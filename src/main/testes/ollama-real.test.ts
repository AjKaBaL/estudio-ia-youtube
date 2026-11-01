import { describe, expect, it } from 'vitest'
import { adaptadorOllama } from '../ia/adaptadores'
import { provedorIaSchema } from '@shared/ia'

// Teste opcional com o Ollama real deste PC. Rode com: OLLAMA_REAL=qwen3:latest npx vitest run ollama-real
describe.skipIf(!process.env.OLLAMA_REAL)('Ollama real (opcional)', () => {
  it('responde JSON válido sem o trecho de "pensamento"', async () => {
    const cfg = provedorIaSchema.parse({ nome: 'PC', adaptador: 'ollama', urlBase: 'http://127.0.0.1:11434', modelo: process.env.OLLAMA_REAL, precoEntradaPorMilhao: null, precoSaidaPorMilhao: null, maxTokensSaida: 400, limitesConhecidos: '' })
    const inicio = Date.now()
    const r = await adaptadorOllama.gerar(
      { sistema: 'Responda só com JSON no formato {"titulo":"...","frase":"..."}.', usuario: 'Crie um título curto e uma frase em português sobre inteligência artificial em pequenas empresas.', maxTokens: 400, temperatura: 0.3, json: true },
      cfg,
      null,
      AbortSignal.timeout(600_000)
    )
    console.log(`${((Date.now() - inicio) / 1000).toFixed(1)} s`, r.texto)
    expect(r.texto).not.toMatch(/<think>/)
    const j = JSON.parse(r.texto) as { titulo: string; frase: string }
    expect(j.titulo.length).toBeGreaterThan(3)
  }, 600_000)
})
