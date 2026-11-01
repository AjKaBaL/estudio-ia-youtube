import { lookup as dnsLookup, type LookupAddress } from 'node:dns'
import http from 'node:http'
import https from 'node:https'
import { isIP, type LookupFunction } from 'node:net'
import { brotliDecompressSync, gunzipSync, inflateSync } from 'node:zlib'

/**
 * Acesso à internet com proteções obrigatórias (Etapa 5):
 * - só http/https, sem usuário/senha na URL e só portas 80/443;
 * - bloqueio de endereços internos/locais (SSRF), conferido NO MOMENTO da conexão (evita DNS rebinding);
 * - redirecionamentos manuais, validados um a um e limitados;
 * - limite de tempo, de tamanho e de tipos de conteúdo; pede conteúdo sem compressão e, se o servidor
 *   compactar mesmo assim, descompacta com o MESMO limite de tamanho no resultado (evita "bombas");
 * - certificados TLS sempre validados; nenhum cookie ou cabeçalho de autenticação é enviado.
 */

export const USER_AGENT = 'EstudioIAYouTube/0.1 (+aplicativo local de pesquisa editorial)'

export interface OpcoesBusca {
  tempoLimiteMs?: number
  tamanhoMaximo?: number
  maxRedirecionamentos?: number
  tiposPermitidos?: readonly string[]
  sinal?: AbortSignal
  /** Progresso do download (bytes recebidos e total informado pelo servidor, se houver). */
  aoProgredir?: (recebidos: number, total: number | null) => void
  /** Somente para testes automatizados: permite conectar a 127.0.0.1. */
  permitirLoopbackEmTeste?: boolean
}

export interface RespostaWeb {
  urlFinal: string
  status: number
  tipoConteudo: string
  corpo: string
  /** O conteúdo original em bytes (para imagens, vídeos e arquivos baixados). */
  bytes?: Buffer
  cabecalhos: Record<string, string>
}

export class ErroRede extends Error {
  constructor(
    readonly codigo: 'url_invalida' | 'endereco_bloqueado' | 'tempo_esgotado' | 'muito_grande' | 'tipo_nao_permitido' | 'redirecionamentos' | 'http' | 'cancelado' | 'conexao',
    mensagem: string,
    readonly status?: number,
    readonly repetirAposMs?: number
  ) {
    super(mensagem)
  }
}

export const TIPOS_TEXTO = [
  'text/html',
  'application/xhtml+xml',
  'application/rss+xml',
  'application/atom+xml',
  'application/xml',
  'text/xml',
  'text/plain',
  'application/json',
  'application/feed+json'
] as const

// ------------------------------------------------------------------ endereços

function ipv4ParaNumero(ip: string): number {
  return ip.split('.').reduce((a, p) => (a << 8) + Number(p), 0) >>> 0
}

const FAIXAS_IPV4_BLOQUEADAS: [string, number][] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4]
]

/** Verdadeiro para endereços que não são da internet pública (rede local, loopback, reservados...). */
export function enderecoBloqueado(ip: string): boolean {
  const versao = isIP(ip)
  if (versao === 4) {
    const n = ipv4ParaNumero(ip)
    return FAIXAS_IPV4_BLOQUEADAS.some(([base, bits]) => {
      const mascara = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0
      return (n & mascara) === (ipv4ParaNumero(base) & mascara)
    })
  }
  if (versao === 6) {
    const s = ip.toLowerCase()
    if (s === '::' || s === '::1') return true
    const mapeado = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    if (mapeado) return enderecoBloqueado(mapeado[1]!)
    if (s.startsWith('::ffff:')) return true // forma hexadecimal de IPv4 mapeado: recusa por segurança
    const primeiro = parseInt(s.split(':')[0] || '0', 16)
    if ((primeiro & 0xfe00) === 0xfc00) return true // fc00::/7 — rede local única
    if ((primeiro & 0xffc0) === 0xfe80) return true // fe80::/10 — link-local
    if ((primeiro & 0xff00) === 0xff00) return true // multicast
    if (s.startsWith('2001:db8') || s.startsWith('64:ff9b') || s.startsWith('2002:')) return true // documentação/NAT64/6to4
    return false
  }
  return true
}

/** Valida a URL antes de qualquer conexão. */
export function validarUrlExterna(entrada: string): URL {
  let u: URL
  try {
    u = new URL(entrada)
  } catch {
    throw new ErroRede('url_invalida', 'Endereço inválido.')
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new ErroRede('url_invalida', 'Somente endereços http:// ou https:// são permitidos.')
  if (u.username || u.password) throw new ErroRede('url_invalida', 'Endereços com usuário ou senha não são permitidos.')
  if (u.port && u.port !== '80' && u.port !== '443') throw new ErroRede('url_invalida', 'Somente as portas padrão (80 e 443) são permitidas.')
  const host = u.hostname.replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new ErroRede('endereco_bloqueado', 'Endereços da rede local não são permitidos.')
  }
  if (isIP(host) && enderecoBloqueado(host)) throw new ErroRede('endereco_bloqueado', 'Endereços da rede local não são permitidos.')
  return u
}

/** Resolve o nome e recusa a conexão se algum endereço for interno. Usada pelo próprio socket. */
export function criarLookupSeguro(permitirLoopback: boolean): LookupFunction {
  return (hostname, options, callback) => {
    dnsLookup(hostname, { ...options, all: true, verbatim: true }, (erro, enderecos) => {
      if (erro) return callback(erro, '', 0)
      const lista = enderecos as unknown as LookupAddress[]
      const proibido = lista.find((e) => enderecoBloqueado(e.address) && !(permitirLoopback && (e.address === '127.0.0.1' || e.address === '::1')))
      if (proibido || lista.length === 0) {
        return callback(Object.assign(new Error('endereco_bloqueado'), { code: 'EBLOQUEADO' }), '', 0)
      }
      if ((options as { all?: boolean }).all) return (callback as unknown as (e: null, l: LookupAddress[]) => void)(null, lista)
      callback(null, lista[0]!.address, lista[0]!.family)
    })
  }
}

// ------------------------------------------------------------------ requisição

function requisitar(url: URL, op: Required<Omit<OpcoesBusca, 'sinal' | 'aoProgredir'>> & Pick<OpcoesBusca, 'sinal' | 'aoProgredir'>): Promise<RespostaWeb> {
  return new Promise((resolve, reject) => {
    const modulo = url.protocol === 'https:' ? https : http
    const req = modulo.request(
      url,
      {
        method: 'GET',
        lookup: criarLookupSeguro(op.permitirLoopbackEmTeste),
        headers: {
          'User-Agent': USER_AGENT,
          Accept: op.tiposPermitidos.join(', '),
          'Accept-Encoding': 'identity',
          'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.6'
        },
        timeout: op.tempoLimiteMs,
        signal: op.sinal,
        rejectUnauthorized: true
      },
      (res) => {
        const status = res.statusCode ?? 0
        const cabecalhos: Record<string, string> = {}
        for (const [k, v] of Object.entries(res.headers)) if (typeof v === 'string') cabecalhos[k] = v
        const tipo = (res.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase()
        if (status >= 300 && status < 400) {
          res.resume()
          return resolve({ urlFinal: url.href, status, tipoConteudo: tipo, corpo: '', bytes: Buffer.alloc(0), cabecalhos })
        }
        if (status < 200 || status >= 300) {
          res.resume()
          const espera = Number(res.headers['retry-after'])
          return reject(new ErroRede('http', `O servidor respondeu com o código ${status}.`, status, Number.isFinite(espera) ? espera * 1000 : undefined))
        }
        if (tipo && !op.tiposPermitidos.includes(tipo)) {
          res.destroy()
          return reject(new ErroRede('tipo_nao_permitido', `Tipo de conteúdo não permitido: ${tipo}.`))
        }
        const declarado = Number(res.headers['content-length'])
        if (Number.isFinite(declarado) && declarado > op.tamanhoMaximo) {
          res.destroy()
          return reject(new ErroRede('muito_grande', 'Conteúdo maior que o limite permitido.'))
        }
        const partes: Buffer[] = []
        let total = 0
        res.on('data', (p: Buffer) => {
          total += p.length
          if (total > op.tamanhoMaximo) {
            res.destroy()
            reject(new ErroRede('muito_grande', 'Conteúdo maior que o limite permitido.'))
            return
          }
          partes.push(p)
          op.aoProgredir?.(total, Number.isFinite(declarado) ? declarado : null)
        })
        res.on('end', () => {
          try {
            const corpo = descompactar(Buffer.concat(partes), cabecalhos['content-encoding'], op.tamanhoMaximo)
            resolve({ urlFinal: url.href, status, tipoConteudo: tipo, corpo: corpo.toString('utf8'), bytes: corpo, cabecalhos })
          } catch (e) {
            reject(e instanceof ErroRede ? e : new ErroRede('conexao', 'Conteúdo compactado inválido.'))
          }
        })
        res.on('error', (e) => reject(new ErroRede('conexao', e.message)))
      }
    )
    req.on('timeout', () => req.destroy(new ErroRede('tempo_esgotado', 'Tempo limite esgotado.')))
    req.on('error', (e: Error & { code?: string }) => {
      if (e instanceof ErroRede) return reject(e)
      if (e.name === 'AbortError') return reject(new ErroRede('cancelado', 'Cancelado pelo usuário.'))
      if (e.code === 'EBLOQUEADO' || e.message === 'endereco_bloqueado') return reject(new ErroRede('endereco_bloqueado', 'O endereço aponta para a rede local e foi bloqueado.'))
      reject(new ErroRede('conexao', 'Não foi possível conectar ao servidor.'))
    })
    req.end()
  })
}

/** Alguns servidores compactam mesmo quando pedimos "identity". O resultado nunca passa do limite. */
export function descompactar(dados: Buffer, codificacao: string | undefined, limite: number): Buffer {
  const c = (codificacao ?? '').trim().toLowerCase()
  if (!c || c === 'identity') return dados
  const opcoes = { maxOutputLength: limite }
  try {
    if (c === 'gzip' || c === 'x-gzip') return gunzipSync(dados, opcoes)
    if (c === 'deflate') return inflateSync(dados, opcoes)
    if (c === 'br') return brotliDecompressSync(dados, opcoes)
  } catch (e) {
    if (e instanceof RangeError || (e as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE') throw new ErroRede('muito_grande', 'Conteúdo descompactado maior que o limite permitido.')
    throw new ErroRede('conexao', 'Conteúdo compactado inválido.')
  }
  throw new ErroRede('tipo_nao_permitido', `Compressão não suportada: ${c}.`)
}

/** Busca um endereço externo com todas as proteções. Redirecionamentos são revalidados. */
export async function buscarSeguro(endereco: string, opcoes: OpcoesBusca = {}): Promise<RespostaWeb> {
  const op = {
    tempoLimiteMs: opcoes.tempoLimiteMs ?? 15_000,
    tamanhoMaximo: opcoes.tamanhoMaximo ?? 2 * 1024 * 1024,
    maxRedirecionamentos: opcoes.maxRedirecionamentos ?? 3,
    tiposPermitidos: opcoes.tiposPermitidos ?? TIPOS_TEXTO,
    permitirLoopbackEmTeste: opcoes.permitirLoopbackEmTeste ?? false,
    sinal: opcoes.sinal,
    aoProgredir: opcoes.aoProgredir
  }
  // Em teste, só 127.0.0.1 escapa da validação; qualquer outro destino continua sendo conferido.
  const validar = (u: string): URL => (op.permitirLoopbackEmTeste && new URL(u).hostname === '127.0.0.1' ? new URL(u) : validarUrlExterna(u))
  let url = validar(endereco)
  for (let i = 0; i <= op.maxRedirecionamentos; i++) {
    if (op.sinal?.aborted) throw new ErroRede('cancelado', 'Cancelado pelo usuário.')
    const r = await requisitar(url, op)
    if (r.status < 300 || r.status >= 400) return r
    const destino = r.cabecalhos.location
    if (!destino) throw new ErroRede('http', 'Redirecionamento sem destino.')
    const proximo = new URL(destino, url)
    if (url.protocol === 'https:' && proximo.protocol === 'http:') throw new ErroRede('redirecionamentos', 'Redirecionamento de https para http recusado.')
    url = validar(proximo.href)
  }
  throw new ErroRede('redirecionamentos', 'Redirecionamentos demais.')
}

/** Repete com espera crescente apenas para erros temporários (429, 5xx, tempo esgotado). */
export async function comRepeticao<T>(fn: () => Promise<T>, tentativas = 3, esperaBaseMs = 1000, sinal?: AbortSignal): Promise<T> {
  let ultimo: unknown
  for (let i = 0; i < tentativas; i++) {
    try {
      return await fn()
    } catch (e) {
      ultimo = e
      const temporario = e instanceof ErroRede && (e.codigo === 'tempo_esgotado' || (e.codigo === 'http' && (e.status === 429 || (e.status ?? 0) >= 500)))
      if (!temporario || i === tentativas - 1 || sinal?.aborted) throw e
      const espera = Math.min((e as ErroRede).repetirAposMs ?? esperaBaseMs * 2 ** i, 30_000)
      await new Promise((r) => setTimeout(r, espera))
    }
  }
  throw ultimo
}
