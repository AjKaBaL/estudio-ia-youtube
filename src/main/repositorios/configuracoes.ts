import { type Banco, agoraIso, executar, um } from '../db/conexao'
import { ErroApp } from '../erros'

/**
 * Configurações NÃO secretas. Chaves que parecem segredo são recusadas: credenciais
 * terão um cofre próprio, criptografado pelo Windows, separado do banco.
 */
const PARECE_SEGREDO = /(senha|password|token|secret|segredo|api[_-]?key|chave[_-]?api|credencial|oauth)/i

export function lerConfig<T>(db: Banco, chave: string): T | null {
  const r = um<{ valor: string }>(db, 'SELECT valor FROM configuracoes WHERE chave = :chave', { chave })
  if (!r) return null
  try {
    return JSON.parse(r.valor) as T
  } catch {
    return null
  }
}

export function gravarConfig(db: Banco, chave: string, valor: unknown): void {
  if (PARECE_SEGREDO.test(chave)) {
    throw new ErroApp('config_secreta', 'Credenciais não podem ser gravadas nas configurações comuns.')
  }
  executar(
    db,
    `INSERT INTO configuracoes (chave, valor, atualizado_em) VALUES (:chave, :valor, :agora)
     ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor, atualizado_em = excluded.atualizado_em`,
    { chave, valor: JSON.stringify(valor), agora: agoraIso() }
  )
}
