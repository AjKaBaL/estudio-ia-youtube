import { type Banco, todos } from '../db/conexao'
import { proximosAgendados } from './agenda'
import { lerEditorial } from './editorial'
import { buscarRoteiros, listarPorStatus } from './roteiros'
import { contarPerdidas } from './tarefas'
import { alertasCapacidade } from '@shared/editorial'
import { filtroRoteirosSchema } from '@shared/schemas'
import type { ExecucaoPesquisa, ServicoStatus, VisaoGeral } from '@shared/tipos'

/** Monta a Visão geral apenas com dados reais do banco e dos serviços. */
export function obterVisaoGeral(db: Banco, servicos: ServicoStatus[], agora = new Date()): VisaoGeral {
  const cfg = lerEditorial(db)
  const temProjetos = (todos<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM projetos')[0]?.n ?? 0) > 0
  const pesquisas = todos<ExecucaoPesquisa>(
    db,
    `SELECT id, consulta, status, origem, intervalo_de AS intervaloDe, intervalo_ate AS intervaloAte,
       iniciada_em AS iniciadaEm, concluida_em AS concluidaEm, mensagem_erro AS mensagemErro
     FROM execucoes_pesquisa WHERE status IN ('pendente','em_andamento','erro')
     ORDER BY criado_em DESC LIMIT 5`
  )
  const alertas = alertasCapacidade(cfg)
  if (cfg.agenda.pausada) alertas.unshift('A agenda de publicação está pausada.')
  return {
    temProjetos,
    proximos: proximosAgendados(db, agora, 6),
    aguardandoRevisao: listarPorStatus(db, 'em_revisao', 5),
    pesquisas,
    recentes: buscarRoteiros(db, filtroRoteirosSchema.parse({ limite: 5 })),
    servicos,
    tarefasPerdidas: contarPerdidas(db),
    alertasAgenda: alertas
  }
}
