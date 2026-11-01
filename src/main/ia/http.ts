import http from 'node:http'
import https from 'node:https'
import type { LookupFunction } from 'node:net'
import { lookup as dnsLookup } from 'node:dns'
import { criarLookupSeguro, ErroRede, USER_AGENT, validarUrlExterna } from '../pesquisa/rede'

/**
 * Chamadas JSON para provedores de IA, com as mesmas proteções da pesquisa:
 * - provedores online: só https público (anti-SSRF), certificado validado;
 * - provedores locais (ex.: Ollama): só endereços do próprio computador (127.0.0.1/localhost).
 * Cabeçalhos de autenticação nunca são registrados nem devolvidos em mensagens de erro.
 */

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost'])

export function validarUrlProvedor(url: string, local: boolean): URL {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    throw new ErroRede('url_invalida', 'Endereço do provedor inválido.')
  }
  if (u.username || u.password) throw new ErroRede('url_invalida', 'Não coloque usuário ou senha no endereço.')
  if (local) {
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new ErroRede('url_invalida', 'Use http:// ou https://.')
    if (!LOOPBACK.has(u.hostname.replace(/^\[|\]$/g, ''))) throw new ErroRede('endereco_bloqueado', 'Provedores locais só podem usar 127.0.0.1 ou localhost.')
    return u
  }
  if (u.protocol !== 'https:') throw new ErroRede('url_invalida', 'Provedores online precisam usar https://.')
  return validarUrlExterna(u.href)
}

const lookupLocal: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: false }, (erro, endereco, familia) => {
    if (erro) return callback(erro, '', 0)
    if (endereco !== '127.0.0.1' && endereco !== '::1') return callback(Object.assign(new Error('endereco_bloqueado'), { code: 'EBLOQUEADO' }), '', 0)
    callback(null, endereco, familia)
  })
}

export interface OpcoesJson {
  local: boolean
  metodo?: 'GET' | 'POST'
  corpo?: unknown
  cabecalhos?: Record<string, string>
  tempoLimiteMs?: number
  tamanhoMaximo?: number
  sinal?: AbortSignal
}

/** Como requisitarJson, mas devolve os bytes da resposta (ex.: imagem gerada). Erros HTTP trazem a mensagem do JSON. */
export async function requisitarBytes(url: string, op: OpcoesJson): Promise<{ tipo: string; bytes: Buffer }> {
  const r = await requisitarBruto(url, op)
  return { tipo: r.tipo, bytes: r.bytes }
}

export async function requisitarJson(url: string, op: OpcoesJson): Promise<{ status: number; dados: unknown }> {
  const r = await requisitarBruto(url, op)
  const texto = r.bytes.toString('utf8')
  let dados: unknown
  try {
    dados = texto ? JSON.parse(texto) : null
  } catch {
    dados = null
  }
  return { status: r.status, dados }
}

function requisitarBruto(url: string, op: OpcoesJson): Promise<{ status: number; tipo: string; bytes: Buffer }> {
  const u = validarUrlProvedor(url, op.local)
  const corpo = op.corpo === undefined ? undefined : JSON.stringify(op.corpo)
  const limite = op.tamanhoMaximo ?? 4 * 1024 * 1024
  return new Promise((resolve, reject) => {
    const modulo = u.protocol === 'https:' ? https : http
    const req = modulo.request(
      u,
      {
        method: op.metodo ?? (corpo ? 'POST' : 'GET'),
        lookup: op.local ? lookupLocal : criarLookupSeguro(false),
        timeout: op.tempoLimiteMs ?? 120_000,
        signal: op.sinal,
        rejectUnauthorized: true,
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'application/json',
          'Accept-Encoding': 'identity',
          ...(corpo ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(corpo) } : {}),
          ...op.cabecalhos
        }
      },
      (res) => {
        const partes: Buffer[] = []
        let total = 0
        res.on('data', (p: Buffer) => {
          total += p.length
          if (total > limite) {
            res.destroy()
            reject(new ErroRede('muito_grande', 'Resposta do provedor maior que o limite.'))
            return
          }
          partes.push(p)
        })
        res.on('end', () => {
          const bytes = Buffer.concat(partes)
          const status = res.statusCode ?? 0
          if (status < 200 || status >= 300) {
            let dados: unknown
            try {
              dados = JSON.parse(bytes.toString('utf8'))
            } catch {
              dados = null
            }
            const msg = (dados as { error?: { message?: unknown } | string } | null)?.error
            const detalhe = typeof msg === 'string' ? msg : typeof msg?.message === 'string' ? msg.message : ''
            const espera = Number(res.headers['retry-after'])
            return reject(new ErroRede('http', `O provedor respondeu ${status}${detalhe ? `: ${detalhe.slice(0, 200)}` : ''}.`, status, Number.isFinite(espera) ? espera * 1000 : undefined))
          }
          resolve({ status, tipo: String(res.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase(), bytes })
        })
        res.on('error', () => reject(new ErroRede('conexao', 'Conexão interrompida.')))
      }
    )
    req.on('timeout', () => req.destroy(new ErroRede('tempo_esgotado', 'O provedor demorou demais para responder.')))
    req.on('error', (e: Error & { code?: string }) => {
      if (e instanceof ErroRede) return reject(e)
      if (e.name === 'AbortError') return reject(new ErroRede('cancelado', 'Cancelado pelo usuário.'))
      if (e.code === 'EBLOQUEADO') return reject(new ErroRede('endereco_bloqueado', 'Endereço bloqueado por segurança.'))
      if (e.code === 'ECONNREFUSED') return reject(new ErroRede('conexao', op.local ? 'Não foi possível conectar. O programa local (ex.: Ollama) está aberto?' : 'Conexão recusada pelo provedor.'))
      reject(new ErroRede('conexao', 'Não foi possível conectar ao provedor.'))
    })
    if (corpo) req.write(corpo)
    req.end()
  })
}
