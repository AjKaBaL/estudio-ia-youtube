/** Vocabulário do domínio compartilhado entre processo principal e interface. */

export const STATUS_ROTEIRO = ['rascunho', 'precisa_verificacao', 'pronto_revisao', 'em_revisao', 'aprovado', 'publicado'] as const
export type StatusRoteiro = (typeof STATUS_ROTEIRO)[number]
export const ROTULO_STATUS_ROTEIRO: Record<StatusRoteiro, string> = {
  rascunho: 'Rascunho',
  precisa_verificacao: 'Precisa de verificação',
  pronto_revisao: 'Pronto para revisão',
  em_revisao: 'Em revisão',
  aprovado: 'Aprovado',
  publicado: 'Publicado'
}

export const TIPOS_VIDEO = ['longo', 'short'] as const
export type TipoVideo = (typeof TIPOS_VIDEO)[number]
export const ROTULO_TIPO_VIDEO: Record<TipoVideo, string> = { longo: 'Vídeo longo', short: 'Short' }

export const STATUS_PAUTA = ['ideia', 'aprovada', 'descartada'] as const
export type StatusPauta = (typeof STATUS_PAUTA)[number]
export const ROTULO_STATUS_PAUTA: Record<StatusPauta, string> = {
  ideia: 'Ideia',
  aprovada: 'Aprovada',
  descartada: 'Rejeitada'
}

export const STATUS_PESQUISA = ['pendente', 'em_andamento', 'concluida', 'erro', 'cancelada'] as const
export type StatusPesquisa = (typeof STATUS_PESQUISA)[number]
export const ROTULO_STATUS_PESQUISA: Record<StatusPesquisa, string> = {
  pendente: 'Pendente',
  em_andamento: 'Em andamento',
  concluida: 'Concluída',
  erro: 'Erro',
  cancelada: 'Cancelada'
}

export const STATUS_TAREFA = ['pendente', 'em_andamento', 'concluida', 'erro', 'perdida', 'ignorada', 'cancelada'] as const
export type StatusTarefa = (typeof STATUS_TAREFA)[number]
export const ROTULO_STATUS_TAREFA: Record<StatusTarefa, string> = {
  pendente: 'Aguardando',
  em_andamento: 'Em execução',
  concluida: 'Concluída',
  erro: 'Erro',
  perdida: 'Perdida (app fechado)',
  ignorada: 'Ignorada',
  cancelada: 'Cancelada'
}

export const TIPOS_FONTE = ['oficial', 'estudo', 'documentacao', 'jornalistica', 'blog', 'rede_social', 'outro'] as const
export type TipoFonte = (typeof TIPOS_FONTE)[number]
export const ROTULO_TIPO_FONTE: Record<TipoFonte, string> = {
  oficial: 'Página oficial',
  estudo: 'Estudo',
  documentacao: 'Documentação técnica',
  jornalistica: 'Jornalística',
  blog: 'Blog',
  rede_social: 'Rede social',
  outro: 'Outro'
}

export const STATUS_AGENDAMENTO = ['planejado', 'cancelado', 'publicado'] as const
export type StatusAgendamento = (typeof STATUS_AGENDAMENTO)[number]

/** Dias da semana no padrão JavaScript: 0 = domingo ... 6 = sábado. */
export const ROTULO_DIA_SEMANA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'] as const
export const ROTULO_DIA_CURTO = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'] as const
