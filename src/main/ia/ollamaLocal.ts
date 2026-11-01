import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { requisitarJson } from './http'

/**
 * O Ollama instalado no PC, mas fechado, deixava o piloto sem a IA local. Quando a conexão é recusada, o app
 * abre o servidor do Ollama sozinho (sem janela) e espera ele responder. Só para o endereço padrão do PC
 * (127.0.0.1:11434), só no aplicativo (nunca nos testes) e no máximo uma tentativa a cada 5 minutos.
 */

const ESPERA_ENTRE_TENTATIVAS_MS = 5 * 60_000
let ultimaTentativa = 0

function executavelOllama(): string | null {
  const candidatos = [
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Programs', 'Ollama', 'ollama.exe'),
    process.env.ProgramFiles && join(process.env.ProgramFiles, 'Ollama', 'ollama.exe')
  ].filter((c): c is string => !!c)
  return candidatos.find((c) => existsSync(c)) ?? null
}

const enderecoPadrao = (urlBase: string): boolean => /^http:\/\/(127\.0\.0\.1|localhost):11434\/?$/i.test(urlBase.trim())

async function responde(urlBase: string): Promise<boolean> {
  try {
    await requisitarJson(`${urlBase.replace(/\/$/, '')}/api/tags`, { local: true, sinal: AbortSignal.timeout(3_000), tempoLimiteMs: 3_000 })
    return true
  } catch {
    return false
  }
}

/** Abre o Ollama se estiver instalado e fechado. Devolve true se ele passou a responder. */
export async function abrirOllama(urlBase: string): Promise<boolean> {
  if (!process.versions.electron || process.platform !== 'win32' || !enderecoPadrao(urlBase)) return false
  if (Date.now() - ultimaTentativa < ESPERA_ENTRE_TENTATIVAS_MS) return false
  ultimaTentativa = Date.now()
  const exe = executavelOllama()
  if (!exe) return false
  try {
    const p = spawn(exe, ['serve'], { detached: true, stdio: 'ignore', windowsHide: true })
    p.on('error', () => undefined)
    p.unref()
  } catch {
    return false
  }
  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 2_000))
    if (await responde(urlBase)) return true
  }
  return false
}
