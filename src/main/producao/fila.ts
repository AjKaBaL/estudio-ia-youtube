import { type Banco, agoraIso, executar, todos, um } from '../db/conexao'
import { registrarEvento } from '../db/eventos'
import { ErroApp, naoEncontrado } from '../erros'
import { gravarConfig, lerConfig } from '../repositorios/configuracoes'
import { lerEditorial } from '../repositorios/editorial'
import { painelRevisao } from '../revisao/fluxo'
import { relatoriosDaRenderizacao } from '../midia/producao'
import type { ItemFila } from '@shared/tipos'

/**
 * Fila de produção completa (Etapa 14): cada item da agenda com o estado do roteiro, da revisão,
 * da produção, do controle de qualidade e da publicação, e as pendências calculadas por regras.
 */

const CHAVE_PAUSA = 'automacao.pausada'

export function automacaoPausada(db: Banco): boolean {
  return lerConfig<boolean>(db, CHAVE_PAUSA) === true
}

/** "Parar todas as tarefas automáticas": vale até ser retomado (inclusive depois de reiniciar o app). */
export function definirPausaGlobal(db: Banco, pausada: boolean): void {
  gravarConfig(db, CHAVE_PAUSA, pausada)
  registrarEvento(db, 'aviso', 'automacao', pausada ? 'Todas as tarefas automáticas foram pausadas pelo usuário.' : 'Tarefas automáticas retomadas pelo usuário.')
}

export function montarFila(db: Banco, agora = new Date()): ItemFila[] {
  const cfg = lerEditorial(db)
  const entradas = todos<{ id: number; roteiroId: number | null; titulo: string; tipoVideo: 'longo' | 'short'; inicioUtc: string; prioridade: number; pausado: number }>(
    db,
    `SELECT id, roteiro_id AS roteiroId, titulo, tipo_video AS tipoVideo, inicio_utc AS inicioUtc, prioridade, pausado
     FROM calendario_entradas WHERE status = 'planejado' ORDER BY prioridade DESC, inicio_utc`
  )
  return entradas.map((e) => {
    const pend: string[] = []
    const dias = (new Date(e.inicioUtc).getTime() - agora.getTime()) / 86_400_000
    let statusRoteiro: ItemFila['statusRoteiro'] = null
    let revisao = 'sem roteiro'
    let producao = 'não iniciada'
    let qualidade = 'não verificado'
    let publicacao = 'não preparada'
    let bloqueiaPublicacao = true
    if (!e.roteiroId) pend.push('Nenhum roteiro ligado a este horário.')
    else {
      const r = um<{ status: ItemFila['statusRoteiro'] }>(db, 'SELECT status FROM roteiros WHERE id = :id', { id: e.roteiroId })
      statusRoteiro = r?.status ?? null
      if (r) {
        const p = painelRevisao(db, e.roteiroId)
        revisao = statusRoteiro === 'aprovado' || statusRoteiro === 'publicado' ? 'aprovado para produção' : p.aprovacaoFactual && p.aprovacaoEditorial ? 'revisões aprovadas' : p.aprovacaoFactual ? 'factual aprovada' : 'pendente'
        if (statusRoteiro !== 'aprovado' && statusRoteiro !== 'publicado') {
          pend.push(`Roteiro em “${statusRoteiro}”: precisa passar pela revisão.`)
          if (dias < cfg.antecedencia.roteiroProntoDias) pend.push(`Atrasado: o roteiro deveria estar pronto ${cfg.antecedencia.roteiroProntoDias} dia(s) antes.`)
        }
        const edicao = um<{ id: number }>(db, 'SELECT id FROM projetos_edicao WHERE roteiro_id = :r ORDER BY atualizado_em DESC LIMIT 1', { r: e.roteiroId })
        if (!edicao) pend.push('Sem projeto de edição.')
        else {
          const render = um<{ id: number; status: string }>(db, 'SELECT id, status FROM renderizacoes WHERE edicao_id = :e ORDER BY id DESC LIMIT 1', { e: edicao.id })
          producao = render ? (render.status === 'concluida' ? 'renderizado' : render.status) : 'em edição'
          if (!render || render.status !== 'concluida') {
            pend.push('Vídeo ainda não renderizado.')
            if (dias < cfg.antecedencia.producaoProntaDias) pend.push(`Atrasado: a produção deveria estar pronta ${cfg.antecedencia.producaoProntaDias} dia(s) antes.`)
          } else {
            const qc = relatoriosDaRenderizacao(db, render.id)[0]
            qualidade = qc ? (qc.aprovado ? 'aprovado' : `reprovado (${qc.bloqueadores} bloqueador(es))`) : 'não verificado'
            if (!qc?.aprovado) pend.push('Controle de qualidade não aprovado.')
            const pub = um<{ status: string }>(db, "SELECT status FROM publicacoes WHERE renderizacao_id = :r AND status <> 'cancelada' ORDER BY id DESC LIMIT 1", { r: render.id })
            publicacao = pub?.status ?? 'não preparada'
            if (!pub || !['aprovada', 'enviando', 'pausada', 'processando', 'concluida'].includes(pub.status)) pend.push('Publicação não aprovada.')
          }
        }
        // Regra da agenda: nunca publicar roteiro em revisão nem vídeo com QC reprovado.
        bloqueiaPublicacao = !(statusRoteiro === 'aprovado' || statusRoteiro === 'publicado') || qualidade !== 'aprovado'
      }
    }
    if (e.pausado) pend.unshift('Item pausado.')
    return {
      id: e.id,
      roteiroId: e.roteiroId,
      titulo: e.titulo,
      tipoVideo: e.tipoVideo,
      inicioUtc: e.inicioUtc,
      prioridade: e.prioridade,
      pausado: Boolean(e.pausado),
      statusRoteiro,
      revisao,
      producao,
      qualidade,
      publicacao,
      pendencias: pend,
      bloqueiaPublicacao,
      atrasado: pend.some((x) => x.startsWith('Atrasado')) || (dias < 0 && publicacao !== 'concluida')
    }
  })
}

export function pausarItem(db: Banco, id: number, pausado: boolean): void {
  if (executar(db, "UPDATE calendario_entradas SET pausado = :p, atualizado_em = :t WHERE id = :id AND status = 'planejado'", { id, p: pausado ? 1 : 0, t: agoraIso() }).changes === 0) throw naoEncontrado('Item planejado')
}

export function priorizarItem(db: Banco, id: number, delta: number): void {
  if (!Number.isInteger(delta) || Math.abs(delta) > 10) throw new ErroApp('validacao', 'Ajuste de prioridade inválido.')
  if (executar(db, "UPDATE calendario_entradas SET prioridade = MAX(-100, MIN(100, prioridade + :d)), atualizado_em = :t WHERE id = :id AND status = 'planejado'", { id, d: delta, t: agoraIso() }).changes === 0) {
    throw naoEncontrado('Item planejado')
  }
}
