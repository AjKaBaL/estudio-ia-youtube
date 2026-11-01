/** Utilidades de texto para conteúdo externo. Tudo é tratado como texto puro; nada é executado. */

const ENTIDADES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', laquo: '«', raquo: '»', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' }

export function decodificarEntidades(texto: string): string {
  return texto.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (todo, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''
    }
    return ENTIDADES[e.toLowerCase()] ?? todo
  })
}

/** Remove blocos perigosos ou inúteis e todas as tags, devolvendo texto limpo. */
export function htmlParaTexto(html: string): string {
  return decodificarEntidades(
    html
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/<(script|style|noscript|iframe|object|embed|svg|template)[\s\S]*?<\/\1\s*>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6])>/gi, '\n')
      .replace(/<[^>]*>/g, ' ')
  )
    .replace(/[ \t\f\v\r]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim()
}

export function limitar(texto: string, max: number): string {
  if (texto.length <= max) return texto
  const corte = texto.slice(0, max)
  const ultimoEspaco = corte.lastIndexOf(' ')
  return `${corte.slice(0, ultimoEspaco > max * 0.6 ? ultimoEspaco : max)}…`
}

/** Minúsculas, sem acentos e sem pontuação. */
export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const PALAVRAS_VAZIAS = new Set(
  'a o as os de da do das dos e em no na nos nas um uma uns umas para por com sem que se ao aos como mais menos sobre entre the of and to in for on with is are be by an at from or as it this that its el la los las y en del'.split(' ')
)

export function palavras(texto: string): string[] {
  return normalizar(texto)
    .split(' ')
    .filter((p) => p.length > 1 && !PALAVRAS_VAZIAS.has(p))
}

/** Similaridade de Jaccard entre conjuntos de palavras (0 a 1). */
export function similaridade(a: string, b: string): number {
  const A = new Set(palavras(a))
  const B = new Set(palavras(b))
  if (A.size === 0 || B.size === 0) return 0
  let inter = 0
  for (const p of A) if (B.has(p)) inter++
  return inter / (A.size + B.size - inter)
}

const MARCAS_IDIOMA: Record<string, string[]> = {
  pt: ['não', 'são', 'também', 'você', 'está', 'pelo', 'pela', 'uma', 'mais', 'isso', 'como', 'para', 'com'],
  en: ['the', 'and', 'with', 'this', 'that', 'from', 'have', 'will', 'are', 'for', 'about', 'which'],
  es: ['el', 'los', 'las', 'del', 'por', 'una', 'pero', 'también', 'está', 'según', 'muy', 'sus']
}

/** Detecção simples de idioma por palavras frequentes (estimativa). */
export function detectarIdioma(texto: string): 'pt' | 'en' | 'es' | 'desconhecido' {
  const tokens = texto.toLowerCase().split(/[^\p{L}]+/u)
  let melhor: 'pt' | 'en' | 'es' | 'desconhecido' = 'desconhecido'
  let maior = 1
  for (const [idioma, marcas] of Object.entries(MARCAS_IDIOMA)) {
    const set = new Set(marcas)
    const n = tokens.filter((t) => set.has(t)).length
    if (n > maior) {
      maior = n
      melhor = idioma as 'pt' | 'en' | 'es'
    }
  }
  return melhor
}

/**
 * Detecta textos que tentam dar ordens a um modelo de IA (prompt injection).
 * O conteúdo continua sendo só dado; o alerta serve para o usuário e para etapas futuras.
 */
const PADROES_INJECAO = [
  /ignore\s+(all\s+|any\s+)?(the\s+)?(previous|prior|above)\s+(instructions|prompts?)/i,
  /disregard\s+(all\s+|the\s+)?(previous|prior|above)/i,
  /ignor(e|ar|em)\s+(todas\s+)?(as\s+)?instru[çc][õo]es\s+(anteriores|acima)/i,
  /(reveal|show|print)\s+(your\s+)?(system\s+prompt|instructions|api\s*key|secrets?)/i,
  /revel(e|ar)\s+(o\s+|a\s+|seu\s+|sua\s+)?(prompt|chave|senha|segredo|token)/i,
  /you\s+are\s+now\s+(a|an|in)\b/i,
  /voc[êe]\s+agora\s+[ée]\s+/i,
  /\b(system|assistant)\s*:\s*/i,
  /<\s*\/?\s*(system|instructions?)\s*>/i,
  /(send|envie|enviar)\s+.{0,40}(token|senha|password|api\s*key|credencia)/i
]

export function pareceInjecao(texto: string): boolean {
  return PADROES_INJECAO.some((p) => p.test(texto))
}
