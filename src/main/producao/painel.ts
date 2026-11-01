import { type Banco, agoraIso, executar, todos, transacao, um } from '../db/conexao'
import { registrarEvento } from '../db/eventos'
import { ErroApp, naoEncontrado } from '../erros'
import { agendar, horariosLivres, reagendar } from '../repositorios/agenda'
import { lerEditorial, salvarEditorial } from '../repositorios/editorial'
import { alterarStatusPauta, listarPautas, obterPauta } from '../repositorios/pautas'
import { automacaoPausada, montarFila } from './fila'
import { aplicarFrequencia, horaPrincipal } from '@shared/editorial'
import type { TipoVideo } from '@shared/dominio'
import type { Agendamento, PainelAdmin, TemaProximo } from '@shared/tipos'

/**
 * Painel do administrador: os próximos vídeos (agenda) e os próximos temas (pautas ainda não agendadas),
 * com ações de adiantar, adiar, agendar e mudar a frequência. Tudo por regras fixas; nada é publicado daqui.
 */

const TIPOS: readonly TipoVideo[] = ['longo', 'short']

/** Pautas ainda não agendadas, na ordem em que devem virar vídeo: prioridade manual, aprovadas, nota. */
export function proximosTemas(db: Banco, limite = 20, agora = new Date()): TemaProximo[] {
  const agendadas = new Set(
    todos<{ pautaId: number }>(
      db,
      `SELECT COALESCE(c.pauta_id, r.pauta_id) AS pautaId FROM calendario_entradas c LEFT JOIN roteiros r ON r.id = c.roteiro_id
       WHERE c.status IN ('planejado', 'publicado') AND COALESCE(c.pauta_id, r.pauta_id) IS NOT NULL`
    ).map((x) => x.pautaId)
  )
  const roteiros = new Map(
    todos<{ pautaId: number; id: number }>(db, 'SELECT pauta_id AS pautaId, MAX(id) AS id FROM roteiros WHERE pauta_id IS NOT NULL GROUP BY pauta_id').map((r) => [r.pautaId, r.id])
  )
  return listarPautas(db, { texto: '', status: null }, agora)
    .filter((p) => p.status !== 'descartada' && !agendadas.has(p.id))
    .sort((a, b) => b.prioridade - a.prioridade || Number(b.status === 'aprovada') - Number(a.status === 'aprovada') || b.pontuacao - a.pontuacao || a.id - b.id)
    .slice(0, limite)
    .map((p) => ({
      id: p.id,
      titulo: p.titulo,
      status: p.status,
      tipoVideo: p.tipoSugerido ?? 'longo',
      prioridade: p.prioridade,
      pontuacao: p.pontuacao,
      riscosAltos: p.riscosAltos,
      origem: p.origem,
      roteiroId: roteiros.get(p.id) ?? null,
      criadoEm: p.criadoEm
    }))
}

export function painelAdmin(db: Banco, agora = new Date()): PainelAdmin {
  const cfg = lerEditorial(db)
  const livres = horariosLivres(db, cfg, agora)
  const conta = (sql: string): number => um<{ n: number }>(db, sql)?.n ?? 0
  return {
    videos: montarFila(db, agora).sort((a, b) => a.inicioUtc.localeCompare(b.inicioUtc)).slice(0, 30),
    temas: proximosTemas(db, 20, agora),
    frequencia: Object.fromEntries(
      TIPOS.map((t) => {
        const f = cfg.agenda.formatos[t]
        return [t, { porSemana: f.pausado ? 0 : f.limiteSemanal, hora: horaPrincipal(f), dias: [...new Set(f.horarios.map((h) => h.dia))].sort(), pausado: f.pausado }]
      })
    ) as PainelAdmin['frequencia'],
    livres: { longo: livres.filter((h) => h.tipoVideo === 'longo').length, short: livres.filter((h) => h.tipoVideo === 'short').length },
    horizonteDias: cfg.horizonteDias,
    sugestoesFontes: conta("SELECT COUNT(*) AS n FROM sugestoes_fontes WHERE status = 'pendente'"),
    fontesAtivas: conta('SELECT COUNT(*) AS n FROM fontes_pesquisa WHERE ativo = 1'),
    pausaGlobal: automacaoPausada(db),
    agendaPausada: cfg.agenda.pausada
  }
}

export function priorizarTema(db: Banco, id: number, delta: number): void {
  if (!Number.isInteger(delta) || Math.abs(delta) > 10) throw new ErroApp('validacao', 'Ajuste de prioridade inválido.')
  if (executar(db, 'UPDATE pautas SET prioridade = MAX(-100, MIN(100, prioridade + :d)) WHERE id = :id', { id, d: delta }).changes === 0) throw naoEncontrado('Pauta')
}

/** Coloca o tema no primeiro horário livre do formato. Agendar um tema conta como aprová-lo. */
export function agendarTema(db: Banco, pautaId: number, tipoVideo: TipoVideo | null, agora = new Date()): Agendamento {
  const cfg = lerEditorial(db)
  const p = obterPauta(db, pautaId, agora)
  if (p.status === 'descartada') throw new ErroApp('pauta_descartada', 'Esta pauta foi descartada. Reative-a antes de agendar.')
  const tipo = tipoVideo ?? p.tipoSugerido ?? 'longo'
  const vaga = horariosLivres(db, cfg, agora).find((h) => h.tipoVideo === tipo)
  if (!vaga) {
    throw new ErroApp(
      'sem_horario',
      `Não há horário livre para ${tipo === 'longo' ? 'vídeo longo' : 'Short'} nos próximos ${cfg.horizonteDias} dias. Aumente a frequência ou adie outro vídeo.`
    )
  }
  const roteiro = um<{ id: number }>(db, 'SELECT id FROM roteiros WHERE pauta_id = :p AND projeto_id = :proj ORDER BY id DESC LIMIT 1', { p: pautaId, proj: p.projetoId })
  return transacao(db, () => {
    const a = agendar(db, cfg, { projetoId: p.projetoId, roteiroId: roteiro?.id ?? null, titulo: p.titulo, tipoVideo: tipo, data: vaga.data, hora: vaga.hora, notas: `Tema da pauta nº ${p.id}` }, agora)
    executar(db, 'UPDATE calendario_entradas SET pauta_id = :p WHERE id = :id', { p: pautaId, id: a.id })
    if (p.status === 'ideia') alterarStatusPauta(db, pautaId, 'aprovada')
    return a
  })
}

/**
 * Adiantar/adiar um vídeo agendado: troca a data com o vídeo vizinho do mesmo formato (as regras de limite
 * continuam valendo, pois o conjunto de horários não muda). Sem vizinho, usa o horário livre mais próximo.
 */
export function moverVideo(db: Banco, id: number, direcao: 'adiantar' | 'adiar', agora = new Date()): void {
  const cfg = lerEditorial(db)
  const atual = um<{ id: number; tipoVideo: TipoVideo; inicioUtc: string }>(
    db,
    "SELECT id, tipo_video AS tipoVideo, inicio_utc AS inicioUtc FROM calendario_entradas WHERE id = :id AND status = 'planejado'",
    { id }
  )
  if (!atual) throw naoEncontrado('Vídeo agendado')
  const vizinho = um<{ id: number; inicioUtc: string }>(
    db,
    direcao === 'adiantar'
      ? `SELECT id, inicio_utc AS inicioUtc FROM calendario_entradas WHERE status = 'planejado' AND tipo_video = :t AND inicio_utc < :i AND inicio_utc > :agora ORDER BY inicio_utc DESC LIMIT 1`
      : `SELECT id, inicio_utc AS inicioUtc FROM calendario_entradas WHERE status = 'planejado' AND tipo_video = :t AND inicio_utc > :i ORDER BY inicio_utc LIMIT 1`,
    direcao === 'adiantar' ? { t: atual.tipoVideo, i: atual.inicioUtc, agora: agora.toISOString() } : { t: atual.tipoVideo, i: atual.inicioUtc }
  )
  const livre = horariosLivres(db, cfg, agora)
    .filter((h) => h.tipoVideo === atual.tipoVideo)
    .filter((h) => (direcao === 'adiantar' ? h.inicioUtc < atual.inicioUtc : h.inicioUtc > atual.inicioUtc))
  // O horário livre mais próximo vence o vizinho quando fica entre os dois (adianta/adia só um pouco).
  const vaga = direcao === 'adiantar' ? livre.at(-1) : livre[0]
  const vagaAntes = vaga && (!vizinho || (direcao === 'adiantar' ? vaga.inicioUtc > vizinho.inicioUtc : vaga.inicioUtc < vizinho.inicioUtc))
  if (vaga && vagaAntes) {
    reagendar(db, cfg, id, vaga.data, vaga.hora, agora)
  } else if (vizinho) {
    transacao(db, () => {
      const t = agoraIso()
      executar(db, 'UPDATE calendario_entradas SET inicio_utc = :i, atualizado_em = :t WHERE id = :id', { id, i: vizinho.inicioUtc, t })
      executar(db, 'UPDATE calendario_entradas SET inicio_utc = :i, atualizado_em = :t WHERE id = :id', { id: vizinho.id, i: atual.inicioUtc, t })
    })
  } else {
    throw new ErroApp(
      'sem_horario',
      direcao === 'adiantar' ? 'Este já é o próximo vídeo deste formato e não há horário livre antes dele.' : `Não há horário livre depois deste nos próximos ${cfg.horizonteDias} dias.`
    )
  }
}

/** Frequência rápida do painel. Grava a configuração editorial como ação explícita do usuário. */
export function definirFrequencia(db: Banco, tipo: TipoVideo, porSemana: number, hora: string): PainelAdmin {
  const cfg = aplicarFrequencia(lerEditorial(db), tipo, porSemana, hora)
  salvarEditorial(db, cfg)
  registrarEvento(db, 'info', 'editorial', `Frequência de ${tipo === 'longo' ? 'vídeos longos' : 'Shorts'}: ${porSemana} por semana às ${hora}.`)
  return painelAdmin(db)
}
