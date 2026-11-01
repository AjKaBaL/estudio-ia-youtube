import { type Banco, agoraIso, executar, todos, um } from '../db/conexao'
import { ErroApp, naoEncontrado } from '../erros'
import { horariosDoHorizonte, validarAgendamento, type ConfigEditorial, type EntradaAgendada } from '@shared/editorial'
import { localParaUtc, somarDias } from '@shared/tempo'
import type { TipoVideo } from '@shared/dominio'
import type { Agendamento, HorarioLivre } from '@shared/tipos'

const SELECT = `
  SELECT c.id, c.projeto_id AS projetoId, c.roteiro_id AS roteiroId, c.titulo, c.tipo_video AS tipoVideo,
    c.inicio_utc AS inicioUtc, c.status, c.notas, r.status AS statusRoteiro
  FROM calendario_entradas c LEFT JOIN roteiros r ON r.id = c.roteiro_id`

export function listarAgenda(db: Banco, cfg: ConfigEditorial, de: string, ate: string): Agendamento[] {
  const inicio = localParaUtc(de, '00:00', cfg.agenda.fuso).toISOString()
  const fim = localParaUtc(somarDias(ate, 1), '00:00', cfg.agenda.fuso).toISOString()
  return todos<Agendamento>(
    db,
    `${SELECT} WHERE c.status <> 'cancelado' AND c.inicio_utc >= :inicio AND c.inicio_utc < :fim ORDER BY c.inicio_utc`,
    { inicio, fim }
  )
}

export function proximosAgendados(db: Banco, agora: Date, limite: number): Agendamento[] {
  return todos<Agendamento>(
    db,
    `${SELECT} WHERE c.status = 'planejado' AND c.inicio_utc >= :agora ORDER BY c.inicio_utc LIMIT :limite`,
    { agora: agora.toISOString(), limite }
  )
}

/** Horários ocupados: os planejados e os já enviados ao YouTube (que podem estar agendados para ir ao ar depois). */
function ativos(db: Banco): EntradaAgendada[] {
  return todos<EntradaAgendada>(
    db,
    `SELECT id, roteiro_id AS roteiroId, tipo_video AS tipoVideo, inicio_utc AS inicioUtc
     FROM calendario_entradas WHERE status IN ('planejado','publicado')`
  )
}

function obter(db: Banco, id: number): Agendamento {
  const a = um<Agendamento>(db, `${SELECT} WHERE c.id = :id`, { id })
  if (!a) throw naoEncontrado('Agendamento')
  return a
}

function verificar(
  db: Banco,
  cfg: ConfigEditorial,
  novo: { roteiroId: number | null; tipoVideo: TipoVideo; inicioUtc: string; ignorarId?: number },
  agora: Date
): void {
  const problemas = validarAgendamento(cfg, ativos(db), novo, agora)
  if (problemas.length) throw new ErroApp('agenda_invalida', problemas.map((p) => p.mensagem).join(' '))
}

export function agendar(
  db: Banco,
  cfg: ConfigEditorial,
  d: { projetoId: number; roteiroId: number | null; titulo: string; tipoVideo: TipoVideo; data: string; hora: string; notas: string },
  agora = new Date()
): Agendamento {
  if (d.roteiroId !== null) {
    const r = um<{ projetoId: number }>(db, 'SELECT projeto_id AS projetoId FROM roteiros WHERE id = :id', { id: d.roteiroId })
    if (!r) throw naoEncontrado('Roteiro')
    if (r.projetoId !== d.projetoId) throw new ErroApp('projeto_diferente', 'O roteiro pertence a outro projeto.')
  }
  const inicioUtc = localParaUtc(d.data, d.hora, cfg.agenda.fuso).toISOString()
  verificar(db, cfg, { roteiroId: d.roteiroId, tipoVideo: d.tipoVideo, inicioUtc }, agora)
  const t = agoraIso()
  const { id } = executar(
    db,
    `INSERT INTO calendario_entradas (projeto_id, roteiro_id, titulo, tipo_video, inicio_utc, notas, criado_em, atualizado_em)
     VALUES (:projetoId, :roteiroId, :titulo, :tipoVideo, :inicioUtc, :notas, :t, :t)`,
    { projetoId: d.projetoId, roteiroId: d.roteiroId, titulo: d.titulo, tipoVideo: d.tipoVideo, inicioUtc, notas: d.notas, t }
  )
  return obter(db, id)
}

export function reagendar(db: Banco, cfg: ConfigEditorial, id: number, data: string, hora: string, agora = new Date()): Agendamento {
  const atual = obter(db, id)
  if (atual.status !== 'planejado') throw new ErroApp('agenda_invalida', 'Só é possível reagendar itens planejados.')
  const inicioUtc = localParaUtc(data, hora, cfg.agenda.fuso).toISOString()
  verificar(db, cfg, { roteiroId: atual.roteiroId, tipoVideo: atual.tipoVideo, inicioUtc, ignorarId: id }, agora)
  executar(db, 'UPDATE calendario_entradas SET inicio_utc = :inicioUtc, atualizado_em = :t WHERE id = :id', { id, inicioUtc, t: agoraIso() })
  return obter(db, id)
}

/** Cancelar mantém o registro (histórico) e não apaga o roteiro. */
export function cancelarAgendamento(db: Banco, id: number): void {
  const r = executar(db, "UPDATE calendario_entradas SET status = 'cancelado', atualizado_em = :t WHERE id = :id AND status = 'planejado'", {
    id,
    t: agoraIso()
  })
  if (r.changes === 0) throw naoEncontrado('Agendamento planejado')
}

/** Horários do horizonte que ainda aceitam um novo item sem violar nenhuma regra. */
export function horariosLivres(db: Banco, cfg: ConfigEditorial, agora = new Date()): HorarioLivre[] {
  const existentes = ativos(db)
  return horariosDoHorizonte(cfg, agora).filter(
    (h) => validarAgendamento(cfg, existentes, { roteiroId: null, tipoVideo: h.tipoVideo, inicioUtc: h.inicioUtc }, agora).length === 0
  )
}
