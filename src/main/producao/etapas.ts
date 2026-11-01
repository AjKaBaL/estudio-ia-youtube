import { join } from 'node:path'
import type { Contexto } from '../contexto'
import { registrarEvento } from '../db/eventos'
import { ErroApp } from '../erros'
import * as producao from '../midia/producao'
import * as miniaturas from '../midia/miniaturas'
import * as publicacoes from '../youtube/publicacao'
import { avaliarQualidade } from '@shared/qualidade'
import { OPCOES_MINIATURA_PADRAO, textoSugerido } from '@shared/miniatura'
import type { ProgressoTarefa, Publicacao, RelatorioQualidade } from '@shared/tipos'

/**
 * Etapas de produção usadas tanto pelos botões da tela quanto pelo piloto automático,
 * para que os dois caminhos sigam exatamente as mesmas regras.
 */

/** Progresso do controle de qualidade por renderização (só enquanto o app está aberto). */
export const progressoQualidade = new Map<number, ProgressoTarefa>()

export async function executarQualidade(ctx: Contexto, renderId: number): Promise<RelatorioQualidade> {
  const r = producao.obterRenderizacao(ctx.db, renderId)
  if (r.status !== 'concluida') throw new ErroApp('render_incompleta', 'Rode o controle de qualidade em uma renderização concluída.')
  const pasta = join(ctx.pastaRender, String(r.id), `qualidade-${Date.now()}`)
  const iniciadoEm = new Date().toISOString()
  const marcar = (percentual: number, etapa: string, ativo = true): void => {
    const antes = progressoQualidade.get(r.id)?.percentual ?? 0
    progressoQualidade.set(r.id, { etapa, percentual: Math.max(antes, percentual), detalhe: '', iniciadoEm, ativo })
  }
  progressoQualidade.delete(r.id)
  marcar(0, 'Preparando a verificação')
  try {
    const { dados, capturas } = await producao.coletarDadosQualidade(ctx.db, r.id, ctx.ferramentas(), pasta, marcar)
    marcar(99, 'Avaliando os resultados')
    const rel = producao.salvarRelatorio(ctx.db, r.id, avaliarQualidade(dados), capturas.length ? pasta : null, capturas)
    marcar(100, 'Concluído', false)
    return rel
  } catch (e) {
    marcar(progressoQualidade.get(r.id)?.percentual ?? 0, 'Erro', false)
    throw e
  }
}

/** Rascunho de publicação com descrição e, em vídeo longo com FFmpeg, miniatura automática (melhor quadro + título). */
export async function prepararPublicacaoCompleta(ctx: Contexto, renderizacaoId: number): Promise<Publicacao> {
  const p = publicacoes.prepararPublicacao(ctx.db, renderizacaoId)
  const f = ctx.ferramentas()
  if (f && p.miniaturaRecursoId === null && p.status === 'rascunho' && producao.formatoDaRenderizacao(ctx.db, p.renderizacaoId) === '16:9') {
    try {
      const quadros = await miniaturas.quadrosCandidatos(ctx.db, f, p.renderizacaoId)
      const melhor = quadros.find((q) => q.sugerido)
      if (melhor) {
        const opcoes = { ...OPCOES_MINIATURA_PADRAO, texto: textoSugerido(p.titulo, OPCOES_MINIATURA_PADRAO.modelo) }
        await miniaturas.salvarMiniatura(ctx.db, f, { tipo: 'quadro', renderizacaoId: p.renderizacaoId, tempo: melhor.tempo }, opcoes, { trabalho: join(ctx.pastaRender, 'miniaturas'), midia: ctx.pastaMidia }, p.id)
      }
    } catch (err) {
      registrarEvento(ctx.db, 'aviso', 'miniatura', err instanceof Error ? err.message : 'Falha na miniatura automática.')
    }
  }
  return publicacoes.obterPublicacao(ctx.db, p.id)
}
