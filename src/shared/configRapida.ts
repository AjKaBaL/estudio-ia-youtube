import type { ProgressoTarefa } from './tipos'

/** Ações de configuração de um clique (assistente e telas de configuração). */

export const PRESETS_AGENDA = {
  leve: { longo: 1, short: 3, rotulo: 'Começar leve', descricao: '1 vídeo longo + 3 Shorts por semana' },
  medio: { longo: 2, short: 5, rotulo: 'Ritmo médio', descricao: '2 vídeos longos + 5 Shorts por semana' },
  intenso: { longo: 3, short: 7, rotulo: 'Intenso', descricao: '3 vídeos longos + 1 Short por dia' }
} as const

export const ACOES_RAPIDAS = [
  'tudo',
  'projeto',
  'pesquisa',
  'agenda_leve',
  'agenda_medio',
  'agenda_intenso',
  'ia_hibrido',
  'ia_local',
  'video',
  'instalar_ollama',
  'instalar_ffmpeg'
] as const
export type AcaoRapida = (typeof ACOES_RAPIDAS)[number]

/** Barra de progresso das instalações de um clique. */
export interface ProgressoInstalacao extends ProgressoTarefa {
  pacote: 'ollama' | 'ffmpeg' | 'piper'
}
