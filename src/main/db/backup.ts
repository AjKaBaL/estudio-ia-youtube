import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Banco } from './conexao'

export const BACKUPS_MANTIDOS = 10

export interface InfoBackup {
  arquivo: string
  tamanhoBytes: number
  criadoEm: string
}

/** Cópia consistente do banco com VACUUM INTO (funciona com o banco aberto). Mantém os N mais recentes. */
export function criarBackup(db: Banco, pasta: string, motivo: 'manual' | 'antes-migracao'): InfoBackup {
  mkdirSync(pasta, { recursive: true })
  const carimbo = new Date().toISOString().replace(/[:.]/g, '-')
  const arquivo = `dados-${carimbo}-${motivo}.sqlite`
  const destino = join(pasta, arquivo)
  // O destino é montado só com valores gerados aqui; o parâmetro evita qualquer injeção.
  db.prepare('VACUUM INTO ?').run(destino)
  limparBackupsAntigos(pasta)
  const st = statSync(destino)
  return { arquivo, tamanhoBytes: st.size, criadoEm: st.mtime.toISOString() }
}

export function listarBackups(pasta: string): InfoBackup[] {
  if (!existsSync(pasta)) return []
  return readdirSync(pasta)
    .filter((n) => /^dados-.*\.sqlite$/.test(n))
    .map((n) => {
      const st = statSync(join(pasta, n))
      return { arquivo: n, tamanhoBytes: st.size, criadoEm: st.mtime.toISOString() }
    })
    .sort((a, b) => b.criadoEm.localeCompare(a.criadoEm) || b.arquivo.localeCompare(a.arquivo))
}

function limparBackupsAntigos(pasta: string): void {
  for (const b of listarBackups(pasta).slice(BACKUPS_MANTIDOS)) {
    rmSync(join(pasta, b.arquivo), { force: true })
  }
}
