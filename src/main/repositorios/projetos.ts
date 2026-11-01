import { type Banco, agoraIso, executar, todos, um } from '../db/conexao'
import { ErroApp, naoEncontrado } from '../erros'
import type { Projeto } from '@shared/tipos'

const SELECT = `
  SELECT p.id, p.nome, p.descricao, p.criado_em AS criadoEm, p.atualizado_em AS atualizadoEm,
    (SELECT COUNT(*) FROM roteiros r WHERE r.projeto_id = p.id) AS totalRoteiros,
    (SELECT COUNT(*) FROM pautas a WHERE a.projeto_id = p.id) AS totalPautas
  FROM projetos p`

export function listarProjetos(db: Banco): Projeto[] {
  return todos<Projeto>(db, `${SELECT} WHERE p.arquivado_em IS NULL ORDER BY p.nome COLLATE NOCASE`)
}

export function obterProjeto(db: Banco, id: number): Projeto {
  const p = um<Projeto>(db, `${SELECT} WHERE p.id = :id`, { id })
  if (!p) throw naoEncontrado('Projeto')
  return p
}

export function criarProjeto(db: Banco, d: { nome: string; descricao: string }): Projeto {
  const agora = agoraIso()
  const { id } = executar(
    db,
    'INSERT INTO projetos (nome, descricao, criado_em, atualizado_em) VALUES (:nome, :descricao, :agora, :agora)',
    { ...d, agora }
  )
  return obterProjeto(db, id)
}

export function atualizarProjeto(db: Banco, d: { id: number; nome: string; descricao: string }): Projeto {
  const r = executar(db, 'UPDATE projetos SET nome = :nome, descricao = :descricao, atualizado_em = :agora WHERE id = :id', {
    ...d,
    agora: agoraIso()
  })
  if (r.changes === 0) throw naoEncontrado('Projeto')
  return obterProjeto(db, d.id)
}

/** Só exclui projeto vazio, para nunca apagar roteiros ou pautas em cascata por engano. */
export function excluirProjeto(db: Banco, id: number): void {
  const p = obterProjeto(db, id)
  if (p.totalRoteiros > 0 || p.totalPautas > 0) {
    throw new ErroApp(
      'projeto_em_uso',
      `O projeto tem ${p.totalRoteiros} roteiro(s) e ${p.totalPautas} pauta(s). Exclua ou mova esses itens antes.`
    )
  }
  executar(db, 'DELETE FROM projetos WHERE id = :id', { id })
}
