import { decodificarEntidades, htmlParaTexto, limitar } from './texto'

/**
 * Leitura de feeds RSS/Atom e de metadados de páginas HTML.
 * Analisadores tolerantes e limitados, escritos sem bibliotecas externas: extraem só os campos
 * necessários, nunca avaliam código e ignoram declarações de entidades externas (XXE).
 */

export interface ItemExtraido {
  titulo: string
  url: string
  autor: string
  publicadaEm: string | null
  trecho: string
  /** Site original quando o feed é um agregador (ex.: <source url> do Google Notícias). */
  site?: string
}

const MAX_ITENS = 100
const MAX_TRECHO = 600

function semCdata(t: string): string {
  return t.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
}

function tag(bloco: string, ...nomes: string[]): string {
  for (const nome of nomes) {
    const n = nome.replace(':', '\\:')
    const m = bloco.match(new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}\\s*>`, 'i'))
    if (m?.[1] !== undefined) return semCdata(m[1]).trim()
  }
  return ''
}

function atributo(fragmento: string, nome: string): string {
  const m = fragmento.match(new RegExp(`\\s${nome}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'))
  return decodificarEntidades(m?.[2] ?? m?.[3] ?? '')
}

export function dataIsoOuNulo(texto: string): string | null {
  if (!texto) return null
  const t = new Date(texto.trim())
  if (Number.isNaN(t.getTime())) return null
  const ano = t.getUTCFullYear()
  return ano >= 1990 && ano <= 2100 ? t.toISOString() : null
}

function urlSegura(bruta: string, base?: string): string {
  try {
    const u = new URL(decodificarEntidades(bruta.trim()), base)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : ''
  } catch {
    return ''
  }
}

/** Lê RSS 2.0, RSS 1.0 (RDF) e Atom. */
export function analisarFeed(xml: string, urlFeed: string): { titulo: string; itens: ItemExtraido[] } {
  const semDoctype = xml.replace(/<!DOCTYPE[\s\S]*?(\[[\s\S]*?\])?\s*>/i, '')
  const ehAtom = /<feed[\s>]/i.test(semDoctype) && !/<rss[\s>]/i.test(semDoctype)
  const blocos = semDoctype.match(ehAtom ? /<entry[\s>][\s\S]*?<\/entry\s*>/gi : /<item[\s>][\s\S]*?<\/item\s*>/gi) ?? []
  const canal = semDoctype.replace(/<(item|entry)[\s>][\s\S]*?<\/\1\s*>/gi, '')
  const titulo = htmlParaTexto(tag(canal, 'title'))

  const itens: ItemExtraido[] = []
  for (const b of blocos.slice(0, MAX_ITENS)) {
    let link: string
    if (ehAtom) {
      const links = b.match(/<link\b[^>]*>/gi) ?? []
      const alt = links.find((l) => !/rel\s*=/.test(l) || /rel\s*=\s*["']alternate["']/i.test(l)) ?? links[0] ?? ''
      link = atributo(alt, 'href')
    } else {
      link = tag(b, 'link') || tag(b, 'guid')
    }
    const url = urlSegura(link, urlFeed)
    if (!url) continue
    const origem = ehAtom ? '' : urlSegura(atributo(b.match(/<source\b[^>]*>/i)?.[0] ?? '', 'url'))
    const autor = htmlParaTexto(ehAtom ? tag(tag(b, 'author'), 'name') || tag(b, 'author') : tag(b, 'dc:creator', 'author'))
    itens.push({
      titulo: limitar(htmlParaTexto(tag(b, 'title')) || url, 300),
      url,
      autor: limitar(autor, 200),
      publicadaEm: dataIsoOuNulo(tag(b, 'pubDate', 'published', 'updated', 'dc:date')),
      trecho: limitar(htmlParaTexto(tag(b, 'description', 'summary', 'content:encoded', 'content')), MAX_TRECHO),
      ...(origem ? { site: origem } : {})
    })
  }
  return { titulo, itens }
}

function meta(html: string, ...nomes: string[]): string {
  const metas = html.match(/<meta\b[^>]*>/gi) ?? []
  for (const nome of nomes) {
    const m = metas.find((t) => new RegExp(`(name|property|itemprop)\\s*=\\s*["']${nome}["']`, 'i').test(t))
    if (m) {
      const c = atributo(m, 'content')
      if (c) return c.trim()
    }
  }
  return ''
}

/** Metadados de uma página: título, autor, data, descrição e um trecho curto (nunca o artigo inteiro). */
export function analisarPagina(html: string, url: string): ItemExtraido & { canonica: string; proibeIndexacao: boolean } {
  const cabeca = html.slice(0, 200_000)
  const tituloTag = htmlParaTexto(cabeca.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '')
  const titulo = meta(cabeca, 'og:title', 'twitter:title') || tituloTag
  const descricao = meta(cabeca, 'description', 'og:description', 'twitter:description')
  const corpo = htmlParaTexto(html.match(/<(article|main)[\s>][\s\S]*?<\/\1>/i)?.[0] ?? html.match(/<body[\s>][\s\S]*$/i)?.[0] ?? '')
  const linkCanonico = (cabeca.match(/<link\b[^>]*rel\s*=\s*["']canonical["'][^>]*>/i) ?? [''])[0]
  const robots = meta(cabeca, 'robots')
  return {
    titulo: limitar(decodificarEntidades(titulo) || url, 300),
    url,
    autor: limitar(meta(cabeca, 'author', 'article:author', 'og:article:author'), 200),
    publicadaEm: dataIsoOuNulo(meta(cabeca, 'article:published_time', 'datePublished', 'date', 'dc.date', 'og:updated_time')),
    trecho: limitar(decodificarEntidades(descricao) || corpo, MAX_TRECHO),
    canonica: urlSegura(atributo(linkCanonico, 'href'), url),
    proibeIndexacao: /noindex|none/i.test(robots)
  }
}

/** Interpreta robots.txt e diz se o caminho pode ser lido pelo nosso agente. */
export function robotsPermite(robots: string, caminho: string, agente = 'estudioiayoutube'): boolean {
  const grupos: { agentes: string[]; regras: { permitir: boolean; caminho: string }[] }[] = []
  let atual: (typeof grupos)[number] | null = null
  let ultimoFoiAgente = false
  for (const bruta of robots.split(/\r?\n/)) {
    const linha = bruta.replace(/#.*/, '').trim()
    const m = linha.match(/^([a-z-]+)\s*:\s*(.*)$/i)
    if (!m) continue
    const campo = m[1]!.toLowerCase()
    const valor = m[2]!.trim()
    if (campo === 'user-agent') {
      if (!atual || !ultimoFoiAgente) {
        atual = { agentes: [], regras: [] }
        grupos.push(atual)
      }
      atual.agentes.push(valor.toLowerCase())
      ultimoFoiAgente = true
    } else if ((campo === 'disallow' || campo === 'allow') && atual) {
      ultimoFoiAgente = false
      if (valor || campo === 'allow') atual.regras.push({ permitir: campo === 'allow', caminho: valor })
    } else {
      ultimoFoiAgente = false
    }
  }
  const especifico = grupos.find((g) => g.agentes.some((a) => a !== '*' && agente.includes(a)))
  const grupo = especifico ?? grupos.find((g) => g.agentes.includes('*'))
  if (!grupo) return true
  let melhor: { permitir: boolean; caminho: string } | null = null
  for (const r of grupo.regras) {
    const padrao = new RegExp(`^${r.caminho.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$')}`)
    if (padrao.test(caminho) && (!melhor || r.caminho.length > melhor.caminho.length)) melhor = r
  }
  return melhor ? melhor.permitir : true
}
