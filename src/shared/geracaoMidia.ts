import { z } from 'zod'

/**
 * Produção automática de mídia (Etapa 19): narração por voz sintética, busca de imagens/vídeos com
 * licença livre e geração de imagens por IA. Cada arquivo guarda a origem, o autor e a licença.
 */

// ------------------------------------------------------------------ voz

export const MOTORES_VOZ = ['windows', 'piper'] as const
export type MotorVoz = (typeof MOTORES_VOZ)[number]
export const INFO_MOTOR_VOZ: Record<MotorVoz, { nome: string; descricao: string }> = {
  windows: { nome: 'Voz do Windows', descricao: 'Já vem no Windows (ex.: Microsoft Maria). Instantânea e offline, mas soa robótica: fica só como reserva.' },
  piper: { nome: 'Piper (voz neural, no PC) — recomendada', descricao: 'Voz neural gratuita e offline (pt-BR “Faber”), bem mais natural. O app instala sozinho na primeira narração (cerca de 85 MB, com assinatura conferida).' }
}

// ------------------------------------------------------------------ imagens: busca

export const FONTES_IMAGEM = ['wikimedia', 'pexels', 'pixabay'] as const
export type FonteImagemBusca = (typeof FONTES_IMAGEM)[number]
export const INFO_FONTE_IMAGEM: Record<FonteImagemBusca, { nome: string; exigeChave: boolean; urlChave: string; videos: boolean; descricao: string }> = {
  wikimedia: {
    nome: 'Wikimedia Commons',
    exigeChave: false,
    urlChave: '',
    videos: false,
    descricao: 'Acervo livre da Wikipédia. Sem chave. Só entram imagens em domínio público, CC0 ou CC BY (com crédito ao autor na descrição).'
  },
  pexels: {
    nome: 'Pexels',
    exigeChave: true,
    urlChave: 'https://www.pexels.com/api/',
    videos: true,
    descricao: 'Fotos e vídeos de alta qualidade, uso gratuito inclusive comercial (licença Pexels). Chave gratuita.'
  },
  pixabay: {
    nome: 'Pixabay',
    exigeChave: true,
    urlChave: 'https://pixabay.com/api/docs/',
    videos: true,
    descricao: 'Fotos, ilustrações e vídeos, uso gratuito inclusive comercial (licença Pixabay). Chave gratuita.'
  }
}

/** Licenças do Wikimedia aceitas sem pedir revisão: domínio público, CC0 e CC BY (atribuição). */
export function licencaAceita(nomeCurto: string, aceitarCompartilhaIgual: boolean): { aceita: boolean; exigeCredito: boolean } {
  const n = nomeCurto.toLowerCase().replace(/\s+/g, ' ').trim()
  if (/^(public domain|pd|domínio público|cc0|cc-zero)/.test(n) || n.startsWith('pd-')) return { aceita: true, exigeCredito: false }
  if (/\b(nc|nd)\b|noncommercial|noderiv|fair use|copyright/.test(n)) return { aceita: false, exigeCredito: true }
  if (/^cc[ -]by[ -]sa/.test(n)) return { aceita: aceitarCompartilhaIgual, exigeCredito: true }
  if (/^cc[ -]by\b/.test(n)) return { aceita: true, exigeCredito: true }
  return { aceita: false, exigeCredito: true }
}

// ------------------------------------------------------------------ imagens: geração por IA

export const GERADORES_IMAGEM = ['pollinations', 'huggingface', 'cloudflare'] as const
export type GeradorImagem = (typeof GERADORES_IMAGEM)[number]
export const INFO_GERADOR: Record<GeradorImagem, { nome: string; urlChave: string; descricao: string; exigeConta: boolean }> = {
  pollinations: { nome: 'Pollinations', urlChave: 'https://enter.pollinations.ai/keys', descricao: 'Geração de imagens (FLUX e outros). Chave gratuita com cota diária.', exigeConta: false },
  huggingface: {
    nome: 'Hugging Face (FLUX.1 schnell)',
    urlChave: 'https://huggingface.co/settings/tokens',
    descricao: 'Modelo FLUX.1 schnell (licença Apache 2.0). Token gratuito com créditos mensais pequenos.',
    exigeConta: false
  },
  cloudflare: {
    nome: 'Cloudflare Workers AI (FLUX.1 schnell)',
    urlChave: 'https://dash.cloudflare.com/profile/api-tokens',
    descricao: 'Cota gratuita diária. Precisa do ID da conta (32 caracteres) e de um token com permissão “Workers AI”.',
    exigeConta: true
  }
}

// ------------------------------------------------------------------ preferências

/** Acabamento dos vídeos produzidos (tudo ligado por padrão). */
export const estiloVideoSchema = z.object({
  /** Apresentador animado no canto, com poses que acompanham o texto. */
  apresentador: z.boolean(),
  lado: z.enum(['direita', 'esquerda']),
  /** Fotos com zoom e deslocamento suaves (e parallax quando a proporção não encaixa). */
  movimento: z.boolean(),
  /** Transição suave na troca de cena. */
  transicoes: z.boolean(),
  /** Trilha sonora em todo vídeo (criada pelo app se não houver uma na biblioteca). */
  trilha: z.boolean(),
  /** Título de cada cena na tela nos primeiros segundos. */
  titulos: z.boolean(),
  /** Buscar também vídeos (intercalados com fotos). */
  videos: z.boolean()
})
export type EstiloVideo = z.infer<typeof estiloVideoSchema>
export const ESTILO_VIDEO_PADRAO: EstiloVideo = { apresentador: true, lado: 'direita', movimento: true, transicoes: true, trilha: true, titulos: true, videos: true }

export const preferenciaMidiaSchema = z.object({
  voz: z.object({
    motor: z.enum(MOTORES_VOZ),
    /** Nome da voz do Windows (vazio = a primeira em português). */
    vozWindows: z.string().max(120),
    /** -5 (lenta) a 5 (rápida). */
    velocidade: z.number().int().min(-5).max(5)
  }),
  busca: z.object({
    fontes: z.array(z.enum(FONTES_IMAGEM)).max(3),
    /** CC BY-SA exige que obras derivadas usem a mesma licença; desligado por padrão. */
    aceitarCompartilhaIgual: z.boolean(),
    preferirVideos: z.boolean(),
    porCena: z.number().int().min(1).max(3)
  }),
  geracao: z.object({
    ativa: z.boolean(),
    gerador: z.enum(GERADORES_IMAGEM),
    /** Gera mesmo quando a busca achou (true) ou só quando não achou nada (false). */
    sempre: z.boolean(),
    estilo: z.string().max(200),
    contaCloudflare: z.string().max(40),
    /** Sem imagem da busca nem da IA: cria um cartão gráfico (título + frase) no próprio app, sem chave. */
    cartoes: z.boolean().default(true)
  }),
  video: estiloVideoSchema.default(ESTILO_VIDEO_PADRAO)
})
export type PreferenciaMidia = z.infer<typeof preferenciaMidiaSchema>

export const PREFERENCIA_MIDIA_PADRAO: PreferenciaMidia = {
  voz: { motor: 'piper', vozWindows: '', velocidade: 0 },
  busca: { fontes: ['wikimedia', 'pexels', 'pixabay'], aceitarCompartilhaIgual: false, preferirVideos: false, porCena: 1 },
  geracao: { ativa: true, gerador: 'pollinations', sempre: false, estilo: 'ilustração editorial moderna, cores vivas, iluminação suave', contaCloudflare: '', cartoes: true },
  video: ESTILO_VIDEO_PADRAO
}

/**
 * Prompt da imagem de uma cena. Pede explicitamente: sem texto, sem logotipos e sem pessoas reais
 * identificáveis (evita confundir o público e usar a imagem de alguém sem autorização).
 */
export function promptDaCena(d: { titulo: string; visual: string; narracao: string; estilo: string; formato: '16:9' | '9:16' }): string {
  const cena = (d.visual || d.titulo).replace(/\s+/g, ' ').trim().slice(0, 300)
  const contexto = d.narracao.replace(/\s+/g, ' ').trim().slice(0, 240)
  return [
    `${cena}.`,
    contexto && `Contexto: ${contexto}`,
    `Estilo: ${d.estilo || 'ilustração editorial moderna'}. Enquadramento ${d.formato === '9:16' ? 'vertical' : 'horizontal'}.`,
    'Sem texto, sem letras, sem logotipos, sem marcas d’água e sem pessoas reais identificáveis.'
  ]
    .filter(Boolean)
    .join(' ')
    .slice(0, 900)
}

/** Termos de busca a partir do título da cena e do tema (sem palavras vazias). */
export function termosDeBusca(titulo: string, tema: string): string {
  const vazias = new Set(['a', 'o', 'as', 'os', 'de', 'da', 'do', 'das', 'dos', 'e', 'em', 'no', 'na', 'nos', 'nas', 'um', 'uma', 'para', 'por', 'com', 'que', 'como', 'ponto', 'cena', 'abertura', 'conclusão', 'conclusao', 'introdução', 'ideia', 'central', 'desenvolvimento'])
  const palavras = `${titulo} ${tema}`
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .filter((p) => p.length > 2 && !vazias.has(p) && !/^\d+$/.test(p))
  return [...new Set(palavras)].slice(0, 5).join(' ')
}

/** Duração de um WAV PCM lendo o cabeçalho (sem precisar do FFmpeg). */
export function duracaoWav(b: Uint8Array): number | null {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const txt = (i: number): string => String.fromCharCode(b[i]!, b[i + 1]!, b[i + 2]!, b[i + 3]!)
  if (b.length < 44 || txt(0) !== 'RIFF' || txt(8) !== 'WAVE') return null
  let i = 12
  let bytesPorSeg = 0
  while (i + 8 <= b.length) {
    const id = txt(i)
    const tam = v.getUint32(i + 4, true)
    if (id === 'fmt ') bytesPorSeg = v.getUint32(i + 16, true)
    if (id === 'data') return bytesPorSeg > 0 ? Math.min(tam, b.length - i - 8) / bytesPorSeg : null
    i += 8 + tam + (tam % 2)
  }
  return null
}
