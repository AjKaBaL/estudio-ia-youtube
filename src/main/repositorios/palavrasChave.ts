import { type Banco, executar, todos, um } from '../db/conexao'

type Alvo = { tabela: 'roteiro_palavras_chave'; coluna: 'roteiro_id' } | { tabela: 'pauta_palavras_chave'; coluna: 'pauta_id' }

export const ALVO_ROTEIRO: Alvo = { tabela: 'roteiro_palavras_chave', coluna: 'roteiro_id' }
export const ALVO_PAUTA: Alvo = { tabela: 'pauta_palavras_chave', coluna: 'pauta_id' }

/** Substitui as palavras-chave de um item. Tabela e coluna vêm de constantes, nunca da interface. */
export function definirPalavrasChave(db: Banco, alvo: Alvo, id: number, termos: readonly string[]): void {
  executar(db, `DELETE FROM ${alvo.tabela} WHERE ${alvo.coluna} = :id`, { id })
  for (const termo of termos) {
    executar(db, 'INSERT INTO palavras_chave (termo) VALUES (:termo) ON CONFLICT(termo) DO NOTHING', { termo })
    const k = um<{ id: number }>(db, 'SELECT id FROM palavras_chave WHERE termo = :termo', { termo })
    if (k) executar(db, `INSERT OR IGNORE INTO ${alvo.tabela} (${alvo.coluna}, palavra_chave_id) VALUES (:id, :k)`, { id, k: k.id })
  }
}

export function palavrasChaveDe(db: Banco, alvo: Alvo, id: number): string[] {
  return todos<{ termo: string }>(
    db,
    `SELECT k.termo FROM ${alvo.tabela} x JOIN palavras_chave k ON k.id = x.palavra_chave_id
     WHERE x.${alvo.coluna} = :id ORDER BY k.termo COLLATE NOCASE`,
    { id }
  ).map((r) => r.termo)
}

/** Converte a coluna agregada (separador \x1f) em lista. */
export function separarPalavras(agregado: string | null): string[] {
  return agregado ? agregado.split('\x1f').sort((a, b) => a.localeCompare(b, 'pt-BR')) : []
}
