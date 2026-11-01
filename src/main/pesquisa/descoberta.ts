import { type Banco, agoraIso, executar, todos, um } from '../db/conexao'
import type { FonteIdentificada } from '@shared/tipos'
import { dominioReconhecido } from '@shared/fontesPadrao'
import { analisarFeed, analisarPagina } from './analisadores'
import { dominioCasa, dominioDe } from './pontuacao'
import type { buscarSeguro } from './rede'

/**
 * Descoberta de fontes por regras fixas (sem IA):
 * - "identificar": o usuário cola o endereço de um site e o app encontra o feed sozinho;
 * - "sugestões": sites que aparecem nos resultados (via agregadores) e ainda não são fontes viram
 *   sugestões, que só entram na pesquisa depois da aprovação do usuário. Veículos reconhecidos do Brasil,
 *   da Europa, dos EUA e do Japão (DOMINIOS_RECONHECIDOS) entram sozinhos como fonte.
 */

type Buscar = typeof buscarSeguro

/** Caminhos comuns de feed, tentados quando a página não anuncia o seu. */
const CAMINHOS_FEED = ['/feed/', '/rss', '/feed.xml', '/rss.xml', '/atom.xml', '/index.xml'] as const

/** Plataformas e redes onde o domínio não identifica um veículo; nunca são sugeridas. */
const PLATAFORMAS = [
  'news.google.com', 'google.com', 'youtube.com', 'youtu.be', 'x.com', 'twitter.com', 'facebook.com', 'instagram.com', 'linkedin.com',
  'reddit.com', 'tiktok.com', 'threads.net', 'bsky.app', 'github.com', 'gitlab.com', 'medium.com', 'substack.com', 'archive.org',
  'ycombinator.com', 'wikipedia.org', 'apple.com', 'amazon.com', 'bit.ly', 't.co'
]

const MAX_DESCOBERTAS_POR_PESQUISA = 4
const OCORRENCIAS_MINIMAS = 2

export function ehFeed(corpo: string): boolean {
  return /<rss[\s>]|<feed[\s>]|<rdf:RDF[\s>]/i.test(corpo.slice(0, 4000))
}

/** Feeds anunciados pela página em <link rel="alternate" type="application/rss+xml|atom+xml">. */
export function feedsAnunciados(html: string, base: string): string[] {
  const saida: string[] = []
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    if (!/rel\s*=\s*["']?alternate/i.test(tag) || !/type\s*=\s*["']application\/(rss|atom)\+xml/i.test(tag)) continue
    const href = tag.match(/href\s*=\s*("([^"]*)"|'([^']*)')/i)
    try {
      const u = new URL((href?.[2] ?? href?.[3] ?? '').replace(/&amp;/g, '&'), base)
      if ((u.protocol === 'https:' || u.protocol === 'http:') && !saida.includes(u.href)) saida.push(u.href)
    } catch {
      // endereço inválido: ignorado
    }
  }
  return saida.slice(0, 5)
}

/** "exame.com", "olhardigital.com.br": junta subdomínios do mesmo site (feeds.x.com e www.x.com). */
export function dominioRaiz(dominio: string): string {
  const partes = dominio.toLowerCase().replace(/^www\./, '').split('.')
  if (partes.length > 2 && partes.at(-1)!.length === 2 && ['com', 'net', 'org', 'gov', 'edu', 'co', 'ac', 'jus', 'leg', 'art', 'blog', 'or', 'ne', 'go'].includes(partes.at(-2)!)) {
    return partes.slice(-3).join('.')
  }
  return partes.slice(-2).join('.')
}

async function feedValido(buscar: Buscar, url: string, sinal?: AbortSignal): Promise<{ url: string; titulo: string; itens: number } | null> {
  try {
    const r = await buscar(url, { tempoLimiteMs: 10_000, sinal })
    if (!ehFeed(r.corpo)) return null
    const f = analisarFeed(r.corpo, r.urlFinal)
    return f.itens.length ? { url: r.urlFinal, titulo: f.titulo, itens: f.itens.length } : null
  } catch {
    return null
  }
}

/** Procura o feed de um site: o anunciado na página e, se não houver, os caminhos comuns. */
async function procurarFeed(buscar: Buscar, html: string, urlPagina: string, sinal?: AbortSignal): Promise<{ url: string; titulo: string; itens: number } | null> {
  const origem = new URL(urlPagina).origin
  const candidatos = [...feedsAnunciados(html, urlPagina), ...CAMINHOS_FEED.map((c) => origem + c)]
  for (const c of [...new Set(candidatos)].slice(0, 8)) {
    if (sinal?.aborted) return null
    const f = await feedValido(buscar, c, sinal)
    if (f) return f
  }
  return null
}

/** Endereço colado pelo usuário: feed direto, feed descoberto a partir do site ou, sem feed, página. */
export async function identificarFonte(endereco: string, buscar: Buscar): Promise<FonteIdentificada> {
  const r = await buscar(endereco, { tempoLimiteMs: 12_000 })
  const host = new URL(r.urlFinal).hostname.replace(/^www\./, '')
  if (ehFeed(r.corpo)) {
    const f = analisarFeed(r.corpo, r.urlFinal)
    return { tipo: 'rss', url: r.urlFinal, nome: f.titulo || host, detalhe: `Feed lido diretamente: ${f.itens.length} publicação(ões) recentes.` }
  }
  const feed = await procurarFeed(buscar, r.corpo, r.urlFinal)
  if (feed) return { tipo: 'rss', url: feed.url, nome: feed.titulo || host, detalhe: `Feed encontrado a partir do site: ${feed.itens} publicação(ões) recentes.` }
  const p = analisarPagina(r.corpo, r.urlFinal)
  return { tipo: 'url', url: r.urlFinal, nome: p.titulo || host, detalhe: 'O site não tem feed. Será lido como página (apenas título, data e um trecho curto).' }
}

/**
 * Depois de cada pesquisa: conta os sites dos resultados que ainda não são fontes. Um site precisa aparecer
 * em pelo menos 2 resultados (somando pesquisas) para o app procurar o feed dele; achando, vira sugestão pendente.
 * Devolve quantas sugestões novas ficaram aguardando aprovação.
 */
export async function registrarSugestoes(db: Banco, execucaoId: number, projetoId: number, buscar: Buscar, sinal?: AbortSignal): Promise<number> {
  const fontes = todos<{ url: string }>(db, 'SELECT url FROM fontes_pesquisa WHERE projeto_id = :p', { p: projetoId }).map((f) => dominioRaiz(dominioDe(f.url)))
  const bloqueados = todos<{ dominio: string }>(db, "SELECT dominio FROM regras_dominio WHERE projeto_id = :p AND regra = 'bloqueado'", { p: projetoId }).map((r) => r.dominio)
  const resultados = todos<{ dominio: string; titulo: string; url: string }>(db, 'SELECT dominio, titulo, url FROM resultados_pesquisa WHERE execucao_id = :e', { e: execucaoId })

  const contagem = new Map<string, { n: number; titulo: string; url: string }>()
  for (const r of resultados) {
    if (!r.dominio || /^[\d.:[\]]+$/.test(r.dominio) || r.dominio === 'localhost') continue
    const raiz = dominioRaiz(r.dominio)
    if (fontes.includes(raiz) || PLATAFORMAS.some((p) => dominioCasa(r.dominio, p)) || bloqueados.some((b) => dominioCasa(r.dominio, b))) continue
    const c = contagem.get(raiz)
    if (c) c.n++
    else contagem.set(raiz, { n: 1, titulo: r.titulo, url: r.url.includes('news.google.com') ? `https://${r.dominio}/` : r.url })
  }
  const t = agoraIso()
  for (const [dominio, c] of contagem) {
    executar(
      db,
      `INSERT INTO sugestoes_fontes (projeto_id, dominio, ocorrencias, exemplo_titulo, exemplo_url, criado_em, atualizado_em)
       VALUES (:p, :d, :n, :titulo, :url, :t, :t)
       ON CONFLICT(projeto_id, dominio) DO UPDATE SET ocorrencias = ocorrencias + excluded.ocorrencias, atualizado_em = excluded.atualizado_em
       WHERE status IN ('observada', 'pendente')`,
      { p: projetoId, d: dominio, n: c.n, titulo: c.titulo.slice(0, 300), url: c.url.slice(0, 2000), t }
    )
  }

  const candidatas = todos<{ id: number; dominio: string; exemploUrl: string }>(
    db,
    `SELECT id, dominio, exemplo_url AS exemploUrl FROM sugestoes_fontes
     WHERE projeto_id = :p AND status = 'observada' AND ocorrencias >= :min ORDER BY ocorrencias DESC, id LIMIT :lim`,
    { p: projetoId, min: OCORRENCIAS_MINIMAS, lim: MAX_DESCOBERTAS_POR_PESQUISA }
  )
  let novas = 0
  for (const s of candidatas) {
    if (sinal?.aborted) break
    let inicio: string
    try {
      inicio = new URL(s.exemploUrl).origin + '/'
    } catch {
      inicio = `https://${s.dominio}/`
    }
    let feed: { url: string; titulo: string } | null
    try {
      const r = await buscar(inicio, { tempoLimiteMs: 10_000, sinal })
      feed = ehFeed(r.corpo) ? { url: r.urlFinal, titulo: analisarFeed(r.corpo, r.urlFinal).titulo } : await procurarFeed(buscar, r.corpo, r.urlFinal, sinal)
    } catch {
      continue // site fora do ar agora: tenta de novo numa próxima pesquisa
    }
    // Um feed já cadastrado com outro domínio (ex.: feeds.x.com) não vira sugestão repetida.
    const jaCadastrado = feed && um(db, 'SELECT 1 FROM fontes_pesquisa WHERE projeto_id = :p AND url = :u', { p: projetoId, u: feed.url })
    if (feed && !jaCadastrado && dominioReconhecido(s.dominio)) {
      // Veículo reconhecido: entra direto como fonte ativa (o usuário pode desativar como qualquer outra).
      executar(db, "UPDATE sugestoes_fontes SET status = 'aprovada', url = :u, nome = :n, atualizado_em = :t WHERE id = :id", {
        id: s.id,
        u: feed.url,
        n: (feed.titulo || s.dominio).slice(0, 120),
        t: agoraIso()
      })
      executar(db, "INSERT INTO fontes_pesquisa (projeto_id, tipo, nome, url, origem, criado_em) VALUES (:p, 'rss', :n, :u, 'sugestao', :t) ON CONFLICT(projeto_id, url) DO NOTHING", {
        p: projetoId,
        n: (feed.titulo || s.dominio).slice(0, 120),
        u: feed.url,
        t: agoraIso()
      })
    } else if (feed && !jaCadastrado) {
      executar(db, "UPDATE sugestoes_fontes SET status = 'pendente', url = :u, nome = :n, atualizado_em = :t WHERE id = :id", {
        id: s.id,
        u: feed.url,
        n: (feed.titulo || s.dominio).slice(0, 120),
        t: agoraIso()
      })
      novas++
    } else {
      executar(db, "UPDATE sugestoes_fontes SET status = 'sem_feed', atualizado_em = :t WHERE id = :id", { id: s.id, t: agoraIso() })
    }
  }
  return novas
}
