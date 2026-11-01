import { describe, expect, it } from 'vitest'
import { executar } from '../db/conexao'
import { proximoDiaComVaga } from '../piloto'
import { bancoDeTeste, projetoDeTeste, roteiroDeTeste } from './auxiliares'

describe('no máximo 3 vídeos longos por dia', () => {
  function banco() {
    const db = bancoDeTeste()
    executar(db, 'PRAGMA foreign_keys = OFF')
    const p = projetoDeTeste(db)
    let n = 0
    const publicar = (tipoVideo: 'longo' | 'short', status: string, enviadoEm: string | null, publicarEm: string | null = null): number => {
      const r = roteiroDeTeste(db, p, { tipoVideo })
      n++
      return executar(
        db,
        `INSERT INTO publicacoes (renderizacao_id, roteiro_id, id_operacao, titulo, status, enviado_em, publicar_em, criado_em, atualizado_em)
         VALUES (:n, :r, :op, 'v', :s, :e, :pe, COALESCE(:e, '2026-01-01T00:00:00.000Z'), COALESCE(:e, '2026-01-01T00:00:00.000Z'))`,
        { n, r: r.id, op: `op${n}`, s: status, e: enviadoEm, pe: publicarEm }
      ).id
    }
    return { db, publicar }
  }
  // 1º/11/2026 é domingo; 12:00 em São Paulo = 15:00 UTC.
  const agora = new Date('2026-11-01T15:00:00.000Z')

  it('com vaga no dia, publica normalmente', () => {
    const { db, publicar } = banco()
    publicar('longo', 'concluida', '2026-11-01T10:00:00.000Z')
    publicar('longo', 'concluida', '2026-11-01T11:00:00.000Z')
    publicar('short', 'concluida', '2026-11-01T12:00:00.000Z')
    publicar('longo', 'concluida', '2026-10-31T23:00:00.000Z') // 20:00 de sábado em São Paulo: outro dia
    const atual = publicar('longo', 'rascunho', null)
    expect(proximoDiaComVaga(db, atual, agora, agora)).toBeNull()
  })

  it('dia cheio: agenda no próximo dia com vaga, contando também os já agendados', () => {
    const { db, publicar } = banco()
    for (const h of ['04', '05', '09']) publicar('longo', 'concluida', `2026-11-01T${h}:00:00.000Z`)
    // Segunda já tem 3 agendados no YouTube: vai para terça.
    for (const h of ['16', '19', '22']) publicar('longo', 'concluida', '2026-11-01T09:30:00.000Z', `2026-11-02T${h}:00:00.000Z`)
    const atual = publicar('longo', 'rascunho', null)
    const vaga = proximoDiaComVaga(db, atual, agora, agora)
    expect(vaga).toBe('2026-11-03T15:00:00.000Z') // terça, mesma hora (sem horário de longo configurado na terça)
  })

  it('dois vídeos levados para o mesmo dia não ficam no mesmo horário', () => {
    const { db, publicar } = banco()
    for (const h of ['04', '05', '09']) publicar('longo', 'concluida', `2026-11-01T${h}:00:00.000Z`)
    // Já há um vídeo agendado para segunda na mesma hora do alvo.
    publicar('longo', 'concluida', '2026-11-01T09:30:00.000Z', '2026-11-02T15:00:00.000Z')
    const atual = publicar('longo', 'rascunho', null)
    const vaga = proximoDiaComVaga(db, atual, agora, agora)
    expect(vaga).not.toBe('2026-11-02T15:00:00.000Z')
    expect(vaga!.startsWith('2026-11-02')).toBe(true)
  })

  it('dia com vaga, mas outro vídeo no mesmo horário: vai para um horário livre', () => {
    const { db, publicar } = banco()
    publicar('longo', 'concluida', '2026-11-01T09:30:00.000Z', '2026-11-02T16:00:00.000Z')
    const atual = publicar('longo', 'rascunho', null)
    const alvo = new Date('2026-11-02T16:00:00.000Z')
    const vaga = proximoDiaComVaga(db, atual, alvo, agora)
    expect(vaga).not.toBeNull()
    expect(Math.abs(new Date(vaga!).getTime() - alvo.getTime())).toBeGreaterThanOrEqual(3_600_000)
    // Sem ninguém por perto, fica no horário dele.
    expect(proximoDiaComVaga(db, atual, new Date('2026-11-02T22:00:00.000Z'), agora)).toBeNull()
  })
})

describe('espaço no PC depois do envio', () => {
  it('apaga só o vídeo renderizado de projetos que já estão no YouTube', async () => {
    const { mkdtempSync, mkdirSync, writeFileSync, existsSync } = await import('node:fs')
    const { join } = await import('node:path')
    const { tmpdir } = await import('node:os')
    const { liberarArquivosEnviados } = await import('../piloto')
    const db = bancoDeTeste()
    executar(db, 'PRAGMA foreign_keys = OFF')
    const p = projetoDeTeste(db)
    const pasta = mkdtempSync(join(tmpdir(), 'estudio-render-'))
    const arquivo = (id: number): string => {
      mkdirSync(join(pasta, String(id)))
      const a = join(pasta, String(id), 'video.mp4')
      writeFileSync(a, Buffer.alloc(1024))
      return a
    }
    const t = '2026-11-01T10:00:00.000Z'
    const render = (id: number, edicao: number): string => {
      const a = arquivo(id)
      executar(db, "INSERT INTO renderizacoes (id, edicao_id, revisao, preset, arquivo, status, criado_em) VALUES (:id, :e, 1, '16:9-1080p', :a, 'concluida', :t)", { id, e: edicao, a, t })
      return a
    }
    const enviado = render(1, 10)
    const antigoDoMesmo = render(2, 10)
    const outro = render(3, 20)
    for (const [r, s] of [[1, 'concluida'], [3, 'rascunho']] as const) {
      const rot = roteiroDeTeste(db, p)
      executar(db, "INSERT INTO publicacoes (renderizacao_id, roteiro_id, id_operacao, titulo, status, criado_em, atualizado_em) VALUES (:r, :rot, :op, 'v', :s, :t, :t)", { r, rot: rot.id, op: `op${r}`, s, t })
    }
    expect(liberarArquivosEnviados(db)).toMatch(/2 arquivo\(s\)/)
    expect(existsSync(enviado)).toBe(false)
    expect(existsSync(antigoDoMesmo)).toBe(false)
    expect(existsSync(outro)).toBe(true) // ainda não foi ao YouTube
    expect(liberarArquivosEnviados(db)).toBe('')
  })
})
