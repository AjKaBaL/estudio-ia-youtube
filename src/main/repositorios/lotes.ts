import { type Banco, agoraIso, executar, todos, transacao, um } from '../db/conexao'
import { ErroApp, naoEncontrado } from '../erros'
import { lerEditorial } from './editorial'
import { listarPautas, obterPauta } from './pautas'
import { dataLocal, inicioSemana, somarDias } from '@shared/tempo'
import type { Lote, LoteDetalhe } from '@shared/tipos'

const SELECT = `
  SELECT l.id, l.projeto_id AS projetoId, l.nome, l.inicio, l.fim, l.meta_longos AS metaLongos, l.meta_shorts AS metaShorts, l.status,
    l.criado_em AS criadoEm, (SELECT COUNT(*) FROM lote_pautas lp WHERE lp.lote_id = l.id) AS totalPautas,
    (SELECT COUNT(*) FROM lote_pautas lp WHERE lp.lote_id = l.id AND lp.selecionada = 1) AS selecionadas
  FROM lotes l`

export function listarLotes(db: Banco, projetoId: number): Lote[] {
  return todos<Lote>(db, `${SELECT} WHERE l.projeto_id = :p ORDER BY l.inicio DESC, l.id DESC`, { p: projetoId })
}

export function obterLote(db: Banco, id: number): LoteDetalhe {
  const l = um<Lote>(db, `${SELECT} WHERE l.id = :id`, { id })
  if (!l) throw naoEncontrado('Lote')
  const itens = todos<{ pautaId: number; selecionada: number }>(db, 'SELECT pauta_id AS pautaId, selecionada FROM lote_pautas WHERE lote_id = :id', { id })
  const pautas = itens
    .map((i) => {
      const { avaliacao, fontes: _f, ...p } = obterPauta(db, i.pautaId)
      return { ...p, selecionada: Boolean(i.selecionada), tipoEfetivo: avaliacao.tipoSugerido.tipo }
    })
    .sort((a, b) => b.pontuacao - a.pontuacao)
  const sel = pautas.filter((p) => p.selecionada)
  const alertas: string[] = []
  const longos = sel.filter((p) => p.tipoEfetivo === 'longo').length
  const shorts = sel.filter((p) => p.tipoEfetivo === 'short').length
  if (longos > l.metaLongos) alertas.push(`Selecionados ${longos} vídeos longos para uma meta de ${l.metaLongos}.`)
  if (shorts > l.metaShorts) alertas.push(`Selecionados ${shorts} Shorts para uma meta de ${l.metaShorts}.`)
  return { ...l, pautas, selecaoLongos: longos, selecaoShorts: shorts, alertas }
}

export function criarLote(db: Banco, d: { projetoId: number; nome: string; inicio: string; fim: string; metaLongos: number; metaShorts: number }): LoteDetalhe {
  if (d.inicio > d.fim) throw new ErroApp('datas', 'A data final deve ser depois da inicial.')
  const t = agoraIso()
  const { id } = executar(
    db,
    `INSERT INTO lotes (projeto_id, nome, inicio, fim, meta_longos, meta_shorts, criado_em, atualizado_em)
     VALUES (:projetoId, :nome, :inicio, :fim, :metaLongos, :metaShorts, :t, :t)`,
    { ...d, t }
  )
  return obterLote(db, id)
}

/**
 * Lista semanal: reúne as pautas criadas na semana (seg–dom) que não foram descartadas
 * nem combinadas. A meta segue a agenda (padrão: 1 vídeo longo e 3 Shorts).
 */
export function gerarLoteSemanal(db: Banco, projetoId: number, agora = new Date()): LoteDetalhe {
  const cfg = lerEditorial(db)
  const hoje = dataLocal(agora, cfg.agenda.fuso)
  const inicio = inicioSemana(hoje)
  const fim = somarDias(inicio, 6)
  return transacao(db, () => {
    const lote = criarLote(db, {
      projetoId,
      nome: `Semana de ${inicio.slice(8, 10)}/${inicio.slice(5, 7)}`,
      inicio,
      fim,
      metaLongos: cfg.agenda.formatos.longo.limiteSemanal,
      metaShorts: cfg.agenda.formatos.short.limiteSemanal
    })
    const candidatas = listarPautas(db, { texto: '', status: null }, agora).filter(
      (p) => p.projetoId === projetoId && p.status !== 'descartada' && dataLocal(new Date(p.criadoEm), cfg.agenda.fuso) >= inicio && dataLocal(new Date(p.criadoEm), cfg.agenda.fuso) <= fim
    )
    for (const p of candidatas) executar(db, 'INSERT OR IGNORE INTO lote_pautas (lote_id, pauta_id) VALUES (:l, :p)', { l: lote.id, p: p.id })
    return obterLote(db, lote.id)
  })
}

export function adicionarAoLote(db: Banco, loteId: number, pautaId: number): LoteDetalhe {
  const l = obterLote(db, loteId)
  if (l.status === 'fechado') throw new ErroApp('lote_fechado', 'Este lote está fechado.')
  if (obterPauta(db, pautaId).projetoId !== l.projetoId) throw new ErroApp('projeto_diferente', 'A pauta é de outro projeto.')
  executar(db, 'INSERT OR IGNORE INTO lote_pautas (lote_id, pauta_id) VALUES (:l, :p)', { l: loteId, p: pautaId })
  return obterLote(db, loteId)
}

export function removerDoLote(db: Banco, loteId: number, pautaId: number): LoteDetalhe {
  executar(db, 'DELETE FROM lote_pautas WHERE lote_id = :l AND pauta_id = :p', { l: loteId, p: pautaId })
  return obterLote(db, loteId)
}

export function selecionarNoLote(db: Banco, loteId: number, pautaId: number, selecionada: boolean): LoteDetalhe {
  if (obterLote(db, loteId).status === 'fechado') throw new ErroApp('lote_fechado', 'Este lote está fechado.')
  if (executar(db, 'UPDATE lote_pautas SET selecionada = :s WHERE lote_id = :l AND pauta_id = :p', { l: loteId, p: pautaId, s: selecionada ? 1 : 0 }).changes === 0) {
    throw naoEncontrado('Pauta no lote')
  }
  return obterLote(db, loteId)
}

export function fecharLote(db: Banco, id: number, fechado: boolean): LoteDetalhe {
  if (executar(db, 'UPDATE lotes SET status = :s, atualizado_em = :t WHERE id = :id', { id, s: fechado ? 'fechado' : 'aberto', t: agoraIso() }).changes === 0) throw naoEncontrado('Lote')
  return obterLote(db, id)
}

export function excluirLote(db: Banco, id: number): void {
  if (executar(db, 'DELETE FROM lotes WHERE id = :id', { id }).changes === 0) throw naoEncontrado('Lote')
}
