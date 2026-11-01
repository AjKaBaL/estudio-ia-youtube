import { randomBytes } from 'node:crypto'
import { closeSync, openSync, readSync, readFileSync } from 'node:fs'
import { classificarErro, ErroYouTube } from './erros'
import { aguardarCodigo, ESCOPOS, gerarPkce, montarUrlAutorizacao, renovarTokens, revogarToken, trocarCodigo, type Tokens } from './oauth'
import type {
  CanalYouTube,
  ClienteHttp,
  FonteTrafego,
  LinhaMetrica,
  MetadadosEnvio,
  PlaylistYouTube,
  Segredos,
  SituacaoEnvio,
  StatusVideo,
  StatusYouTube,
  YouTubeGateway
} from './tipos'
import { VERSAO_REGRAS } from './versao'

/**
 * Implementação real, usando somente a API oficial (YouTube Data API v3 e YouTube Analytics API v2).
 * Tokens ficam no cofre do aplicativo e nunca são registrados em logs nem devolvidos ao chamador.
 */

const API = 'https://www.googleapis.com/youtube/v3'
const API_UPLOAD = 'https://www.googleapis.com/upload/youtube/v3'
const API_ANALYTICS = 'https://youtubeanalytics.googleapis.com/v2/reports'
/** Partes do envio retomável: múltiplos de 256 KiB, como exige a API. */
export const TAMANHO_PARTE = 8 * 1024 * 1024

const CHAVES = { cliente: 'youtube:cliente', tokens: 'youtube:tokens' }

export class YouTubeReal implements YouTubeGateway {
  constructor(
    private readonly http: ClienteHttp,
    private readonly segredos: Segredos
  ) {}

  private cliente(): { clientId: string; clientSecret: string } | null {
    const v = this.segredos.obter(CHAVES.cliente)
    if (!v) return null
    try {
      return JSON.parse(v) as { clientId: string; clientSecret: string }
    } catch {
      return null
    }
  }

  private tokens(): Tokens | null {
    const v = this.segredos.obter(CHAVES.tokens)
    if (!v) return null
    try {
      return JSON.parse(v) as Tokens
    } catch {
      return null
    }
  }

  private async tokenValido(): Promise<string> {
    const c = this.cliente()
    const t = this.tokens()
    if (!c || !t) throw new ErroYouTube('autorizacao', 'Conta do YouTube não conectada.')
    if (t.expiraEm - Date.now() > 60_000) return t.acesso
    if (!t.renovacao) throw new ErroYouTube('autorizacao', 'A autorização expirou. Conecte a conta novamente.')
    const novos = await renovarTokens(this.http, { ...c, renovacao: t.renovacao })
    this.segredos.guardar(CHAVES.tokens, JSON.stringify({ ...novos, escopos: novos.escopos.length ? novos.escopos : t.escopos }))
    return novos.acesso
  }

  private async chamar(metodo: 'GET' | 'POST' | 'PUT', url: string, extra: { corpo?: string | Buffer; cabecalhos?: Record<string, string>; tempoLimiteMs?: number; sinal?: AbortSignal } = {}): Promise<{ status: number; cabecalhos: Record<string, string>; corpo: string }> {
    const token = await this.tokenValido()
    const r = await this.http.requisitar({ metodo, url, corpo: extra.corpo, tempoLimiteMs: extra.tempoLimiteMs ?? 60_000, sinal: extra.sinal, cabecalhos: { Authorization: `Bearer ${token}`, ...extra.cabecalhos } })
    if (r.status >= 400) throw classificarErro(r.status, r.corpo)
    return r
  }

  async status(): Promise<StatusYouTube> {
    const base = { versaoRegras: VERSAO_REGRAS, demonstrativo: false }
    if (!this.cliente()) return { ...base, estado: 'nao_configurado', mensagem: 'Credenciais do projeto Google (OAuth) ainda não informadas.', escopos: [] }
    const t = this.tokens()
    if (!t) return { ...base, estado: 'desconectado', mensagem: 'Projeto configurado; conta ainda não conectada.', escopos: [] }
    return { ...base, estado: 'conectado', mensagem: 'Conta conectada.', escopos: t.escopos }
  }

  configurarCliente(clientId: string, clientSecret: string): void {
    if (!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(clientId)) throw new ErroYouTube('validacao', 'O ID do cliente OAuth deve terminar em .apps.googleusercontent.com.')
    if (clientSecret.length < 8) throw new ErroYouTube('validacao', 'Chave secreta do cliente inválida.')
    this.segredos.guardar(CHAVES.cliente, JSON.stringify({ clientId, clientSecret }))
  }

  removerCliente(): void {
    this.segredos.remover(CHAVES.cliente)
  }

  async conectar(op: { metricas: boolean; receita: boolean; abrirNavegador: (url: string) => Promise<void>; sinal?: AbortSignal }): Promise<StatusYouTube> {
    const c = this.cliente()
    if (!c) throw new ErroYouTube('validacao', 'Informe primeiro as credenciais OAuth do seu projeto Google.')
    const escopos = [ESCOPOS.leitura, ESCOPOS.envio, ...(op.metricas ? [ESCOPOS.metricas] : []), ...(op.receita ? [ESCOPOS.receita] : [])]
    const pkce = gerarPkce()
    const estado = randomBytes(16).toString('hex')
    const { codigo, redirectUri } = await aguardarCodigo(
      (redirectUri) => op.abrirNavegador(montarUrlAutorizacao({ clientId: c.clientId, redirectUri, escopos, estado, desafio: pkce.desafio })),
      estado,
      300_000,
      op.sinal
    )
    const tokens = await trocarCodigo(this.http, { ...c, codigo, verificador: pkce.verificador, redirectUri })
    this.segredos.guardar(CHAVES.tokens, JSON.stringify(tokens))
    return this.status()
  }

  /** Revoga no Google (quando possível) e apaga os tokens locais. */
  async desconectar(): Promise<void> {
    const t = this.tokens()
    if (t) await revogarToken(this.http, t.renovacao ?? t.acesso)
    this.segredos.remover(CHAVES.tokens)
  }

  async listarCanais(): Promise<CanalYouTube[]> {
    const r = await this.chamar('GET', `${API}/channels?part=snippet&mine=true&maxResults=50`)
    const d = JSON.parse(r.corpo) as { items?: { id: string; snippet?: { title?: string } }[] }
    return (d.items ?? []).map((i) => ({ id: i.id, titulo: i.snippet?.title ?? i.id }))
  }

  async listarPlaylists(): Promise<PlaylistYouTube[]> {
    const r = await this.chamar('GET', `${API}/playlists?part=snippet&mine=true&maxResults=50`)
    const d = JSON.parse(r.corpo) as { items?: { id: string; snippet?: { title?: string } }[] }
    return (d.items ?? []).map((i) => ({ id: i.id, titulo: i.snippet?.title ?? i.id }))
  }

  /** Cria a sessão de envio retomável e devolve o endereço da sessão (tratado como segredo pelo app). */
  async iniciarEnvio(meta: MetadadosEnvio, tamanho: number, tipoMime: string): Promise<string> {
    const corpo = JSON.stringify({
      snippet: { title: meta.titulo, description: meta.descricao, tags: meta.tags, categoryId: meta.categoriaId, defaultLanguage: 'pt-BR' },
      status: {
        privacyStatus: meta.publicarEm ? 'private' : meta.privacidade,
        ...(meta.publicarEm ? { publishAt: meta.publicarEm } : {}),
        selfDeclaredMadeForKids: meta.feitoParaCriancas,
        containsSyntheticMedia: meta.conteudoSintetico
      }
    })
    const r = await this.chamar('POST', `${API_UPLOAD}/videos?uploadType=resumable&part=snippet,status`, {
      corpo,
      cabecalhos: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Length': String(tamanho), 'X-Upload-Content-Type': tipoMime }
    })
    const sessao = r.cabecalhos.location
    if (!sessao?.startsWith('https://www.googleapis.com/upload/')) throw new ErroYouTube('outro', 'O YouTube não devolveu uma sessão de envio válida.')
    return sessao
  }

  private interpretarSituacao(r: { status: number; cabecalhos: Record<string, string>; corpo: string }): SituacaoEnvio {
    if (r.status === 200 || r.status === 201) {
      const d = JSON.parse(r.corpo) as { id?: string }
      return { concluido: true, bytesRecebidos: -1, videoId: d.id ?? null }
    }
    if (r.status === 308) {
      const m = r.cabecalhos.range?.match(/bytes=0-(\d+)/)
      return { concluido: false, bytesRecebidos: m ? Number(m[1]) + 1 : 0, videoId: null }
    }
    throw classificarErro(r.status, r.corpo)
  }

  /** Pergunta ao YouTube quantos bytes já recebeu (para retomar depois de falha ou reinício). */
  async consultarEnvio(sessao: string, tamanho: number): Promise<SituacaoEnvio> {
    const token = await this.tokenValido()
    const r = await this.http.requisitar({ metodo: 'PUT', url: sessao, cabecalhos: { Authorization: `Bearer ${token}`, 'Content-Range': `bytes */${tamanho}`, 'Content-Length': '0' }, tempoLimiteMs: 30_000 })
    if (r.status === 404 || r.status === 410) throw new ErroYouTube('nao_encontrado', 'A sessão de envio expirou. Será preciso iniciar um novo envio.')
    return this.interpretarSituacao(r)
  }

  async enviarPartes(sessao: string, caminho: string, tamanho: number, desde: number, aoProgredir: (bytes: number) => void, sinal: AbortSignal): Promise<SituacaoEnvio> {
    let posicao = desde
    const fd = openSync(caminho, 'r')
    try {
      while (posicao < tamanho) {
        if (sinal.aborted) return { concluido: false, bytesRecebidos: posicao, videoId: null }
        const fim = Math.min(posicao + TAMANHO_PARTE, tamanho)
        const parte = Buffer.alloc(fim - posicao)
        readSync(fd, parte, 0, parte.length, posicao)
        const token = await this.tokenValido()
        const r = await this.http.requisitar({
          metodo: 'PUT',
          url: sessao,
          corpo: parte,
          sinal,
          tempoLimiteMs: 300_000,
          cabecalhos: { Authorization: `Bearer ${token}`, 'Content-Length': String(parte.length), 'Content-Range': `bytes ${posicao}-${fim - 1}/${tamanho}` }
        })
        const s = this.interpretarSituacao(r)
        if (s.concluido) {
          aoProgredir(tamanho)
          return s
        }
        posicao = s.bytesRecebidos
        aoProgredir(posicao)
      }
      return this.consultarEnvio(sessao, tamanho)
    } finally {
      closeSync(fd)
    }
  }

  async definirMiniatura(videoId: string, caminho: string, tipoMime: string): Promise<void> {
    await this.chamar('POST', `${API_UPLOAD}/thumbnails/set?videoId=${encodeURIComponent(videoId)}&uploadType=media`, { corpo: readFileSync(caminho), cabecalhos: { 'Content-Type': tipoMime } })
  }

  async statusVideo(videoId: string): Promise<StatusVideo | null> {
    const r = await this.chamar('GET', `${API}/videos?part=status,statistics&id=${encodeURIComponent(videoId)}`)
    const i = (JSON.parse(r.corpo) as { items?: { id: string; status?: { uploadStatus?: string; privacyStatus?: string; publishAt?: string; rejectionReason?: string }; statistics?: { viewCount?: string } }[] }).items?.[0]
    if (!i) return null
    return {
      id: i.id,
      statusEnvio: i.status?.uploadStatus ?? 'desconhecido',
      privacidade: i.status?.privacyStatus ?? 'desconhecida',
      publicarEm: i.status?.publishAt ?? null,
      motivoRejeicao: i.status?.rejectionReason ?? null,
      visualizacoes: i.statistics?.viewCount ? Number(i.statistics.viewCount) : null
    }
  }

  async metricas(inicio: string, fim: string, videoIds: string[]): Promise<LinhaMetrica[]> {
    if (!videoIds.length) return []
    const u = new URL(API_ANALYTICS)
    u.searchParams.set('ids', 'channel==MINE')
    u.searchParams.set('startDate', inicio)
    u.searchParams.set('endDate', fim)
    u.searchParams.set('metrics', 'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained')
    u.searchParams.set('dimensions', 'video')
    u.searchParams.set('filters', `video==${videoIds.slice(0, 200).join(',')}`)
    u.searchParams.set('maxResults', '200')
    const r = await this.chamar('GET', u.href)
    const d = JSON.parse(r.corpo) as { columnHeaders?: { name: string }[]; rows?: (string | number)[][] }
    const cols = (d.columnHeaders ?? []).map((c) => c.name)
    const val = (linha: (string | number)[], nome: string): number | null => {
      const i = cols.indexOf(nome)
      return i >= 0 && linha[i] !== undefined ? Number(linha[i]) : null
    }
    return (d.rows ?? []).map((l) => ({
      videoId: String(l[cols.indexOf('video')]),
      visualizacoes: val(l, 'views'),
      minutosAssistidos: val(l, 'estimatedMinutesWatched'),
      duracaoMediaSeg: val(l, 'averageViewDuration'),
      percentualMedioAssistido: val(l, 'averageViewPercentage'),
      inscritosGanhos: val(l, 'subscribersGained')
    }))
  }

  async fontesTrafego(inicio: string, fim: string): Promise<FonteTrafego[]> {
    const u = new URL(API_ANALYTICS)
    u.searchParams.set('ids', 'channel==MINE')
    u.searchParams.set('startDate', inicio)
    u.searchParams.set('endDate', fim)
    u.searchParams.set('metrics', 'views')
    u.searchParams.set('dimensions', 'insightTrafficSourceType')
    u.searchParams.set('sort', '-views')
    const r = await this.chamar('GET', u.href)
    const d = JSON.parse(r.corpo) as { rows?: [string, number][] }
    return (d.rows ?? []).map(([fonte, v]) => ({ fonte, visualizacoes: Number(v) }))
  }
}
