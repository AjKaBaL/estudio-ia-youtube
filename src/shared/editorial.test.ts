import { describe, expect, it } from 'vitest'
import {
  CONFIG_EDITORIAL_PADRAO,
  alertasCapacidade,
  configEditorialSchema,
  horariosDoHorizonte,
  horariosPesquisa,
  intervaloPesquisa,
  validarAgendamento,
  type ConfigEditorial,
  type EntradaAgendada
} from './editorial'
import { dataLocal, horaLocal, inicioSemana, localParaUtc } from './tempo'

const clone = (): ConfigEditorial => structuredClone(CONFIG_EDITORIAL_PADRAO)
// Segunda-feira, 2 de novembro de 2026, 09:00 em São Paulo.
const AGORA = new Date('2026-11-02T12:00:00Z')
const sp = (data: string, hora: string): string => localParaUtc(data, hora, 'America/Sao_Paulo').toISOString()

describe('fuso horário', () => {
  it('converte horário de São Paulo (UTC−3, sem horário de verão) para UTC', () => {
    expect(sp('2026-11-08', '18:00')).toBe('2026-11-08T21:00:00.000Z')
  })
  it('respeita horário de verão em outros fusos', () => {
    expect(localParaUtc('2026-07-01', '12:00', 'America/New_York').toISOString()).toBe('2026-07-01T16:00:00.000Z')
    expect(localParaUtc('2026-12-01', '12:00', 'America/New_York').toISOString()).toBe('2026-12-01T17:00:00.000Z')
  })
  it('obtém data e hora locais e o início da semana (segunda)', () => {
    const t = new Date('2026-11-09T01:30:00Z') // 08/11 22:30 em SP
    expect(dataLocal(t, 'America/Sao_Paulo')).toBe('2026-11-08')
    expect(horaLocal(t, 'America/Sao_Paulo')).toBe('22:30')
    expect(inicioSemana('2026-11-08')).toBe('2026-11-02')
  })
})

describe('configuração padrão', () => {
  it('é válida e corresponde à agenda inicial do canal', () => {
    const c = configEditorialSchema.parse(CONFIG_EDITORIAL_PADRAO)
    expect(c.pesquisa.frequencia).toBe('diaria')
    expect(c.agenda.fuso).toBe('America/Sao_Paulo')
    expect(c.agenda.formatos.longo.horarios).toEqual([{ dia: 0, hora: '18:00' }])
    expect(c.agenda.formatos.short.horarios.map((h) => h.dia)).toEqual([2, 4, 6])
    expect(c.agenda.formatos.short.limiteSemanal).toBe(3)
    expect(alertasCapacidade(c)).toEqual([])
  })
  it('recusa fuso inválido, intervalo invertido e horários repetidos', () => {
    const c = clone()
    c.agenda.fuso = 'Marte/Base'
    expect(configEditorialSchema.safeParse(c).success).toBe(false)
    const d = clone()
    d.pesquisa.periodo = 'personalizado'
    d.pesquisa.periodoDe = '2026-10-10'
    d.pesquisa.periodoAte = '2026-10-01'
    expect(configEditorialSchema.safeParse(d).success).toBe(false)
    const e = clone()
    e.agenda.formatos.short.horarios.push({ dia: 2, hora: '18:00' })
    expect(configEditorialSchema.safeParse(e).success).toBe(false)
  })
  it('informa o intervalo pesquisado', () => {
    const i = intervaloPesquisa(CONFIG_EDITORIAL_PADRAO.pesquisa, AGORA)
    expect(AGORA.getTime() - i.de.getTime()).toBe(7 * 24 * 3600_000)
  })
})

describe('horizonte e limites da agenda', () => {
  it('gera 1 longo e 3 Shorts por semana no horizonte de 14 dias', () => {
    const h = horariosDoHorizonte(clone(), AGORA)
    expect(h.filter((x) => x.tipoVideo === 'longo')).toHaveLength(2)
    expect(h.filter((x) => x.tipoVideo === 'short')).toHaveLength(6)
    expect(h[0]).toMatchObject({ tipoVideo: 'short', data: '2026-11-03', hora: '18:00' })
  })

  it('pausa da agenda e de um formato, e reativação', () => {
    const c = clone()
    c.agenda.pausada = true
    expect(horariosDoHorizonte(c, AGORA)).toEqual([])
    expect(validarAgendamento(c, [], { roteiroId: 1, tipoVideo: 'longo', inicioUtc: sp('2026-11-08', '18:00') }, AGORA).map((p) => p.codigo)).toContain('pausada')
    c.agenda.pausada = false
    c.agenda.formatos.short.pausado = true
    expect(horariosDoHorizonte(c, AGORA).every((x) => x.tipoVideo === 'longo')).toBe(true)
    c.agenda.formatos.short.pausado = false
    expect(horariosDoHorizonte(c, AGORA).some((x) => x.tipoVideo === 'short')).toBe(true)
  })

  it('aplica limite diário, semanal e mensal', () => {
    const c = clone()
    const e: EntradaAgendada[] = [{ id: 1, roteiroId: 1, tipoVideo: 'short', inicioUtc: sp('2026-11-03', '18:00') }]
    const mesmoDia = validarAgendamento(c, e, { roteiroId: 2, tipoVideo: 'short', inicioUtc: sp('2026-11-03', '20:00') }, AGORA)
    expect(mesmoDia.map((p) => p.codigo)).toContain('limite_diario')

    e.push({ id: 2, roteiroId: 2, tipoVideo: 'short', inicioUtc: sp('2026-11-05', '18:00') })
    e.push({ id: 3, roteiroId: 3, tipoVideo: 'short', inicioUtc: sp('2026-11-07', '18:00') })
    const quarto = validarAgendamento(c, e, { roteiroId: 4, tipoVideo: 'short', inicioUtc: sp('2026-11-06', '18:00') }, AGORA)
    expect(quarto.map((p) => p.codigo)).toContain('limite_semanal')
    // Semana seguinte (seg 09/11) volta a aceitar.
    expect(validarAgendamento(c, e, { roteiroId: 4, tipoVideo: 'short', inicioUtc: sp('2026-11-10', '18:00') }, AGORA)).toEqual([])

    c.agenda.formatos.short.limiteMensal = 3
    expect(validarAgendamento(c, e, { roteiroId: 4, tipoVideo: 'short', inicioUtc: sp('2026-11-10', '18:00') }, AGORA).map((p) => p.codigo)).toContain('limite_mensal')
  })

  it('detecta conflito de horário, duplicidade e horário passado', () => {
    const c = clone()
    const e: EntradaAgendada[] = [{ id: 1, roteiroId: 7, tipoVideo: 'longo', inicioUtc: sp('2026-11-08', '18:00') }]
    const codigos = validarAgendamento(c, e, { roteiroId: 7, tipoVideo: 'short', inicioUtc: sp('2026-11-08', '18:00') }, AGORA).map((p) => p.codigo)
    expect(codigos).toEqual(expect.arrayContaining(['duplicado', 'conflito']))
    expect(validarAgendamento(c, [], { roteiroId: null, tipoVideo: 'longo', inicioUtc: sp('2026-11-01', '18:00') }, AGORA).map((p) => p.codigo)).toContain('passado')
    // Reagendar o próprio item não conta como conflito com ele mesmo.
    expect(validarAgendamento(c, e, { roteiroId: 7, tipoVideo: 'longo', inicioUtc: sp('2026-11-15', '18:00'), ignorarId: 1 }, AGORA)).toEqual([])
  })

  it('alerta quando a meta supera capacidade, horários e orçamento', () => {
    const c = clone()
    c.agenda.formatos.short.limiteSemanal = 7
    c.capacidade.orcamentoMensal = 10
    c.capacidade.custoEstimadoPorVideo = 2
    const a = alertasCapacidade(c)
    expect(a.some((x) => x.includes('horários configurados'))).toBe(true)
    expect(a.some((x) => x.includes('capacidade de revisão'))).toBe(true)
    expect(a.some((x) => x.includes('orçamento'))).toBe(true)
  })
})

describe('horários de pesquisa', () => {
  it('diária às 08:00 de São Paulo, e nenhuma quando manual', () => {
    const c = clone()
    const lista = horariosPesquisa(c, new Date('2026-11-01T00:00:00Z'), new Date('2026-11-04T00:00:00Z'))
    expect(lista.map((d) => d.toISOString())).toEqual(['2026-11-01T11:00:00.000Z', '2026-11-02T11:00:00.000Z', '2026-11-03T11:00:00.000Z'])
    c.pesquisa.frequencia = 'manual'
    expect(horariosPesquisa(c, new Date('2026-11-01T00:00:00Z'), new Date('2026-11-04T00:00:00Z'))).toEqual([])
  })
  it('dias úteis e a cada 12 horas', () => {
    const c = clone()
    c.pesquisa.frequencia = 'dias_uteis'
    const semana = horariosPesquisa(c, new Date('2026-11-01T00:00:00Z'), new Date('2026-11-08T23:00:00Z'))
    expect(semana).toHaveLength(5)
    c.pesquisa.frequencia = 'a_cada_12h'
    expect(horariosPesquisa(c, new Date('2026-11-01T00:00:00Z'), new Date('2026-11-02T03:00:00Z'))).toHaveLength(2)
  })
})
