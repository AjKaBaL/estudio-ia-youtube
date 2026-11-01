import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, describe, expect, it } from 'vitest'
import { baixarModeloOllama, percentualWinget, type ProgressoDownload } from '../instaladores'

const servidores: http.Server[] = []
afterAll(() => servidores.forEach((s) => s.close()))

/** "Ollama" falso que responde ao /api/pull em linhas, como o real. */
async function ollamaPull(linhas: object[]): Promise<number> {
  const s = http.createServer((req, res) => {
    req.resume()
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' })
      for (const l of linhas) res.write(JSON.stringify(l) + '\n')
      res.end()
    })
  })
  servidores.push(s)
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()))
  return (s.address() as AddressInfo).port
}

describe('progresso das instalações', () => {
  it('lê a porcentagem da saída do winget', () => {
    expect(percentualWinget('  ██████▒▒▒▒  45%\r  ████████▒▒  80%')).toBe(80)
    expect(percentualWinget('  12.0 MB / 48.0 MB')).toBe(25)
    expect(percentualWinget('Encontrado Ollama [Ollama.Ollama]')).toBeNull()
  })

  it('soma o progresso de todas as partes do modelo e termina no "success"', async () => {
    const porta = await ollamaPull([
      { status: 'pulling manifest' },
      { status: 'pulling a', digest: 'a', total: 1000, completed: 500 },
      { status: 'pulling a', digest: 'a', total: 1000, completed: 1000 },
      { status: 'pulling b', digest: 'b', total: 3000, completed: 1500 },
      { status: 'verifying sha256 digest' },
      { status: 'success' }
    ])
    const passos: ProgressoDownload[] = []
    await baixarModeloOllama('modelo', (p) => passos.push(p), undefined, porta)
    expect(passos.find((p) => p.status === 'pulling b')).toMatchObject({ baixados: 2500, total: 4000 })
    expect(passos.at(-1)!.status).toBe('success')
  })

  it('erro do Ollama ou fim sem "success" viram mensagem clara', async () => {
    const comErro = await ollamaPull([{ status: 'pulling manifest' }, { error: 'pull model manifest: file does not exist' }])
    await expect(baixarModeloOllama('x', undefined, undefined, comErro)).rejects.toThrow(/Falha ao baixar o modelo: pull model manifest/)
    const interrompido = await ollamaPull([{ status: 'pulling a', digest: 'a', total: 10, completed: 5 }])
    await expect(baixarModeloOllama('x', undefined, undefined, interrompido)).rejects.toThrow(/interrompido/)
  })
})

describe('respostas de modelos que "pensam"', () => {
  it('remove o trecho <think> antes da resposta', async () => {
    const { semPensamento } = await import('../ia/adaptadores')
    expect(semPensamento('<think>vou montar o JSON</think>\n{"a":1}')).toBe('{"a":1}')
    expect(semPensamento('raciocínio solto</think>{"a":1}')).toBe('{"a":1}')
    expect(semPensamento('{"a":1}')).toBe('{"a":1}')
  })
})
