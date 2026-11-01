import { mkdtempSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ESTILOS_TRILHA, expressaoTrilha, gerarTrilha } from '../midia/trilha'
import { localizarFerramentas } from '../midia/ffmpeg'

describe('trilha sonora (regras)', () => {
  it('expressão sem aspas simples e ciclo de 8 compassos', () => {
    for (const e of ESTILOS_TRILHA) {
      const r = expressaoTrilha(e)
      expect(r.expressao).not.toContain("'")
      expect(r.segundos).toBeCloseTo((60 / e.bpm) * 4 * 4 * 2, 3)
    }
  })
})

const f = process.env.FFMPEG_REAL ? localizarFerramentas(process.env.FFMPEG_CAMINHO ?? null) : null
describe.skipIf(!f)('trilha sonora (FFmpeg real, opcional)', () => {
  it('compõe e repete até a duração do vídeo', async () => {
    const pasta = mkdtempSync(join(tmpdir(), 'estudio-trilha-'))
    const inicio = Date.now()
    const r = await gerarTrilha(f!, 95, 3, pasta)
    console.log(r.arquivo, `${((Date.now() - inicio) / 1000).toFixed(1)} s`)
    expect(statSync(r.arquivo).size).toBeGreaterThan(95 * 44100 * 4 * 0.95)
  }, 120_000)
})
