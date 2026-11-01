import type { YouTubeGateway } from '@estudio/youtube'
import type { Banco } from './db/conexao'
import type { GerenciadorPesquisas } from './pesquisa/executor'
import type { Cofre } from './ia/cofre'
import type { GerenciadorProducao } from './midia/producao'
import type { Ferramentas } from './midia/ffmpeg'
import type { GerenciadorEnvio } from './youtube/publicacao'

/** Dependências compartilhadas pelos manipuladores IPC. Facilita testar sem Electron. */
export interface Contexto {
  db: Banco
  versaoApp: string
  pastaDados: string
  pastaBackups: string
  youtube: YouTubeGateway
  pesquisas: GerenciadorPesquisas
  cofre: Cofre
  pastaMidia: string
  pastaRender: string
  producao: GerenciadorProducao
  ferramentas: () => Ferramentas | null
  envios: GerenciadorEnvio
  abrirNavegador: (url: string) => Promise<void>
  plataforma: Plataforma
}

/** Operações que dependem do Windows/Electron (caixa de diálogo, explorador de arquivos). */
export interface Plataforma {
  /** Abre "Salvar como" e grava o texto. Devolve o caminho escolhido ou null se o usuário cancelar. */
  salvarTexto(nomeSugerido: string, conteudo: string, filtro: { nome: string; extensao: string }): Promise<string | null>
  abrirPasta(caminho: string): Promise<void>
  /** Caixa "Abrir" nativa para escolher arquivos. Devolve [] se o usuário cancelar. */
  escolherArquivos(filtro: { nome: string; extensoes: string[] }, varios: boolean): Promise<string[]>
  mostrarNoExplorador(caminho: string): void
  /** Pasta Downloads do usuário (para achar o client_secret….json baixado do Google). */
  pastaDownloads?: string
  /** Bandeja e iniciar com o Windows (só no app real; nos testes fica ausente). */
  segundoPlano?: { ler(): { bandeja: boolean; iniciarComWindows: boolean }; definir(p: { bandeja: boolean; iniciarComWindows: boolean }): { bandeja: boolean; iniciarComWindows: boolean } }
}
