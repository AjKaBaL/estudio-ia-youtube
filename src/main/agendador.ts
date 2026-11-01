import type { Banco } from './db/conexao'
import { registrarEvento } from './db/eventos'
import { processarFilaPesquisa } from './pesquisa/agendadas'
import type { GerenciadorPesquisas } from './pesquisa/executor'
import { gravarConfig, lerConfig } from './repositorios/configuracoes'
import { lerEditorial } from './repositorios/editorial'
import { verificarAgendaPesquisa } from './repositorios/tarefas'
import { automacaoPausada } from './producao/fila'

const CHAVE_ULTIMA = 'agenda.ultimaVerificacao'
const INTERVALO_MS = 60_000

/** Uma rodada do verificador: registra execuções no prazo e perdidas, e guarda o momento da verificação. */
export function rodadaAgendador(db: Banco, agora = new Date()): void {
  // Pausa global: nenhum horário é processado; ao retomar, nada se acumula.
  if (automacaoPausada(db)) {
    gravarConfig(db, CHAVE_ULTIMA, agora.toISOString())
    return
  }
  const ultimaIso = lerConfig<string>(db, CHAVE_ULTIMA)
  const ultima = ultimaIso ? new Date(ultimaIso) : null
  const r = verificarAgendaPesquisa(db, lerEditorial(db), agora, ultima && !Number.isNaN(ultima.getTime()) ? ultima : null)
  if (r.perdidas > 0) registrarEvento(db, 'aviso', 'agenda', `${r.perdidas} pesquisa(s) agendada(s) perdida(s) com o aplicativo fechado.`)
  gravarConfig(db, CHAVE_ULTIMA, agora.toISOString())
}

/** Só roda com o aplicativo aberto; não há serviço em segundo plano no Windows. */
export function iniciarAgendador(db: Banco, pesquisas: GerenciadorPesquisas, aCadaMinuto: () => void = () => undefined): () => void {
  const rodar = (): void => {
    try {
      rodadaAgendador(db)
      if (!automacaoPausada(db)) {
        void processarFilaPesquisa(db, pesquisas)
        aCadaMinuto()
      }
    } catch (e) {
      registrarEvento(db, 'erro', 'agenda', e instanceof Error ? e.message : String(e))
    }
  }
  rodar()
  const t = setInterval(rodar, INTERVALO_MS)
  return () => clearInterval(t)
}
