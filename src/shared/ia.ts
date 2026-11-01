import { z } from 'zod'

/** Central de serviços de IA, orçamento e operação híbrida (Etapa 10). */

export const CATEGORIAS_SERVICO = ['llm', 'pesquisa_web', 'tts', 'imagem', 'video', 'transcricao', 'outros'] as const
export type CategoriaServico = (typeof CATEGORIAS_SERVICO)[number]
export const ROTULO_CATEGORIA: Record<CategoriaServico, string> = {
  llm: 'Modelo de linguagem (pesquisa, síntese e roteiros)',
  pesquisa_web: 'Pesquisa web',
  tts: 'Texto para fala / narração',
  imagem: 'Geração de imagem',
  video: 'Geração de vídeo',
  transcricao: 'Transcrição / legendas',
  outros: 'Outros serviços opcionais'
}

export const ADAPTADORES_LLM = ['simulado', 'ollama', 'openai_compativel'] as const
export type AdaptadorLlm = (typeof ADAPTADORES_LLM)[number]
export const INFO_ADAPTADOR: Record<AdaptadorLlm, { nome: string; local: boolean; exigeChave: boolean; descricao: string; urlPadrao: string }> = {
  simulado: {
    nome: 'Simulado (teste)',
    local: true,
    exigeChave: false,
    descricao: 'Adaptador de TESTE: não usa IA de verdade e devolve texto marcado como [SIMULADO]. Serve para conferir o fluxo sem custo.',
    urlPadrao: ''
  },
  ollama: {
    nome: 'Ollama (local)',
    local: true,
    exigeChave: false,
    descricao: 'Modelos rodando no próprio computador, sem custo por uso. Exige instalar o Ollama e baixar um modelo. Nada sai do computador.',
    urlPadrao: 'http://127.0.0.1:11434'
  },
  openai_compativel: {
    nome: 'API compatível com OpenAI (online)',
    local: false,
    exigeChave: true,
    descricao: 'Qualquer serviço com API no formato "chat completions". Pode ter limites e cobrança conforme o fornecedor; os dados enviados saem do computador.',
    urlPadrao: 'https://'
  }
}

export const politicaIaSchema = z.object({
  modo: z.enum(['local', 'hibrido', 'online']),
  moeda: z.enum(['USD', 'BRL']),
  tetoMensal: z.number().min(0).max(100000).nullable(),
  tetoPorExecucao: z.number().min(0).max(10000).nullable(),
  recursosCaros: z.object({ tts: z.boolean(), imagem: z.boolean(), video: z.boolean() }),
  /** No modo híbrido/online, IAs marcadas como gratuitas são usadas sem pedir autorização a cada envio. */
  gratuitosAutomaticos: z.boolean().default(false),
  revisaoInterna: z
    .object({
      /** Roda a revisão interna sozinha depois de gerar um roteiro. */
      automatica: z.boolean(),
      /** A IA que revisa deve ser diferente da que escreveu (quando houver outra disponível). */
      outroModelo: z.boolean()
    })
    .default({ automatica: true, outroModelo: true })
})
export type PoliticaIa = z.infer<typeof politicaIaSchema>

/** Padrão: só local, teto zero e recursos caros desligados (custo zero por padrão). */
export const POLITICA_PADRAO: PoliticaIa = {
  modo: 'local',
  moeda: 'USD',
  tetoMensal: 0,
  tetoPorExecucao: 0,
  recursosCaros: { tts: false, imagem: false, video: false },
  gratuitosAutomaticos: false,
  revisaoInterna: { automatica: true, outroModelo: true }
}

/** O que a IA faz no app. O roteador escolhe um provedor por tarefa. */
export const TAREFAS_IA = ['escrever', 'revisar'] as const
export type TarefaIa = (typeof TAREFAS_IA)[number]
export const ROTULO_TAREFA: Record<TarefaIa, string> = { escrever: 'Escrever roteiros', revisar: 'Revisão interna' }

export const ROTULO_MODO: Record<PoliticaIa['modo'], string> = {
  local: 'Somente local (nada sai do computador)',
  hibrido: 'Híbrido (o app escolhe entre o PC e as IAs gratuitas; pagas só com sua autorização)',
  online: 'Online permitido (sempre com aviso do que será enviado)'
}

export const provedorIaSchema = z.object({
  nome: z.string().trim().min(1).max(80),
  adaptador: z.enum(ADAPTADORES_LLM),
  urlBase: z.string().trim().max(300),
  modelo: z.string().trim().max(120),
  precoEntradaPorMilhao: z.number().min(0).max(10000).nullable(),
  precoSaidaPorMilhao: z.number().min(0).max(10000).nullable(),
  maxTokensSaida: z.number().int().min(64).max(32000),
  limitesConhecidos: z.string().trim().max(500),
  /** Camada gratuita: custo zero e, se a política permitir, uso sem autorização a cada envio. */
  gratuito: z.boolean().default(false),
  /** Ordem de preferência do roteador (1 = primeiro). */
  prioridade: z.number().int().min(1).max(99).default(10),
  papeis: z.object({ escrever: z.boolean(), revisar: z.boolean() }).default({ escrever: true, revisar: true }),
  /** Teto de chamadas por dia definido pelo usuário (abaixo do limite do fornecedor). */
  limiteDiario: z.number().int().min(1).max(100000).nullable().default(null),
  /** Item do catálogo de onde veio (ex.: "groq"). */
  catalogo: z.string().max(40).nullable().default(null),
  /** Outros modelos do mesmo fornecedor, usados quando o principal esgota a cota (cada modelo tem a sua). */
  modelosReserva: z.array(z.string().trim().min(1).max(120)).max(6).default([])
})
export type ProvedorIaConfig = z.infer<typeof provedorIaSchema>
export type ProvedorIaEntrada = z.input<typeof provedorIaSchema>

export interface PlanoEnvio {
  provedorId: number
  provedorNome: string
  adaptador: AdaptadorLlm
  local: boolean
  destino: string
  finalidade: string
  dados: { rotulo: string; caracteres: number }[]
  tokensEstimados: { entrada: number; saida: number }
  custo: { estimavel: boolean; valor: number | null; moeda: PoliticaIa['moeda'] }
  bloqueios: string[]
  avisos: string[]
  exigeAutorizacao: boolean
  assinatura: string
}

/** Estimativa grosseira de tokens: ~4 caracteres por token. */
export function estimarTokens(texto: string): number {
  return Math.ceil(texto.length / 4)
}

export function estimarCusto(cfg: Pick<ProvedorIaConfig, 'precoEntradaPorMilhao' | 'precoSaidaPorMilhao'>, entrada: number, saida: number): number | null {
  if (cfg.precoEntradaPorMilhao === null || cfg.precoSaidaPorMilhao === null) return null
  return (entrada * cfg.precoEntradaPorMilhao + saida * cfg.precoSaidaPorMilhao) / 1_000_000
}
