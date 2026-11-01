import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ErroApp } from '../erros'
import { buscarSeguro } from '../pesquisa/rede'
import { executarFerramenta } from './ffmpeg'
import { duracaoWav, type PreferenciaMidia } from '@shared/geracaoMidia'

/**
 * Narração por voz sintética, toda no próprio computador:
 * - Windows: as vozes do sistema (SAPI), por um script fixo do app; o texto vai por ARQUIVO, nunca no comando;
 * - Piper: voz neural gratuita e offline, instalada em 1 clique com conferência de assinatura (SHA-256).
 */

const SCRIPT_WINDOWS = `param([string]$Texto = '', [string]$Saida = '', [string]$Voz = '', [int]$Velocidade = 0, [switch]$Listar)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  if ($Listar) { $s.GetInstalledVoices() | Where-Object { $_.Enabled } | ForEach-Object { $_.VoiceInfo.Name + '|' + $_.VoiceInfo.Culture.Name }; exit 0 }
  if ($Voz) { $s.SelectVoice($Voz) }
  $s.Rate = [Math]::Max(-10, [Math]::Min(10, $Velocidade * 2 + 1))
  $s.SetOutputToWaveFile($Saida)
  $s.Speak([System.IO.File]::ReadAllText($Texto, [System.Text.Encoding]::UTF8))
} finally { $s.Dispose() }
`

function scriptWindows(pastaFerramentas: string): string {
  mkdirSync(pastaFerramentas, { recursive: true })
  const caminho = join(pastaFerramentas, 'voz-windows.ps1')
  // BOM para o PowerShell 5 ler o script como UTF-8.
  const conteudo = '\ufeff' + SCRIPT_WINDOWS
  if (!existsSync(caminho) || readFileSync(caminho, 'utf8') !== conteudo) writeFileSync(caminho, conteudo, 'utf8')
  return caminho
}

const argsPs = (script: string): string[] => ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script]

export interface VozDisponivel {
  nome: string
  idioma: string
}

export async function listarVozesWindows(pastaFerramentas: string): Promise<VozDisponivel[]> {
  if (process.platform !== 'win32') return []
  const saida: string[] = []
  const r = await executarFerramenta('powershell.exe', [...argsPs(scriptWindows(pastaFerramentas)), '-Listar'], { tempoLimiteMs: 20_000, aoProgredir: (t) => saida.push(t) })
  if (r.codigo !== 0) return []
  return saida
    .join('')
    .split(/\r?\n/)
    .map((l) => l.trim().split('|'))
    .filter((p): p is [string, string] => p.length === 2 && /^[\w .()-]{1,80}$/.test(p[0]!))
    .map(([nome, idioma]) => ({ nome, idioma }))
}

async function sintetizarWindows(texto: string, saida: string, voz: string, velocidade: number, pastaFerramentas: string): Promise<string> {
  const vozes = await listarVozesWindows(pastaFerramentas)
  if (!vozes.length) throw new ErroApp('sem_voz', 'Nenhuma voz do Windows encontrada. Instale a voz em português em Configurações do Windows › Hora e idioma › Fala.')
  // Só nomes que o próprio Windows listou (nunca um texto livre).
  const escolhida = vozes.find((v) => v.nome === voz) ?? vozes.find((v) => v.idioma.toLowerCase().startsWith('pt')) ?? vozes[0]!
  const arqTexto = `${saida}.txt`
  writeFileSync(arqTexto, texto, 'utf8')
  try {
    const r = await executarFerramenta(
      'powershell.exe',
      [...argsPs(scriptWindows(pastaFerramentas)), '-Texto', arqTexto, '-Saida', saida, '-Voz', escolhida.nome, '-Velocidade', String(Math.round(velocidade))],
      { tempoLimiteMs: 180_000 }
    )
    if (r.codigo !== 0 || !existsSync(saida)) throw new ErroApp('voz', `A voz do Windows não gerou o áudio. ${r.stderr.slice(-200)}`)
    return `Voz do Windows: ${escolhida.nome}`
  } finally {
    rmSync(arqTexto, { force: true })
  }
}

// ------------------------------------------------------------------ Piper (voz neural)

/** Arquivos oficiais com assinatura conferida em 31/10/2026: qualquer alteração faz a instalação ser recusada. */
const PIPER = {
  programa: {
    url: 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip',
    sha256: 'f3c58906402b24f3a96d92145f58acba6d86c9b5db896d207f78dc80811efcea',
    tamanho: 22_477_236
  },
  modelo: {
    url: 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/pt/pt_BR/faber/medium/pt_BR-faber-medium.onnx',
    sha256: '858555e3a064209c57088fe6bd70c4c3dc54d03eaa00c45d5ecaf43a33f95aa7',
    tamanho: 63_201_294
  },
  config: {
    url: 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/pt/pt_BR/faber/medium/pt_BR-faber-medium.onnx.json',
    sha256: '7e694de195ae3fc36dd732c445eb04fb49b649854893cb5506b978f0d50a1d6f',
    tamanho: 4_855
  }
} as const

const caminhosPiper = (pastaFerramentas: string) => {
  const base = join(pastaFerramentas, 'piper')
  return { base, exe: join(base, 'piper', 'piper.exe'), modelo: join(base, 'pt_BR-faber-medium.onnx'), config: join(base, 'pt_BR-faber-medium.onnx.json') }
}

export function piperInstalado(pastaFerramentas: string): boolean {
  const c = caminhosPiper(pastaFerramentas)
  return existsSync(c.exe) && existsSync(c.modelo) && existsSync(c.config)
}

async function baixarConferido(arq: { url: string; sha256: string; tamanho: number }, destino: string, aoProgredir: (recebidos: number) => void): Promise<void> {
  const r = await buscarSeguro(arq.url, {
    tempoLimiteMs: 15 * 60_000,
    tamanhoMaximo: arq.tamanho + 1024,
    maxRedirecionamentos: 5,
    tiposPermitidos: ['application/octet-stream', 'application/zip', 'application/x-zip-compressed', 'binary/octet-stream', 'application/json', 'text/plain', ''],
    aoProgredir: (n) => aoProgredir(n)
  })
  const bytes = r.bytes ?? Buffer.from(r.corpo)
  const sha = createHash('sha256').update(bytes).digest('hex')
  if (sha !== arq.sha256) throw new ErroApp('assinatura', 'O arquivo baixado não corresponde à assinatura esperada e foi descartado (pode ter sido alterado).')
  writeFileSync(destino, bytes)
}

/** Baixa o Piper e a voz pt-BR, confere as assinaturas e descompacta com o tar do próprio Windows. */
export async function instalarPiper(pastaFerramentas: string, aoProgredir: (pct: number, etapa: string) => void = () => undefined): Promise<void> {
  const c = caminhosPiper(pastaFerramentas)
  mkdirSync(c.base, { recursive: true })
  const total = PIPER.programa.tamanho + PIPER.modelo.tamanho + PIPER.config.tamanho
  let feito = 0
  const zip = join(c.base, 'piper.zip')
  await baixarConferido(PIPER.programa, zip, (n) => aoProgredir(Math.round(((feito + n) / total) * 95), 'Baixando o Piper'))
  feito += PIPER.programa.tamanho
  await baixarConferido(PIPER.modelo, c.modelo, (n) => aoProgredir(Math.round(((feito + n) / total) * 95), 'Baixando a voz em português (Faber)'))
  feito += PIPER.modelo.tamanho
  await baixarConferido(PIPER.config, c.config, () => undefined)
  aoProgredir(96, 'Descompactando')
  const tar = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
  const r = await executarFerramenta(tar, ['-xf', zip, '-C', c.base], { tempoLimiteMs: 120_000 })
  rmSync(zip, { force: true })
  if (r.codigo !== 0 || !existsSync(c.exe)) throw new ErroApp('instalacao', 'Não foi possível descompactar o Piper.')
  aoProgredir(100, 'Concluído')
}

function sintetizarPiper(texto: string, saida: string, velocidade: number, pastaFerramentas: string): Promise<string> {
  const c = caminhosPiper(pastaFerramentas)
  // length_scale > 1 fala mais devagar. A base 0,88 (≈ 14% mais rápida que a voz original) soa natural em vídeo;
  // velocidade 5 → 0,63 e -5 → 1,13.
  const escala = (0.88 - velocidade * 0.05).toFixed(2)
  return new Promise((resolve, reject) => {
    const proc = spawn(c.exe, ['--model', c.modelo, '--config', c.config, '--output_file', saida, '--length_scale', escala, '--sentence_silence', '0.2'], { windowsHide: true, shell: false, stdio: ['pipe', 'ignore', 'pipe'] })
    let erro = ''
    const limite = setTimeout(() => proc.kill(), 300_000)
    proc.stderr.on('data', (d: Buffer) => (erro = (erro + d.toString('utf8')).slice(-2000)))
    proc.on('error', (e) => {
      clearTimeout(limite)
      reject(new ErroApp('voz', `O Piper não abriu: ${e.message}`))
    })
    proc.on('close', (codigo) => {
      clearTimeout(limite)
      if (codigo === 0 && existsSync(saida)) resolve('Piper: voz neural pt-BR “Faber”')
      else reject(new ErroApp('voz', `O Piper não gerou o áudio. ${erro.slice(-200)}`))
    })
    // O texto vai pela entrada padrão, uma linha por frase (nunca como argumento).
    proc.stdin.end(texto.replace(/\s+/g, ' ').trim() + '\n', 'utf8')
  })
}

/** Gera o WAV da fala. Sem o Piper (ou se ele falhar), usa a voz do Windows como reserva e avisa. */
export async function sintetizar(pref: PreferenciaMidia['voz'], texto: string, saida: string, pastaFerramentas: string): Promise<{ descricao: string; duracao: number }> {
  if (!texto.trim()) throw new ErroApp('validacao', 'Texto vazio para narrar.')
  let descricao: string
  if (pref.motor === 'piper' && piperInstalado(pastaFerramentas)) {
    try {
      descricao = await sintetizarPiper(texto, saida, pref.velocidade, pastaFerramentas)
    } catch (e) {
      descricao = `${await sintetizarWindows(texto, saida, pref.vozWindows, pref.velocidade, pastaFerramentas)} (reserva: o Piper falhou — ${e instanceof Error ? e.message.slice(0, 120) : 'erro'})`
    }
  } else {
    descricao = await sintetizarWindows(texto, saida, pref.vozWindows, pref.velocidade, pastaFerramentas)
    if (pref.motor === 'piper') descricao += ' (reserva: o Piper não está instalado)'
  }
  const duracao = duracaoWav(readFileSync(saida))
  if (!duracao || duracao < 0.2) throw new ErroApp('voz', 'O áudio gerado ficou vazio.')
  return { descricao, duracao }
}
