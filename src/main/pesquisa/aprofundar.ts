import { type Banco, agoraIso, executar, todos, transacao, um } from '../db/conexao'
import { lerOpcoesPesquisa } from '../repositorios/pesquisa'
import { obterPauta } from '../repositorios/pautas'
import { analisarFeed, analisarPagina, robotsPermite, type ItemExtraido } from './analisadores'
import { criarExecucao } from './executor'
import { analisarConsulta, classificarTipoFonte, dominioDe, pontuar, urlCanonica } from './pontuacao'
import { buscarSeguro } from './rede'
import { detectarIdioma, palavras, pareceInjecao, similaridade } from './texto'

/**
 * Pesquisa extra de um tema: procura a MESMA notícia em outros sites para o dossiê ter várias fontes independentes
 * e a descrição do vídeo trazer os links das matérias (endereço real do site, não o link do agregador).
 *  1) resultados de pesquisas anteriores com título parecido (sem rede);
 *  2) busca de notícias por palavras-chave (Bing Notícias em RSS, que traz o endereço original da matéria);
 *  3) para cada matéria nova, lê só os metadados e um trecho curto da página (respeita o robots.txt).
 * Tudo entra como resultado de uma pesquisa da pauta, com proveniência (site, data, acesso).
 */

/** Rede usada aqui (nos testes, nula: nunca acessa a internet). */
export const redeAprofundar: { buscar: typeof buscarSeguro | null } = { buscar: process.env.VITEST ? null : buscarSeguro }

const AGREGADORES = ['news.google.com', 'bing.com', 'msn.com']
const MAX_NOVAS = 8
const MAX_PAGINAS = 6

/** Link de agregador (Google Notícias): não é o endereço da matéria. */
export const ehAgregador = (url: string): boolean => {
  const d = dominioDe(url)
  return AGREGADORES.some((a) => d === a || d.endsWith(`.${a}`))
}

/** Título sem o " - Nome do site" que agregadores acrescentam. */
export const tituloLimpo = (t: string): string => t.replace(/\s+[-–|]\s+[^-–|]{2,40}$/, '').trim()

/** Palavras-chave da busca: as mais significativas do título (até 7). */
export function termosDaBusca(titulo: string): string {
  return palavras(tituloLimpo(titulo))
    .filter((p) => p.length > 2 || /\d/.test(p) || p === 'ia')
    .slice(0, 7)
    .join(' ')
}

/** As 4 palavras mais marcantes do título (nomes próprios e palavras longas), na ordem original. */
export function termosPrincipais(titulo: string): string {
  const original = tituloLimpo(titulo).split(/\s+/)
  const nomes = new Set(original.filter((w, i) => (i > 0 && /^\p{Lu}/u.test(w)) || /\p{Lu}.*\p{Lu}/u.test(w)).flatMap((w) => palavras(w)))
  const lista = [...new Set(palavras(tituloLimpo(titulo)).filter((p) => p.length > 2 || p === 'ia'))]
  const peso = (p: string): number => (nomes.has(p) ? 10 : 0) + p.length
  const melhores = new Set([...lista].sort((a, b) => peso(b) - peso(a)).slice(0, 4))
  return lista.filter((p) => melhores.has(p)).join(' ')
}

/** O link do Bing Notícias embute o endereço original no parâmetro "url". */
export function urlOriginalBing(link: string): string | null {
  try {
    const u = new URL(link)
    if (!u.hostname.endsWith('bing.com')) return link
    const alvo = u.searchParams.get('url')
    if (!alvo) return null
    const final = new URL(alvo)
    return final.protocol === 'https:' || final.protocol === 'http:' ? final.toString() : null
  } catch {
    return null
  }
}

/** Matéria sobre o mesmo assunto: título parecido ou várias palavras-chave em comum. */
function mesmoAssunto(tituloPauta: string, titulo: string, trecho: string): boolean {
  if (similaridade(tituloLimpo(tituloPauta), tituloLimpo(titulo)) >= 0.3) return true
  const chave = new Set(palavras(tituloLimpo(tituloPauta)))
  const comuns = new Set(palavras(`${titulo} ${trecho}`).filter((p) => chave.has(p)))
  return comuns.size >= Math.min(4, Math.max(2, Math.ceil(chave.size * 0.5)))
}

interface Candidata extends ItemExtraido {
  fonteNome: string
  resultadoId?: number
}

export async function aprofundarPauta(db: Banco, pautaId: number, sinal: AbortSignal, agora = new Date()): Promise<{ novas: number; dominios: number; sites: string[] }> {
  const pauta = obterPauta(db, pautaId)
  const vinculadas = new Set(pauta.fontes.map((f) => urlCanonica(f.url)))
  const dominios = new Set(pauta.fontes.map((f) => f.dominio))
  const candidatas: Candidata[] = []

  // 1) Pesquisas anteriores (últimos 14 dias), sem rede.
  const desde = new Date(agora.getTime() - 14 * 86_400_000).toISOString()
  for (const r of todos<{ id: number; titulo: string; url: string; dominio: string; trecho: string; autor: string; publicadaEm: string | null; fonteNome: string }>(
    db,
    `SELECT r.id, r.titulo, r.url, r.dominio, r.trecho, r.autor, r.publicada_em AS publicadaEm, r.fonte_nome AS fonteNome FROM resultados_pesquisa r
     JOIN execucoes_pesquisa e ON e.id = r.execucao_id WHERE e.projeto_id = :p AND r.alerta_injecao = 0 AND r.criado_em >= :d ORDER BY r.pontuacao DESC LIMIT 2000`,
    { p: pauta.projetoId, d: desde }
  )) {
    if (mesmoAssunto(pauta.titulo, r.titulo, '')) candidatas.push({ ...r, site: `https://${r.dominio}`, resultadoId: r.id })
  }

  // 2) Busca de notícias por palavras-chave (só fora dos testes).
  const buscar = redeAprofundar.buscar
  const termos = termosDaBusca(pauta.titulo)
  // Duas consultas: o título quase inteiro e só as 4 palavras mais marcantes (acha matérias com títulos diferentes).
  const consultas = [...new Set([termos, termosPrincipais(pauta.titulo)])].filter((q) => q.split(' ').length >= 2)
  for (const consultaBusca of buscar ? consultas : []) {
    if (sinal.aborted) break
    try {
      const q = encodeURIComponent(consultaBusca)
      const r = await buscar!(`https://www.bing.com/news/search?q=${q}&format=rss&setlang=pt-BR&cc=BR`, { sinal, tempoLimiteMs: 15_000, tamanhoMaximo: 2 * 1024 * 1024 })
      for (const i of analisarFeed(r.corpo, r.urlFinal).itens) {
        const url = urlOriginalBing(i.url)
        if (!url || !mesmoAssunto(pauta.titulo, i.titulo, i.trecho)) continue
        candidatas.push({ ...i, url, site: undefined, fonteNome: 'Busca de notícias' })
      }
    } catch {
      // sem busca agora: fica com o que já existe localmente
    }
  }

  // Escolhe: primeiro sites ainda não usados (fontes independentes), depois links diretos que substituem agregadores.
  const escolhidas: Candidata[] = []
  const vistas = new Set(vinculadas)
  const ordenadas = [...candidatas].sort((a, b) => Number(ehAgregador(a.url)) - Number(ehAgregador(b.url)))
  for (const c of ordenadas) {
    const canon = urlCanonica(c.url)
    const dom = dominioDe(c.site || c.url)
    if (vistas.has(canon) || ehAgregador(`https://${dom}`) || pareceInjecao(`${c.titulo} ${c.trecho}`)) continue
    const novoSite = !dominios.has(dom)
    const substituiAgregador = !ehAgregador(c.url) && pauta.fontes.some((f) => ehAgregador(f.url) && f.dominio === dom)
    if (!novoSite && !substituiAgregador) continue
    vistas.add(canon)
    dominios.add(dom)
    escolhidas.push(c)
    if (escolhidas.length >= MAX_NOVAS) break
  }

  // 3) Metadados e trecho curto da página de cada matéria nova (respeita robots.txt; nunca o artigo inteiro).
  if (buscar) {
    for (const c of escolhidas.filter((x) => !x.resultadoId).slice(0, MAX_PAGINAS)) {
      if (sinal.aborted) break
      try {
        const u = new URL(c.url)
        const robots = await buscar(`${u.origin}/robots.txt`, { sinal, tempoLimiteMs: 8000, tamanhoMaximo: 256 * 1024, tiposPermitidos: ['text/plain'] })
          .then((r) => r.corpo)
          .catch(() => null)
        if (robots && !robotsPermite(robots, u.pathname + u.search)) continue
        const r = await buscar(c.url, { sinal, tempoLimiteMs: 12_000, tamanhoMaximo: 2 * 1024 * 1024, tiposPermitidos: ['text/html', 'application/xhtml+xml'] })
        const p = analisarPagina(r.corpo, r.urlFinal)
        if (p.trecho.length > c.trecho.length) c.trecho = p.trecho
        if (p.autor && !c.autor) c.autor = p.autor
        if (p.publicadaEm && !c.publicadaEm) c.publicadaEm = p.publicadaEm
        if (p.canonica && !ehAgregador(p.canonica)) c.url = p.canonica
      } catch {
        // página indisponível: fica o trecho da busca
      }
    }
  }

  if (!escolhidas.length) return { novas: 0, dominios: dominios.size, sites: [] }
  const opcoes = lerOpcoesPesquisa(db)
  const execucao = criarExecucao(db, { projetoId: pauta.projetoId, consulta: termos || tituloLimpo(pauta.titulo), pautaId, origem: 'agendada' }, agora)
  const consulta = analisarConsulta(termos || pauta.titulo)
  transacao(db, () => {
    for (const c of escolhidas) {
      let id = c.resultadoId
      if (!id) {
        const dom = dominioDe(c.url)
        const p = pontuar(c, { consulta, nicho: opcoes.nicho, agora, intervalo: { de: new Date(agora.getTime() - 30 * 86_400_000), ate: agora }, confiaveis: [] })
        id = executar(
          db,
          `INSERT INTO resultados_pesquisa (execucao_id, fonte_pesquisa_id, fonte_nome, titulo, url, url_canonica, dominio, autor, publicada_em,
             acessada_em, trecho, idioma, tipo_fonte, relevancia, atualidade, confiabilidade, nicho, pontuacao, explicacao, grupo, duplicado_de,
             alerta_injecao, criado_em)
           VALUES (:e, NULL, :fn, :titulo, :url, :canon, :dom, :autor, :pub, :acesso, :trecho, :idioma, :tipo, :rel, :atu, :conf, :nicho, :total,
             :expl, NULL, NULL, 0, :t)`,
          {
            e: execucao,
            fn: c.fonteNome,
            titulo: c.titulo,
            url: c.url,
            canon: urlCanonica(c.url),
            dom,
            autor: c.autor,
            pub: c.publicadaEm,
            acesso: agora.toISOString(),
            trecho: c.trecho,
            idioma: detectarIdioma(`${c.titulo} ${c.trecho}`),
            tipo: classificarTipoFonte(dom),
            rel: p.relevancia,
            atu: p.atualidade,
            conf: p.confiabilidade,
            nicho: p.nicho,
            total: p.total,
            expl: JSON.stringify(['Encontrada na pesquisa extra do tema (mesma notícia em outro site).', ...p.explicacao]),
            t: agoraIso()
          }
        ).id
      }
      executar(db, 'INSERT OR IGNORE INTO pauta_resultados (pauta_id, resultado_id) VALUES (:p, :r)', { p: pautaId, r: id })
    }
    executar(db, "UPDATE execucoes_pesquisa SET status = 'concluida', iniciada_em = :t, concluida_em = :t, total_resultados = :n WHERE id = :id", {
      id: execucao,
      t: agoraIso(),
      n: escolhidas.length
    })
  })
  const sites = [...new Set(escolhidas.map((c) => dominioDe(c.site || c.url)))]
  return { novas: escolhidas.length, dominios: new Set(obterPauta(db, pautaId).fontes.map((f) => f.dominio)).size, sites }
}

/** Já existe pauta ativa (ou descartada há pouco) sobre o mesmo assunto? Evita repetir o mesmo tema a cada pesquisa. */
export function pautaParecidaExiste(db: Banco, projetoId: number, titulo: string, agora = new Date()): boolean {
  const recente = new Date(agora.getTime() - 3 * 86_400_000).toISOString()
  const pautas = todos<{ titulo: string }>(
    db,
    "SELECT titulo FROM pautas WHERE projeto_id = :p AND combinada_em IS NULL AND (status <> 'descartada' OR (atualizado_em >= :r AND notas NOT LIKE '%recomeçar a fila%'))",
    { p: projetoId, r: recente }
  )
  const alvo = tituloLimpo(titulo)
  return pautas.some((p) => similaridade(tituloLimpo(p.titulo), alvo) >= 0.6) || !!um(db, 'SELECT 1 FROM roteiros WHERE projeto_id = :p AND titulo = :t', { p: projetoId, t: alvo })
}
