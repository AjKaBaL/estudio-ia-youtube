import { type Banco, agoraIso, executar, todos } from '../db/conexao'
import { ErroApp, naoEncontrado } from '../erros'
import { horariosPesquisa, type ConfigEditorial } from '@shared/editorial'
import type { Tarefa } from '@shared/tipos'

export const TIPO_PESQUISA_AGENDADA = 'pesquisa_agendada'
/** Horário considerado "no prazo": até 3 minutos de atraso (o verificador roda a cada minuto). */
export const TOLERANCIA_MS = 3 * 60_000
/** Não recupera horários perdidos mais antigos que isto, para não gerar avalanche de tarefas. */
export const JANELA_RECUPERACAO_MS = 7 * 24 * 3600_000

export function listarTarefas(db: Banco, limite = 200): Tarefa[] {
  return todos<Tarefa>(
    db,
    `SELECT id, tipo, descricao, status, agendada_para AS agendadaPara, iniciada_em AS iniciadaEm,
       concluida_em AS concluidaEm, diagnostico, criado_em AS criadoEm
     FROM tarefas ORDER BY COALESCE(agendada_para, criado_em) DESC LIMIT :limite`,
    { limite }
  )
}

export function ignorarTarefa(db: Banco, id: number): void {
  const r = executar(
    db,
    "UPDATE tarefas SET status = 'ignorada', atualizado_em = :t WHERE id = :id AND status IN ('pendente','perdida','erro')",
    { id, t: agoraIso() }
  )
  if (r.changes === 0) throw naoEncontrado('Tarefa que possa ser ignorada')
}

/** Cancela uma tarefa que ainda está aguardando. */
export function cancelarTarefa(db: Banco, id: number): void {
  const r = executar(db, "UPDATE tarefas SET status = 'cancelada', diagnostico = 'Cancelada pelo usuário.', atualizado_em = :t WHERE id = :id AND status = 'pendente'", {
    id,
    t: agoraIso()
  })
  if (r.changes === 0) throw naoEncontrado('Tarefa aguardando')
}

/** Coloca de volta na fila uma tarefa com erro, perdida ou cancelada. */
export function repetirTarefa(db: Banco, id: number): void {
  const t = todos<{ tipo: string }>(db, 'SELECT tipo FROM tarefas WHERE id = :id', { id })[0]
  if (t?.tipo === 'geracao_roteiro') {
    throw new ErroApp('repetir_manual', 'Gerações de roteiro são refeitas pela tela do roteiro, porque podem exigir nova autorização de envio e custo.')
  }
  const r = executar(
    db,
    "UPDATE tarefas SET status = 'pendente', diagnostico = 'Reenviada pelo usuário.', atualizado_em = :t WHERE id = :id AND status IN ('erro','perdida','cancelada','ignorada')",
    { id, t: agoraIso() }
  )
  if (r.changes === 0) throw naoEncontrado('Tarefa que possa ser repetida')
}

export function contarPerdidas(db: Banco): number {
  return todos<{ n: number }>(db, "SELECT COUNT(*) AS n FROM tarefas WHERE status = 'perdida'")[0]?.n ?? 0
}

function inserir(db: Banco, status: string, descricao: string, agendadaPara: string | null, diagnostico: string | null): boolean {
  const t = agoraIso()
  // Recuperação (sem horário) não se acumula: só uma pendente por vez.
  if (agendadaPara === null && todos(db, "SELECT 1 FROM tarefas WHERE tipo = :tipo AND status = 'pendente' AND agendada_para IS NULL", { tipo: TIPO_PESQUISA_AGENDADA }).length) {
    return false
  }
  const r = executar(
    db,
    `INSERT OR IGNORE INTO tarefas (tipo, descricao, status, agendada_para, diagnostico, criado_em, atualizado_em)
     VALUES (:tipo, :descricao, :status, :agendadaPara, :diagnostico, :t, :t)`,
    { tipo: TIPO_PESQUISA_AGENDADA, descricao, status, agendadaPara, diagnostico, t }
  )
  return r.changes > 0
}

export interface ResultadoVerificacao {
  criadas: number
  perdidas: number
}

/**
 * Confere horários de pesquisa automática entre a última verificação e agora.
 * Horários no prazo viram tarefas pendentes. Horários em que o app estava fechado ficam
 * registrados como perdidos e recebem a política escolhida pelo usuário.
 */
export function verificarAgendaPesquisa(db: Banco, cfg: ConfigEditorial, agora: Date, ultimaVerificacao: Date | null): ResultadoVerificacao {
  if (!ultimaVerificacao) return { criadas: 0, perdidas: 0 } // primeira abertura: nada a recuperar
  const desde = new Date(Math.max(ultimaVerificacao.getTime(), agora.getTime() - JANELA_RECUPERACAO_MS))
  const horarios = horariosPesquisa(cfg, desde, agora)
  let criadas = 0
  const perdidas: Date[] = []
  for (const h of horarios) {
    const iso = h.toISOString()
    if (agora.getTime() - h.getTime() <= TOLERANCIA_MS) {
      if (inserir(db, 'pendente', 'Pesquisa agendada', iso, null)) criadas++
      continue
    }
    const politica = cfg.pesquisa.politicaPerdida
    const diag = {
      ignorar: 'O aplicativo estava fechado neste horário. Política: ignorar.',
      reagendar: 'O aplicativo estava fechado neste horário. Política: fazer no próximo horário programado.',
      executar_ao_abrir: 'O aplicativo estava fechado neste horário. Política: executar ao abrir.'
    }[politica]
    const status = politica === 'ignorar' ? 'ignorada' : 'perdida'
    if (inserir(db, status, 'Pesquisa agendada (horário perdido)', iso, diag)) perdidas.push(h)
  }
  if (perdidas.length && cfg.pesquisa.politicaPerdida === 'executar_ao_abrir') {
    // Uma única execução de recuperação, mesmo que vários horários tenham sido perdidos.
    if (inserir(db, 'pendente', `Recuperação de ${perdidas.length} pesquisa(s) perdida(s)`, null, null)) criadas++
  }
  return { criadas, perdidas: perdidas.length }
}
