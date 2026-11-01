import { type Banco, agoraIso, executar, todos, um } from '../db/conexao'
import { naoEncontrado } from '../erros'
import type { CategoriaLink } from '@shared/publicacao'
import type { LinkCadastrado } from '@shared/tipos'

/** Links reutilizáveis nas descrições: redes sociais, produtos, afiliados, patrocínio. Sem projeto = vale para todos. */

const SELECT = `SELECT id, projeto_id AS projetoId, nome, url, categoria, descricao, padrao, ativo, criado_em AS criadoEm, atualizado_em AS atualizadoEm FROM links`
type Linha = Omit<LinkCadastrado, 'padrao' | 'ativo'> & { padrao: number; ativo: number }
const paraLink = (l: Linha): LinkCadastrado => ({ ...l, padrao: Boolean(l.padrao), ativo: Boolean(l.ativo) })

const ORDEM = `ORDER BY CASE categoria WHEN 'rede_social' THEN 1 WHEN 'site' THEN 2 WHEN 'produto' THEN 3 WHEN 'afiliado' THEN 4 WHEN 'patrocinio' THEN 5 ELSE 6 END, nome COLLATE NOCASE`

/** Links do projeto e os globais (sem projeto). */
export function listarLinks(db: Banco, projetoId: number | null): LinkCadastrado[] {
  return todos<Linha>(db, `${SELECT} WHERE projeto_id IS NULL OR projeto_id = :p ${ORDEM}`, { p: projetoId }).map(paraLink)
}

export function obterLink(db: Banco, id: number): LinkCadastrado {
  const l = um<Linha>(db, `${SELECT} WHERE id = :id`, { id })
  if (!l) throw naoEncontrado('Link')
  return paraLink(l)
}

export interface DadosLink {
  id?: number
  projetoId: number | null
  nome: string
  url: string
  categoria: CategoriaLink
  descricao: string
  padrao: boolean
  ativo: boolean
}

export function salvarLink(db: Banco, d: DadosLink): LinkCadastrado {
  const t = agoraIso()
  const v = { p: d.projetoId, nome: d.nome, url: d.url, cat: d.categoria, desc: d.descricao, padrao: d.padrao ? 1 : 0, ativo: d.ativo ? 1 : 0, t }
  if (d.id) {
    const r = executar(
      db,
      'UPDATE links SET projeto_id = :p, nome = :nome, url = :url, categoria = :cat, descricao = :desc, padrao = :padrao, ativo = :ativo, atualizado_em = :t WHERE id = :id',
      { ...v, id: d.id }
    )
    if (r.changes === 0) throw naoEncontrado('Link')
    return obterLink(db, d.id)
  }
  const { id } = executar(db, 'INSERT INTO links (projeto_id, nome, url, categoria, descricao, padrao, ativo, criado_em, atualizado_em) VALUES (:p, :nome, :url, :cat, :desc, :padrao, :ativo, :t, :t)', v)
  return obterLink(db, id)
}

export function removerLink(db: Banco, id: number): void {
  if (executar(db, 'DELETE FROM links WHERE id = :id', { id }).changes === 0) throw naoEncontrado('Link')
}

/** Links marcados como "incluir sempre" e ativos, para descrições automáticas. */
export function linksPadrao(db: Banco, projetoId: number | null): LinkCadastrado[] {
  return listarLinks(db, projetoId).filter((l) => l.ativo && l.padrao)
}
