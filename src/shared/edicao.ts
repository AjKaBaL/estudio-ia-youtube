import { z } from 'zod'

/**
 * Modelo do projeto de edição (Etapa 11): faixas, clipes e cenas ligadas ao roteiro.
 * Todas as operações são funções puras: facilitam desfazer/refazer, salvar e testar.
 */

export const FAIXAS = ['video', 'audio', 'narracao', 'legendas', 'textos'] as const
export type Faixa = (typeof FAIXAS)[number]
export const ROTULO_FAIXA: Record<Faixa, string> = { video: 'Vídeo/imagens', audio: 'Trilha/sons', narracao: 'Narração', legendas: 'Legendas', textos: 'Textos na tela' }
export const FORMATOS = ['16:9', '9:16'] as const
export type Formato = (typeof FORMATOS)[number]

export const DURACAO_MAXIMA = 4 * 3600

const segundos = z.number().min(0).max(DURACAO_MAXIMA)
export const clipSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  faixa: z.enum(FAIXAS),
  recursoId: z.number().int().positive().nullable(),
  inicio: segundos,
  duracao: z.number().min(0.1).max(DURACAO_MAXIMA),
  corteInicio: segundos,
  volume: z.number().min(0).max(2),
  fadeIn: z.number().min(0).max(30),
  fadeOut: z.number().min(0).max(30),
  texto: z.string().max(500),
  cena: z.number().int().min(0).nullable()
})
export type Clip = z.infer<typeof clipSchema>

export const estadoEdicaoSchema = z.object({
  versaoModelo: z.literal(1),
  formato: z.enum(FORMATOS),
  cenas: z.array(z.object({ indice: z.number().int().min(0), titulo: z.string().max(200) })).max(200),
  clips: z.array(clipSchema).max(3000)
})
export type EstadoEdicao = z.infer<typeof estadoEdicaoSchema>

let contador = 0
export function novoId(): string {
  contador = (contador + 1) % 1_000_000
  return `c${Date.now().toString(36)}-${contador.toString(36)}`
}

const arred = (n: number): number => Math.round(n * 1000) / 1000

export function duracaoTotal(e: EstadoEdicao): number {
  return arred(e.clips.reduce((m, c) => Math.max(m, c.inicio + c.duracao), 0))
}

/** Caracteres por linha de legenda que cabem no quadro (com o apresentador ao lado no 16:9). */
export const LINHA_LEGENDA: Record<Formato, number> = { '16:9': 34, '9:16': 22 }

/** Quebra o texto em linhas de até "porLinha" caracteres (palavra maior que a linha fica sozinha). */
export function linhasLegenda(texto: string, porLinha: number): string[] {
  const linhas: string[] = []
  let atual = ''
  for (const p of texto.replace(/\s+/g, ' ').trim().split(' ')) {
    if ((atual + ' ' + p).trim().length > porLinha && atual) {
      linhas.push(atual)
      atual = p
    } else atual = `${atual} ${p}`.trim()
  }
  if (atual) linhas.push(atual)
  return linhas
}

/** Duas linhas de tamanho parecido (quebra no espaço mais perto do meio que ainda caiba). */
function duasLinhas(texto: string, porLinha: number): string[] {
  const t = texto.replace(/\s+/g, ' ').trim()
  if (t.length <= porLinha) return [t]
  let melhor = -1
  for (let i = t.indexOf(' '); i !== -1; i = t.indexOf(' ', i + 1)) {
    if (i <= porLinha && t.length - i - 1 <= porLinha && (melhor < 0 || Math.abs(t.length / 2 - i) < Math.abs(t.length / 2 - melhor))) melhor = i
  }
  return melhor < 0 ? linhasLegenda(t, porLinha) : [t.slice(0, melhor), t.slice(melhor + 1)]
}

/** Divide o texto narrado em legendas curtas: cada uma cabe em no máximo duas linhas de "porLinha" caracteres. */
export function dividirLegendas(texto: string, porLinha = LINHA_LEGENDA['16:9']): string[] {
  const frases = texto.replace(/\s+/g, ' ').trim().split(/(?<=[.!?…])\s+/)
  const saida: string[] = []
  const cabe = (s: string): boolean => linhasLegenda(s, porLinha).length <= 2
  for (const f of frases) {
    if (cabe(f)) {
      if (f) saida.push(f)
      continue
    }
    let atual = ''
    for (const p of f.split(' ')) {
      const junto = `${atual} ${p}`.trim()
      if (!cabe(junto) && atual) {
        saida.push(atual)
        atual = p
      } else atual = junto
    }
    if (atual) saida.push(atual)
  }
  return saida
}

/** Cria o projeto inicial a partir do roteiro: uma cena por seção "## " e legendas com a narração. */
export function estadoInicial(conteudoRoteiro: string, formato: Formato, palavrasPorMinuto = 150): EstadoEdicao {
  const secoes: { titulo: string; texto: string }[] = []
  let atual: { titulo: string; texto: string } | null = null
  let ignorar = false
  for (const l of conteudoRoteiro.split(/\r?\n/)) {
    if (l.startsWith('## ')) {
      ignorar = /^## (Fontes|Sugestões)/i.test(l)
      if (atual) secoes.push(atual)
      atual = ignorar ? null : { titulo: l.slice(3).trim(), texto: '' }
      continue
    }
    if (ignorar || !atual || l.startsWith('[') || l.startsWith('#') || l.startsWith('Formato:')) continue
    atual.texto += ` ${l.replace(/\[Fontes?:[^\]]*\]/g, '')}`
  }
  if (atual) secoes.push(atual)
  if (!secoes.length) secoes.push({ titulo: 'Cena 1', texto: conteudoRoteiro.slice(0, 2000) })

  const clips: Clip[] = []
  let t = 0
  secoes.forEach((s, cena) => {
    const legendas = dividirLegendas(s.texto, LINHA_LEGENDA[formato])
    const inicioCena = t
    for (const leg of legendas) {
      const d = Math.max(1.2, arred((leg.split(/\s+/).length / palavrasPorMinuto) * 60))
      clips.push({ id: novoId(), faixa: 'legendas', recursoId: null, inicio: arred(t), duracao: d, corteInicio: 0, volume: 1, fadeIn: 0, fadeOut: 0, texto: leg, cena })
      t = arred(t + d)
    }
    if (t === inicioCena) t = arred(t + 3)
  })
  return { versaoModelo: 1, formato, cenas: secoes.map((s, i) => ({ indice: i, titulo: s.titulo })), clips }
}

// ------------------------------------------------------------------ operações

function trocar(e: EstadoEdicao, id: string, fn: (c: Clip) => Clip | Clip[] | null): EstadoEdicao {
  const clips: Clip[] = []
  for (const c of e.clips) {
    if (c.id !== id) {
      clips.push(c)
      continue
    }
    const r = fn(c)
    if (Array.isArray(r)) clips.push(...r)
    else if (r) clips.push(r)
  }
  return { ...e, clips }
}

export function moverClip(e: EstadoEdicao, id: string, delta: number): EstadoEdicao {
  return trocar(e, id, (c) => ({ ...c, inicio: arred(Math.max(0, c.inicio + delta)) }))
}

export function ajustarClip(e: EstadoEdicao, id: string, campos: Partial<Omit<Clip, 'id' | 'faixa'>>): EstadoEdicao {
  return trocar(e, id, (c) => clipSchema.parse({ ...c, ...campos }))
}

/** Corta o clipe no instante t (tempo da linha do tempo), gerando dois clipes. */
export function cortarClip(e: EstadoEdicao, id: string, t: number): EstadoEdicao {
  return trocar(e, id, (c) => {
    const rel = arred(t - c.inicio)
    if (rel <= 0.1 || rel >= c.duracao - 0.1) return c
    return [
      { ...c, duracao: rel, fadeOut: 0 },
      { ...c, id: novoId(), inicio: arred(t), duracao: arred(c.duracao - rel), corteInicio: arred(c.corteInicio + rel), fadeIn: 0 }
    ]
  })
}

export function removerClip(e: EstadoEdicao, id: string): EstadoEdicao {
  return trocar(e, id, () => null)
}

export function adicionarClip(e: EstadoEdicao, c: Omit<Clip, 'id'>): EstadoEdicao {
  return { ...e, clips: [...e.clips, clipSchema.parse({ ...c, id: novoId() })] }
}

export function substituirRecurso(e: EstadoEdicao, id: string, recursoId: number): EstadoEdicao {
  return trocar(e, id, (c) => ({ ...c, recursoId, corteInicio: 0 }))
}

/** Intervalo de tempo ocupado por uma cena (pelos clipes ligados a ela). */
export function intervaloCena(e: EstadoEdicao, cena: number): { inicio: number; fim: number } | null {
  const cs = e.clips.filter((c) => c.cena === cena)
  if (!cs.length) return null
  return { inicio: Math.min(...cs.map((c) => c.inicio)), fim: Math.max(...cs.map((c) => c.inicio + c.duracao)) }
}

/** Troca a cena de lugar com a vizinha, deslocando todos os clipes das duas. */
export function reordenarCena(e: EstadoEdicao, cena: number, direcao: -1 | 1): EstadoEdicao {
  const ordem = [...e.cenas].sort((a, b) => (intervaloCena(e, a.indice)?.inicio ?? 0) - (intervaloCena(e, b.indice)?.inicio ?? 0)).map((c) => c.indice)
  const pos = ordem.indexOf(cena)
  const outra = ordem[pos + direcao]
  if (pos < 0 || outra === undefined) return e
  // "primeira" é a que vem antes no tempo; depois da troca, a segunda passa a começar onde a primeira começava.
  const [primeira, segunda] = direcao === 1 ? [cena, outra] : [outra, cena]
  const a = intervaloCena(e, primeira)
  const b = intervaloCena(e, segunda)
  if (!a || !b) return e
  const durB = b.fim - b.inicio
  const intervalo = Math.max(0, b.inicio - a.fim)
  return {
    ...e,
    clips: e.clips.map((c) => {
      if (c.cena === segunda) return { ...c, inicio: arred(c.inicio - b.inicio + a.inicio) }
      if (c.cena === primeira) return { ...c, inicio: arred(c.inicio - a.inicio + a.inicio + durB + intervalo) }
      return c
    })
  }
}

/** Problemas de estrutura: sobreposição na mesma faixa (exceto áudio/trilha), recursos ausentes. */
export function problemasEstado(e: EstadoEdicao, recursosExistentes: Set<number>): string[] {
  const p: string[] = []
  for (const faixa of ['video', 'narracao', 'legendas', 'textos'] as const) {
    const cs = e.clips.filter((c) => c.faixa === faixa).sort((a, b) => a.inicio - b.inicio)
    for (let i = 1; i < cs.length; i++) {
      if (cs[i]!.inicio < cs[i - 1]!.inicio + cs[i - 1]!.duracao - 0.01) {
        p.push(`${ROTULO_FAIXA[faixa]}: clipes sobrepostos em ${cs[i]!.inicio.toFixed(1)} s.`)
        break
      }
    }
  }
  for (const c of e.clips) if (c.recursoId !== null && !recursosExistentes.has(c.recursoId)) p.push(`Clipe em ${c.inicio.toFixed(1)} s usa uma mídia que não existe mais.`)
  return p
}

function tempoSrt(s: number): string {
  const ms = Math.round(s * 1000)
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  const seg = Math.floor((ms % 60_000) / 1000)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(seg).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`
}

/**
 * Gera SRT de uma faixa de texto. Legendas: no máximo 2 linhas na tela (do tamanho que cabe no formato); um texto
 * maior vira blocos seguidos de até 2 linhas, cada um com o tempo proporcional ao seu tamanho.
 * Textos na tela: linhas de até 42 caracteres.
 */
export function gerarSrt(e: EstadoEdicao, faixa: 'legendas' | 'textos' = 'legendas'): string {
  const cs = e.clips.filter((c) => c.faixa === faixa && c.texto.trim()).sort((a, b) => a.inicio - b.inicio)
  const blocos: { inicio: number; fim: number; linhas: string[] }[] = []
  for (const c of cs) {
    if (faixa === 'textos') {
      blocos.push({ inicio: c.inicio, fim: c.inicio + c.duracao, linhas: linhasLegenda(c.texto, 42) })
      continue
    }
    const porLinha = LINHA_LEGENDA[e.formato]
    const partes = linhasLegenda(c.texto, porLinha).length <= 2 ? [c.texto] : dividirLegendas(c.texto, porLinha)
    const total = partes.reduce((s, p) => s + p.length, 0)
    let t = c.inicio
    for (const p of partes) {
      const fim = t + (c.duracao * p.length) / total
      blocos.push({ inicio: t, fim, linhas: duasLinhas(p, porLinha) })
      t = fim
    }
  }
  return blocos.map((b, i) => `${i + 1}\n${tempoSrt(b.inicio)} --> ${tempoSrt(b.fim)}\n${b.linhas.join('\n')}\n`).join('\n')
}

// ------------------------------------------------------------------ montagem automática

export interface MidiaParaMontagem {
  id: number
  categoria: 'video' | 'audio' | 'imagem' | 'legenda'
  /** Campo "cena" da biblioteca: nome da cena, "narração", "trilha" ou "miniatura". */
  cena: string
  nome: string
  duracaoSeg: number | null
}

const normal = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
const ehNarracao = (m: MidiaParaMontagem): boolean => normal(m.cena) === 'narracao' || /narra|locu/.test(normal(m.nome))
const ehTrilha = (m: MidiaParaMontagem): boolean => ['trilha', 'musica', 'trilha sonora'].includes(normal(m.cena)) || /trilha|musica|music/.test(normal(m.nome))

/**
 * Preenche o projeto com as mídias da biblioteca, por regras fixas (sem IA):
 * 1. cada cena sem imagem recebe as mídias marcadas com o nome dela; senão, a próxima mídia ainda não usada;
 * 2. vídeos ocupam no máximo a própria duração; o restante da cena recebe a mídia seguinte;
 * 3. sem narração no projeto, usa o áudio marcado como "narração"; sem trilha, o marcado como "trilha" (volume baixo e fades).
 * Cenas que você já montou não são tocadas. O resultado entra no histórico (dá para desfazer).
 */
export function montarAutomaticamente(e: EstadoEdicao, midias: MidiaParaMontagem[]): { estado: EstadoEdicao; relatorio: string[] } {
  const relatorio: string[] = []
  let estado = e
  const visuais = midias.filter((m) => (m.categoria === 'video' || m.categoria === 'imagem') && normal(m.cena) !== 'miniatura')
  const usados = new Set(e.clips.map((c) => c.recursoId).filter((x): x is number => x !== null))
  const titulos = new Set(e.cenas.map((c) => normal(c.titulo)))
  // Mídias livres: sem cena marcada (ou marcada com uma cena que não existe) e ainda não usadas.
  const livres = visuais.filter((m) => !usados.has(m.id) && (!m.cena.trim() || !titulos.has(normal(m.cena))))
  const base = { corteInicio: 0, volume: 1, fadeIn: 0, fadeOut: 0, texto: '' }
  const cenas = [...e.cenas].sort((a, b) => (intervaloCena(e, a.indice)?.inicio ?? 0) - (intervaloCena(e, b.indice)?.inicio ?? 0))
  let montadas = 0

  for (const cena of cenas) {
    const iv = intervaloCena(estado, cena.indice)
    if (!iv) continue
    // Tolerância de 0,05 s: clipes que só encostam na cena (arredondamento) não contam como imagem dela.
    const temVisual = estado.clips.some((c) => c.faixa === 'video' && c.recursoId !== null && c.inicio < iv.fim - 0.05 && c.inicio + c.duracao > iv.inicio + 0.05)
    if (temVisual) continue
    const marcadas = visuais.filter((m) => normal(m.cena) === normal(cena.titulo) && !usados.has(m.id))
    // Cada mídia entra uma vez só (a mesma foto repetida em duas cenas criava sobreposição).
    const proxima = (): MidiaParaMontagem | undefined => {
      let m = marcadas.shift() ?? livres.shift()
      while (m && usados.has(m.id)) m = marcadas.shift() ?? livres.shift()
      if (m) usados.add(m.id)
      return m
    }
    let t = iv.inicio
    let ultimo: { id: string; categoria: string } | null = null
    for (let k = 0; t < iv.fim - 0.05 && k < 8; k++) {
      const m = proxima()
      if (!m) {
        // Sem mais mídia: uma imagem pode se estender até o fim da cena; um vídeo não (ficaria congelado).
        if (ultimo?.categoria === 'imagem') estado = ajustarClip(estado, ultimo.id, { duracao: arred(iv.fim - (estado.clips.find((c) => c.id === ultimo!.id)?.inicio ?? t)) })
        else relatorio.push(`Cena “${cena.titulo}”: ${k === 0 ? 'nenhuma mídia disponível' : `${(iv.fim - t).toFixed(1)} s ficaram sem imagem`}.`)
        break
      }
      const d = m.categoria === 'video' && m.duracaoSeg ? Math.min(iv.fim - t, m.duracaoSeg) : iv.fim - t
      estado = adicionarClip(estado, { ...base, faixa: 'video', recursoId: m.id, inicio: arred(t), duracao: arred(Math.max(0.1, d)), cena: cena.indice })
      ultimo = { id: estado.clips[estado.clips.length - 1]!.id, categoria: m.categoria }
      t = arred(t + d)
    }
    if (ultimo) montadas++
  }
  if (montadas) relatorio.unshift(`${montadas} cena(s) receberam imagens ou vídeos.`)

  const total = duracaoTotal(estado)
  if (!estado.clips.some((c) => c.faixa === 'narracao')) {
    const narr = midias.find((m) => m.categoria === 'audio' && ehNarracao(m))
    if (narr) {
      estado = adicionarClip(estado, { ...base, faixa: 'narracao', recursoId: narr.id, inicio: 0, duracao: arred(Math.max(0.1, narr.duracaoSeg ?? total)), cena: null })
      relatorio.push(`Narração “${narr.nome}” colocada no início.`)
      if (narr.duracaoSeg && Math.abs(narr.duracaoSeg - total) > 2) relatorio.push(`A narração tem ${narr.duracaoSeg.toFixed(0)} s e o projeto ${total.toFixed(0)} s: ajuste as legendas ou as cenas.`)
    } else relatorio.push('Nenhum áudio marcado como “narração” na biblioteca (campo Cena = narração).')
  }
  if (!estado.clips.some((c) => c.faixa === 'audio')) {
    const trilha = midias.find((m) => m.categoria === 'audio' && ehTrilha(m) && !ehNarracao(m))
    if (trilha) {
      const d = Math.min(duracaoTotal(estado), trilha.duracaoSeg ?? duracaoTotal(estado))
      estado = adicionarClip(estado, { ...base, faixa: 'audio', recursoId: trilha.id, inicio: 0, duracao: arred(Math.max(0.1, d)), volume: 0.15, fadeIn: 1, fadeOut: Math.min(3, d / 4), cena: null })
      relatorio.push(`Trilha “${trilha.nome}” colocada em volume baixo (15%) com entrada e saída suaves.`)
    }
  }
  if (!relatorio.length) relatorio.push('Nada a fazer: todas as cenas já têm imagem e as faixas de áudio já estão montadas.')
  return { estado, relatorio }
}

/**
 * Correção automática da linha do tempo (sem perguntar): clipes sobrepostos na mesma faixa são aparados para
 * terminar onde o seguinte começa (o que sobra com menos de 0,1 s sai), e buracos entre imagens são cobertos
 * esticando a imagem anterior (ou a seguinte, no começo do vídeo). Vídeos não são esticados (ficariam congelados).
 */
export function corrigirLinhaDoTempo(e: EstadoEdicao, imagens: Set<number>): { estado: EstadoEdicao; correcoes: string[] } {
  const correcoes: string[] = []
  let clips = [...e.clips]
  for (const faixa of ['video', 'narracao', 'legendas', 'textos'] as const) {
    const cs = clips.filter((c) => c.faixa === faixa).sort((a, b) => a.inicio - b.inicio || b.duracao - a.duracao)
    const remover = new Set<string>()
    const novos = new Map<string, Clip>()
    let anterior: Clip | null = null
    let sobrepostos = 0
    for (const c of cs) {
      if (anterior && c.inicio < anterior.inicio + anterior.duracao - 0.01) {
        sobrepostos++
        const d = arred(c.inicio - anterior.inicio)
        if (d < 0.1) {
          // O anterior quase não aparece: sai, e o atual assume o tempo dele.
          remover.add(anterior.id)
          novos.delete(anterior.id)
        } else novos.set(anterior.id, { ...anterior, duracao: d })
      }
      anterior = c
    }
    if (sobrepostos) correcoes.push(`${ROTULO_FAIXA[faixa]}: ${sobrepostos} sobreposição(ões) corrigida(s).`)
    clips = clips.filter((c) => !remover.has(c.id)).map((c) => novos.get(c.id) ?? c)
  }
  const total = duracaoTotal(e)
  const visuais = clips.filter((c) => c.faixa === 'video' && c.recursoId !== null).sort((a, b) => a.inicio - b.inicio)
  let buracos = 0
  for (let i = 0; i < visuais.length; i++) {
    const c = visuais[i]!
    const fim = c.inicio + c.duracao
    const proximo = visuais[i + 1]?.inicio ?? total
    if (proximo - fim > 0.05 && imagens.has(c.recursoId!)) {
      visuais[i] = { ...c, duracao: arred(proximo - c.inicio) }
      buracos++
    }
  }
  const primeiro = visuais[0]
  if (primeiro && primeiro.inicio > 0.05 && imagens.has(primeiro.recursoId!)) {
    visuais[0] = { ...primeiro, inicio: 0, duracao: arred(primeiro.duracao + primeiro.inicio) }
    buracos++
  }
  if (buracos) correcoes.push(`${buracos} trecho(s) sem imagem coberto(s) esticando a imagem vizinha.`)
  const porId = new Map(visuais.map((c) => [c.id, c]))
  clips = clips.map((c) => porId.get(c.id) ?? c)
  return { estado: correcoes.length ? { ...e, clips } : e, correcoes }
}

/** Texto narrado de cada cena (junta as legendas da cena, na ordem). */
export function textosDasCenas(e: EstadoEdicao): { indice: number; titulo: string; texto: string }[] {
  return e.cenas.map((c) => ({
    indice: c.indice,
    titulo: c.titulo,
    texto: e.clips
      .filter((x) => x.faixa === 'legendas' && x.cena === c.indice)
      .sort((a, b) => a.inicio - b.inicio)
      .map((x) => x.texto)
      .join(' ')
      .trim()
  }))
}

/**
 * Encaixa a narração gerada por cena: cada cena passa a durar o tempo real da sua fala (mais uma pausa curta),
 * e tudo o que pertence a ela (legendas, textos, imagens) é esticado ou encolhido na mesma proporção.
 * A trilha e narrações antigas sem cena saem (a montagem automática recoloca a trilha com a duração nova).
 */
export function retemporizarComNarracao(e: EstadoEdicao, narracoes: { cena: number; recursoId: number; duracao: number }[], pausa = 0.4): EstadoEdicao {
  const ordem = [...e.cenas].map((c) => ({ c, iv: intervaloCena(e, c.indice) })).sort((a, b) => (a.iv?.inicio ?? 0) - (b.iv?.inicio ?? 0))
  const clips: Clip[] = e.clips.filter((c) => c.cena === null && c.faixa !== 'narracao' && c.faixa !== 'audio')
  let cursor = 0
  for (const { c, iv } of ordem) {
    const n = narracoes.find((x) => x.cena === c.indice)
    const antiga = iv ? Math.max(0.1, iv.fim - iv.inicio) : 3
    const nova = n ? arred(n.duracao + pausa) : antiga
    const fator = nova / antiga
    for (const x of e.clips.filter((k) => k.cena === c.indice && k.faixa !== 'narracao')) {
      clips.push({ ...x, inicio: arred(cursor + (x.inicio - (iv?.inicio ?? 0)) * fator), duracao: arred(Math.max(0.1, x.duracao * fator)) })
    }
    if (n) clips.push({ id: novoId(), faixa: 'narracao', recursoId: n.recursoId, inicio: arred(cursor), duracao: arred(Math.max(0.1, n.duracao)), corteInicio: 0, volume: 1, fadeIn: 0, fadeOut: 0, texto: '', cena: c.indice })
    cursor = arred(cursor + nova)
  }
  return { ...e, clips }
}
