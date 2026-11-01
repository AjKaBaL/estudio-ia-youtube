import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ARTE_APRESENTADOR } from './apresentadorArte'

/** Grava (uma vez) os desenhos do apresentador na pasta do app e devolve "pose-boca" → caminho do PNG. */
export function arquivosApresentador(pasta: string): Record<string, string> {
  mkdirSync(pasta, { recursive: true })
  const saida: Record<string, string> = {}
  for (const [nome, b64] of Object.entries(ARTE_APRESENTADOR)) {
    const caminho = join(pasta, `${nome}.png`)
    const dados = Buffer.from(b64, 'base64')
    if (!existsSync(caminho) || statSync(caminho).size !== dados.length) writeFileSync(caminho, dados)
    saida[nome] = caminho
  }
  return saida
}
