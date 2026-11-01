import { z } from 'zod'
import { STATUS_PAUTA, STATUS_ROTEIRO, TIPOS_FONTE, TIPOS_VIDEO } from './dominio'
import { configEditorialSchema } from './editorial'
import { DECISOES, NATUREZAS } from './verificacao'
import { provedorIaSchema } from './ia'
import { FPS_RENDER, OPCOES_RENDER_RECOMENDADAS, QUALIDADES_RENDER, RESOLUCOES, SITUACOES_LICENCA, PRESETS_RENDER, VELOCIDADES_RENDER, type PresetRender, type QualidadeRender, type VelocidadeRender } from './midia'
import { DURACAO_MAXIMA, FORMATOS, estadoEdicaoSchema } from './edicao'
import { CATEGORIAS_LINK } from './publicacao'
import { CORES_MINIATURA, FONTES_MINIATURA, MODELOS_MINIATURA, type CorMiniatura, type FonteMiniatura, type ModeloMiniatura } from './miniatura'

/** Validação de toda entrada que chega ao processo principal pela IPC. */

export const id = z.number().int().positive()
const texto = (max: number) => z.string().trim().max(max, `Máximo de ${max} caracteres`)
const obrigatorio = (max: number) => texto(max).min(1, 'Campo obrigatório')
export const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato AAAA-MM-DD')
const hora = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora no formato HH:MM')
const urlWeb = z
  .string()
  .trim()
  .max(2000)
  .refine((u) => {
    try {
      const p = new URL(u)
      return p.protocol === 'https:' || p.protocol === 'http:'
    } catch {
      return false
    }
  }, 'Informe um endereço que comece com http:// ou https://')

export const palavrasChaveSchema = z
  .array(texto(60).min(1))
  .max(30, 'Máximo de 30 palavras-chave')
  .transform((l) => [...new Map(l.map((p) => [p.toLocaleLowerCase('pt-BR'), p])).values()])

export const porId = z.object({ id })

// ---------------------------------------------------------------- projetos
export const projetoNovoSchema = z.object({ nome: obrigatorio(120), descricao: texto(1000).default('') })
export const projetoAtualizarSchema = projetoNovoSchema.extend({ id })

// ---------------------------------------------------------------- roteiros
export const ORDENS_ROTEIRO = ['atualizado_desc', 'criado_desc', 'titulo_asc', 'prevista_asc', 'status_asc'] as const
export const filtroRoteirosSchema = z.object({
  texto: texto(200).default(''),
  status: z.enum(STATUS_ROTEIRO).nullable().default(null),
  tipoVideo: z.enum(TIPOS_VIDEO).nullable().default(null),
  projetoId: id.nullable().default(null),
  palavraChave: texto(60).default(''),
  campoData: z.enum(['atualizado', 'criado', 'prevista']).default('atualizado'),
  dataDe: dataIso.nullable().default(null),
  dataAte: dataIso.nullable().default(null),
  situacao: z.enum(['ativos', 'arquivados', 'todos']).default('ativos'),
  ordem: z.enum(ORDENS_ROTEIRO).default('atualizado_desc'),
  limite: z.number().int().min(1).max(500).default(200)
})
export type FiltroRoteiros = z.infer<typeof filtroRoteirosSchema>

const camposRoteiro = {
  titulo: obrigatorio(200),
  tema: texto(200).default(''),
  tipoVideo: z.enum(TIPOS_VIDEO),
  notas: texto(20000).default(''),
  dataPrevista: dataIso.nullable().default(null),
  palavrasChave: palavrasChaveSchema.default([]),
  conteudo: texto(200000).default('')
}
export const roteiroNovoSchema = z.object({ ...camposRoteiro, projetoId: id, pautaId: id.nullable().default(null) })
export const roteiroSalvarSchema = z.object({
  ...camposRoteiro,
  id,
  /** Versão que o editor abriu; impede sobrescrever alterações feitas em outra janela. */
  versaoBase: z.number().int().positive()
})
export const roteiroRenomearSchema = z.object({ id, titulo: obrigatorio(200) })
export const roteiroStatusSchema = z.object({ id, status: z.enum(STATUS_ROTEIRO) })
export const versaoSchema = z.object({ roteiroId: id, numero: z.number().int().positive() })
export const exportarSchema = z.object({ id, formato: z.enum(['txt', 'md', 'json']) })

export const fonteNovaSchema = z.object({
  roteiroId: id,
  titulo: obrigatorio(300),
  url: urlWeb,
  autor: texto(200).default(''),
  tipoFonte: z.enum(TIPOS_FONTE).default('outro'),
  publicadaEm: dataIso.nullable().default(null),
  acessadaEm: dataIso,
  notas: texto(2000).default('')
})
export const removerFonteSchema = z.object({ roteiroId: id, fonteId: id })
export const comentarioNovoSchema = z.object({ roteiroId: id, texto: obrigatorio(5000) })

// ---------------------------------------------------------------- pautas
export const pautaNovaSchema = z.object({
  projetoId: id,
  titulo: obrigatorio(200),
  tema: texto(200).default(''),
  notas: texto(5000).default(''),
  palavrasChave: palavrasChaveSchema.default([]),
  perguntaCentral: texto(500).default(''),
  resumo: texto(5000).default(''),
  publico: texto(300).default(''),
  tipoSugerido: z.enum(TIPOS_VIDEO).nullable().default(null),
  potencialNarrativa: z.number().int().min(1).max(5).nullable().default(null)
})
export const pautaAtualizarSchema = pautaNovaSchema.omit({ projetoId: true }).extend({ id, status: z.enum(STATUS_PAUTA) })
export const pautaStatusSchema = z.object({ id, status: z.enum(STATUS_PAUTA) })
export const pautaDeResultadosSchema = z.object({ projetoId: id, resultadoIds: z.array(id).min(1).max(20) })
export const excluirPautasSchema = z.object({ ids: z.array(id).min(1).max(1000) })
export const combinarPautasSchema = z.object({ ids: z.array(id).min(2).max(10), titulo: obrigatorio(200) })
export const pautaResultadoSchema = z.object({ pautaId: id, resultadoId: id })
export const loteNovoSchema = z
  .object({ projetoId: id, nome: obrigatorio(120), inicio: dataIso, fim: dataIso, metaLongos: z.number().int().min(0).max(50), metaShorts: z.number().int().min(0).max(200) })
  .refine((l) => l.inicio <= l.fim, { message: 'A data final deve ser depois da inicial', path: ['fim'] })
export const lotePautaSchema = z.object({ loteId: id, pautaId: id })
export const loteSelecaoSchema = lotePautaSchema.extend({ selecionada: z.boolean() })
export const loteFecharSchema = z.object({ id, fechado: z.boolean() })
export const filtroPautasSchema = z.object({ texto: texto(200).default(''), status: z.enum(STATUS_PAUTA).nullable().default(null), incluirCombinadas: z.boolean().default(false) })

// ---------------------------------------------------------------- agenda (etapa 4)
export const intervaloSchema = z.object({ de: dataIso, ate: dataIso })
export const agendarSchema = z.object({
  projetoId: id,
  roteiroId: id.nullable(),
  titulo: obrigatorio(200),
  tipoVideo: z.enum(TIPOS_VIDEO),
  data: dataIso,
  hora,
  notas: texto(1000).default('')
})
export const reagendarSchema = z.object({ id, data: dataIso, hora })
export const salvarConfigEditorialSchema = configEditorialSchema

// ---------------------------------------------------------------- pesquisa (etapa 5)
export const opcoesPesquisaSchema = z.object({
  termosMonitorados: z.array(texto(120).min(1)).max(30).default([]),
  nicho: z.array(texto(60).min(1)).max(40).default([]),
  somenteConfiaveis: z.boolean().default(false)
})
export type OpcoesPesquisa = z.infer<typeof opcoesPesquisaSchema>
/** Endereço colado pelo usuário: site ou feed, com ou sem "https://". */
export const identificarFonteSchema = z.object({ url: z.string().trim().min(3, 'Informe o endereço do site').max(2000) })
export const moverVideoSchema = z.object({ id, direcao: z.enum(['adiantar', 'adiar']) })
export const priorizarTemaSchema = z.object({ id, delta: z.number().int().min(-10).max(10) })
export const agendarTemaSchema = z.object({ id, tipoVideo: z.enum(TIPOS_VIDEO).nullable().default(null) })
export const frequenciaSchema = z.object({ tipo: z.enum(TIPOS_VIDEO), porSemana: z.number().int().min(0).max(14), hora })
export const fontePesquisaNovaSchema = z.object({
  projetoId: id,
  tipo: z.enum(['rss', 'url']),
  nome: obrigatorio(120),
  url: urlWeb
})
export const fontePesquisaAtivaSchema = z.object({ id, ativo: z.boolean() })
export const regraDominioSchema = z.object({
  projetoId: id,
  dominio: obrigatorio(253)
    .transform((d) => d.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, ''))
    .refine((d) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d), 'Domínio inválido (ex.: exemplo.com.br)'),
  regra: z.enum(['confiavel', 'bloqueado'])
})
export const iniciarPesquisaSchema = z.object({
  projetoId: id,
  consulta: obrigatorio(300),
  pautaId: id.nullable().default(null)
})
export const listarExecucoesSchema = z.object({ projetoId: id.nullable().default(null), limite: z.number().int().min(1).max(200).default(50) })
export const resultadoParaRoteiroSchema = z.object({ resultadoId: id, roteiroId: id })

// ---------------------------------------------------------------- verificação (etapa 7)
export const alvoDossieSchema = z
  .object({ pautaId: id.nullable().default(null), roteiroId: id.nullable().default(null) })
  .refine((a) => (a.pautaId === null) !== (a.roteiroId === null), 'Informe a pauta ou o roteiro')
const camposAfirmacao = {
  texto: obrigatorio(2000),
  natureza: z.enum(NATUREZAS),
  relevante: z.boolean().default(true),
  temaRapido: z.boolean().default(false),
  observacoes: texto(2000).default('')
}
export const afirmacaoNovaSchema = z.object({ alvo: alvoDossieSchema, ...camposAfirmacao })
export const afirmacaoAtualizarSchema = z.object({ id, ...camposAfirmacao, decisao: z.enum(DECISOES).nullable().default(null) })
const camposVinculo = {
  afirmacaoId: id,
  trecho: obrigatorio(1500),
  papel: z.enum(['primaria', 'secundaria']),
  posicao: z.enum(['sustenta', 'parcial', 'contradiz'])
}
export const vincularResultadoSchema = z.object({ ...camposVinculo, resultadoId: id })
export const vincularNovaFonteSchema = z.object({
  ...camposVinculo,
  titulo: obrigatorio(300),
  url: urlWeb,
  autor: texto(200).default(''),
  tipoFonte: z.enum(TIPOS_FONTE).default('outro'),
  publicadaEm: dataIso.nullable().default(null),
  acessadaEm: dataIso
})
export const desvincularFonteSchema = z.object({ afirmacaoId: id, fonteId: id })

// ---------------------------------------------------------------- serviços de IA (etapa 10)
export const salvarProvedorSchema = z.object({ id: id.nullable(), config: provedorIaSchema })
export const ativarProvedorSchema = z.object({ id, ativo: z.boolean() })
/** A chave chega do usuário e vai direto ao cofre; nunca é devolvida nem registrada. */
export const adicionarCatalogoSchema = z.object({ catalogo: z.string().min(1).max(40), chave: z.string().trim().min(8, 'Chave curta demais').max(500).nullable().default(null) })
export const conferirInternaSchema = z.object({ revisaoId: id, indice: z.number().int().min(0).max(200), nota: texto(500).default('') })
export const chaveProvedorSchema = z.object({ id, chave: z.string().trim().min(8, 'Chave curta demais').max(500).nullable() })

// ---------------------------------------------------------------- geração e revisão (etapas 8 e 9)
export const pedidoGeracaoSchema = z
  .object({
    pautaId: id.nullable().default(null),
    roteiroId: id.nullable().default(null),
    tipo: z.enum(TIPOS_VIDEO),
    provedorId: id.nullable().default(null),
    /** O app escolhe a IA (PC ou gratuitas) pela rota; sem IA disponível, usa o modo estruturado. */
    automatico: z.boolean().default(false),
    angulo: texto(300).default('')
  })
  .refine((p) => (p.pautaId === null) !== (p.roteiroId === null), 'Informe a pauta (novo roteiro) ou o roteiro (nova variação)')
  .refine((p) => !(p.automatico && p.provedorId !== null), 'Escolha um provedor ou o modo automático, não os dois')
export const gerarSchema = z.object({ pedido: pedidoGeracaoSchema, autorizacao: z.string().regex(/^[0-9a-f]{64}$/).nullable().default(null) })
export const revisaoAcaoSchema = z.object({ id, comentario: texto(5000).default('') })
export const revisaoCorrecaoSchema = z.object({ id, tipo: z.enum(['factual', 'editorial']), comentario: obrigatorio(5000) })
export const marcarVerificadaSchema = z.object({ id, nota: texto(500).default('') })

// ---------------------------------------------------------------- mídia, edição e qualidade (etapas 11 e 12)
export const listarMidiaSchema = z.object({ projetoId: id, roteiroId: id.nullable().default(null) })
export const importarMidiaSchema = z.object({ projetoId: id, roteiroId: id.nullable().default(null), situacaoLicenca: z.enum(SITUACOES_LICENCA).default('nao_verificado') })
export const atualizarMidiaSchema = z.object({
  id,
  roteiroId: id.nullable(),
  cena: texto(200).default(''),
  origem: texto(300).default(''),
  autor: texto(200).default(''),
  urlOrigem: z.union([z.literal(''), urlWeb]).default(''),
  licenca: texto(1000).default(''),
  situacaoLicenca: z.enum(SITUACOES_LICENCA),
  obtidoEm: dataIso.nullable().default(null)
})
export const criarEdicaoSchema = z.object({ roteiroId: id, formato: z.enum(FORMATOS).nullable().default(null) })
export const salvarEdicaoSchema = z.object({ id, revisaoBase: z.number().int().positive(), estado: estadoEdicaoSchema })
export const restaurarSnapshotSchema = z.object({ id, snapshotId: id })
export const opcoesRenderSchema = z.object({
  fps: z.literal([...FPS_RENDER]),
  qualidade: z.enum(Object.keys(QUALIDADES_RENDER) as [QualidadeRender, ...QualidadeRender[]]),
  velocidade: z.enum(Object.keys(VELOCIDADES_RENDER) as [VelocidadeRender, ...VelocidadeRender[]])
})
export const renderizarSchema = z.object({
  edicaoId: id,
  preset: z.enum(Object.keys(PRESETS_RENDER) as [PresetRender, ...PresetRender[]]),
  opcoes: opcoesRenderSchema.default(OPCOES_RENDER_RECOMENDADAS)
})
export const preferenciaRenderSchema = z.object({
  modo: z.enum(['recomendado', 'fixo']),
  longo: z.enum(RESOLUCOES),
  short: z.enum(RESOLUCOES),
  opcoes: opcoesRenderSchema
})
export const ETAPAS_ASSISTENTE = ['boasvindas', 'projeto', 'pesquisa', 'agenda', 'ia', 'video', 'youtube', 'backup'] as const
export type EtapaAssistente = (typeof ETAPAS_ASSISTENTE)[number]
export const servicoMidiaSchema = z.enum(['pexels', 'pixabay', 'pollinations', 'huggingface', 'cloudflare'])
export const chaveMidiaSchema = z.object({ servico: servicoMidiaSchema, chave: z.string().trim().min(8, 'Chave curta demais').max(500).nullable() })
export const produzirMidiasSchema = z.object({ edicaoId: id, narracao: z.boolean(), imagens: z.boolean() })
export const testarVozSchema = z.object({ texto: z.string().trim().min(1).max(400) })
export const acaoRapidaSchema = z.object({ acao: z.enum(['tudo', 'projeto', 'pesquisa', 'agenda_leve', 'agenda_medio', 'agenda_intenso', 'ia_hibrido', 'ia_local', 'video']) })
export const salvarAssistenteSchema = z.object({
  revisada: z.enum(ETAPAS_ASSISTENTE).optional(),
  desfazer: z.enum(ETAPAS_ASSISTENTE).optional(),
  concluido: z.boolean().optional(),
  dispensado: z.boolean().optional()
})
export const aceitarExcecaoSchema = z.object({ relatorioId: id, codigo: obrigatorio(60), justificativa: obrigatorio(500) })

// ---------------------------------------------------------------- YouTube (etapa 13)
export const clienteOAuthSchema = z.object({ clientId: obrigatorio(200), clientSecret: obrigatorio(200) })
export const conectarYouTubeSchema = z.object({ metricas: z.boolean().default(false), receita: z.boolean().default(false) })
export const atualizarPublicacaoSchema = z.object({
  id,
  titulo: texto(100).min(1, 'Informe o título'),
  descricao: texto(5000).default(''),
  tags: z.array(texto(100).min(1)).max(30).default([]),
  categoriaId: z.string().regex(/^\d{1,3}$/).default('28'),
  playlistId: z.string().max(100).nullable().default(null),
  privacidade: z.enum(['private', 'unlisted', 'public']),
  publicarEm: z.string().datetime().nullable().default(null),
  feitoParaCriancas: z.boolean().nullable(),
  conteudoSintetico: z.boolean().default(false),
  miniaturaRecursoId: id.nullable().default(null)
})
export const aprovarPublicacaoSchema = z.object({ id, confirmarPublico: z.boolean().default(false) })

// ---------------------------------------------------------------- links, descrição e miniaturas
export const linkSchema = z.object({
  id: id.optional(),
  projetoId: id.nullable().default(null),
  nome: obrigatorio(120),
  url: urlWeb,
  categoria: z.enum(CATEGORIAS_LINK),
  descricao: texto(200).default(''),
  padrao: z.boolean().default(false),
  ativo: z.boolean().default(true)
})
export const gerarDescricaoSchema = z.object({ id, links: z.array(id).max(50).default([]), tags: z.array(texto(100).min(1)).max(30).default([]) })
export const fonteImagemSchema = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('quadro'), renderizacaoId: id, tempo: z.number().min(0).max(DURACAO_MAXIMA) }),
  z.object({ tipo: z.literal('imagem'), recursoId: id })
])
export const opcoesMiniaturaSchema = z.object({
  modelo: z.enum(Object.keys(MODELOS_MINIATURA) as [ModeloMiniatura, ...ModeloMiniatura[]]),
  texto: texto(80),
  selo: texto(14).default(''),
  cor: z.enum(Object.keys(CORES_MINIATURA) as [CorMiniatura, ...CorMiniatura[]]),
  fonte: z.enum(Object.keys(FONTES_MINIATURA) as [FonteMiniatura, ...FonteMiniatura[]]),
  maiusculas: z.boolean().default(true)
})
export const miniaturaSchema = z.object({ fonte: fonteImagemSchema, opcoes: opcoesMiniaturaSchema, publicacaoId: id.nullable().default(null) })
export const definirMiniaturaSchema = z.object({ publicacaoId: id, recursoId: id.nullable() })

// ---------------------------------------------------------------- fila e métricas (etapas 14 e 15)
export const pausarItemSchema = z.object({ id, pausado: z.boolean() })
export const priorizarSchema = z.object({ id, delta: z.number().int().min(-10).max(10) })
export const derivarShortSchema = z.object({ roteiroId: id, chave: obrigatorio(300) })
export const filtroMetricasSchema = z.object({ de: dataIso.nullable().default(null), ate: dataIso.nullable().default(null), tipo: z.enum(TIPOS_VIDEO).nullable().default(null) })
export const decidirSugestaoSchema = z.object({ id, aceita: z.boolean() })

// ---------------------------------------------------------------- interface
export const estadoUiSchema = z.object({
  tela: texto(40),
  filtroRoteiros: filtroRoteirosSchema.partial().optional()
})
export type EstadoUi = z.infer<typeof estadoUiSchema>
