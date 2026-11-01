import { ErroApp } from '../erros'
import { requisitarBytes, requisitarJson } from '../ia/http'
import { buscarSeguro } from '../pesquisa/rede'
import { htmlParaTexto } from '../pesquisa/texto'
import { licencaAceita, type FonteImagemBusca, type GeradorImagem } from '@shared/geracaoMidia'

/**
 * Busca de imagens e vídeos com licença livre e geração de imagens por IA.
 * Só baixa por https público (mesmas proteções da pesquisa), confere o tipo pelo conteúdo
 * e guarda autor, licença e endereço de cada arquivo.
 */

export interface ResultadoMidia {
  fonte: FonteImagemBusca
  tipo: 'imagem' | 'video'
  titulo: string
  autor: string
  licenca: string
  exigeCredito: boolean
  urlPagina: string
  urlArquivo: string
  previa: string
  largura: number
  altura: number
  duracaoSeg: number | null
}

const UA_JSON = { local: false, tempoLimiteMs: 20_000 } as const

// ------------------------------------------------------------------ Wikimedia Commons (sem chave)

/** Arquivos que costumam ficar estranhos num vídeo: logotipos, mapas, diagramas, documentos, ícones, cartazes. */
const ESTRANHOS = /\b(logo|logotipo|map|mapa|flag|bandeira|coat of arms|bras[aã]o|diagram|diagrama|chart|gr[aá]fico|graph|scheme|esquema|signature|assinatura|screenshot|captura de tela|document|documento|pdf|page \d|p[aá]gina|scan|icon|[ií]cone|symbol|s[ií]mbolo|emblem|seal|selo|stamp|poster|cartaz|infographic|infogr[aá]fico|table|tabela|text|texto|plan|planta|blueprint|cover|capa)\b/i

const normal = (t: string): string => t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/** O título do arquivo precisa ter pelo menos uma palavra da busca (evita resultados sem relação com a cena). */
export function relevante(titulo: string, consulta: string): boolean {
  const palavras = normal(consulta).split(/[^a-z0-9]+/).filter((p) => p.length >= 4)
  if (!palavras.length) return true
  const t = normal(titulo)
  return palavras.some((p) => t.includes(p.slice(0, Math.max(4, p.length - 2))))
}

export function aceitavelNoVideo(titulo: string, consulta: string): boolean {
  return !ESTRANHOS.test(titulo) && relevante(titulo, consulta)
}

export async function buscarWikimedia(consulta: string, n: number, aceitarSA: boolean, orientacao: 'horizontal' | 'vertical'): Promise<ResultadoMidia[]> {
  const q = new URLSearchParams({
    action: 'query',
    format: 'json',
    generator: 'search',
    gsrnamespace: '6',
    gsrsearch: `${consulta} filetype:bitmap`,
    gsrlimit: String(Math.min(30, n * 8)),
    prop: 'imageinfo',
    iiprop: 'url|extmetadata|size|mime',
    iiurlwidth: '1920'
  })
  const r = await buscarSeguro(`https://commons.wikimedia.org/w/api.php?${q}`, { tempoLimiteMs: 20_000, tiposPermitidos: ['application/json'] })
  const paginas = Object.values((JSON.parse(r.corpo) as { query?: { pages?: Record<string, unknown> } }).query?.pages ?? {}) as {
    title: string
    index?: number
    imageinfo?: { url: string; thumburl?: string; width: number; height: number; mime: string; descriptionurl: string; extmetadata?: Record<string, { value?: string }> }[]
  }[]
  const saida: ResultadoMidia[] = []
  for (const p of paginas.sort((a, b) => (a.index ?? 0) - (b.index ?? 0))) {
    const ii = p.imageinfo?.[0]
    if (!ii || !/^image\/(jpeg|png|webp)$/.test(ii.mime)) continue
    if (ii.width < 1000 || (orientacao === 'horizontal' ? ii.width < ii.height : ii.height < ii.width)) continue
    const proporcao = ii.width / ii.height
    if (orientacao === 'horizontal' ? proporcao < 1.2 || proporcao > 2.2 : proporcao > 0.85) continue
    if (!aceitavelNoVideo(p.title, consulta)) continue
    const meta = ii.extmetadata ?? {}
    const licenca = htmlParaTexto(meta.LicenseShortName?.value ?? '')
    const regra = licencaAceita(licenca, aceitarSA)
    if (!regra.aceita) continue
    saida.push({
      fonte: 'wikimedia',
      tipo: 'imagem',
      titulo: p.title.replace(/^File:/, '').replace(/\.[a-z]+$/i, ''),
      autor: htmlParaTexto(meta.Artist?.value ?? '').slice(0, 200) || 'Autor no Wikimedia Commons',
      licenca,
      exigeCredito: regra.exigeCredito,
      urlPagina: ii.descriptionurl,
      urlArquivo: ii.thumburl ?? ii.url,
      previa: ii.thumburl ?? ii.url,
      largura: ii.width,
      altura: ii.height,
      duracaoSeg: null
    })
    if (saida.length >= n) break
  }
  return saida
}

/** Vídeos do Wikimedia Commons (licenças livres): usa a versão convertida até 1080p, só vídeos curtos. */
export async function buscarWikimediaVideos(consulta: string, n: number, aceitarSA: boolean, orientacao: 'horizontal' | 'vertical'): Promise<ResultadoMidia[]> {
  const q = new URLSearchParams({
    action: 'query',
    format: 'json',
    generator: 'search',
    gsrnamespace: '6',
    gsrsearch: `${consulta} filetype:video`,
    gsrlimit: String(Math.min(30, n * 8)),
    prop: 'videoinfo',
    viprop: 'url|size|mime|extmetadata|derivatives'
  })
  const r = await buscarSeguro(`https://commons.wikimedia.org/w/api.php?${q}`, { tempoLimiteMs: 20_000, tiposPermitidos: ['application/json'] })
  const paginas = Object.values((JSON.parse(r.corpo) as { query?: { pages?: Record<string, unknown> } }).query?.pages ?? {}) as {
    title: string
    index?: number
    videoinfo?: { width: number; height: number; duration?: number; descriptionurl: string; extmetadata?: Record<string, { value?: string }>; derivatives?: { type: string; width: number; height: number; src: string }[] }[]
  }[]
  const saida: ResultadoMidia[] = []
  for (const p of paginas.sort((a, b) => (a.index ?? 0) - (b.index ?? 0))) {
    const vi = p.videoinfo?.[0]
    if (!vi || !vi.duration || vi.duration < 3 || vi.duration > 120) continue
    if (orientacao === 'horizontal' ? vi.width < vi.height : vi.height < vi.width) continue
    if (!aceitavelNoVideo(p.title, consulta)) continue
    const meta = vi.extmetadata ?? {}
    const licenca = htmlParaTexto(meta.LicenseShortName?.value ?? '')
    const regra = licencaAceita(licenca, aceitarSA)
    if (!regra.aceita) continue
    // Maior versão WebM até 1080 de altura (e pelo menos 480).
    const der = (vi.derivatives ?? []).filter((d) => d.type.startsWith('video/webm') && d.height >= 480 && d.height <= 1080).sort((a, b) => b.height - a.height)[0]
    if (!der) continue
    saida.push({
      fonte: 'wikimedia',
      tipo: 'video',
      titulo: p.title.replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, ''),
      autor: htmlParaTexto(meta.Artist?.value ?? '').slice(0, 200) || 'Autor no Wikimedia Commons',
      licenca,
      exigeCredito: regra.exigeCredito,
      urlPagina: vi.descriptionurl,
      urlArquivo: der.src,
      previa: '',
      largura: der.width,
      altura: der.height,
      duracaoSeg: vi.duration
    })
    if (saida.length >= n) break
  }
  return saida
}

// ------------------------------------------------------------------ Pexels (chave gratuita)

export async function buscarPexels(consulta: string, chave: string, n: number, tipo: 'imagem' | 'video', orientacao: 'horizontal' | 'vertical'): Promise<ResultadoMidia[]> {
  const o = orientacao === 'horizontal' ? 'landscape' : 'portrait'
  const q = new URLSearchParams({ query: consulta, per_page: String(Math.min(15, n * 3)), orientation: o, locale: 'pt-BR' })
  const cab = { Authorization: chave }
  if (tipo === 'imagem') {
    const r = await requisitarJson(`https://api.pexels.com/v1/search?${q}`, { ...UA_JSON, cabecalhos: cab })
    const fotos = ((r.dados as { photos?: unknown[] })?.photos ?? []) as { url: string; photographer: string; alt: string; width: number; height: number; src: { large2x: string; medium: string } }[]
    return fotos.slice(0, n).map((f) => ({
      fonte: 'pexels' as const,
      tipo: 'imagem' as const,
      titulo: f.alt || 'Foto do Pexels',
      autor: f.photographer,
      licenca: 'Licença Pexels (uso gratuito, inclusive comercial)',
      exigeCredito: false,
      urlPagina: f.url,
      urlArquivo: f.src.large2x,
      previa: f.src.medium,
      largura: f.width,
      altura: f.height,
      duracaoSeg: null
    }))
  }
  const r = await requisitarJson(`https://api.pexels.com/videos/search?${q}`, { ...UA_JSON, cabecalhos: cab })
  const videos = ((r.dados as { videos?: unknown[] })?.videos ?? []) as { url: string; duration: number; width: number; height: number; image: string; user: { name: string }; video_files: { link: string; width: number | null; height: number | null; file_type: string }[] }[]
  return videos.slice(0, n).flatMap((v) => {
    // Arquivo MP4 mais próximo de 1920 px no lado maior, sem passar disso (evita downloads enormes).
    const arq = v.video_files.filter((f) => f.file_type === 'video/mp4' && (f.width ?? 0) > 0 && Math.max(f.width ?? 0, f.height ?? 0) <= 1920).sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]
    return arq
      ? [{ fonte: 'pexels' as const, tipo: 'video' as const, titulo: 'Vídeo do Pexels', autor: v.user.name, licenca: 'Licença Pexels (uso gratuito, inclusive comercial)', exigeCredito: false, urlPagina: v.url, urlArquivo: arq.link, previa: v.image, largura: arq.width ?? v.width, altura: arq.height ?? v.height, duracaoSeg: v.duration }]
      : []
  })
}

// ------------------------------------------------------------------ Pixabay (chave gratuita)

export async function buscarPixabay(consulta: string, chave: string, n: number, tipo: 'imagem' | 'video', orientacao: 'horizontal' | 'vertical'): Promise<ResultadoMidia[]> {
  const q = new URLSearchParams({ key: chave, q: consulta.slice(0, 100), lang: 'pt', safesearch: 'true', per_page: String(Math.max(3, Math.min(20, n * 3))) })
  if (tipo === 'imagem') {
    q.set('image_type', 'photo')
    q.set('orientation', orientacao)
    const r = await requisitarJson(`https://pixabay.com/api/?${q}`, UA_JSON)
    const hits = ((r.dados as { hits?: unknown[] })?.hits ?? []) as { pageURL: string; tags: string; user: string; largeImageURL: string; webformatURL: string; imageWidth: number; imageHeight: number }[]
    return hits.slice(0, n).map((h) => ({
      fonte: 'pixabay' as const,
      tipo: 'imagem' as const,
      titulo: h.tags || 'Imagem do Pixabay',
      autor: h.user,
      licenca: 'Licença Pixabay (uso gratuito, inclusive comercial)',
      exigeCredito: false,
      urlPagina: h.pageURL,
      urlArquivo: h.largeImageURL,
      previa: h.webformatURL,
      largura: h.imageWidth,
      altura: h.imageHeight,
      duracaoSeg: null
    }))
  }
  const r = await requisitarJson(`https://pixabay.com/api/videos/?${q}`, UA_JSON)
  const hits = ((r.dados as { hits?: unknown[] })?.hits ?? []) as { pageURL: string; tags: string; user: string; duration: number; videos: Record<string, { url: string; width: number; height: number; thumbnail?: string }> }[]
  return hits.slice(0, n).flatMap((h) => {
    const v = h.videos.large?.url ? h.videos.large : h.videos.medium
    return v?.url ? [{ fonte: 'pixabay' as const, tipo: 'video' as const, titulo: h.tags || 'Vídeo do Pixabay', autor: h.user, licenca: 'Licença Pixabay (uso gratuito, inclusive comercial)', exigeCredito: false, urlPagina: h.pageURL, urlArquivo: v.url, previa: v.thumbnail ?? '', largura: v.width, altura: v.height, duracaoSeg: h.duration }] : []
  })
}

// ------------------------------------------------------------------ download conferido

const ASSINATURAS: { ext: string; confere: (b: Buffer) => boolean }[] = [
  { ext: '.jpg', confere: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: '.png', confere: (b) => b.length > 8 && b.readUInt32BE(0) === 0x89504e47 },
  { ext: '.webp', confere: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
  { ext: '.mp4', confere: (b) => b.subarray(4, 8).toString('latin1') === 'ftyp' },
  { ext: '.webm', confere: (b) => b.length > 4 && b.readUInt32BE(0) === 0x1a45dfa3 }
]

/** Extensão pelo conteúdo (nunca pelo nome); null se não for imagem/vídeo aceito. */
export function extensaoPeloConteudo(b: Buffer): string | null {
  return ASSINATURAS.find((a) => a.confere(b))?.ext ?? null
}

export async function baixarMidia(r: ResultadoMidia): Promise<{ bytes: Buffer; ext: string }> {
  const resp = await buscarSeguro(r.urlArquivo, {
    tempoLimiteMs: 5 * 60_000,
    tamanhoMaximo: r.tipo === 'video' ? 300 * 1024 * 1024 : 25 * 1024 * 1024,
    maxRedirecionamentos: 5,
    tiposPermitidos: ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm', 'application/octet-stream', 'binary/octet-stream']
  })
  const bytes = resp.bytes ?? Buffer.from(resp.corpo)
  const ext = extensaoPeloConteudo(bytes)
  if (!ext) throw new ErroApp('tipo_midia', 'O arquivo baixado não é uma imagem ou vídeo aceito.')
  return { bytes, ext }
}

// ------------------------------------------------------------------ geração por IA

/** Tamanho pedido ao gerador (múltiplos de 16, perto de 16:9 ou 9:16). */
export const TAMANHO_GERACAO = { '16:9': { largura: 1344, altura: 768 }, '9:16': { largura: 768, altura: 1344 } } as const

export async function gerarImagem(gerador: GeradorImagem, prompt: string, formato: '16:9' | '9:16', chave: string, contaCloudflare: string, sinal?: AbortSignal): Promise<{ bytes: Buffer; ext: string; modelo: string }> {
  const t = TAMANHO_GERACAO[formato]
  const cab = { Authorization: `Bearer ${chave}` }
  let bytes: Buffer
  let modelo: string
  if (gerador === 'pollinations') {
    const q = new URLSearchParams({ width: String(t.largura), height: String(t.altura), model: 'flux', nologo: 'true', safe: 'true' })
    bytes = (await requisitarBytes(`https://gen.pollinations.ai/image/${encodeURIComponent(prompt)}?${q}`, { local: false, cabecalhos: cab, tempoLimiteMs: 180_000, tamanhoMaximo: 20 * 1024 * 1024, sinal })).bytes
    modelo = 'Pollinations (FLUX)'
  } else if (gerador === 'huggingface') {
    bytes = (
      await requisitarBytes('https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell', {
        local: false,
        cabecalhos: { ...cab, Accept: 'image/jpeg' },
        corpo: { inputs: prompt, parameters: { width: t.largura, height: t.altura } },
        tempoLimiteMs: 180_000,
        tamanhoMaximo: 20 * 1024 * 1024,
        sinal
      })
    ).bytes
    modelo = 'FLUX.1 schnell (Hugging Face)'
  } else {
    if (!/^[a-f0-9]{32}$/i.test(contaCloudflare)) throw new ErroApp('validacao', 'Informe o ID da conta Cloudflare (32 caracteres) em Configurações › Mídia automática.')
    const r = await requisitarJson(`https://api.cloudflare.com/client/v4/accounts/${contaCloudflare}/ai/run/@cf/black-forest-labs/flux-1-schnell`, {
      local: false,
      cabecalhos: cab,
      corpo: { prompt, steps: 6 },
      tempoLimiteMs: 180_000,
      tamanhoMaximo: 30 * 1024 * 1024,
      sinal
    })
    const b64 = (r.dados as { result?: { image?: unknown } })?.result?.image
    if (typeof b64 !== 'string') throw new ErroApp('geracao', 'A Cloudflare não devolveu a imagem.')
    bytes = Buffer.from(b64, 'base64')
    modelo = 'FLUX.1 schnell (Cloudflare Workers AI)'
  }
  const ext = extensaoPeloConteudo(bytes)
  if (!ext || ext === '.mp4' || ext === '.webm') throw new ErroApp('geracao', 'O gerador não devolveu uma imagem válida.')
  return { bytes, ext, modelo }
}
