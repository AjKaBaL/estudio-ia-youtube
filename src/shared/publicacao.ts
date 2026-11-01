/**
 * Descrição, capítulos, hashtags e links das publicações. Tudo por regras fixas, sem IA:
 * o texto sai só do roteiro, das fontes verificadas e dos links que você cadastrou.
 */

export const CATEGORIAS_LINK = ['rede_social', 'produto', 'afiliado', 'patrocinio', 'site', 'outro'] as const
export type CategoriaLink = (typeof CATEGORIAS_LINK)[number]
export const ROTULO_CATEGORIA_LINK: Record<CategoriaLink, string> = {
  rede_social: 'Redes sociais',
  produto: 'Produtos mencionados',
  afiliado: 'Links de afiliado',
  patrocinio: 'Patrocínio / apoio',
  site: 'Site e contato',
  outro: 'Outros links'
}

export interface LinkDescricao {
  nome: string
  url: string
  categoria: CategoriaLink
  descricao: string
}

export interface Capitulo {
  inicio: number
  titulo: string
}

export interface EntradaDescricao {
  resumo: string
  formato: '16:9' | '9:16'
  duracaoSeg: number
  capitulos: Capitulo[]
  fontes: { titulo: string; url: string }[]
  links: LinkDescricao[]
  tags: string[]
  /** Créditos obrigatórios das mídias de terceiros (autor e licença). Nunca são cortados. */
  creditos?: string[]
  /** Mídia sintética usada no vídeo (para lembrar a divulgação exigida pelo YouTube). */
  sintetico?: { imagens: boolean; voz: boolean }
}

export const LIMITE_DESCRICAO_BYTES = 5000
const bytes = (t: string): number => new TextEncoder().encode(t).length

/** O YouTube recusa < e > na descrição e no título. */
export const limparTextoYouTube = (t: string): string => t.replace(/</g, '‹').replace(/>/g, '›')

export function formatarTempo(seg: number): string {
  const s = Math.max(0, Math.floor(seg))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${String(m).padStart(2, '0')}:${ss}`
}

/**
 * Capítulos válidos para o YouTube: o primeiro em 00:00, pelo menos 3 e cada um com 10 s ou mais.
 * Capítulos curtos são unidos ao anterior. Devolve [] (com o motivo) se não der para cumprir as regras.
 */
export function capitulosValidos(cenas: Capitulo[], duracaoTotal: number): { capitulos: Capitulo[]; motivo: string | null } {
  const ordenadas = [...cenas].filter((c) => c.titulo.trim()).sort((a, b) => a.inicio - b.inicio)
  if (!ordenadas.length) return { capitulos: [], motivo: 'O projeto de edição não tem cenas.' }
  const lista: Capitulo[] = [{ inicio: 0, titulo: ordenadas[0]!.titulo.trim() }]
  for (const c of ordenadas.slice(1)) {
    const ultimo = lista[lista.length - 1]!
    if (c.inicio - ultimo.inicio >= 10) lista.push({ inicio: c.inicio, titulo: c.titulo.trim() })
  }
  // O último capítulo também precisa durar 10 s.
  while (lista.length > 1 && duracaoTotal - lista[lista.length - 1]!.inicio < 10) lista.pop()
  if (lista.length < 3) return { capitulos: [], motivo: 'O YouTube exige pelo menos 3 capítulos de 10 s ou mais; este vídeo tem cenas curtas demais para isso.' }
  return { capitulos: lista.map((c) => ({ ...c, titulo: limparTextoYouTube(c.titulo).slice(0, 100) })), motivo: null }
}

/** Hashtags a partir das tags: sem espaços nem acentos, no máximo 3 (o YouTube mostra as 3 primeiras acima do título). */
export function hashtags(tags: string[], max = 3): string[] {
  const vistos = new Set<string>()
  const saida: string[] = []
  for (const t of tags) {
    const h = t
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .split(/[^A-Za-z0-9]+/)
      .filter(Boolean)
      .map((p, i) => (i === 0 ? p.toLowerCase() : p[0]!.toUpperCase() + p.slice(1).toLowerCase()))
      .join('')
    if (h.length < 2 || h.length > 40 || vistos.has(h.toLowerCase())) continue
    vistos.add(h.toLowerCase())
    saida.push(`#${h}`)
    if (saida.length >= max) break
  }
  return saida
}

export interface DescricaoGerada {
  texto: string
  avisos: string[]
  hashtags: string[]
}

const AVISO_AFILIADO = 'Alguns links acima são de afiliado: se você comprar por eles, o canal pode receber uma comissão, sem custo extra para você.'

/** Monta a descrição em blocos fixos; se passar de 5000 bytes, encurta a lista de fontes e depois a de links. */
export function gerarDescricao(e: EntradaDescricao): DescricaoGerada {
  const avisos: string[] = []
  const tagsHash = hashtags(e.tags)
  const resumo = limparTextoYouTube(e.resumo.trim())
  if (!resumo) avisos.push('O roteiro não tem tema/resumo: escreva o primeiro parágrafo da descrição à mão (é o que aparece na busca).')

  let capitulos: Capitulo[] = []
  if (e.formato === '16:9') {
    const r = capitulosValidos(e.capitulos, e.duracaoSeg)
    capitulos = r.capitulos
    if (r.motivo) avisos.push(`Capítulos não incluídos: ${r.motivo}`)
  }

  const linksPorCategoria = CATEGORIAS_LINK.map((c) => [c, e.links.filter((l) => l.categoria === c)] as const).filter(([, l]) => l.length > 0)
  const temAfiliado = e.links.some((l) => l.categoria === 'afiliado')
  if (e.links.some((l) => l.categoria === 'patrocinio')) avisos.push('Há link de patrocínio: marque “Inclui promoção paga” no YouTube Studio (obrigatório pelas regras do YouTube).')
  if (e.sintetico?.imagens) avisos.push('O vídeo usa imagens geradas por IA: se alguma parecer real (pessoa, lugar ou acontecimento), marque “Conteúdo alterado ou sintético” no YouTube Studio.')
  if (e.sintetico?.voz) avisos.push('A narração usa voz sintética: se ela imitar uma pessoa real, a divulgação de conteúdo sintético é obrigatória no YouTube.')
  if (e.formato === '9:16' && e.links.length) avisos.push('Em Shorts, links na descrição podem não ser clicáveis; prefira o link no perfil do canal ou no vídeo longo relacionado.')

  const montar = (nFontes: number, nLinks: number): string => {
    const blocos: string[] = []
    if (resumo) blocos.push(resumo)
    if (capitulos.length) blocos.push(['Capítulos', ...capitulos.map((c) => `${formatarTempo(c.inicio)} ${c.titulo}`)].join('\n'))
    let restantes = nLinks
    const partesLinks: string[] = []
    for (const [cat, lista] of linksPorCategoria) {
      const usados = lista.slice(0, Math.max(0, restantes))
      restantes -= usados.length
      if (!usados.length) continue
      partesLinks.push([ROTULO_CATEGORIA_LINK[cat], ...usados.map((l) => `- ${limparTextoYouTube(l.nome)}${l.descricao ? ` (${limparTextoYouTube(l.descricao)})` : ''}: ${l.url}`)].join('\n'))
    }
    if (partesLinks.length) blocos.push(partesLinks.join('\n\n'))
    if (temAfiliado && nLinks > 0) blocos.push(AVISO_AFILIADO)
    if (e.creditos?.length) blocos.push(['Créditos das imagens e vídeos', ...e.creditos.map((c) => `- ${limparTextoYouTube(c)}`)].join('\n'))
    if (e.fontes.length && nFontes > 0) {
      const fontes = e.fontes.slice(0, nFontes).map((f) => `- ${limparTextoYouTube(f.titulo)}: ${f.url}`)
      if (nFontes < e.fontes.length) fontes.push(`(mais ${e.fontes.length - nFontes} fonte(s) no dossiê do vídeo)`)
      blocos.push(['Fontes', ...fontes].join('\n'))
    }
    if (tagsHash.length) blocos.push(tagsHash.join(' '))
    return blocos.join('\n\n')
  }

  let nFontes = e.fontes.length
  let nLinks = e.links.length
  let texto = montar(nFontes, nLinks)
  while (bytes(texto) > LIMITE_DESCRICAO_BYTES && nFontes > 0) texto = montar(--nFontes, nLinks)
  while (bytes(texto) > LIMITE_DESCRICAO_BYTES && nLinks > 0) texto = montar(nFontes, --nLinks)
  if (nFontes < e.fontes.length) avisos.push(`A descrição passaria de 5000 bytes: só ${nFontes} de ${e.fontes.length} fontes couberam.`)
  if (nLinks < e.links.length) avisos.push(`A descrição passaria de 5000 bytes: só ${nLinks} de ${e.links.length} links couberam.`)
  if (bytes(texto) > LIMITE_DESCRICAO_BYTES) texto = new TextDecoder().decode(new TextEncoder().encode(texto).slice(0, LIMITE_DESCRICAO_BYTES)).replace(/�$/, '')
  if (!tagsHash.length) avisos.push('Sem palavras-chave no roteiro: nenhuma hashtag foi criada.')
  return { texto, avisos, hashtags: tagsHash }
}

