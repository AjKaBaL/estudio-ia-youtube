import { z } from 'zod'
import type { TipoVideo } from './dominio'
import { contarPalavras } from './diff'

/** Estrutura de roteiro gerado (Etapa 8): cenas, fontes por afirmação e alertas determinísticos. */

const textoCurto = (max: number) => z.string().max(max).default('')
export const cenaSchema = z.object({
  titulo: textoCurto(200),
  narracao: z.string().min(1).max(6000),
  visual: textoCurto(1000),
  textoNaTela: textoCurto(300),
  afirmacoes: z.array(z.number().int().positive()).max(20).default([])
})
export const estruturaSchema = z.object({
  titulo: z.string().min(1).max(200),
  promessa: textoCurto(500),
  abertura: z.string().min(1).max(3000),
  cenas: z.array(cenaSchema).min(1).max(30),
  conclusao: z.string().min(1).max(3000),
  sugestoes: z
    .object({
      titulos: z.array(z.string().max(120)).max(5).default([]),
      descricao: textoCurto(3000),
      miniatura: textoCurto(500)
    })
    .default({ titulos: [], descricao: '', miniatura: '' })
})
export type Estrutura = z.infer<typeof estruturaSchema>

export interface AfirmacaoParaRoteiro {
  id: number
  texto: string
  natureza: string
  fontes: { titulo: string; url: string; trecho: string; publicadaEm: string | null }[]
}

export interface AlertaGeracao {
  cena: number | null
  tipo: 'fato_novo' | 'referencia_inexistente' | 'sem_fonte' | 'duracao' | 'semelhanca' | 'formato'
  mensagem: string
}

const NUMERO = /\b\d+(?:[.,]\d+)*\s?%?/g
const ATRIBUICAO = /\b(segundo|de acordo com|estudos? (mostram|mostra|indicam)|pesquisas? (mostram|mostra|indicam)|dados (mostram|indicam)|especialistas)\b/i

function normalizarNumero(n: string): string {
  return n.replace(/\s/g, '').replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.')
}

/**
 * Confere a estrutura gerada contra o dossiê, por regras fixas:
 * - referências a afirmações que não existem são removidas (nunca se inventa fonte);
 * - números e datas que não aparecem no dossiê viram "fato novo — verificar";
 * - frases de atribuição ("segundo...", "estudos mostram") sem afirmação ligada também.
 */
export function conferirEstrutura(e: Estrutura, dossie: AfirmacaoParaRoteiro[]): { estrutura: Estrutura; alertas: AlertaGeracao[] } {
  const ids = new Set(dossie.map((a) => a.id))
  const numerosDossie = new Set(
    dossie.flatMap((a) => [a.texto, ...a.fontes.map((f) => f.trecho)]).flatMap((t) => (t.match(NUMERO) ?? []).map(normalizarNumero))
  )
  const alertas: AlertaGeracao[] = []
  const cenas = e.cenas.map((c, i) => {
    const validas = c.afirmacoes.filter((id) => ids.has(id))
    const inexistentes = c.afirmacoes.filter((id) => !ids.has(id))
    if (inexistentes.length) alertas.push({ cena: i, tipo: 'referencia_inexistente', mensagem: `Cena ${i + 1}: referência a afirmação inexistente (${inexistentes.map((x) => `A${x}`).join(', ')}) foi removida.` })
    const novos = [...new Set((c.narracao.match(NUMERO) ?? []).map(normalizarNumero))].filter((n) => !numerosDossie.has(n))
    if (novos.length) alertas.push({ cena: i, tipo: 'fato_novo', mensagem: `Cena ${i + 1}: números ou datas fora do dossiê (${novos.join(', ')}). Verificar antes de usar.` })
    if (!validas.length && ATRIBUICAO.test(c.narracao)) alertas.push({ cena: i, tipo: 'sem_fonte', mensagem: `Cena ${i + 1}: cita “estudos”, “dados” ou “segundo...” sem afirmação do dossiê ligada.` })
    return { ...c, afirmacoes: validas }
  })
  for (const [campo, texto] of [['abertura', e.abertura], ['conclusao', e.conclusao]] as const) {
    const novos = [...new Set((texto.match(NUMERO) ?? []).map(normalizarNumero))].filter((n) => !numerosDossie.has(n))
    if (novos.length) alertas.push({ cena: null, tipo: 'fato_novo', mensagem: `${campo === 'abertura' ? 'Abertura' : 'Conclusão'}: números ou datas fora do dossiê (${novos.join(', ')}).` })
  }
  // Saída de IA não é confiável: endereços que não vieram do dossiê podem ser inventados.
  const urlsDossie = new Set(dossie.flatMap((a) => a.fontes.map((f) => f.url)))
  const textos = [e.abertura, ...e.cenas.flatMap((c) => [c.narracao, c.visual, c.textoNaTela]), e.conclusao, e.sugestoes.descricao]
  const urlsNovas = [...new Set(textos.flatMap((t) => t.match(/https?:\/\/[^\s)"'<>\]]+/gi) ?? []))].filter((u) => !urlsDossie.has(u.replace(/[.,;:]+$/, '')))
  if (urlsNovas.length) alertas.push({ cena: null, tipo: 'referencia_inexistente', mensagem: `Endereços que não estão no dossiê (possivelmente inventados): ${urlsNovas.slice(0, 5).join(', ')}. Remova ou confira.` })
  return { estrutura: { ...e, cenas }, alertas }
}

export function palavrasNarradas(e: Estrutura): number {
  return contarPalavras([e.abertura, ...e.cenas.map((c) => c.narracao), e.conclusao].join(' '))
}

/** Duração provável (narração a ~150 palavras/min; Shorts costumam ser mais rápidos, ~165). */
export function duracaoProvavelSeg(e: Estrutura, tipo: TipoVideo): number {
  return Math.round((palavrasNarradas(e) / (tipo === 'short' ? 165 : 150)) * 60)
}

/** Converte a estrutura em texto de roteiro legível e editável. */
export function renderizarRoteiro(e: Estrutura, tipo: TipoVideo, dossie: AfirmacaoParaRoteiro[]): string {
  const fonteIndice = new Map<string, number>()
  const refs = (ids: number[]): string => {
    const nums: number[] = []
    for (const id of ids) {
      for (const f of dossie.find((a) => a.id === id)?.fontes ?? []) {
        if (!fonteIndice.has(f.url)) fonteIndice.set(f.url, fonteIndice.size + 1)
        nums.push(fonteIndice.get(f.url)!)
      }
    }
    return nums.length ? ` [Fontes: ${[...new Set(nums)].map((n) => `F${n}`).join(', ')}]` : ''
  }
  const formato = tipo === 'short' ? 'Short (9:16, vertical)' : 'Vídeo longo (16:9)'
  const l = [`# ${e.titulo}`, '', `Formato: ${formato} · ${palavrasNarradas(e)} palavras · duração provável ${Math.round(duracaoProvavelSeg(e, tipo) / 6) / 10} min (estimativa)`]
  if (e.promessa) l.push(`Promessa: ${e.promessa}`)
  l.push('', '## Abertura', '', e.abertura)
  e.cenas.forEach((c, i) => {
    l.push('', `## ${tipo === 'short' ? 'Parte' : 'Bloco'} ${i + 1}${c.titulo ? ` — ${c.titulo}` : ''}`, '', `${c.narracao}${refs(c.afirmacoes)}`)
    if (c.visual) l.push(`[Visual: ${c.visual}]`)
    if (c.textoNaTela) l.push(`[Texto na tela: ${c.textoNaTela}]`)
  })
  l.push('', '## Conclusão', '', e.conclusao)
  if (fonteIndice.size) {
    l.push('', '## Fontes')
    const todas = dossie.flatMap((a) => a.fontes)
    for (const [url, n] of fonteIndice) l.push(`F${n}. ${todas.find((f) => f.url === url)?.titulo ?? url} — ${url}`)
  }
  if (e.sugestoes.titulos.length || e.sugestoes.descricao || e.sugestoes.miniatura) {
    l.push('', '## Sugestões de publicação (não garantem cliques)')
    for (const t of e.sugestoes.titulos) l.push(`- Título: ${t}`)
    if (e.sugestoes.descricao) l.push(`- Descrição: ${e.sugestoes.descricao}`)
    if (tipo === 'longo') l.push(`- Capítulos: ${['Abertura', ...e.cenas.map((c, i) => c.titulo || `Bloco ${i + 1}`), 'Conclusão'].join(' · ')}`)
    if (e.sugestoes.miniatura) l.push(`- Miniatura: ${e.sugestoes.miniatura}`)
  }
  return `${l.join('\n')}\n`
}
