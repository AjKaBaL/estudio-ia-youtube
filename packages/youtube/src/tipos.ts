/**
 * Tipos próprios do pacote. O restante do aplicativo depende apenas destes tipos,
 * nunca de objetos da API do Google, para que mudanças do YouTube fiquem contidas aqui.
 */

export type EstadoConexaoYouTube = 'nao_configurado' | 'desconectado' | 'conectado' | 'erro'

export interface StatusYouTube {
  estado: EstadoConexaoYouTube
  /** Mensagem curta em português para exibir ao usuário. */
  mensagem: string
  /** Versão das regras de acesso que este pacote implementa (ver REGRAS.md). */
  versaoRegras: string
  /** Indica uma implementação demonstrativa, que nunca acessa o YouTube real. */
  demonstrativo: boolean
  /** Permissões (escopos) efetivamente concedidas pela conta. */
  escopos: string[]
}

/** Cliente HTTP injetado pelo aplicativo (com suas proteções de rede). */
export interface ClienteHttp {
  requisitar(req: {
    metodo: 'GET' | 'POST' | 'PUT'
    url: string
    cabecalhos?: Record<string, string>
    corpo?: string | Buffer
    tempoLimiteMs?: number
    sinal?: AbortSignal
  }): Promise<{ status: number; cabecalhos: Record<string, string>; corpo: string }>
}

/** Armazenamento de segredos injetado pelo aplicativo (cofre criptografado). */
export interface Segredos {
  obter(chave: string): string | null
  guardar(chave: string, valor: string): void
  remover(chave: string): void
}

export interface CanalYouTube {
  id: string
  titulo: string
}

export interface PlaylistYouTube {
  id: string
  titulo: string
}

export interface MetadadosEnvio {
  titulo: string
  descricao: string
  tags: string[]
  categoriaId: string
  privacidade: 'private' | 'unlisted' | 'public'
  /** ISO 8601. Só vale com privacidade "private" (o YouTube publica na data). */
  publicarEm: string | null
  feitoParaCriancas: boolean
  /** Divulgação de conteúdo sintético/alterado realista, quando aplicável. */
  conteudoSintetico: boolean
}

export interface SituacaoEnvio {
  concluido: boolean
  bytesRecebidos: number
  videoId: string | null
}

export interface StatusVideo {
  id: string
  statusEnvio: string
  privacidade: string
  publicarEm: string | null
  motivoRejeicao: string | null
  visualizacoes: number | null
}

export interface LinhaMetrica {
  videoId: string
  visualizacoes: number | null
  minutosAssistidos: number | null
  duracaoMediaSeg: number | null
  percentualMedioAssistido: number | null
  inscritosGanhos: number | null
}

export interface FonteTrafego {
  fonte: string
  visualizacoes: number
}

/** Contrato único entre o aplicativo e o YouTube. */
export interface YouTubeGateway {
  status(): Promise<StatusYouTube>
  configurarCliente(clientId: string, clientSecret: string): void
  removerCliente(): void
  conectar(opcoes: { metricas: boolean; receita: boolean; abrirNavegador: (url: string) => Promise<void>; sinal?: AbortSignal }): Promise<StatusYouTube>
  desconectar(): Promise<void>
  listarCanais(): Promise<CanalYouTube[]>
  listarPlaylists(): Promise<PlaylistYouTube[]>
  iniciarEnvio(meta: MetadadosEnvio, tamanho: number, tipoMime: string): Promise<string>
  consultarEnvio(sessao: string, tamanho: number): Promise<SituacaoEnvio>
  enviarPartes(sessao: string, caminho: string, tamanho: number, desde: number, aoProgredir: (bytes: number) => void, sinal: AbortSignal): Promise<SituacaoEnvio>
  definirMiniatura(videoId: string, caminho: string, tipoMime: string): Promise<void>
  statusVideo(videoId: string): Promise<StatusVideo | null>
  metricas(inicio: string, fim: string, videoIds: string[]): Promise<LinhaMetrica[]>
  fontesTrafego(inicio: string, fim: string): Promise<FonteTrafego[]>
}
