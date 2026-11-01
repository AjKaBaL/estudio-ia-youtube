import { DatabaseSync, type SQLInputValue } from 'node:sqlite'

export type Banco = DatabaseSync
export type Parametros = Record<string, SQLInputValue>

export function abrirBanco(caminho: string): Banco {
  const db = new DatabaseSync(caminho)
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA busy_timeout = 5000')
  db.exec('PRAGMA secure_delete = ON')
  if (caminho !== ':memory:') db.exec('PRAGMA journal_mode = WAL')
  // Busca sem diferenciar acentos e maiúsculas: normalizar('Inteligência') = 'inteligencia'.
  db.function('normalizar', { deterministic: true }, (v) => (typeof v === 'string' ? normalizarTexto(v) : null))
  return db
}

export function normalizarTexto(texto: string): string {
  return texto.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR')
}

export function agoraIso(): string {
  return new Date().toISOString()
}

/** Executa a função dentro de uma transação; desfaz tudo em caso de erro. Suporta aninhamento. */
export function transacao<T>(db: Banco, fn: () => T): T {
  if (db.isTransaction) return fn()
  db.exec('BEGIN IMMEDIATE')
  try {
    const r = fn()
    db.exec('COMMIT')
    return r
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

export function todos<T>(db: Banco, sql: string, p: Parametros = {}): T[] {
  return db.prepare(sql).all(p) as T[]
}

export function um<T>(db: Banco, sql: string, p: Parametros = {}): T | undefined {
  return db.prepare(sql).get(p) as T | undefined
}

export function executar(db: Banco, sql: string, p: Parametros = {}): { changes: number; id: number } {
  const r = db.prepare(sql).run(p)
  return { changes: Number(r.changes), id: Number(r.lastInsertRowid) }
}

/** Escapa curingas para uso em LIKE ... ESCAPE '\'. */
export function padraoLike(texto: string): string {
  return `%${texto.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
}
