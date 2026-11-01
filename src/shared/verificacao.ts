import type { TipoFonte } from './dominio'

/**
 * Verificação de fatos por regras fixas (Etapa 7). A situação de cada afirmação é calculada
 * a partir das fontes vinculadas; nada é inventado e o texto das fontes nunca é tratado como instrução.
 */

export const NATUREZAS = ['fato', 'estimativa', 'opiniao', 'previsao', 'hipotese'] as const
export type Natureza = (typeof NATUREZAS)[number]
export const ROTULO_NATUREZA: Record<Natureza, string> = { fato: 'Fato', estimativa: 'Estimativa', opiniao: 'Opinião', previsao: 'Previsão', hipotese: 'Hipótese' }

export const SITUACOES = ['confirmada', 'parcial', 'conflitante', 'sem_fonte', 'opiniao'] as const
export type Situacao = (typeof SITUACOES)[number]
export const ROTULO_SITUACAO: Record<Situacao, string> = {
  confirmada: 'Confirmada',
  parcial: 'Parcialmente confirmada',
  conflitante: 'Conflitante',
  sem_fonte: 'Sem fonte suficiente',
  opiniao: 'Opinião'
}

export const DECISOES = ['corrigir', 'remover', 'incerto'] as const
export type Decisao = (typeof DECISOES)[number]
export const ROTULO_DECISAO: Record<Decisao, string> = {
  corrigir: 'Pedir correção',
  remover: 'Remover do roteiro',
  incerto: 'Manter marcada como incerta'
}

export type Confianca = 'alta' | 'media' | 'baixa'

export interface VinculoFonte {
  dominio: string
  tipoFonte: TipoFonte
  papel: 'primaria' | 'secundaria'
  posicao: 'sustenta' | 'parcial' | 'contradiz'
  publicadaEm: string | null
}

export interface AfirmacaoBase {
  natureza: Natureza
  relevante: boolean
  temaRapido: boolean
  decisao: Decisao | null
  /** Marcada como verificada manualmente pelo usuário (exige fonte vinculada). */
  verificadaEm?: string | null
  verificadaNota?: string
}

export interface ResultadoVerificacao {
  situacao: Situacao
  confianca: Confianca
  razao: string
  pendencias: string[]
  /** Pode entrar no roteiro (confirmada, opinião identificada ou incerteza assumida). */
  pronta: boolean
  /** Removida pelo usuário: não entra no roteiro e não conta como pendência. */
  removida: boolean
}

export const DIAS_TEMA_RAPIDO = 30
const PRIMARIAS_FORTES: TipoFonte[] = ['oficial', 'estudo', 'documentacao']

export function verificarAfirmacao(a: AfirmacaoBase, vinculos: readonly VinculoFonte[], agora: Date): ResultadoVerificacao {
  const pendencias: string[] = []
  const sustenta = vinculos.filter((v) => v.posicao === 'sustenta')
  const parcial = vinculos.filter((v) => v.posicao === 'parcial')
  const contradiz = vinculos.filter((v) => v.posicao === 'contradiz')
  const independentes = new Set(sustenta.map((v) => v.dominio)).size
  const primariaForte = sustenta.some((v) => v.papel === 'primaria' && PRIMARIAS_FORTES.includes(v.tipoFonte))

  let situacao: Situacao
  let confianca: Confianca
  let razao: string
  if (a.natureza === 'opiniao') {
    situacao = 'opiniao'
    confianca = 'media'
    razao = 'Opinião: deve aparecer no vídeo claramente identificada como opinião.'
  } else if (contradiz.length && (sustenta.length || parcial.length)) {
    situacao = 'conflitante'
    confianca = 'baixa'
    razao = `${sustenta.length + parcial.length} fonte(s) a favor e ${contradiz.length} contra.`
    pendencias.push('Fontes conflitantes: compare as fontes e decida (corrigir, remover ou marcar como incerta).')
  } else if (!sustenta.length && !parcial.length) {
    situacao = contradiz.length ? 'conflitante' : 'sem_fonte'
    confianca = 'baixa'
    razao = contradiz.length ? 'Só há fontes que contradizem a afirmação.' : 'Nenhuma fonte sustenta a afirmação.'
    pendencias.push('Sem fonte suficiente: adicione uma fonte, peça correção, remova ou marque como incerta.')
  } else if (a.verificadaEm && (sustenta.length || parcial.length)) {
    situacao = 'confirmada'
    confianca = primariaForte || independentes >= 2 ? 'alta' : 'media'
    razao = `Verificada manualmente em ${a.verificadaEm.slice(0, 10)}${a.verificadaNota ? `: ${a.verificadaNota}` : ''}`
  } else if (sustenta.length && (!a.relevante || independentes >= 2 || primariaForte)) {
    situacao = 'confirmada'
    confianca = primariaForte || independentes >= 2 ? 'alta' : 'media'
    razao = [
      primariaForte ? 'sustentada por fonte primária (oficial, estudo ou documentação)' : null,
      independentes >= 2 ? `${independentes} fontes independentes concordam` : null,
      !a.relevante && !primariaForte && independentes < 2 ? 'afirmação de menor relevância com uma fonte' : null
    ]
      .filter(Boolean)
      .join('; ')
  } else {
    situacao = 'parcial'
    confianca = sustenta.length ? 'media' : 'baixa'
    razao = sustenta.length ? 'Uma única fonte secundária sustenta uma afirmação relevante.' : 'As fontes só sustentam parte da afirmação.'
    pendencias.push('Confirme com uma fonte independente ou com a fonte primária (documento original, comunicado oficial, estudo).')
  }

  if (a.natureza !== 'fato' && a.natureza !== 'opiniao' && situacao === 'confirmada') {
    razao += `. Apresente como ${a.natureza === 'estimativa' ? 'estimativa' : a.natureza === 'previsao' ? 'previsão' : 'hipótese'}, não como fato`
  }

  // Assuntos que mudam rápido: a fonte mais recente precisa ser recente.
  if (a.temaRapido && a.natureza !== 'opiniao') {
    const datas = sustenta.concat(parcial).map((v) => v.publicadaEm).filter((d): d is string => !!d).sort()
    const recente = datas.at(-1)
    const dias = recente ? Math.floor((agora.getTime() - new Date(recente).getTime()) / 86_400_000) : null
    if (dias === null) pendencias.push('Tema em rápida mudança e fontes sem data: confirme se a informação ainda é atual.')
    else if (dias > DIAS_TEMA_RAPIDO) pendencias.push(`Tema em rápida mudança: a fonte mais recente tem ${dias} dias. Verifique se ainda é atual.`)
  }

  const removida = a.decisao === 'remover'
  if (a.decisao === 'corrigir') pendencias.push('Correção solicitada: reescreva a afirmação e confira as fontes.')
  const incertaAssumida = a.decisao === 'incerto'
  const pronta = !removida && (incertaAssumida || ((situacao === 'confirmada' || situacao === 'opiniao') && pendencias.length === 0))
  return {
    situacao,
    confianca,
    razao: razao || 'Sem detalhes.',
    pendencias: removida || incertaAssumida ? [] : pendencias,
    pronta,
    removida
  }
}
