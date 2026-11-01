import { type Banco, type Parametros, agoraIso, executar, normalizarTexto, padraoLike, todos, transacao, um } from '../db/conexao'
import { ErroApp, naoEncontrado } from '../erros'
import { similaridade } from '../pesquisa/texto'
import { gravarConfig, lerConfig } from './configuracoes'
import { ALVO_PAUTA, definirPalavrasChave, palavrasChaveDe, separarPalavras } from './palavrasChave'
import type { StatusPauta, TipoVideo } from '@shared/dominio'
import { PESOS_PADRAO, avaliarPauta, pesosSchema, type FontePreliminar, type PesosPlanejador, type Semelhante } from '@shared/planejador'
import type { Pauta, PautaDetalhe, ResultadoPesquisa } from '@shared/tipos'

const SELECT = `
  SELECT a.id, a.projeto_id AS projetoId, p.nome AS projetoNome, a.titulo, a.tema, a.notas, a.status,
    a.pergunta_central AS perguntaCentral, a.resumo, a.publico, a.tipo_sugerido AS tipoSugerido,
    a.potencial_narrativa AS potencialNarrativa, a.combinada_em AS combinadaEm, a.na_fila_pesquisa AS naFilaPesquisa, a.origem, a.prioridade,
    a.criado_em AS criadoEm, a.atualizado_em AS atualizadoEm,
    (SELECT group_concat(k.termo, char(31)) FROM pauta_palavras_chave pk
       JOIN palavras_chave k ON k.id = pk.palavra_chave_id WHERE pk.pauta_id = a.id) AS palavras
  FROM pautas a JOIN projetos p ON p.id = a.projeto_id`

type Linha = Omit<Pauta, 'palavrasChave' | 'naFilaPesquisa' | 'pontuacao' | 'riscosAltos' | 'riscos'> & { palavras: string | null; naFilaPesquisa: number }

// ------------------------------------------------------------------ pesos

const CHAVE_PESOS = 'planejador.pesos'

export function lerPesos(db: Banco): PesosPlanejador {
  const r = pesosSchema.safeParse(lerConfig(db, CHAVE_PESOS))
  return r.success ? r.data : PESOS_PADRAO
}

export function salvarPesos(db: Banco, p: PesosPlanejador): PesosPlanejador {
  gravarConfig(db, CHAVE_PESOS, p)
  return p
}

// ------------------------------------------------------------------ avaliação

function fontesDaPauta(db: Banco, pautaId: number): (ResultadoPesquisa & FontePreliminar)[] {
  return todos<Omit<ResultadoPesquisa, 'explicacao' | 'alertaInjecao'> & { explicacao: string; alertaInjecao: number }>(
    db,
    `SELECT r.id, r.fonte_nome AS fonteNome, r.titulo, r.url, r.dominio, r.autor, r.publicada_em AS publicadaEm, r.acessada_em AS acessadaEm,
       r.trecho, r.idioma, r.tipo_fonte AS tipoFonte, r.relevancia, r.atualidade, r.confiabilidade, r.nicho, r.pontuacao, r.explicacao,
       r.grupo, r.duplicado_de AS duplicadoDe, r.alerta_injecao AS alertaInjecao
     FROM pauta_resultados pr JOIN resultados_pesquisa r ON r.id = pr.resultado_id WHERE pr.pauta_id = :id ORDER BY r.pontuacao DESC`,
    { id: pautaId }
  ).map((r) => ({ ...r, explicacao: JSON.parse(r.explicacao) as string[], alertaInjecao: Boolean(r.alertaInjecao) }))
}

/** Roteiros e outras pautas parecidos (título, tema e palavras-chave). Não bloqueia: só recomenda diferenciar. */
export function semelhantesA(db: Banco, alvo: { id?: number; projetoId: number; titulo: string; tema: string; palavrasChave: string[] }): Semelhante[] {
  const texto = `${alvo.titulo} ${alvo.tema} ${alvo.palavrasChave.join(' ')}`
  const roteiros = todos<{ id: number; titulo: string; tema: string; pautaId: number | null }>(
    db,
    'SELECT id, titulo, tema, pauta_id AS pautaId FROM roteiros WHERE projeto_id = :p',
    { p: alvo.projetoId }
  )
  const pautas = todos<{ id: number; titulo: string; tema: string }>(
    db,
    'SELECT id, titulo, tema FROM pautas WHERE projeto_id = :p AND combinada_em IS NULL AND id <> :id',
    { p: alvo.projetoId, id: alvo.id ?? 0 }
  )
  const lista: Semelhante[] = [
    ...roteiros.filter((r) => r.pautaId !== alvo.id).map((r) => ({ tipo: 'roteiro' as const, id: r.id, titulo: r.titulo, similaridade: similaridade(texto, `${r.titulo} ${r.tema}`) })),
    ...pautas.map((p) => ({ tipo: 'pauta' as const, id: p.id, titulo: p.titulo, similaridade: similaridade(texto, `${p.titulo} ${p.tema}`) }))
  ]
  return lista.filter((s) => s.similaridade >= 0.3).sort((a, b) => b.similaridade - a.similaridade).slice(0, 5)
}

function completar(db: Banco, l: Linha, pesos: PesosPlanejador, agora: Date): PautaDetalhe {
  const { palavras, ...resto } = l
  const palavrasChave = separarPalavras(palavras)
  const fontes = fontesDaPauta(db, l.id)
  const avaliacao = avaliarPauta(
    { tipoSugerido: l.tipoSugerido, potencialNarrativa: l.potencialNarrativa, resumo: l.resumo },
    fontes,
    semelhantesA(db, { id: l.id, projetoId: l.projetoId, titulo: l.titulo, tema: l.tema, palavrasChave }),
    pesos,
    agora
  )
  return {
    ...resto,
    naFilaPesquisa: Boolean(l.naFilaPesquisa),
    palavrasChave,
    pontuacao: avaliacao.pontuacao.total,
    riscosAltos: avaliacao.riscos.filter((r) => r.nivel === 'alto').length,
    riscos: avaliacao.riscos.length,
    avaliacao,
    fontes
  }
}

// ------------------------------------------------------------------ consulta

export function listarPautas(db: Banco, f: { texto: string; status: StatusPauta | null; incluirCombinadas?: boolean }, agora = new Date()): Pauta[] {
  const where: string[] = []
  const p: Parametros = {}
  if (f.texto) {
    p.like = padraoLike(normalizarTexto(f.texto))
    where.push(`(normalizar(a.titulo) LIKE :like ESCAPE '\\' OR normalizar(a.tema) LIKE :like ESCAPE '\\'
      OR normalizar(a.notas) LIKE :like ESCAPE '\\' OR normalizar(a.resumo) LIKE :like ESCAPE '\\'
      OR EXISTS (SELECT 1 FROM pauta_palavras_chave pk JOIN palavras_chave k ON k.id = pk.palavra_chave_id
                 WHERE pk.pauta_id = a.id AND normalizar(k.termo) LIKE :like ESCAPE '\\'))`)
  }
  if (f.status) {
    p.status = f.status
    where.push('a.status = :status')
  }
  if (!f.incluirCombinadas) where.push('a.combinada_em IS NULL')
  const pesos = lerPesos(db)
  return todos<Linha>(db, `${SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY a.atualizado_em DESC`, p).map((l) => {
    const { avaliacao: _a, fontes: _f, ...resumo } = completar(db, l, pesos, agora)
    return resumo
  })
}

export function obterPauta(db: Banco, id: number, agora = new Date()): PautaDetalhe {
  const a = um<Linha>(db, `${SELECT} WHERE a.id = :id`, { id })
  if (!a) throw naoEncontrado('Pauta')
  return completar(db, a, lerPesos(db), agora)
}

// ------------------------------------------------------------------ edição

interface CamposPauta {
  titulo: string
  tema: string
  notas: string
  palavrasChave: string[]
  perguntaCentral: string
  resumo: string
  publico: string
  tipoSugerido: TipoVideo | null
  potencialNarrativa: number | null
}

export function criarPauta(db: Banco, d: CamposPauta & { projetoId: number; origem?: string }): PautaDetalhe {
  return transacao(db, () => {
    const agora = agoraIso()
    const { id } = executar(
      db,
      `INSERT INTO pautas (projeto_id, titulo, tema, notas, pergunta_central, resumo, publico, tipo_sugerido, potencial_narrativa, origem, criado_em, atualizado_em)
       VALUES (:projetoId, :titulo, :tema, :notas, :pergunta, :resumo, :publico, :tipo, :narrativa, :origem, :agora, :agora)`,
      {
        projetoId: d.projetoId,
        titulo: d.titulo,
        tema: d.tema,
        notas: d.notas,
        pergunta: d.perguntaCentral,
        resumo: d.resumo,
        publico: d.publico,
        tipo: d.tipoSugerido,
        narrativa: d.potencialNarrativa,
        origem: d.origem ?? 'manual',
        agora
      }
    )
    definirPalavrasChave(db, ALVO_PAUTA, id, d.palavrasChave)
    return obterPauta(db, id)
  })
}

export function atualizarPauta(db: Banco, d: CamposPauta & { id: number; status: StatusPauta }): PautaDetalhe {
  return transacao(db, () => {
    const r = executar(
      db,
      `UPDATE pautas SET titulo = :titulo, tema = :tema, notas = :notas, status = :status, pergunta_central = :pergunta, resumo = :resumo,
         publico = :publico, tipo_sugerido = :tipo, potencial_narrativa = :narrativa, atualizado_em = :agora WHERE id = :id`,
      {
        id: d.id,
        titulo: d.titulo,
        tema: d.tema,
        notas: d.notas,
        status: d.status,
        pergunta: d.perguntaCentral,
        resumo: d.resumo,
        publico: d.publico,
        tipo: d.tipoSugerido,
        narrativa: d.potencialNarrativa,
        agora: agoraIso()
      }
    )
    if (r.changes === 0) throw naoEncontrado('Pauta')
    definirPalavrasChave(db, ALVO_PAUTA, d.id, d.palavrasChave)
    return obterPauta(db, d.id)
  })
}

export function alterarStatusPauta(db: Banco, id: number, status: StatusPauta): PautaDetalhe {
  if (executar(db, 'UPDATE pautas SET status = :status, atualizado_em = :t WHERE id = :id', { id, status, t: agoraIso() }).changes === 0) throw naoEncontrado('Pauta')
  return obterPauta(db, id)
}

/** Roteiros ligados à pauta são mantidos (o vínculo vira vazio). */
export function excluirPauta(db: Banco, id: number): void {
  const r = executar(db, 'DELETE FROM pautas WHERE id = :id', { id })
  if (r.changes === 0) throw naoEncontrado('Pauta')
}

/**
 * Exclui várias pautas de uma vez (pedido explícito do usuário). Mantém as que estão em produção na agenda ou ligadas
 * a um vídeo já publicado; roteiros e pesquisas ligados às excluídas continuam guardados.
 */
export function excluirPautas(db: Banco, ids: number[]): { excluidas: number; mantidas: number } {
  let excluidas = 0
  let mantidas = 0
  transacao(db, () => {
    for (const id of new Set(ids)) {
      if (um(db, "SELECT 1 FROM calendario_entradas WHERE pauta_id = :id AND status IN ('planejado','publicado')", { id })) {
        mantidas++
        continue
      }
      try {
        excluidas += executar(db, 'DELETE FROM pautas WHERE id = :id', { id }).changes
      } catch {
        mantidas++ // ligada a algo que não pode perder a referência
      }
    }
  })
  return { excluidas, mantidas }
}

// ------------------------------------------------------------------ a partir da pesquisa

/** Cria um cartão de pauta a partir de resultados de pesquisa. Os resultados originais não são alterados. */
export function pautaDeResultados(db: Banco, projetoId: number, resultadoIds: number[]): PautaDetalhe {
  return transacao(db, () => {
    const marcadores = resultadoIds.map((_, i) => `:r${i}`).join(',')
    const params = Object.fromEntries(resultadoIds.map((v, i) => [`r${i}`, v]))
    const resultados = todos<{ id: number; titulo: string; trecho: string; projetoId: number; consulta: string }>(
      db,
      `SELECT r.id, r.titulo, r.trecho, e.projeto_id AS projetoId, e.consulta FROM resultados_pesquisa r
       JOIN execucoes_pesquisa e ON e.id = r.execucao_id WHERE r.id IN (${marcadores}) ORDER BY r.pontuacao DESC`,
      params
    )
    if (resultados.length !== resultadoIds.length) throw naoEncontrado('Resultado de pesquisa')
    if (resultados.some((r) => r.projetoId !== projetoId)) throw new ErroApp('projeto_diferente', 'Os resultados pertencem a outro projeto.')
    const principal = resultados[0]!
    const consultas = [...new Set(resultados.map((r) => r.consulta))]
    const pauta = criarPauta(db, {
      projetoId,
      titulo: principal.titulo.slice(0, 200),
      tema: '',
      notas: `Criada a partir de ${resultados.length} resultado(s) da pesquisa: ${consultas.join(' | ')}`.slice(0, 5000),
      palavrasChave: [],
      perguntaCentral: '',
      resumo: resultados.map((r) => r.trecho).filter(Boolean).slice(0, 3).join('\n\n').slice(0, 2000),
      publico: '',
      tipoSugerido: null,
      potencialNarrativa: null,
      origem: 'pesquisa'
    })
    for (const r of resultados) executar(db, 'INSERT OR IGNORE INTO pauta_resultados (pauta_id, resultado_id) VALUES (:p, :r)', { p: pauta.id, r: r.id })
    return obterPauta(db, pauta.id)
  })
}

export function removerResultadoDaPauta(db: Banco, pautaId: number, resultadoId: number): PautaDetalhe {
  executar(db, 'DELETE FROM pauta_resultados WHERE pauta_id = :p AND resultado_id = :r', { p: pautaId, r: resultadoId })
  return obterPauta(db, pautaId)
}

/** Combina pautas em uma nova. As originais ficam preservadas e marcadas como "combinadas". */
export function combinarPautas(db: Banco, ids: number[], titulo: string): PautaDetalhe {
  return transacao(db, () => {
    const originais = ids.map((id) => obterPauta(db, id))
    const projetoId = originais[0]!.projetoId
    if (originais.some((o) => o.projetoId !== projetoId)) throw new ErroApp('projeto_diferente', 'Só é possível combinar pautas do mesmo projeto.')
    if (originais.some((o) => o.combinadaEm !== null)) throw new ErroApp('ja_combinada', 'Uma das pautas já foi combinada em outra.')
    const nova = criarPauta(db, {
      projetoId,
      titulo,
      tema: [...new Set(originais.map((o) => o.tema).filter(Boolean))].join(' / ').slice(0, 200),
      notas: [`Combinada de: ${originais.map((o) => `“${o.titulo}” (nº ${o.id})`).join(', ')}`, ...originais.map((o) => o.notas).filter(Boolean)].join('\n\n').slice(0, 5000),
      palavrasChave: [...new Set(originais.flatMap((o) => o.palavrasChave))].slice(0, 30),
      perguntaCentral: originais.map((o) => o.perguntaCentral).find(Boolean) ?? '',
      resumo: originais.map((o) => o.resumo).filter(Boolean).join('\n\n').slice(0, 5000),
      publico: originais.map((o) => o.publico).find(Boolean) ?? '',
      tipoSugerido: null,
      potencialNarrativa: null,
      origem: 'combinacao'
    })
    for (const o of originais) {
      executar(db, 'INSERT OR IGNORE INTO pauta_resultados (pauta_id, resultado_id) SELECT :n, resultado_id FROM pauta_resultados WHERE pauta_id = :o', { n: nova.id, o: o.id })
      executar(db, 'UPDATE pautas SET combinada_em = :n, atualizado_em = :t WHERE id = :o', { n: nova.id, o: o.id, t: agoraIso() })
    }
    return obterPauta(db, nova.id)
  })
}

export const TIPO_PESQUISA_PAUTA = 'pesquisa_pauta'

/** Coloca a pauta na fila de pesquisa: uma tarefa usará as palavras-chave (ou o título) como consulta. */
export function colocarNaFilaPesquisa(db: Banco, id: number): PautaDetalhe {
  const p = obterPauta(db, id)
  if (p.naFilaPesquisa) throw new ErroApp('ja_na_fila', 'Esta pauta já está na fila de pesquisa.')
  transacao(db, () => {
    const t = agoraIso()
    executar(
      db,
      `INSERT INTO tarefas (tipo, descricao, status, referencia_tipo, referencia_id, criado_em, atualizado_em)
       VALUES (:tipo, :d, 'pendente', 'pauta', :id, :t, :t)`,
      { tipo: TIPO_PESQUISA_PAUTA, d: `Pesquisar pauta: ${p.titulo}`.slice(0, 200), id, t }
    )
    executar(db, 'UPDATE pautas SET na_fila_pesquisa = 1, atualizado_em = :t WHERE id = :id', { id, t })
  })
  return obterPauta(db, id)
}

export function consultaDaPauta(db: Banco, id: number): { projetoId: number; consulta: string } {
  const p = um<{ projetoId: number; titulo: string }>(db, 'SELECT projeto_id AS projetoId, titulo FROM pautas WHERE id = :id', { id })
  if (!p) throw naoEncontrado('Pauta')
  const palavras = palavrasChaveDe(db, ALVO_PAUTA, id)
  return { projetoId: p.projetoId, consulta: (palavras.length ? palavras.join(', ') : p.titulo).slice(0, 300) }
}
