import { z } from 'zod'

/**
 * Piloto automático: encadeia todas as etapas sozinho — a IA revisa e aprova roteiro e publicação pelas mesmas
 * travas fixas da aprovação manual, corrige o que o controle de qualidade reprova e publica no horário marcado.
 * Só pede o usuário no que nenhum programa pode fazer por ele (ex.: conectar a conta do YouTube).
 */

export const configPilotoSchema = z.object({
  ligado: z.boolean(),
  /** Cria pautas a partir dos melhores resultados das pesquisas (ficam como "ideia"). */
  criarPautas: z.boolean(),
  /** Coloca os melhores temas nos horários livres da agenda (agendar um tema o aprova). */
  escolherTemas: z.boolean(),
  /** Monta o dossiê com IA: afirmações com trechos exatos das notícias pesquisadas. */
  montarDossie: z.boolean(),
  gerarRoteiros: z.boolean(),
  produzirMidia: z.boolean(),
  renderizar: z.boolean(),
  prepararPublicacao: z.boolean(),
  /** A IA revisa (e corrige) o roteiro e o aprova quando não sobra nenhum ponto crítico. */
  aprovarComIa: z.boolean().default(true),
  /** Avisos do controle de qualidade (não bloqueadores) são aceitos com justificativa registrada. */
  aceitarAvisos: z.boolean().default(true),
  /** A IA aprova a publicação e envia ao YouTube. */
  enviarAprovadas: z.boolean(),
  /** Publica sozinho no horário marcado (autorização do usuário). Desligado: envia como privado. */
  publicarSozinho: z.boolean().default(true),
  /** Declaração exigida pelo YouTube para o canal (tecnologia e negócios: não é para crianças). */
  feitoParaCriancas: z.boolean().default(false),
  /** Produz os vídeos agendados para os próximos N dias. */
  diasAntecedencia: z.number().int().min(1).max(30)
})
export type ConfigPiloto = z.infer<typeof configPilotoSchema>

export const CONFIG_PILOTO_PADRAO: ConfigPiloto = {
  ligado: false,
  criarPautas: true,
  escolherTemas: true,
  montarDossie: true,
  gerarRoteiros: true,
  produzirMidia: true,
  renderizar: true,
  prepararPublicacao: true,
  aprovarComIa: true,
  aceitarAvisos: true,
  enviarAprovadas: true,
  publicarSozinho: true,
  feitoParaCriancas: false,
  diasAntecedencia: 14
}

export const ROTULO_OPCAO_PILOTO: Record<Exclude<keyof ConfigPiloto, 'ligado' | 'diasAntecedencia' | 'feitoParaCriancas'>, string> = {
  criarPautas: 'Criar pautas a partir das melhores notícias pesquisadas',
  escolherTemas: 'Colocar os melhores temas nos horários livres da agenda',
  montarDossie: 'Montar o dossiê com IA (só afirmações com trecho exato de notícia real)',
  gerarRoteiros: 'Escrever o roteiro com IA',
  aprovarComIa: 'A IA revisa, corrige e aprova o roteiro (só sem nenhum ponto crítico)',
  produzirMidia: 'Gerar narração e imagens',
  renderizar: 'Renderizar e fazer o controle de qualidade',
  aceitarAvisos: 'Aceitar avisos do controle de qualidade (bloqueadores nunca)',
  prepararPublicacao: 'Preparar a publicação (título, descrição e miniatura)',
  enviarAprovadas: 'A IA aprova a publicação e envia ao YouTube',
  publicarSozinho: 'Publicar sozinho no horário marcado (desligado: envia como privado)'
}

export const ETAPAS_PILOTO = ['pautas', 'tema', 'dossie', 'roteiro', 'aprovar_roteiro', 'edicao', 'midia', 'render', 'qualidade', 'publicacao', 'aprovar_publicacao', 'envio'] as const
export type EtapaPiloto = (typeof ETAPAS_PILOTO)[number]
export const ROTULO_ETAPA_PILOTO: Record<EtapaPiloto, string> = {
  pautas: 'Pautas',
  tema: 'Tema',
  dossie: 'Dossiê',
  roteiro: 'Roteiro',
  aprovar_roteiro: 'Aprovação do roteiro (IA)',
  edicao: 'Edição',
  midia: 'Narração e imagens',
  render: 'Renderização',
  qualidade: 'Controle de qualidade',
  publicacao: 'Publicação',
  aprovar_publicacao: 'Aprovação da publicação (IA)',
  envio: 'Envio ao YouTube'
}

export interface RegistroPiloto {
  id: number
  calendarioId: number | null
  titulo: string
  etapa: EtapaPiloto
  resultado: 'feito' | 'aguardando' | 'erro'
  mensagem: string
  /** Só o que nenhum programa resolve sozinho (ex.: conectar a conta do YouTube). */
  precisaUsuario: boolean
  criadoEm: string
}

/** Situação de um vídeo agendado, para o painel: em linguagem simples, sem etapas para aprovar. */
export interface SituacaoVideo {
  fase: 'na_fila' | 'produzindo' | 'corrigindo' | 'pronto' | 'publicando' | 'publicado' | 'precisa_voce'
  texto: string
  /** Vídeo pronto (aprovado no controle de qualidade) e ainda não enviado: pode ir ao ar já. */
  podePostar: boolean
  percentual: number | null
}

export interface EstadoPiloto {
  config: ConfigPiloto
  rodando: boolean
  etapaAtual: string | null
  ultimoCiclo: string | null
  proximoCiclo: string | null
  /** Situação atual de cada vídeo da janela de produção (a última etapa registrada). */
  itens: { calendarioId: number; titulo: string; inicioUtc: string; etapa: EtapaPiloto; resultado: RegistroPiloto['resultado']; mensagem: string; precisaUsuario: boolean }[]
  registros: RegistroPiloto[]
}
