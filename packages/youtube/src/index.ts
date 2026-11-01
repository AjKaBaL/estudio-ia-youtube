import { YouTubeReal } from './gateway'
import type { ClienteHttp, Segredos, YouTubeGateway } from './tipos'

export type {
  CanalYouTube,
  ClienteHttp,
  EstadoConexaoYouTube,
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
export { ErroYouTube, type TipoErroYouTube } from './erros'
export { DESCRICAO_ESCOPOS, ESCOPOS } from './oauth'
export { VERSAO_REGRAS } from './versao'
export { YouTubeNaoConfigurado } from './naoConfigurado'

/** Hosts oficiais que o aplicativo deve permitir no cliente HTTP injetado. */
export const HOSTS_PERMITIDOS = ['accounts.google.com', 'oauth2.googleapis.com', 'www.googleapis.com', 'youtubeanalytics.googleapis.com'] as const

/** Ponto de entrada único: o aplicativo injeta HTTP e cofre, e não conhece a implementação. */
export function criarYouTubeGateway(deps: { http: ClienteHttp; segredos: Segredos }): YouTubeGateway {
  return new YouTubeReal(deps.http, deps.segredos)
}
