import { type Banco, agoraIso, executar, todos, transacao, um } from '../db/conexao'
import { ErroApp, naoEncontrado } from '../erros'
import { obterRoteiro } from '../repositorios/roteiros'
import { corrigirLinhaDoTempo, estadoEdicaoSchema, estadoInicial, type EstadoEdicao, type Formato } from '@shared/edicao'
import type { ProjetoEdicao } from '@shared/tipos'

/** Projetos de edição com salvamento automático e cópias para recuperação (Etapa 11). */

const SNAPSHOTS_MANTIDOS = 30

/** Corrige sobreposições e buracos da linha do tempo (sabe quais mídias são imagens pela biblioteca). */
export function corrigirEstado(db: Banco, estado: EstadoEdicao): { estado: EstadoEdicao; correcoes: string[] } {
  const ids = [...new Set(estado.clips.map((c) => c.recursoId).filter((x): x is number => x !== null))]
  const imagens = new Set(
    ids.length ? todos<{ id: number }>(db, `SELECT id FROM recursos_midia WHERE tipo = 'imagem' AND id IN (${ids.map(Number).join(',')})`).map((x) => x.id) : []
  )
  return corrigirLinhaDoTempo(estado, imagens)
}

type Linha = { id: number; roteiroId: number; roteiroTitulo: string; nome: string; formato: Formato; estado: string; revisao: number; criadoEm: string; atualizadoEm: string }
const SELECT = `
  SELECT e.id, e.roteiro_id AS roteiroId, r.titulo AS roteiroTitulo, e.nome, e.formato, e.estado, e.revisao,
    e.criado_em AS criadoEm, e.atualizado_em AS atualizadoEm
  FROM projetos_edicao e JOIN roteiros r ON r.id = e.roteiro_id`

function paraProjeto(l: Linha): ProjetoEdicao {
  return { ...l, estado: estadoEdicaoSchema.parse(JSON.parse(l.estado)) }
}

export function listarEdicoes(db: Banco): Omit<ProjetoEdicao, 'estado'>[] {
  return todos<Linha>(db, `${SELECT} ORDER BY e.atualizado_em DESC`).map(({ estado: _e, ...resto }) => resto)
}

export function obterEdicao(db: Banco, id: number): ProjetoEdicao {
  const l = um<Linha>(db, `${SELECT} WHERE e.id = :id`, { id })
  if (!l) throw naoEncontrado('Projeto de edição')
  return paraProjeto(l)
}

export function criarEdicao(db: Banco, roteiroId: number, formato: Formato | null): ProjetoEdicao {
  const r = obterRoteiro(db, roteiroId)
  const f = formato ?? (r.tipoVideo === 'short' ? '9:16' : '16:9')
  const estado = estadoInicial(r.conteudo, f)
  const t = agoraIso()
  const { id } = executar(db, 'INSERT INTO projetos_edicao (roteiro_id, nome, formato, estado, criado_em, atualizado_em) VALUES (:r, :n, :f, :e, :t, :t)', {
    r: roteiroId,
    n: `${r.titulo} (${f})`.slice(0, 200),
    f,
    e: JSON.stringify(estado),
    t
  })
  return obterEdicao(db, id)
}

/** Salva o estado (validado). Recusa sobrescrever se outra janela salvou antes. Guarda uma cópia para recuperação. */
export function salvarEdicao(db: Banco, id: number, revisaoBase: number, estado: EstadoEdicao): { revisao: number; salvoEm: string } {
  const valido = estadoEdicaoSchema.parse(estado)
  return transacao(db, () => {
    const atual = um<{ revisao: number }>(db, 'SELECT revisao FROM projetos_edicao WHERE id = :id', { id })
    if (!atual) throw naoEncontrado('Projeto de edição')
    if (atual.revisao !== revisaoBase) throw new ErroApp('conflito_versao', 'O projeto foi salvo em outro lugar. Reabra para continuar.')
    const revisao = atual.revisao + 1
    const t = agoraIso()
    executar(db, 'UPDATE projetos_edicao SET estado = :e, formato = :f, revisao = :r, atualizado_em = :t WHERE id = :id', { id, e: JSON.stringify(valido), f: valido.formato, r: revisao, t })
    executar(db, 'INSERT INTO edicao_snapshots (edicao_id, revisao, estado, criado_em) VALUES (:id, :r, :e, :t)', { id, r: revisao, e: JSON.stringify(valido), t })
    executar(db, 'DELETE FROM edicao_snapshots WHERE edicao_id = :id AND id NOT IN (SELECT id FROM edicao_snapshots WHERE edicao_id = :id ORDER BY id DESC LIMIT :n)', { id, n: SNAPSHOTS_MANTIDOS })
    return { revisao, salvoEm: t }
  })
}

export function listarSnapshots(db: Banco, id: number): { id: number; revisao: number; criadoEm: string; clips: number }[] {
  return todos<{ id: number; revisao: number; criadoEm: string; estado: string }>(
    db,
    'SELECT id, revisao, criado_em AS criadoEm, estado FROM edicao_snapshots WHERE edicao_id = :id ORDER BY id DESC',
    { id }
  ).map(({ estado, ...s }) => ({ ...s, clips: (JSON.parse(estado) as EstadoEdicao).clips.length }))
}

/** Restaura uma cópia anterior como nova revisão (a revisão atual continua nas cópias). */
export function restaurarSnapshot(db: Banco, edicaoId: number, snapshotId: number): ProjetoEdicao {
  const s = um<{ estado: string }>(db, 'SELECT estado FROM edicao_snapshots WHERE id = :s AND edicao_id = :e', { s: snapshotId, e: edicaoId })
  if (!s) throw naoEncontrado('Cópia')
  const atual = obterEdicao(db, edicaoId)
  salvarEdicao(db, edicaoId, atual.revisao, estadoEdicaoSchema.parse(JSON.parse(s.estado)))
  return obterEdicao(db, edicaoId)
}

export function excluirEdicao(db: Banco, id: number): void {
  if (executar(db, 'DELETE FROM projetos_edicao WHERE id = :id', { id }).changes === 0) throw naoEncontrado('Projeto de edição')
}
