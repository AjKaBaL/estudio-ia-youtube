import { createHash, randomBytes } from 'node:crypto'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import type { ClienteHttp } from './tipos'
import { classificarErro, ErroYouTube } from './erros'

/**
 * OAuth 2.0 para aplicativos instalados (fluxo oficial do Google), com PKCE e redirecionamento
 * para um servidor local temporário preso a 127.0.0.1, que atende uma única resposta e fecha.
 */

export const ESCOPOS = {
  leitura: 'https://www.googleapis.com/auth/youtube.readonly',
  envio: 'https://www.googleapis.com/auth/youtube.upload',
  metricas: 'https://www.googleapis.com/auth/yt-analytics.readonly',
  receita: 'https://www.googleapis.com/auth/yt-analytics-monetary.readonly'
} as const

export const DESCRICAO_ESCOPOS: Record<string, string> = {
  [ESCOPOS.leitura]: 'Ver o canal e as playlists da conta (somente leitura).',
  [ESCOPOS.envio]: 'Enviar vídeos para o canal (não permite excluir nem editar vídeos existentes).',
  [ESCOPOS.metricas]: 'Ver relatórios de audiência do YouTube Analytics (somente leitura).',
  [ESCOPOS.receita]: 'Ver relatórios de receita do YouTube Analytics (somente leitura), se o canal for monetizado.'
}

export const URL_AUTORIZACAO = 'https://accounts.google.com/o/oauth2/v2/auth'
export const URL_TOKEN = 'https://oauth2.googleapis.com/token'
export const URL_REVOGAR = 'https://oauth2.googleapis.com/revoke'

const base64url = (b: Buffer): string => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

export function gerarPkce(): { verificador: string; desafio: string } {
  const verificador = base64url(randomBytes(32))
  return { verificador, desafio: base64url(createHash('sha256').update(verificador).digest()) }
}

export function montarUrlAutorizacao(p: { clientId: string; redirectUri: string; escopos: string[]; estado: string; desafio: string }): string {
  const u = new URL(URL_AUTORIZACAO)
  u.searchParams.set('client_id', p.clientId)
  u.searchParams.set('redirect_uri', p.redirectUri)
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('scope', p.escopos.join(' '))
  u.searchParams.set('state', p.estado)
  u.searchParams.set('code_challenge', p.desafio)
  u.searchParams.set('code_challenge_method', 'S256')
  u.searchParams.set('access_type', 'offline')
  u.searchParams.set('prompt', 'consent')
  u.searchParams.set('include_granted_scopes', 'false')
  return u.href
}

const PAGINA = (titulo: string): string =>
  `<!doctype html><meta charset="utf-8"><title>${titulo}</title><body style="font-family:sans-serif;background:#0f0f0f;color:#f1f1f1;padding:40px"><h1>${titulo}</h1><p>Você pode fechar esta janela e voltar ao Estúdio.</p></body>`

/** Servidor de uso único em 127.0.0.1, porta escolhida pelo sistema. */
export async function aguardarCodigo(abrirNavegador: (redirectUri: string) => Promise<void>, estado: string, tempoLimiteMs = 300_000, sinal?: AbortSignal): Promise<{ codigo: string; redirectUri: string }> {
  return new Promise((resolve, reject) => {
    let redirectUri = ''
    const servidor = http.createServer((req, res) => {
      const u = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (u.pathname !== '/retorno') {
        res.writeHead(404).end()
        return
      }
      const erro = u.searchParams.get('error')
      const codigo = u.searchParams.get('code')
      if (u.searchParams.get('state') !== estado) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' }).end(PAGINA('Resposta inválida'))
        return encerrar(new ErroYouTube('autorizacao', 'A resposta de autorização não corresponde a este pedido e foi ignorada.'))
      }
      if (erro || !codigo) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(PAGINA('Autorização não concedida'))
        return encerrar(new ErroYouTube('autorizacao', erro === 'access_denied' ? 'Você não concedeu a autorização.' : 'Autorização não concluída.'))
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(PAGINA('Conta conectada'))
      encerrar(null, codigo)
    })
    const limite = setTimeout(() => encerrar(new ErroYouTube('autorizacao', 'Tempo esgotado aguardando a autorização no navegador.')), tempoLimiteMs)
    const abortar = (): void => encerrar(new ErroYouTube('autorizacao', 'Conexão cancelada.'))
    sinal?.addEventListener('abort', abortar, { once: true })
    let encerrado = false
    function encerrar(e: Error | null, codigo?: string): void {
      if (encerrado) return
      encerrado = true
      clearTimeout(limite)
      sinal?.removeEventListener('abort', abortar)
      servidor.close()
      if (e) reject(e)
      else resolve({ codigo: codigo!, redirectUri })
    }
    servidor.listen(0, '127.0.0.1', () => {
      redirectUri = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/retorno`
      abrirNavegador(redirectUri).catch((e: unknown) => encerrar(e instanceof Error ? e : new Error(String(e))))
    })
  })
}

export interface Tokens {
  acesso: string
  renovacao: string | null
  expiraEm: number
  escopos: string[]
}

async function postarFormulario(http: ClienteHttp, url: string, campos: Record<string, string>): Promise<Record<string, unknown>> {
  const r = await http.requisitar({ metodo: 'POST', url, cabecalhos: { 'Content-Type': 'application/x-www-form-urlencoded' }, corpo: new URLSearchParams(campos).toString(), tempoLimiteMs: 30_000 })
  if (r.status < 200 || r.status >= 300) throw classificarErro(r.status, r.corpo)
  return JSON.parse(r.corpo || '{}') as Record<string, unknown>
}

function paraTokens(d: Record<string, unknown>, renovacaoAnterior: string | null): Tokens {
  if (typeof d.access_token !== 'string') throw new ErroYouTube('autorizacao', 'Resposta de autorização inesperada.')
  return {
    acesso: d.access_token,
    renovacao: typeof d.refresh_token === 'string' ? d.refresh_token : renovacaoAnterior,
    expiraEm: Date.now() + (typeof d.expires_in === 'number' ? d.expires_in : 3600) * 1000,
    escopos: typeof d.scope === 'string' ? d.scope.split(' ') : []
  }
}

export async function trocarCodigo(http: ClienteHttp, p: { clientId: string; clientSecret: string; codigo: string; verificador: string; redirectUri: string }): Promise<Tokens> {
  return paraTokens(
    await postarFormulario(http, URL_TOKEN, { client_id: p.clientId, client_secret: p.clientSecret, code: p.codigo, code_verifier: p.verificador, grant_type: 'authorization_code', redirect_uri: p.redirectUri }),
    null
  )
}

export async function renovarTokens(http: ClienteHttp, p: { clientId: string; clientSecret: string; renovacao: string }): Promise<Tokens> {
  return paraTokens(await postarFormulario(http, URL_TOKEN, { client_id: p.clientId, client_secret: p.clientSecret, refresh_token: p.renovacao, grant_type: 'refresh_token' }), p.renovacao)
}

export async function revogarToken(http: ClienteHttp, token: string): Promise<void> {
  await postarFormulario(http, URL_REVOGAR, { token }).catch(() => undefined) // revogar é "melhor esforço"; os dados locais são apagados de qualquer forma
}
