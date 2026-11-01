import { describe, expect, it } from 'vitest'
import { rodadaAgendador } from '../agendador'
import * as agenda from '../repositorios/agenda'
import { lerEditorial, salvarEditorial } from '../repositorios/editorial'
import * as r from '../repositorios/roteiros'
import { listarTarefas, verificarAgendaPesquisa } from '../repositorios/tarefas'
import { CONFIG_EDITORIAL_PADRAO, type ConfigEditorial } from '@shared/editorial'
import { filtroRoteirosSchema } from '@shared/schemas'
import { bancoDeTeste, projetoDeTeste, roteiroDeTeste } from './auxiliares'

const AGORA = new Date('2026-11-02T12:00:00Z') // segunda, 09:00 em SP
const cfg = (): ConfigEditorial => structuredClone(CONFIG_EDITORIAL_PADRAO)

describe('agenda (banco)', () => {
  it('agenda uma semana fictícia com 1 longo e 3 Shorts e recusa o excedente', () => {
    const db = bancoDeTeste()
    const p = projetoDeTeste(db)
    const c = cfg()
    const novo = (tipo: 'longo' | 'short', data: string) => {
      const rot = roteiroDeTeste(db, p, { tipoVideo: tipo, titulo: `${tipo} ${data}` })
      return agenda.agendar(db, c, { projetoId: p, roteiroId: rot.id, titulo: rot.titulo, tipoVideo: tipo, data, hora: '18:00', notas: '' }, AGORA)
    }
    novo('short', '2026-11-03')
    novo('short', '2026-11-05')
    novo('short', '2026-11-07')
    const longo = novo('longo', '2026-11-08')
    expect(longo.inicioUtc).toBe('2026-11-08T21:00:00.000Z')
    expect(() => novo('short', '2026-11-06')).toThrow(/Limite semanal/)
    expect(agenda.listarAgenda(db, c, '2026-11-02', '2026-11-08')).toHaveLength(4)
    // Horários livres no horizonte de 14 dias: só a semana seguinte (3 Shorts + 1 longo).
    expect(agenda.horariosLivres(db, c, AGORA)).toHaveLength(4)
  })

  it('impede agendar o mesmo roteiro duas vezes e permite reagendar e cancelar', () => {
    const db = bancoDeTeste()
    const p = projetoDeTeste(db)
    const c = cfg()
    const rot = roteiroDeTeste(db, p)
    const a = agenda.agendar(db, c, { projetoId: p, roteiroId: rot.id, titulo: 'x', tipoVideo: 'longo', data: '2026-11-08', hora: '18:00', notas: '' }, AGORA)
    expect(() =>
      agenda.agendar(db, c, { projetoId: p, roteiroId: rot.id, titulo: 'x', tipoVideo: 'longo', data: '2026-11-15', hora: '18:00', notas: '' }, AGORA)
    ).toThrow(/já está agendado/)
    const b = agenda.reagendar(db, c, a.id, '2026-11-15', '18:00', AGORA)
    expect(b.inicioUtc).toBe('2026-11-15T21:00:00.000Z')
    agenda.cancelarAgendamento(db, a.id)
    expect(agenda.listarAgenda(db, c, '2026-11-01', '2026-11-30')).toHaveLength(0)
    // Cancelar não apaga o roteiro.
    expect(r.buscarRoteiros(db, filtroRoteirosSchema.parse({}))).toHaveLength(1)
  })

  it('recusa agendar com a agenda pausada e volta a aceitar ao reativar', () => {
    const db = bancoDeTeste()
    const p = projetoDeTeste(db)
    const c = cfg()
    c.agenda.pausada = true
    const dados = { projetoId: p, roteiroId: null, titulo: 'x', tipoVideo: 'longo' as const, data: '2026-11-08', hora: '18:00', notas: '' }
    expect(() => agenda.agendar(db, c, dados, AGORA)).toThrow(/pausada/)
    c.agenda.pausada = false
    expect(agenda.agendar(db, c, dados, AGORA).status).toBe('planejado')
  })

  it('não altera padrões sem ação do usuário e grava quando ele salva', () => {
    const db = bancoDeTeste()
    expect(lerEditorial(db)).toEqual(CONFIG_EDITORIAL_PADRAO)
    const c = cfg()
    c.horizonteDias = 30
    salvarEditorial(db, c)
    expect(lerEditorial(db).horizonteDias).toBe(30)
  })
})

describe('pesquisas agendadas e execuções perdidas', () => {
  it('primeira abertura não cria tarefas retroativas', () => {
    const db = bancoDeTeste()
    expect(verificarAgendaPesquisa(db, cfg(), AGORA, null)).toEqual({ criadas: 0, perdidas: 0 })
  })

  it('cria tarefa no horário e não duplica ao verificar de novo', () => {
    const db = bancoDeTeste()
    const noHorario = new Date('2026-11-02T11:01:00Z') // 08:01 em SP
    const antes = new Date('2026-11-02T10:59:00Z')
    expect(verificarAgendaPesquisa(db, cfg(), noHorario, antes).criadas).toBe(1)
    expect(verificarAgendaPesquisa(db, cfg(), noHorario, antes).criadas).toBe(0)
    expect(listarTarefas(db).map((t) => t.status)).toEqual(['pendente'])
  })

  it('app fechado por 3 dias: registra perdidas e cria uma única recuperação', () => {
    const db = bancoDeTeste()
    const fechadoEm = new Date('2026-10-30T12:00:00Z')
    const r1 = verificarAgendaPesquisa(db, cfg(), AGORA, fechadoEm)
    expect(r1.perdidas).toBe(3) // 31/10, 01/11 e 02/11 às 08:00
    const t = listarTarefas(db)
    expect(t.filter((x) => x.status === 'perdida')).toHaveLength(3)
    expect(t.filter((x) => x.status === 'pendente')).toHaveLength(1)
  })

  it('políticas ignorar e reagendar não executam ao abrir', () => {
    for (const politica of ['ignorar', 'reagendar'] as const) {
      const db = bancoDeTeste()
      const c = cfg()
      c.pesquisa.politicaPerdida = politica
      verificarAgendaPesquisa(db, c, AGORA, new Date('2026-10-31T12:00:00Z'))
      const t = listarTarefas(db)
      expect(t.some((x) => x.status === 'pendente')).toBe(false)
      expect(t.every((x) => x.status === (politica === 'ignorar' ? 'ignorada' : 'perdida'))).toBe(true)
    }
  })

  it('o verificador guarda a última verificação no banco', () => {
    const db = bancoDeTeste()
    rodadaAgendador(db, new Date('2026-11-01T12:00:00Z'))
    rodadaAgendador(db, AGORA)
    expect(listarTarefas(db).filter((x) => x.status === 'perdida')).toHaveLength(1)
  })
})
