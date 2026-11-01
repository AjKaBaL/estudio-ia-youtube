import { spawn, spawnSync } from 'node:child_process'
import http from 'node:http'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { ErroApp } from './erros'
import { executarFerramenta } from './midia/ffmpeg'
import { requisitarJson } from './ia/http'

/**
 * Instalações de um clique, só pelos pacotes oficiais do Windows (winget), com lista fechada:
 * nenhum texto do usuário entra no comando. Rodam somente quando o usuário clica no botão.
 */

const PACOTES = {
  ollama: { id: 'Ollama.Ollama', nome: 'Ollama' },
  ffmpeg: { id: 'Gyan.FFmpeg', nome: 'FFmpeg' }
} as const
export type Pacote = keyof typeof PACOTES

/** Modelo leve recomendado para PCs com 16 GB de memória (cerca de 2,5 GB para baixar). */
export const MODELO_OLLAMA_PADRAO = 'qwen3:4b'
const URL_OLLAMA = 'http://127.0.0.1:11434'

export function wingetDisponivel(): boolean {
  if (process.platform !== 'win32') return false
  return spawnSync('where.exe', ['winget'], { windowsHide: true, timeout: 5000 }).status === 0
}

/** Último percentual que o winget escreveu na saída (ex.: "████  45%" ou "12.3 MB / 98.0 MB"). */
export function percentualWinget(trecho: string): number | null {
  const pct = [...trecho.matchAll(/(\d{1,3})\s*%/g)].map((m) => Number(m[1])).filter((n) => n <= 100)
  if (pct.length) return pct.at(-1)!
  const mb = [...trecho.matchAll(/([\d.,]+)\s*(KB|MB|GB)\s*\/\s*([\d.,]+)\s*(KB|MB|GB)/gi)].at(-1)
  if (!mb) return null
  const fator = (u: string): number => ({ KB: 1, MB: 1024, GB: 1024 * 1024 })[u.toUpperCase() as 'KB'] ?? 1
  const feito = Number(mb[1]!.replace(',', '.')) * fator(mb[2]!)
  const total = Number(mb[3]!.replace(',', '.')) * fator(mb[4]!)
  return total > 0 ? Math.min(100, Math.round((feito / total) * 100)) : null
}

export async function instalarPacote(pacote: Pacote, sinal?: AbortSignal, aoProgredir?: (pct: number) => void): Promise<void> {
  const p = PACOTES[pacote]
  if (!wingetDisponivel()) throw new ErroApp('sem_winget', `O instalador do Windows (winget) não foi encontrado. Instale o ${p.nome} pelo site oficial.`)
  const r = await executarFerramenta(
    'winget',
    ['install', '--id', p.id, '--exact', '--silent', '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity'],
    {
      sinal,
      tempoLimiteMs: 30 * 60_000,
      aoProgredir: (t) => {
        const pct = percentualWinget(t)
        if (pct !== null) aoProgredir?.(pct)
      }
    }
  )
  // 0 = instalado; -1978335189 (0x8A15002B) = já estava instalado e atualizado.
  if (r.codigo !== 0 && r.codigo !== -1978335189 && r.codigo !== 2316632107) {
    throw new ErroApp('instalacao', `A instalação do ${p.nome} não terminou (código ${r.codigo ?? '?'}). Tente pelo site oficial.${r.cancelado ? ' (cancelada)' : ''}`)
  }
}

/** Onde o winget deixa os atalhos dos programas de linha de comando (ex.: ffmpeg.exe). */
export function caminhoWingetLinks(nome: string): string | null {
  const base = process.env.LOCALAPPDATA
  if (!base) return null
  const c = join(base, 'Microsoft', 'WinGet', 'Links', nome)
  return existsSync(c) ? c : null
}

/** O Ollama está instalado neste usuário do Windows (pelo winget ou pelo instalador do site)? */
export function ollamaInstalado(): boolean {
  const pasta = process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Programs', 'Ollama') : ''
  return Boolean(pasta) && (existsSync(join(pasta, 'ollama.exe')) || existsSync(join(pasta, 'ollama app.exe')))
}

/** Modelos já baixados no Ollama (lista vazia se ele não responder). */
export async function modelosOllama(): Promise<string[]> {
  try {
    const r = await requisitarJson(`${URL_OLLAMA}/api/tags`, { local: true, tempoLimiteMs: 5000 })
    return ((r.dados as { models?: { name?: unknown }[] })?.models ?? []).map((m) => m.name).filter((n): n is string => typeof n === 'string')
  } catch {
    return []
  }
}

export async function ollamaRespondendo(): Promise<boolean> {
  try {
    await requisitarJson(`${URL_OLLAMA}/api/tags`, { local: true, tempoLimiteMs: 3000 })
    return true
  } catch {
    return false
  }
}

/** Abre o Ollama (sem janela) se ele ainda não estiver rodando e espera ficar pronto. */
export async function garantirOllamaRodando(): Promise<void> {
  if (await ollamaRespondendo()) return
  const pasta = process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Programs', 'Ollama') : ''
  const app = join(pasta, 'ollama app.exe')
  const cli = join(pasta, 'ollama.exe')
  const proc = existsSync(app) ? spawn(app, [], { detached: true, stdio: 'ignore', windowsHide: true, shell: false }) : existsSync(cli) ? spawn(cli, ['serve'], { detached: true, stdio: 'ignore', windowsHide: true, shell: false }) : null
  if (!proc) throw new ErroApp('ollama_ausente', 'O Ollama não foi encontrado depois da instalação. Abra o Ollama pelo menu Iniciar e tente de novo.')
  proc.unref()
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000))
    if (await ollamaRespondendo()) return
  }
  throw new ErroApp('ollama_parado', 'O Ollama foi instalado, mas não respondeu. Abra o Ollama pelo menu Iniciar e clique em “Detectar no PC”.')
}

export interface ProgressoDownload {
  status: string
  baixados: number
  total: number
}

/**
 * Baixa o modelo pelo próprio Ollama (API local, endereço fixo), lendo o progresso linha a linha:
 * cada parte do modelo informa bytes baixados ("completed") e o tamanho ("total").
 */
export function baixarModeloOllama(modelo = MODELO_OLLAMA_PADRAO, aoProgredir?: (p: ProgressoDownload) => void, sinal?: AbortSignal, porta = 11434): Promise<void> {
  const corpo = JSON.stringify({ model: modelo, stream: true })
  const partes = new Map<string, { baixados: number; total: number }>()
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: porta, path: '/api/pull', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(corpo) }, signal: sinal, timeout: 5 * 60_000 },
      (res) => {
        if ((res.statusCode ?? 0) >= 300) {
          res.resume()
          return reject(new ErroApp('ollama_download', `O Ollama recusou o download do modelo (código ${res.statusCode}).`))
        }
        let resto = ''
        let erro: string | null = null
        let sucesso = false
        res.setEncoding('utf8')
        res.on('data', (pedaco: string) => {
          resto = (resto + pedaco).slice(-100_000)
          const linhas = resto.split('\n')
          resto = linhas.pop() ?? ''
          for (const l of linhas) {
            if (!l.trim()) continue
            let d: { status?: string; digest?: string; total?: number; completed?: number; error?: string }
            try {
              d = JSON.parse(l)
            } catch {
              continue
            }
            if (d.error) erro = String(d.error).slice(0, 300)
            if (d.status === 'success') sucesso = true
            if (d.digest && typeof d.total === 'number') partes.set(d.digest, { total: d.total, baixados: Math.min(d.total, d.completed ?? 0) })
            const total = [...partes.values()].reduce((s, x) => s + x.total, 0)
            const baixados = [...partes.values()].reduce((s, x) => s + x.baixados, 0)
            aoProgredir?.({ status: d.status ?? '', baixados, total })
          }
        })
        res.on('end', () => (erro ? reject(new ErroApp('ollama_download', `Falha ao baixar o modelo: ${erro}`)) : sucesso ? resolve() : reject(new ErroApp('ollama_download', 'O download do modelo foi interrompido.'))))
        res.on('error', () => reject(new ErroApp('ollama_download', 'Conexão com o Ollama interrompida.')))
      }
    )
    req.on('timeout', () => req.destroy(new Error('tempo')))
    req.on('error', (e) => reject(e instanceof ErroApp ? e : new ErroApp('ollama_download', 'Não foi possível falar com o Ollama para baixar o modelo.')))
    req.end(corpo)
  })
}
