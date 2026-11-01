import { type Banco, agoraIso, executar, todos, transacao } from '../db/conexao'
import { ErroApp } from '../erros'
import { relatorio } from '../repositorios/dossie'
import { arquivarRoteiro, comentar, obterRoteiro } from '../repositorios/roteiros'
import { analisarTexto, numerosDeTextos } from '@shared/analiseTexto'
import { duracaoEstimadaSeg } from '@shared/diff'
import type { PainelRevisao, RegistroAprovacao } from '@shared/tipos'
import { secoesAlteradas, secoesDoTexto, type Secao } from './aprovacoes'
import { revisaoInternaAtual, revisarSoRegras } from './interna'

/**
 * Fluxo de revisão (Etapa 9): revisão factual e editorial separadas, histórico auditável,
 * e passagem para produção só sem pendências críticas. Regras impostas pelo código.
 */

function historico(db: Banco, roteiroId: number): RegistroAprovacao[] {
  return todos<RegistroAprovacao>(
    db,
    `SELECT id, versao_numero AS versao, tipo, acao, comentario, invalidada_em AS invalidadaEm, invalidada_motivo AS invalidadaMotivo, criado_em AS criadoEm
     FROM aprovacoes WHERE roteiro_id = :id ORDER BY id DESC`,
    { id: roteiroId }
  )
}

function aprovacaoValida(h: RegistroAprovacao[], tipo: 'factual' | 'editorial', versao: number): RegistroAprovacao | null {
  return h.find((a) => a.tipo === tipo && a.acao === 'aprovado' && !a.invalidadaEm && a.versao === versao) ?? null
}

export function painelRevisao(db: Banco, roteiroId: number): PainelRevisao {
  const r = obterRoteiro(db, roteiroId)
  const dossie = relatorio(db, { pautaId: null, roteiroId })
  const anteriores = todos<{ titulo: string; conteudo: string }>(
    db,
    `SELECT r.titulo, v.conteudo FROM roteiros r JOIN roteiro_versoes v ON v.roteiro_id = r.id AND v.numero = r.versao_atual
     WHERE r.projeto_id = :p AND r.id <> :id`,
    { p: r.projetoId, id: r.id }
  )
  const textosDossie = dossie.afirmacoes.flatMap((a) => [a.texto, ...a.fontes.map((f) => f.trecho)])
  const alertasTexto = analisarTexto(r.titulo, r.conteudo, {
    anteriores,
    trechosFontes: dossie.afirmacoes.flatMap((a) => a.fontes.map((f) => f.trecho)),
    numerosDossie: numerosDeTextos(textosDossie)
  })
  const h = historico(db, roteiroId)
  const factual = aprovacaoValida(h, 'factual', r.versaoAtual)
  const editorial = aprovacaoValida(h, 'editorial', r.versaoAtual)
  const ultimaAprovada = h.find((a) => a.acao === 'aprovado')
  const secoesAtuais = secoesDoTexto(r.conteudo)
  const alteradasDesde = ultimaAprovada
    ? secoesAlteradas(JSON.parse(todos<{ s: string }>(db, 'SELECT secoes AS s FROM aprovacoes WHERE id = :id', { id: ultimaAprovada.id })[0]?.s ?? '[]') as Secao[], secoesAtuais)
    : []

  const pendenciasFactuais = [
    ...dossie.pendencias.map((p) => `${p.texto}: ${p.motivo}`),
    ...(dossie.resumo.total === 0 ? ['Dossiê vazio: registre as afirmações relevantes e suas fontes.'] : []),
    ...alertasTexto.filter((a) => a.tipo === 'fato_novo').map((a) => a.mensagem)
  ]
  const criticosEditoriais = alertasTexto.filter((a) => a.gravidade === 'critico' && a.tipo !== 'fato_novo').map((a) => a.mensagem)
  const interna = revisaoInternaAtual(db, roteiroId)
  const criticosIa = interna?.itens.filter((i) => i.origem === 'ia' && i.gravidade === 'critico' && !i.conferido).length ?? 0
  const motivosBloqueio = [
    ...(criticosIa ? [`Revisão interna: ${criticosIa} ponto(s) crítico(s) apontado(s) pela IA revisora ainda não conferido(s).`] : []),
    ...(factual ? [] : ['Falta aprovação factual da versão atual.']),
    ...(editorial ? [] : ['Falta aprovação editorial da versão atual.']),
    ...pendenciasFactuais.map((p) => `Pendência factual: ${p}`),
    ...criticosEditoriais.map((p) => `Alerta crítico: ${p}`)
  ]
  return {
    roteiro: r,
    dossie,
    alertasTexto,
    pendenciasFactuais,
    duracaoSeg: duracaoEstimadaSeg(r.conteudo),
    historico: h,
    aprovacaoFactual: factual,
    aprovacaoEditorial: editorial,
    secoesAlteradasDesdeAprovacao: alteradasDesde,
    podeAprovarProducao: motivosBloqueio.length === 0,
    motivosBloqueio,
    revisaoInterna: interna
  }
}

function registrar(db: Banco, roteiroId: number, tipo: 'factual' | 'editorial' | 'producao', acao: 'aprovado' | 'correcoes' | 'rejeitado', comentario: string): void {
  const r = obterRoteiro(db, roteiroId)
  executar(
    db,
    `INSERT INTO aprovacoes (roteiro_id, versao_numero, tipo, acao, comentario, secoes, criado_em)
     VALUES (:r, :v, :tipo, :acao, :c, :s, :t)`,
    { r: roteiroId, v: r.versaoAtual, tipo, acao, c: comentario, s: JSON.stringify(secoesDoTexto(r.conteudo)), t: agoraIso() }
  )
}

/** Aprovação factual: só com dossiê sem pendências e sem números fora do dossiê. */
export function aprovarFactual(db: Banco, roteiroId: number, comentario: string): PainelRevisao {
  const p = painelRevisao(db, roteiroId)
  if (p.pendenciasFactuais.length) throw new ErroApp('pendencias_factuais', `A revisão factual tem ${p.pendenciasFactuais.length} pendência(s). Resolva antes de aprovar.`)
  transacao(db, () => {
    registrar(db, roteiroId, 'factual', 'aprovado', comentario)
    executar(db, "UPDATE roteiros SET status = 'em_revisao', atualizado_em = :t WHERE id = :id AND status <> 'aprovado'", { id: roteiroId, t: agoraIso() })
  })
  return painelRevisao(db, roteiroId)
}

/** Aprovação editorial: registrada separadamente; não apaga alertas factuais. */
export function aprovarEditorial(db: Banco, roteiroId: number, comentario: string): PainelRevisao {
  transacao(db, () => {
    registrar(db, roteiroId, 'editorial', 'aprovado', comentario)
    executar(db, "UPDATE roteiros SET status = 'em_revisao', atualizado_em = :t WHERE id = :id AND status <> 'aprovado'", { id: roteiroId, t: agoraIso() })
  })
  return painelRevisao(db, roteiroId)
}

/** Passagem para produção: exige as duas aprovações válidas da versão atual e nenhuma pendência crítica. */
export function aprovarParaProducao(db: Banco, roteiroId: number, comentario: string): PainelRevisao {
  // Toda versão aprovada passa pela revisão interna; sem ela ainda, roda na hora a parte das regras fixas.
  if (!revisaoInternaAtual(db, roteiroId)) revisarSoRegras(db, roteiroId, 'Feita automaticamente ao aprovar para produção (só regras fixas).')
  const p = painelRevisao(db, roteiroId)
  if (!p.podeAprovarProducao) throw new ErroApp('bloqueado', `Não é possível aprovar para produção: ${p.motivosBloqueio.slice(0, 3).join(' ')}${p.motivosBloqueio.length > 3 ? ' …' : ''}`)
  transacao(db, () => {
    registrar(db, roteiroId, 'producao', 'aprovado', comentario)
    executar(db, "UPDATE roteiros SET status = 'aprovado', atualizado_em = :t WHERE id = :id", { id: roteiroId, t: agoraIso() })
  })
  return painelRevisao(db, roteiroId)
}

export function solicitarCorrecoes(db: Banco, roteiroId: number, tipo: 'factual' | 'editorial', comentario: string): PainelRevisao {
  if (!comentario.trim()) throw new ErroApp('validacao', 'Descreva as correções pedidas.')
  transacao(db, () => {
    registrar(db, roteiroId, tipo, 'correcoes', comentario)
    comentar(db, roteiroId, `[Correção ${tipo}] ${comentario}`)
    executar(db, "UPDATE roteiros SET status = 'rascunho', atualizado_em = :t WHERE id = :id", { id: roteiroId, t: agoraIso() })
  })
  return painelRevisao(db, roteiroId)
}

/** Rejeitar registra a decisão e arquiva o roteiro (nada é apagado). */
export function rejeitar(db: Banco, roteiroId: number, comentario: string): void {
  transacao(db, () => {
    registrar(db, roteiroId, 'editorial', 'rejeitado', comentario)
    executar(db, "UPDATE roteiros SET status = 'rascunho' WHERE id = :id", { id: roteiroId })
    arquivarRoteiro(db, roteiroId, true)
  })
}

