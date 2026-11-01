import type { TipoFonte } from '@shared/dominio'
import { normalizar, similaridade } from './texto'

/**
 * Classificação de resultados por regras fixas e explicáveis (sem IA).
 * As notas são ESTIMATIVAS para ajudar a ordenar, não medidas de verdade ou de audiência.
 */

// ------------------------------------------------------------------ consulta

/**
 * Sintaxe da consulta: vírgulas separam alternativas (OU); dentro de cada alternativa todas
 * as palavras precisam aparecer (E); aspas exigem a expressão exata.
 * Ex.: "inteligência artificial" varejo, chips quânticos
 */
export type Consulta = { grupos: { termos: string[]; frases: string[] }[]; original: string }

export function analisarConsulta(texto: string): Consulta {
  const grupos = texto
    .split(',')
    .map((parte) => {
      const frases = [...parte.matchAll(/"([^"]+)"/g)].map((m) => normalizar(m[1]!)).filter(Boolean)
      const termos = normalizar(parte.replace(/"[^"]*"/g, ' '))
        .split(' ')
        .filter((t) => t.length > 1)
      return { termos, frases }
    })
    .filter((g) => g.termos.length || g.frases.length)
  return { grupos, original: texto.trim() }
}

export function correspondeConsulta(c: Consulta, texto: string): boolean {
  if (c.grupos.length === 0) return true
  const n = ` ${normalizar(texto)} `
  return c.grupos.some((g) => g.frases.every((f) => n.includes(` ${f} `)) && g.termos.every((t) => n.includes(` ${t}`)))
}

// ------------------------------------------------------------------ URLs e domínios

const PARAMETROS_RASTREIO = /^(utm_|mc_|fbclid$|gclid$|dclid$|igshid$|ref$|ref_src$|spm$|cmpid$|ocid$)/i

export function urlCanonica(url: string): string {
  try {
    const u = new URL(url)
    u.hash = ''
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, '')
    const params = [...u.searchParams.entries()].filter(([k]) => !PARAMETROS_RASTREIO.test(k)).sort(([a], [b]) => a.localeCompare(b))
    u.search = new URLSearchParams(params).toString()
    u.protocol = 'https:'
    return u.href.replace(/\/(\?|$)/, '$1')
  } catch {
    return url
  }
}

export function dominioDe(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

/** Domínio corresponde à regra (inclui subdomínios: "gov.br" vale para "www.ibge.gov.br"). */
export function dominioCasa(dominio: string, regra: string): boolean {
  const r = regra.toLowerCase().replace(/^www\./, '')
  return dominio === r || dominio.endsWith(`.${r}`)
}

const REDES_SOCIAIS = ['x.com', 'twitter.com', 'facebook.com', 'instagram.com', 'tiktok.com', 'youtube.com', 'reddit.com', 'linkedin.com', 'threads.net', 'medium.com', 'substack.com']
const ESTUDOS = ['arxiv.org', 'doi.org', 'scielo.br', 'scielo.org', 'nature.com', 'science.org', 'acm.org', 'ieee.org', 'pubmed.ncbi.nlm.nih.gov']

export function classificarTipoFonte(dominio: string): TipoFonte {
  if (/(^|\.)(gov|gov\.br|mil|jus\.br|leg\.br|europa\.eu|int)$/.test(dominio)) return 'oficial'
  if (ESTUDOS.some((d) => dominioCasa(dominio, d)) || /(^|\.)(edu|edu\.br|ac\.uk)$/.test(dominio)) return 'estudo'
  if (REDES_SOCIAIS.some((d) => dominioCasa(dominio, d))) return 'rede_social'
  if (/^(docs|developer|developers|dev)\./.test(dominio)) return 'documentacao'
  return 'outro'
}

// ------------------------------------------------------------------ pontuação

export interface ContextoPontuacao {
  consulta: Consulta
  nicho: string[]
  agora: Date
  intervalo: { de: Date; ate: Date }
  confiaveis: string[]
}

export interface Pontuacao {
  relevancia: number
  atualidade: number
  confiabilidade: number
  nicho: number
  total: number
  explicacao: string[]
}

const PESOS = { relevancia: 0.35, atualidade: 0.25, confiabilidade: 0.25, nicho: 0.15 }
const pct = (n: number): string => `${Math.round(n * 100)}%`

export function pontuar(item: { titulo: string; trecho: string; url: string; publicadaEm: string | null }, ctx: ContextoPontuacao): Pontuacao {
  const explicacao: string[] = []
  const titulo = ` ${normalizar(item.titulo)} `
  const corpo = ` ${normalizar(`${item.titulo} ${item.trecho}`)} `

  // Relevância: termos da consulta no título valem o dobro dos encontrados só no trecho.
  const termos = [...new Set(ctx.consulta.grupos.flatMap((g) => [...g.termos, ...g.frases]))]
  let relevancia = 0.5
  if (termos.length) {
    const pontos = termos.reduce((s, t) => s + (titulo.includes(` ${t}`) ? 2 : corpo.includes(` ${t}`) ? 1 : 0), 0)
    relevancia = Math.min(1, pontos / (termos.length * 2))
    explicacao.push(`Relevância ${pct(relevancia)}: ${termos.filter((t) => corpo.includes(` ${t}`)).length} de ${termos.length} termo(s) encontrados.`)
  } else {
    explicacao.push('Relevância 50%: consulta sem termos.')
  }

  // Atualidade: decai linearmente ao longo do intervalo pesquisado.
  let atualidade = 0.3
  if (item.publicadaEm) {
    const total = Math.max(1, ctx.intervalo.ate.getTime() - ctx.intervalo.de.getTime())
    const idade = ctx.agora.getTime() - new Date(item.publicadaEm).getTime()
    atualidade = Math.max(0.05, Math.min(1, 1 - idade / total))
    explicacao.push(`Atualidade ${pct(atualidade)}: publicado há ${Math.max(0, Math.round(idade / 86_400_000))} dia(s).`)
  } else {
    explicacao.push('Atualidade 30%: sem data de publicação.')
  }

  // Confiabilidade aproximada pelo domínio.
  const dominio = dominioDe(item.url)
  const tipo = classificarTipoFonte(dominio)
  let confiabilidade = 0.5
  let motivo = 'domínio sem histórico'
  if (ctx.confiaveis.some((r) => dominioCasa(dominio, r))) {
    confiabilidade = 0.9
    motivo = 'domínio marcado como confiável por você'
  } else if (tipo === 'oficial') {
    confiabilidade = 0.85
    motivo = 'domínio institucional/governamental'
  } else if (tipo === 'estudo') {
    confiabilidade = 0.8
    motivo = 'repositório acadêmico ou científico'
  } else if (tipo === 'documentacao') {
    confiabilidade = 0.7
    motivo = 'documentação técnica'
  } else if (tipo === 'rede_social') {
    confiabilidade = 0.3
    motivo = 'rede social ou plataforma aberta'
  }
  explicacao.push(`Confiabilidade aproximada ${pct(confiabilidade)}: ${motivo}.`)

  // Relação com o nicho do canal.
  const nichoEncontrados = ctx.nicho.filter((t) => corpo.includes(` ${normalizar(t)}`))
  const nicho = ctx.nicho.length ? Math.min(1, nichoEncontrados.length / 2) : 0.5
  explicacao.push(
    ctx.nicho.length ? `Nicho ${pct(nicho)}: ${nichoEncontrados.length ? nichoEncontrados.join(', ') : 'nenhum termo do nicho'}.` : 'Nicho 50%: nenhum termo de nicho configurado.'
  )

  const total = Math.round(100 * (PESOS.relevancia * relevancia + PESOS.atualidade * atualidade + PESOS.confiabilidade * confiabilidade + PESOS.nicho * nicho))
  return { relevancia, atualidade, confiabilidade, nicho, total, explicacao }
}

// ------------------------------------------------------------------ duplicatas e eventos

export interface Agrupamento {
  duplicadoDe: number | null
  grupo: number
}

/** Marca URLs repetidas (mesma URL canônica) e agrupa notícias sobre o mesmo evento por semelhança de título. */
export function agrupar(itens: readonly { url: string; titulo: string }[], limiarEvento = 0.5): Agrupamento[] {
  const vistos = new Map<string, number>()
  const grupos: number[] = []
  return itens.map((item, i) => {
    const canon = urlCanonica(item.url)
    const anterior = vistos.get(canon)
    if (anterior !== undefined) {
      grupos[i] = grupos[anterior]!
      return { duplicadoDe: anterior, grupo: grupos[anterior]! }
    }
    vistos.set(canon, i)
    let grupo = i
    for (let j = 0; j < i; j++) {
      if (grupos[j] === j && similaridade(item.titulo, itens[j]!.titulo) >= limiarEvento) {
        grupo = j
        break
      }
    }
    grupos[i] = grupo
    return { duplicadoDe: null, grupo }
  })
}
