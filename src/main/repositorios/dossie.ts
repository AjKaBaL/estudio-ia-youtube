import { type Banco, agoraIso, executar, todos, transacao, um } from '../db/conexao'
import { ErroApp, naoEncontrado } from '../erros'
import { dominioDe } from '../pesquisa/pontuacao'
import { obterResultado } from './pesquisa'
import type { TipoFonte } from '@shared/dominio'
import { ROTULO_DECISAO, ROTULO_NATUREZA, ROTULO_SITUACAO, verificarAfirmacao, type Decisao, type Natureza } from '@shared/verificacao'
import type { AfirmacaoDetalhe, RelatorioVerificacao } from '@shared/tipos'

/** Dossiê de verificação: afirmações, fontes que as sustentam e relatório de pendências. */

export interface Alvo {
  pautaId: number | null
  roteiroId: number | null
}

function projetoDoAlvo(db: Banco, alvo: Alvo): number {
  const r = alvo.roteiroId
    ? um<{ p: number }>(db, 'SELECT projeto_id AS p FROM roteiros WHERE id = :id', { id: alvo.roteiroId })
    : um<{ p: number }>(db, 'SELECT projeto_id AS p FROM pautas WHERE id = :id', { id: alvo.pautaId ?? 0 })
  if (!r) throw naoEncontrado(alvo.roteiroId ? 'Roteiro' : 'Pauta')
  return r.p
}

/** Para um roteiro, inclui também as afirmações da pauta de origem. */
function filtroAlvo(db: Banco, alvo: Alvo): { where: string; p: Record<string, number> } {
  if (alvo.roteiroId) {
    const pauta = um<{ pautaId: number | null }>(db, 'SELECT pauta_id AS pautaId FROM roteiros WHERE id = :id', { id: alvo.roteiroId })
    if (!pauta) throw naoEncontrado('Roteiro')
    return pauta.pautaId
      ? { where: '(a.roteiro_id = :r OR a.pauta_id = :p)', p: { r: alvo.roteiroId, p: pauta.pautaId } }
      : { where: 'a.roteiro_id = :r', p: { r: alvo.roteiroId } }
  }
  return { where: 'a.pauta_id = :p', p: { p: alvo.pautaId ?? 0 } }
}

export function relatorio(db: Banco, alvo: Alvo, agora = new Date()): RelatorioVerificacao {
  const { where, p } = filtroAlvo(db, alvo)
  const linhas = todos<{
    id: number
    pautaId: number | null
    roteiroId: number | null
    texto: string
    natureza: Natureza
    relevante: number
    temaRapido: number
    decisao: Decisao | null
    observacoes: string
    atualizadoEm: string
    verificadaEm: string | null
    verificadaNota: string
  }>(
    db,
    `SELECT a.id, a.pauta_id AS pautaId, a.roteiro_id AS roteiroId, a.texto, a.natureza, a.relevante, a.tema_rapido AS temaRapido,
       a.decisao, a.observacoes, a.atualizado_em AS atualizadoEm, a.verificada_em AS verificadaEm, a.verificada_nota AS verificadaNota
     FROM afirmacoes a WHERE ${where} ORDER BY a.id`,
    p
  )
  const afirmacoes: AfirmacaoDetalhe[] = linhas.map((l) => {
    const fontes = todos<{ fonteId: number; titulo: string; url: string; autor: string; tipoFonte: TipoFonte; publicadaEm: string | null; acessadaEm: string; trecho: string; papel: 'primaria' | 'secundaria'; posicao: 'sustenta' | 'parcial' | 'contradiz' }>(
      db,
      `SELECT f.id AS fonteId, f.titulo, f.url, f.autor, f.tipo_fonte AS tipoFonte, f.publicada_em AS publicadaEm, f.acessada_em AS acessadaEm,
         af.trecho, af.papel, af.posicao
       FROM afirmacao_fontes af JOIN fontes f ON f.id = af.fonte_id WHERE af.afirmacao_id = :id ORDER BY af.criado_em`,
      { id: l.id }
    )
    const base = { natureza: l.natureza, relevante: Boolean(l.relevante), temaRapido: Boolean(l.temaRapido), decisao: l.decisao, verificadaEm: l.verificadaEm, verificadaNota: l.verificadaNota }
    const verificacao = verificarAfirmacao(base, fontes.map((f) => ({ ...f, dominio: dominioDe(f.url) })), agora)
    return { ...l, ...base, fontes, verificacao }
  })
  const porSituacao = Object.fromEntries(Object.keys(ROTULO_SITUACAO).map((s) => [s, afirmacoes.filter((a) => a.verificacao.situacao === s && !a.verificacao.removida).length]))
  const pendencias = afirmacoes.flatMap((a) => a.verificacao.pendencias.map((motivo) => ({ afirmacaoId: a.id, texto: a.texto, motivo })))
  return {
    afirmacoes,
    resumo: {
      total: afirmacoes.length,
      prontas: afirmacoes.filter((a) => a.verificacao.pronta).length,
      removidas: afirmacoes.filter((a) => a.verificacao.removida).length,
      porSituacao
    },
    pendencias,
    geradoEm: agora.toISOString()
  }
}

/** Regra da Etapa 7: roteiro só segue para revisão editorial com dossiê preenchido e sem pendências. */
export function conferirAntesDaRevisao(db: Banco, roteiroId: number): void {
  const r = relatorio(db, { pautaId: null, roteiroId })
  if (r.resumo.total === 0) {
    throw new ErroApp('dossie_vazio', 'Antes da revisão editorial, registre no dossiê as afirmações relevantes do roteiro e suas fontes (aba Verificação).')
  }
  if (r.pendencias.length) {
    throw new ErroApp('verificacao_pendente', `Há ${r.pendencias.length} pendência(s) de verificação. Resolva-as na aba Verificação antes de enviar para revisão.`)
  }
}

interface CamposAfirmacao {
  texto: string
  natureza: Natureza
  relevante: boolean
  temaRapido: boolean
  observacoes: string
}

export function criarAfirmacao(db: Banco, alvo: Alvo, d: CamposAfirmacao): void {
  projetoDoAlvo(db, alvo)
  const t = agoraIso()
  executar(
    db,
    `INSERT INTO afirmacoes (pauta_id, roteiro_id, texto, natureza, relevante, tema_rapido, observacoes, criado_em, atualizado_em)
     VALUES (:pauta, :roteiro, :texto, :natureza, :relevante, :rapido, :obs, :t, :t)`,
    { pauta: alvo.pautaId, roteiro: alvo.roteiroId, texto: d.texto, natureza: d.natureza, relevante: d.relevante ? 1 : 0, rapido: d.temaRapido ? 1 : 0, obs: d.observacoes, t }
  )
}

export function atualizarAfirmacao(db: Banco, id: number, d: CamposAfirmacao & { decisao: Decisao | null }): void {
  const r = executar(
    db,
    `UPDATE afirmacoes SET texto = :texto, natureza = :natureza, relevante = :relevante, tema_rapido = :rapido, decisao = :decisao,
       observacoes = :obs, atualizado_em = :t WHERE id = :id`,
    { id, texto: d.texto, natureza: d.natureza, relevante: d.relevante ? 1 : 0, rapido: d.temaRapido ? 1 : 0, decisao: d.decisao, obs: d.observacoes, t: agoraIso() }
  )
  if (r.changes === 0) throw naoEncontrado('Afirmação')
}

/** Etapa 9: o usuário confirma manualmente, mantendo registro da(s) fonte(s) já vinculada(s). */
export function marcarVerificada(db: Banco, id: number, nota: string): void {
  const fontes = um<{ n: number }>(db, "SELECT COUNT(*) AS n FROM afirmacao_fontes WHERE afirmacao_id = :id AND posicao IN ('sustenta','parcial')", { id })?.n ?? 0
  if (!um(db, 'SELECT 1 FROM afirmacoes WHERE id = :id', { id })) throw naoEncontrado('Afirmação')
  if (fontes === 0) throw new ErroApp('sem_fonte', 'Para marcar como verificada, vincule antes a fonte que você conferiu.')
  executar(db, 'UPDATE afirmacoes SET verificada_em = :t, verificada_nota = :n, atualizado_em = :t WHERE id = :id', { id, n: nota.slice(0, 500), t: agoraIso() })
}

export function desmarcarVerificada(db: Banco, id: number): void {
  if (executar(db, "UPDATE afirmacoes SET verificada_em = NULL, verificada_nota = '', atualizado_em = :t WHERE id = :id", { id, t: agoraIso() }).changes === 0) throw naoEncontrado('Afirmação')
}

export function excluirAfirmacao(db: Banco, id: number): void {
  if (executar(db, 'DELETE FROM afirmacoes WHERE id = :id', { id }).changes === 0) throw naoEncontrado('Afirmação')
}

function projetoDaAfirmacao(db: Banco, id: number): number {
  const a = um<{ pautaId: number | null; roteiroId: number | null }>(db, 'SELECT pauta_id AS pautaId, roteiro_id AS roteiroId FROM afirmacoes WHERE id = :id', { id })
  if (!a) throw naoEncontrado('Afirmação')
  return projetoDoAlvo(db, a)
}

interface Vinculo {
  trecho: string
  papel: 'primaria' | 'secundaria'
  posicao: 'sustenta' | 'parcial' | 'contradiz'
}

function vincular(db: Banco, afirmacaoId: number, fonteId: number, v: Vinculo): void {
  executar(
    db,
    `INSERT INTO afirmacao_fontes (afirmacao_id, fonte_id, trecho, papel, posicao, criado_em) VALUES (:a, :f, :trecho, :papel, :posicao, :t)
     ON CONFLICT(afirmacao_id, fonte_id) DO UPDATE SET trecho = excluded.trecho, papel = excluded.papel, posicao = excluded.posicao`,
    { a: afirmacaoId, f: fonteId, trecho: v.trecho, papel: v.papel, posicao: v.posicao, t: agoraIso() }
  )
  executar(db, 'UPDATE afirmacoes SET atualizado_em = :t WHERE id = :id', { id: afirmacaoId, t: agoraIso() })
}

/** Usa um resultado real de pesquisa (URL e datas como foram obtidos) como fonte da afirmação. */
export function vincularResultado(db: Banco, afirmacaoId: number, resultadoId: number, v: Vinculo): void {
  transacao(db, () => {
    const projeto = projetoDaAfirmacao(db, afirmacaoId)
    const r = obterResultado(db, resultadoId)
    if (r.projetoId !== projeto) throw new ErroApp('projeto_diferente', 'O resultado pertence a outro projeto.')
    const existente = um<{ id: number }>(db, 'SELECT id FROM fontes WHERE projeto_id = :p AND url = :u ORDER BY id LIMIT 1', { p: projeto, u: r.url })
    const fonteId =
      existente?.id ??
      executar(
        db,
        `INSERT INTO fontes (projeto_id, titulo, url, autor, tipo_fonte, publicada_em, acessada_em, notas, criado_em)
         VALUES (:p, :titulo, :url, :autor, :tipo, :pub, :acesso, '', :t)`,
        { p: projeto, titulo: r.titulo, url: r.url, autor: r.autor, tipo: r.tipoFonte, pub: r.publicadaEm?.slice(0, 10) ?? null, acesso: r.acessadaEm.slice(0, 10), t: agoraIso() }
      ).id
    vincular(db, afirmacaoId, fonteId, v)
  })
}

/** Fonte informada pelo usuário (título, URL e datas digitados por ele). */
export function vincularNovaFonte(
  db: Banco,
  afirmacaoId: number,
  f: { titulo: string; url: string; autor: string; tipoFonte: TipoFonte; publicadaEm: string | null; acessadaEm: string },
  v: Vinculo
): void {
  transacao(db, () => {
    const projeto = projetoDaAfirmacao(db, afirmacaoId)
    const { id } = executar(
      db,
      `INSERT INTO fontes (projeto_id, titulo, url, autor, tipo_fonte, publicada_em, acessada_em, notas, criado_em)
       VALUES (:p, :titulo, :url, :autor, :tipo, :pub, :acesso, '', :t)`,
      { p: projeto, titulo: f.titulo, url: f.url, autor: f.autor, tipo: f.tipoFonte, pub: f.publicadaEm, acesso: f.acessadaEm, t: agoraIso() }
    )
    vincular(db, afirmacaoId, id, v)
  })
}

export function desvincularFonte(db: Banco, afirmacaoId: number, fonteId: number): void {
  executar(db, 'DELETE FROM afirmacao_fontes WHERE afirmacao_id = :a AND fonte_id = :f', { a: afirmacaoId, f: fonteId })
}

/** Relatório em Markdown, com links para conferência manual de cada fonte. */
export function relatorioMarkdown(r: RelatorioVerificacao, titulo: string): string {
  const md = (t: string): string => t.replace(/([\\`*_[\]<>#|])/g, '\\$1')
  const l = [
    `# Relatório de verificação — ${md(titulo)}`,
    '',
    `Gerado em ${r.geradoEm.slice(0, 16).replace('T', ' ')} (UTC). Situações calculadas por regras automáticas; confira as fontes manualmente.`,
    '',
    `- Afirmações: ${r.resumo.total} · prontas para o roteiro: ${r.resumo.prontas} · removidas: ${r.resumo.removidas} · pendências: ${r.pendencias.length}`,
    ...Object.entries(r.resumo.porSituacao).map(([s, n]) => `- ${ROTULO_SITUACAO[s as keyof typeof ROTULO_SITUACAO]}: ${n}`),
    '',
    '## Pendências',
    '',
    ...(r.pendencias.length ? r.pendencias.map((p) => `- ${md(p.texto)} — ${md(p.motivo)}`) : ['Nenhuma.']),
    '',
    '## Afirmações'
  ]
  for (const a of r.afirmacoes) {
    l.push(
      '',
      `### ${md(a.texto)}`,
      '',
      `- Natureza: ${ROTULO_NATUREZA[a.natureza]} · Situação: ${ROTULO_SITUACAO[a.verificacao.situacao]} · Confiança (estimativa): ${a.verificacao.confianca}`,
      `- Razão: ${md(a.verificacao.razao)}`,
      ...(a.decisao ? [`- Decisão: ${ROTULO_DECISAO[a.decisao]}`] : []),
      ...(a.verificacao.pronta ? ['- Pronta para entrar no roteiro.'] : []),
      ...(a.observacoes ? [`- Observações: ${md(a.observacoes)}`] : []),
      ...a.fontes.map(
        (f) => `- [${md(f.titulo)}](<${f.url.replace(/>/g, '%3E')}>) — ${f.posicao}, fonte ${f.papel}, publicada ${f.publicadaEm ?? 'sem data'}, acesso ${f.acessadaEm}. Trecho: “${md(f.trecho)}”`
      )
    )
  }
  return `${l.join('\n')}\n`
}
