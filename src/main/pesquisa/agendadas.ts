import { type Banco, agoraIso, executar, um } from '../db/conexao'
import { lerOpcoesPesquisa } from '../repositorios/pesquisa'
import { TIPO_PESQUISA_AGENDADA } from '../repositorios/tarefas'
import { consultaDaPauta, TIPO_PESQUISA_PAUTA } from '../repositorios/pautas'
import type { GerenciadorPesquisas } from './executor'

/**
 * Executa, uma de cada vez, as tarefas de pesquisa agendada que estão aguardando.
 * A consulta usa os "termos monitorados" configurados pelo usuário.
 */
export function processarFilaPesquisa(db: Banco, gerenciador: GerenciadorPesquisas): Promise<void> | null {
  if (gerenciador.emAndamento() !== null) return null
  const tarefa = um<{ id: number; tipo: string; referencia_id: number | null }>(
    db,
    `SELECT id, tipo, referencia_id FROM tarefas WHERE tipo IN (:agendada, :pauta) AND status = 'pendente'
     ORDER BY COALESCE(agendada_para, criado_em) LIMIT 1`,
    { agendada: TIPO_PESQUISA_AGENDADA, pauta: TIPO_PESQUISA_PAUTA }
  )
  if (!tarefa) return null
  const falhar = (diagnostico: string): null => {
    executar(db, "UPDATE tarefas SET status = 'erro', diagnostico = :d, concluida_em = :t, atualizado_em = :t WHERE id = :id", {
      id: tarefa.id,
      d: diagnostico,
      t: agoraIso()
    })
    return null
  }
  let alvo: { projetoId: number; consulta: string; pautaId: number | null }
  if (tarefa.tipo === TIPO_PESQUISA_PAUTA) {
    if (!tarefa.referencia_id || !um(db, 'SELECT 1 FROM pautas WHERE id = :id', { id: tarefa.referencia_id })) return falhar('A pauta não existe mais.')
    alvo = { ...consultaDaPauta(db, tarefa.referencia_id), pautaId: tarefa.referencia_id }
  } else {
    const termos = lerOpcoesPesquisa(db).termosMonitorados
    if (termos.length === 0) return falhar('Nenhum termo monitorado configurado (Pautas e pesquisas › Fontes e opções).')
    const projeto = um<{ id: number }>(db, 'SELECT id FROM projetos WHERE arquivado_em IS NULL ORDER BY id LIMIT 1')
    if (!projeto) return falhar('Nenhum projeto criado.')
    alvo = { projetoId: projeto.id, consulta: termos.join(', '), pautaId: null }
  }

  const { id, termino } = gerenciador.iniciar({ ...alvo, origem: 'agendada' })
  executar(db, "UPDATE tarefas SET status = 'em_andamento', iniciada_em = :t, execucao_pesquisa_id = :e, atualizado_em = :t WHERE id = :id", {
    id: tarefa.id,
    e: id,
    t: agoraIso()
  })
  return termino.then(() => {
    if (alvo.pautaId) executar(db, 'UPDATE pautas SET na_fila_pesquisa = 0 WHERE id = :id', { id: alvo.pautaId })
    const ex = um<{ status: string; mensagem_erro: string | null; total_resultados: number }>(
      db,
      'SELECT status, mensagem_erro, total_resultados FROM execucoes_pesquisa WHERE id = :id',
      { id }
    )
    const ok = ex?.status === 'concluida'
    executar(db, 'UPDATE tarefas SET status = :s, diagnostico = :d, concluida_em = :t, atualizado_em = :t WHERE id = :id', {
      id: tarefa.id,
      s: ok ? 'concluida' : ex?.status === 'cancelada' ? 'cancelada' : 'erro',
      d: ok ? `Pesquisa nº ${id}: ${ex?.total_resultados ?? 0} resultado(s).${ex?.mensagem_erro ? ` ${ex.mensagem_erro}` : ''}` : `Pesquisa nº ${id}: ${ex?.mensagem_erro ?? 'falhou'}`,
      t: agoraIso()
    })
  })
}
