import { z } from 'zod'
import type { TipoVideo } from './dominio'
import { dataLocal, diaSemanaDeData, fusoValido, inicioSemana, localParaUtc, somarDias } from './tempo'

/** Configurações editoriais (Etapa 4). Não são secretas e ficam na tabela "configuracoes". */

const hora = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use o formato HH:MM')
const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato AAAA-MM-DD')

export const FREQUENCIAS_PESQUISA = ['manual', 'diaria', 'a_cada_12h', 'dias_uteis', 'semanal'] as const
export const ROTULO_FREQUENCIA: Record<(typeof FREQUENCIAS_PESQUISA)[number], string> = {
  manual: 'Somente manual',
  diaria: 'Uma vez por dia',
  a_cada_12h: 'A cada 12 horas',
  dias_uteis: 'Dias úteis (seg–sex)',
  semanal: 'Uma vez por semana'
}
export const PERIODOS_PESQUISA = ['24h', '7d', '30d', '90d', 'personalizado'] as const
export const ROTULO_PERIODO: Record<(typeof PERIODOS_PESQUISA)[number], string> = {
  '24h': 'Últimas 24 horas',
  '7d': 'Últimos 7 dias',
  '30d': 'Últimos 30 dias',
  '90d': 'Últimos 90 dias',
  personalizado: 'Intervalo personalizado'
}
export const POLITICAS_PERDIDA = ['ignorar', 'executar_ao_abrir', 'reagendar'] as const
export const ROTULO_POLITICA: Record<(typeof POLITICAS_PERDIDA)[number], string> = {
  ignorar: 'Ignorar e só registrar',
  executar_ao_abrir: 'Executar ao abrir o app',
  reagendar: 'Reagendar para o próximo horário'
}
export const HORIZONTES = [7, 14, 30] as const

const formatoSchema = z.object({
  pausado: z.boolean(),
  maxPorDia: z.number().int().min(0).max(10),
  limiteSemanal: z.number().int().min(0).max(70),
  limiteMensal: z.number().int().min(0).max(300).nullable(),
  horarios: z.array(z.object({ dia: z.number().int().min(0).max(6), hora })).max(50),
  duracaoMinSeg: z.number().int().min(5).max(14400),
  duracaoMaxSeg: z.number().int().min(5).max(14400)
})
export type FormatoAgenda = z.infer<typeof formatoSchema>

export const configEditorialSchema = z
  .object({
    pesquisa: z.object({
      frequencia: z.enum(FREQUENCIAS_PESQUISA),
      horario: hora,
      diaSemana: z.number().int().min(0).max(6),
      periodo: z.enum(PERIODOS_PESQUISA),
      periodoDe: dataIso.nullable(),
      periodoAte: dataIso.nullable(),
      politicaPerdida: z.enum(POLITICAS_PERDIDA)
    }),
    horizonteDias: z.union([z.literal(7), z.literal(14), z.literal(30)]),
    agenda: z.object({
      fuso: z.string().refine(fusoValido, 'Fuso horário inválido'),
      pausada: z.boolean(),
      formatos: z.object({ longo: formatoSchema, short: formatoSchema })
    }),
    antecedencia: z.object({
      roteiroProntoDias: z.number().int().min(0).max(60),
      producaoProntaDias: z.number().int().min(0).max(60)
    }),
    capacidade: z.object({
      revisoesPorSemana: z.number().int().min(0).max(100),
      orcamentoMensal: z.number().min(0).max(100000).nullable(),
      custoEstimadoPorVideo: z.number().min(0).max(10000)
    })
  })
  .superRefine((c, ctx) => {
    if (c.pesquisa.periodo === 'personalizado') {
      if (!c.pesquisa.periodoDe || !c.pesquisa.periodoAte) {
        ctx.addIssue({ code: 'custom', path: ['pesquisa', 'periodoDe'], message: 'Informe início e fim do intervalo' })
      } else if (c.pesquisa.periodoDe > c.pesquisa.periodoAte) {
        ctx.addIssue({ code: 'custom', path: ['pesquisa', 'periodoAte'], message: 'O fim deve ser depois do início' })
      }
    }
    for (const tipo of ['longo', 'short'] as const) {
      const f = c.agenda.formatos[tipo]
      if (f.duracaoMinSeg > f.duracaoMaxSeg) {
        ctx.addIssue({ code: 'custom', path: ['agenda', 'formatos', tipo, 'duracaoMinSeg'], message: 'Duração mínima maior que a máxima' })
      }
      const chaves = f.horarios.map((h) => `${h.dia}-${h.hora}`)
      if (new Set(chaves).size !== chaves.length) {
        ctx.addIssue({ code: 'custom', path: ['agenda', 'formatos', tipo, 'horarios'], message: 'Há horários repetidos' })
      }
    }
  })
export type ConfigEditorial = z.infer<typeof configEditorialSchema>

/** Padrões iniciais definidos pelo canal. Só mudam com ação explícita do usuário. */
export const CONFIG_EDITORIAL_PADRAO: ConfigEditorial = {
  pesquisa: {
    frequencia: 'diaria',
    horario: '08:00',
    diaSemana: 1,
    periodo: '7d',
    periodoDe: null,
    periodoAte: null,
    politicaPerdida: 'executar_ao_abrir'
  },
  horizonteDias: 14,
  agenda: {
    fuso: 'America/Sao_Paulo',
    pausada: false,
    formatos: {
      longo: {
        pausado: false,
        maxPorDia: 1,
        limiteSemanal: 1,
        limiteMensal: null,
        horarios: [{ dia: 0, hora: '18:00' }],
        duracaoMinSeg: 480,
        duracaoMaxSeg: 720
      },
      short: {
        pausado: false,
        maxPorDia: 1,
        limiteSemanal: 3,
        limiteMensal: null,
        horarios: [
          { dia: 2, hora: '18:00' },
          { dia: 4, hora: '18:00' },
          { dia: 6, hora: '18:00' }
        ],
        duracaoMinSeg: 30,
        duracaoMaxSeg: 60
      }
    }
  },
  antecedencia: { roteiroProntoDias: 3, producaoProntaDias: 1 },
  capacidade: { revisoesPorSemana: 4, orcamentoMensal: null, custoEstimadoPorVideo: 0 }
}

/** Intervalo de datas pesquisado, que aparece no relatório de cada pesquisa. */
export function intervaloPesquisa(c: ConfigEditorial['pesquisa'], agora: Date): { de: Date; ate: Date } {
  if (c.periodo === 'personalizado' && c.periodoDe && c.periodoAte) {
    return { de: new Date(`${c.periodoDe}T00:00:00Z`), ate: new Date(`${c.periodoAte}T23:59:59Z`) }
  }
  const horas = { '24h': 24, '7d': 168, '30d': 720, '90d': 2160, personalizado: 168 }[c.periodo]
  return { de: new Date(agora.getTime() - horas * 3600_000), ate: agora }
}

// ---------------------------------------------------------------- agenda

export interface EntradaAgendada {
  id: number
  roteiroId: number | null
  tipoVideo: TipoVideo
  inicioUtc: string
}

export interface Horario {
  tipoVideo: TipoVideo
  inicioUtc: string
  data: string
  hora: string
}

/** Horários disponíveis no horizonte, segundo dias/horários de cada formato (ignora formatos pausados). */
export function horariosDoHorizonte(c: ConfigEditorial, agora: Date, dias = c.horizonteDias): Horario[] {
  if (c.agenda.pausada) return []
  const fuso = c.agenda.fuso
  const hoje = dataLocal(agora, fuso)
  const lista: Horario[] = []
  for (let i = 0; i < dias; i++) {
    const data = somarDias(hoje, i)
    const dia = diaSemanaDeData(data)
    for (const tipo of ['longo', 'short'] as const) {
      const f = c.agenda.formatos[tipo]
      if (f.pausado) continue
      for (const h of f.horarios.filter((x) => x.dia === dia)) {
        const inicio = localParaUtc(data, h.hora, fuso)
        if (inicio.getTime() > agora.getTime()) {
          lista.push({ tipoVideo: tipo, inicioUtc: inicio.toISOString(), data, hora: h.hora })
        }
      }
    }
  }
  return lista.sort((a, b) => a.inicioUtc.localeCompare(b.inicioUtc))
}

export interface ProblemaAgendamento {
  codigo: 'pausada' | 'formato_pausado' | 'duplicado' | 'conflito' | 'limite_diario' | 'limite_semanal' | 'limite_mensal' | 'passado'
  mensagem: string
}

/** Valida um novo agendamento contra as regras e os agendamentos já existentes (cancelados não entram). */
export function validarAgendamento(
  c: ConfigEditorial,
  existentes: readonly EntradaAgendada[],
  novo: { roteiroId: number | null; tipoVideo: TipoVideo; inicioUtc: string; ignorarId?: number },
  agora: Date
): ProblemaAgendamento[] {
  const problemas: ProblemaAgendamento[] = []
  const fuso = c.agenda.fuso
  const f = c.agenda.formatos[novo.tipoVideo]
  const outros = existentes.filter((e) => e.id !== novo.ignorarId)
  const inicio = new Date(novo.inicioUtc)

  if (inicio.getTime() <= agora.getTime()) problemas.push({ codigo: 'passado', mensagem: 'O horário já passou.' })
  if (c.agenda.pausada) problemas.push({ codigo: 'pausada', mensagem: 'A agenda está pausada. Reative-a em Configurações.' })
  else if (f.pausado) problemas.push({ codigo: 'formato_pausado', mensagem: `O formato ${novo.tipoVideo === 'longo' ? 'vídeo longo' : 'Short'} está pausado.` })

  if (novo.roteiroId !== null && outros.some((e) => e.roteiroId === novo.roteiroId)) {
    problemas.push({ codigo: 'duplicado', mensagem: 'Este roteiro já está agendado.' })
  }
  if (outros.some((e) => e.inicioUtc === inicio.toISOString())) {
    problemas.push({ codigo: 'conflito', mensagem: 'Já existe um conteúdo agendado neste mesmo horário.' })
  }

  const doTipo = outros.filter((e) => e.tipoVideo === novo.tipoVideo)
  const data = dataLocal(inicio, fuso)
  const mesmoDia = doTipo.filter((e) => dataLocal(new Date(e.inicioUtc), fuso) === data).length
  if (mesmoDia + 1 > f.maxPorDia) {
    problemas.push({ codigo: 'limite_diario', mensagem: `Limite diário atingido (${f.maxPorDia} por dia).` })
  }
  const semana = inicioSemana(data)
  const mesmaSemana = doTipo.filter((e) => inicioSemana(dataLocal(new Date(e.inicioUtc), fuso)) === semana).length
  if (mesmaSemana + 1 > f.limiteSemanal) {
    problemas.push({ codigo: 'limite_semanal', mensagem: `Limite semanal atingido (${f.limiteSemanal} por semana, seg–dom).` })
  }
  if (f.limiteMensal !== null) {
    const mes = data.slice(0, 7)
    const mesmoMes = doTipo.filter((e) => dataLocal(new Date(e.inicioUtc), fuso).slice(0, 7) === mes).length
    if (mesmoMes + 1 > f.limiteMensal) {
      problemas.push({ codigo: 'limite_mensal', mensagem: `Limite mensal atingido (${f.limiteMensal} por mês).` })
    }
  }
  return problemas
}

/** Alertas quando a meta de volume não combina com capacidade de revisão, orçamento ou prazos. */
export function alertasCapacidade(c: ConfigEditorial): string[] {
  const alertas: string[] = []
  const { longo, short } = c.agenda.formatos
  const metaSemanal = (longo.pausado ? 0 : longo.limiteSemanal) + (short.pausado ? 0 : short.limiteSemanal)

  for (const [nome, f] of [['vídeos longos', longo], ['Shorts', short]] as const) {
    if (f.pausado) continue
    const vagas = f.horarios.length * f.maxPorDia
    if (vagas < f.limiteSemanal) {
      alertas.push(`A meta de ${f.limiteSemanal} ${nome} por semana é maior que os ${vagas} horários configurados.`)
    }
    if (f.limiteMensal !== null && f.limiteMensal < f.limiteSemanal * 4) {
      alertas.push(`O limite mensal de ${nome} (${f.limiteMensal}) é menor que 4 semanas da meta semanal; algumas semanas ficarão abaixo da meta.`)
    }
  }
  if (metaSemanal > c.capacidade.revisoesPorSemana) {
    alertas.push(`A meta é de ${metaSemanal} vídeos por semana, mas a capacidade de revisão informada é de ${c.capacidade.revisoesPorSemana}.`)
  }
  if (c.capacidade.orcamentoMensal !== null) {
    const custo = metaSemanal * 4.35 * c.capacidade.custoEstimadoPorVideo
    if (custo > c.capacidade.orcamentoMensal) {
      alertas.push(`Custo estimado de R$ ${custo.toFixed(2)} por mês supera o orçamento de R$ ${c.capacidade.orcamentoMensal.toFixed(2)}.`)
    }
  }
  if (c.antecedencia.roteiroProntoDias < c.antecedencia.producaoProntaDias) {
    alertas.push('O roteiro deveria ficar pronto antes da produção: aumente a antecedência do roteiro.')
  }
  return alertas
}

// ---------------------------------------------------------------- execuções de pesquisa agendadas

/** Próximos horários de pesquisa automática a partir de "desde" (exclusivo) até "ate" (inclusivo). */
export function horariosPesquisa(c: ConfigEditorial, desde: Date, ate: Date, limite = 500): Date[] {
  const p = c.pesquisa
  if (p.frequencia === 'manual') return []
  const fuso = c.agenda.fuso
  const horas = p.frequencia === 'a_cada_12h' ? [p.horario, somarHoras(p.horario, 12)] : [p.horario]
  const lista: Date[] = []
  let data = dataLocal(desde, fuso)
  const fim = dataLocal(ate, fuso)
  while (data <= fim && lista.length < limite) {
    const dia = diaSemanaDeData(data)
    const diaValido =
      p.frequencia === 'diaria' || p.frequencia === 'a_cada_12h' ||
      (p.frequencia === 'dias_uteis' && dia >= 1 && dia <= 5) ||
      (p.frequencia === 'semanal' && dia === p.diaSemana)
    if (diaValido) {
      for (const h of horas.sort()) {
        const t = localParaUtc(data, h, fuso)
        if (t.getTime() > desde.getTime() && t.getTime() <= ate.getTime()) lista.push(t)
      }
    }
    data = somarDias(data, 1)
  }
  return lista
}

// ------------------------------------------------------------------ frequência rápida (painel)

/** Dias da semana (0 = domingo) usados para N publicações por semana, espalhados pela semana. */
const DIAS_POR_FREQUENCIA: Record<TipoVideo, number[][]> = {
  longo: [[], [0], [0, 3], [0, 2, 4], [0, 2, 4, 6], [0, 1, 3, 4, 6], [0, 1, 2, 3, 4, 5], [0, 1, 2, 3, 4, 5, 6]],
  short: [[], [3], [2, 5], [2, 4, 6], [1, 3, 5, 6], [1, 2, 3, 4, 5], [1, 2, 3, 4, 5, 6], [0, 1, 2, 3, 4, 5, 6]]
}
export const FREQUENCIA_MAXIMA = 14

function somarHoras(hora: string, delta: number): string {
  const [h, m] = hora.split(':').map(Number) as [number, number]
  return `${String((((h + delta) % 24) + 24) % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** Horário mais usado do formato (para manter o costume do canal ao mudar a frequência). */
export function horaPrincipal(f: FormatoAgenda, padrao = '18:00'): string {
  const contagem = new Map<string, number>()
  for (const h of f.horarios) contagem.set(h.hora, (contagem.get(h.hora) ?? 0) + 1)
  return [...contagem].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? padrao
}

/**
 * "Quero N vídeos por semana às HH:MM": gera os dias e horários do formato por regra fixa.
 * Acima de 7 por semana, os extras ficam 6 horas antes. 0 pausa o formato (mantendo os horários).
 * Um horário que coincidiria com o outro formato é deslocado 1 hora para não haver conflito.
 */
export function aplicarFrequencia(c: ConfigEditorial, tipo: TipoVideo, porSemana: number, hora: string): ConfigEditorial {
  const n = Math.max(0, Math.min(FREQUENCIA_MAXIMA, Math.round(porSemana)))
  const f = c.agenda.formatos[tipo]
  const outro = c.agenda.formatos[tipo === 'longo' ? 'short' : 'longo']
  const ocupados = new Set(outro.pausado ? [] : outro.horarios.map((h) => `${h.dia}-${h.hora}`))
  let novo: FormatoAgenda
  if (n === 0) {
    novo = { ...f, pausado: true }
  } else {
    const tabela = DIAS_POR_FREQUENCIA[tipo]
    const extra = somarHoras(hora, Number(hora.slice(0, 2)) >= 12 ? -6 : 6)
    const horarios = [...tabela[Math.min(n, 7)]!.map((dia) => ({ dia, hora })), ...(n > 7 ? tabela[n - 7]!.map((dia) => ({ dia, hora: extra })) : [])].map((h) => {
      let hh = h.hora
      for (let i = 0; i < 23 && ocupados.has(`${h.dia}-${hh}`); i++) hh = somarHoras(hh, 1)
      return { dia: h.dia, hora: hh }
    })
    const porDia = Math.max(...[...new Set(horarios.map((h) => h.dia))].map((d) => horarios.filter((h) => h.dia === d).length))
    novo = {
      ...f,
      pausado: false,
      horarios: horarios.sort((a, b) => a.dia - b.dia || a.hora.localeCompare(b.hora)),
      limiteSemanal: n,
      maxPorDia: Math.max(f.maxPorDia, porDia),
      limiteMensal: f.limiteMensal !== null && f.limiteMensal < Math.ceil((n * 31) / 7) ? Math.ceil((n * 31) / 7) : f.limiteMensal
    }
  }
  return configEditorialSchema.parse({ ...c, agenda: { ...c.agenda, formatos: { ...c.agenda.formatos, [tipo]: novo } } })
}
