import { ErroYouTube } from './erros'
import type { CanalYouTube, FonteTrafego, LinhaMetrica, MetadadosEnvio, PlaylistYouTube, SituacaoEnvio, StatusVideo, StatusYouTube, YouTubeGateway } from './tipos'
import { VERSAO_REGRAS } from './versao'

/** Implementação sem rede, usada em testes e quando não há conta conectada. */
export class YouTubeNaoConfigurado implements YouTubeGateway {
  async status(): Promise<StatusYouTube> {
    return { estado: 'nao_configurado', mensagem: 'Conta do YouTube não conectada.', versaoRegras: VERSAO_REGRAS, demonstrativo: false, escopos: [] }
  }
  protected recusar(): never {
    throw new ErroYouTube('validacao', 'Conta do YouTube não conectada.')
  }
  configurarCliente(_clientId: string, _clientSecret: string): void {
    this.recusar()
  }
  removerCliente(): void {}
  async conectar(_op: { metricas: boolean; receita: boolean; abrirNavegador: (url: string) => Promise<void>; sinal?: AbortSignal }): Promise<StatusYouTube> {
    return this.recusar()
  }
  async desconectar(): Promise<void> {}
  async listarCanais(): Promise<CanalYouTube[]> {
    return this.recusar()
  }
  async listarPlaylists(): Promise<PlaylistYouTube[]> {
    return this.recusar()
  }
  async iniciarEnvio(_meta: MetadadosEnvio, _tamanho: number, _tipoMime: string): Promise<string> {
    return this.recusar()
  }
  async consultarEnvio(_sessao: string, _tamanho: number): Promise<SituacaoEnvio> {
    return this.recusar()
  }
  async enviarPartes(_sessao: string, _caminho: string, _tamanho: number, _desde: number, _aoProgredir: (bytes: number) => void, _sinal: AbortSignal): Promise<SituacaoEnvio> {
    return this.recusar()
  }
  async definirMiniatura(_videoId: string, _caminho: string, _tipoMime: string): Promise<void> {
    return this.recusar()
  }
  async statusVideo(_videoId: string): Promise<StatusVideo | null> {
    return this.recusar()
  }
  async metricas(_inicio: string, _fim: string, _videoIds: string[]): Promise<LinhaMetrica[]> {
    return this.recusar()
  }
  async fontesTrafego(_inicio: string, _fim: string): Promise<FonteTrafego[]> {
    return this.recusar()
  }
}
