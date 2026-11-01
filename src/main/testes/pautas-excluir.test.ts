import { describe, expect, it } from 'vitest'
import { executar, um } from '../db/conexao'
import { criarPauta, excluirPautas } from '../repositorios/pautas'
import { bancoDeTeste, projetoDeTeste } from './auxiliares'

const nova = (db: ReturnType<typeof bancoDeTeste>, projetoId: number, titulo: string): number =>
  criarPauta(db, { projetoId, titulo, tema: '', notas: '', palavrasChave: [], perguntaCentral: '', resumo: '', publico: '', tipoSugerido: null, potencialNarrativa: null, origem: 'manual' }).id

describe('apagar várias pautas', () => {
  it('apaga as selecionadas e mantém a que está em produção na agenda', () => {
    const db = bancoDeTeste()
    const p = projetoDeTeste(db)
    const [a, b, c] = [nova(db, p, 'A'), nova(db, p, 'B'), nova(db, p, 'C')]
    const t = new Date().toISOString()
    executar(db, "INSERT INTO calendario_entradas (projeto_id, titulo, tipo_video, inicio_utc, status, criado_em, atualizado_em, pauta_id) VALUES (:p, 'C', 'longo', :t, 'planejado', :t, :t, :c)", { p, t, c: c! })
    expect(excluirPautas(db, [a!, b!, c!])).toEqual({ excluidas: 2, mantidas: 1 })
    expect(um<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM pautas')!.n).toBe(1)
  })
})
