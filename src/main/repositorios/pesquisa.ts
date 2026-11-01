import { type Banco, agoraIso, executar, todos, um } from '../db/conexao'
import { ErroApp, naoEncontrado } from '../erros'
import { gravarConfig, lerConfig } from './configuracoes'
import { obterRoteiro } from './roteiros'
import { opcoesPesquisaSchema, type OpcoesPesquisa } from '@shared/schemas'
import { FONTES_INTERNACIONAIS, FONTES_PADRAO, TERMOS_PADRAO, dominioReconhecido } from '@shared/fontesPadrao'
import type { ExecucaoDetalhe, ExecucaoResumo, FontePesquisa, RegistroExecucao, RegraDominio, ResultadoPesquisa, RoteiroCompleto, SugestaoFonte } from '@shared/tipos'

const CHAVE_OPCOES = 'pesquisa.opcoes'

/** Nicho inicial do canal (tecnologia, IA e negócios da inovação). Editável pelo usuário. */
export const NICHO_PADRAO = ['inteligência artificial', 'IA', 'tecnologia', 'inovação', 'startups', 'negócios', 'software', 'dados']

export function lerOpcoesPesquisa(db: Banco): OpcoesPesquisa {
  const r = opcoesPesquisaSchema.safeParse(lerConfig(db, CHAVE_OPCOES) ?? { nicho: NICHO_PADRAO })
  return r.success ? r.data : opcoesPesquisaSchema.parse({ nicho: NICHO_PADRAO })
}

export function salvarOpcoesPesquisa(db: Banco, o: OpcoesPesquisa): OpcoesPesquisa {
  gravarConfig(db, CHAVE_OPCOES, o)
  return o
}

// ------------------------------------------------------------------ fontes

const SELECT_FONTE = `SELECT id, tipo, nome, url, ativo, ultimo_status AS ultimoStatus, ultima_execucao AS ultimaExecucao, origem FROM fontes_pesquisa`

export function listarFontesPesquisa(db: Banco, projetoId: number): FontePesquisa[] {
  return todos<Omit<FontePesquisa, 'ativo'> & { ativo: number }>(db, `${SELECT_FONTE} WHERE projeto_id = :p ORDER BY tipo, nome COLLATE NOCASE`, { p: projetoId }).map((f) => ({
    ...f,
    ativo: Boolean(f.ativo)
  }))
}

export function adicionarFontePesquisa(
  db: Banco,
  d: { projetoId: number; tipo: 'rss' | 'url'; nome: string; url: string; origem?: FontePesquisa['origem'] }
): FontePesquisa {
  const existe = um(db, 'SELECT 1 FROM fontes_pesquisa WHERE projeto_id = :p AND url = :u', { p: d.projetoId, u: d.url })
  if (existe) throw new ErroApp('duplicado', 'Esta fonte já foi adicionada.')
  const { id } = executar(db, 'INSERT INTO fontes_pesquisa (projeto_id, tipo, nome, url, origem, criado_em) VALUES (:p, :tipo, :nome, :url, :origem, :t)', {
    p: d.projetoId,
    tipo: d.tipo,
    nome: d.nome,
    url: d.url,
    origem: d.origem ?? 'usuario',
    t: agoraIso()
  })
  const f = um<Omit<FontePesquisa, 'ativo'> & { ativo: number }>(db, `${SELECT_FONTE} WHERE id = :id`, { id })!
  return { ...f, ativo: Boolean(f.ativo) }
}

export function ativarFontePesquisa(db: Banco, id: number, ativo: boolean): void {
  if (executar(db, 'UPDATE fontes_pesquisa SET ativo = :a WHERE id = :id', { id, a: ativo ? 1 : 0 }).changes === 0) throw naoEncontrado('Fonte')
}

/** Remove a fonte configurada; resultados de pesquisas anteriores são preservados. */
export function removerFontePesquisa(db: Banco, id: number): void {
  if (executar(db, 'DELETE FROM fontes_pesquisa WHERE id = :id', { id }).changes === 0) throw naoEncontrado('Fonte')
}

/** Acrescenta as fontes padrão que faltam no projeto (as já cadastradas, mesmo desativadas, não mudam). */
export function restaurarFontesPadrao(db: Banco, projetoId: number, lista: readonly { nome: string; url: string }[] = FONTES_PADRAO): number {
  let adicionadas = 0
  for (const f of lista) {
    const r = executar(
      db,
      `INSERT INTO fontes_pesquisa (projeto_id, tipo, nome, url, origem, criado_em) VALUES (:p, 'rss', :nome, :url, 'padrao', :t)
       ON CONFLICT(projeto_id, url) DO NOTHING`,
      { p: projetoId, nome: f.nome, url: f.url, t: agoraIso() }
    )
    adicionadas += r.changes
  }
  return adicionadas
}

const CHAVE_PADRAO_APLICADO = 'pesquisa.padraoAplicado'
const CHAVE_TERMOS_APLICADOS = 'pesquisa.termosPadraoAplicados'
const CHAVE_INTERNACIONAIS_APLICADO = 'pesquisa.internacionaisAplicados'

/**
 * Executado ao abrir o app e ao criar projeto: cada projeto recebe as fontes padrão UMA vez (se o usuário
 * remover depois, não voltam sozinhas). Os termos monitorados padrão entram uma vez, só se a lista estiver vazia.
 */
export function aplicarPadroesPesquisa(db: Banco): { projetos: number; fontes: number; termos: boolean } {
  const aplicados = new Set(lerConfig<number[]>(db, CHAVE_PADRAO_APLICADO) ?? [])
  const ids = todos<{ id: number }>(db, 'SELECT id FROM projetos WHERE arquivado_em IS NULL ORDER BY id').map((p) => p.id)
  let fontes = 0
  let projetos = 0
  for (const id of ids.filter((x) => !aplicados.has(x))) {
    fontes += restaurarFontesPadrao(db, id)
    aplicados.add(id)
    projetos++
  }
  if (projetos) gravarConfig(db, CHAVE_PADRAO_APLICADO, [...aplicados])
  // Veículos do Brasil, Europa, EUA e Japão chegaram depois: entram uma vez também nos projetos que já existiam.
  const internacionais = new Set(lerConfig<number[]>(db, CHAVE_INTERNACIONAIS_APLICADO) ?? [])
  const faltam = ids.filter((x) => !internacionais.has(x))
  for (const id of faltam) {
    fontes += restaurarFontesPadrao(db, id, FONTES_INTERNACIONAIS)
    internacionais.add(id)
  }
  if (faltam.length) gravarConfig(db, CHAVE_INTERNACIONAIS_APLICADO, [...internacionais])
  // Sugestões pendentes de veículos reconhecidos não esperam aprovação.
  for (const s of todos<{ id: number; dominio: string }>(db, "SELECT id, dominio FROM sugestoes_fontes WHERE status = 'pendente' AND url <> ''")) {
    if (!dominioReconhecido(s.dominio)) continue
    aprovarSugestaoFonte(db, s.id)
    fontes++
  }
  let termos = false
  if (lerConfig<boolean>(db, CHAVE_TERMOS_APLICADOS) !== true) {
    const o = lerOpcoesPesquisa(db)
    if (o.termosMonitorados.length === 0) {
      salvarOpcoesPesquisa(db, { ...o, termosMonitorados: [...TERMOS_PADRAO] })
      termos = true
    }
    gravarConfig(db, CHAVE_TERMOS_APLICADOS, true)
  }
  return { projetos, fontes, termos }
}

// ------------------------------------------------------------------ sugestões de novas fontes

export function listarSugestoesFontes(db: Banco, projetoId: number): SugestaoFonte[] {
  return todos<SugestaoFonte>(
    db,
    `SELECT id, dominio, nome, url, ocorrencias, exemplo_titulo AS exemploTitulo, exemplo_url AS exemploUrl, criado_em AS criadoEm
     FROM sugestoes_fontes WHERE projeto_id = :p AND status = 'pendente' ORDER BY ocorrencias DESC, id`,
    { p: projetoId }
  )
}

function sugestaoPendente(db: Banco, id: number): { projetoId: number; dominio: string; nome: string; url: string } {
  const s = um<{ projetoId: number; dominio: string; nome: string; url: string }>(
    db,
    "SELECT projeto_id AS projetoId, dominio, nome, url FROM sugestoes_fontes WHERE id = :id AND status = 'pendente'",
    { id }
  )
  if (!s) throw naoEncontrado('Sugestão pendente')
  return s
}

/** Aprovar cadastra o feed como fonte ativa; o usuário pode desativá-lo depois como qualquer outra. */
export function aprovarSugestaoFonte(db: Banco, id: number): FontePesquisa {
  const s = sugestaoPendente(db, id)
  const existente = um<{ id: number }>(db, 'SELECT id FROM fontes_pesquisa WHERE projeto_id = :p AND url = :u', { p: s.projetoId, u: s.url })
  executar(db, "UPDATE sugestoes_fontes SET status = 'aprovada', atualizado_em = :t WHERE id = :id", { id, t: agoraIso() })
  if (existente) return listarFontesPesquisa(db, s.projetoId).find((f) => f.id === existente.id)!
  return adicionarFontePesquisa(db, { projetoId: s.projetoId, tipo: 'rss', nome: s.nome || s.dominio, url: s.url, origem: 'sugestao' })
}

/** Recusada não volta a ser sugerida. */
export function recusarSugestaoFonte(db: Banco, id: number): void {
  sugestaoPendente(db, id)
  executar(db, "UPDATE sugestoes_fontes SET status = 'recusada', atualizado_em = :t WHERE id = :id", { id, t: agoraIso() })
}

// ------------------------------------------------------------------ domínios

export function listarRegras(db: Banco, projetoId: number): RegraDominio[] {
  return todos<RegraDominio>(db, 'SELECT id, dominio, regra FROM regras_dominio WHERE projeto_id = :p ORDER BY regra, dominio', { p: projetoId })
}

export function definirRegra(db: Banco, d: { projetoId: number; dominio: string; regra: 'confiavel' | 'bloqueado' }): RegraDominio[] {
  executar(
    db,
    `INSERT INTO regras_dominio (projeto_id, dominio, regra, criado_em) VALUES (:p, :d, :r, :t)
     ON CONFLICT(projeto_id, dominio) DO UPDATE SET regra = excluded.regra`,
    { p: d.projetoId, d: d.dominio, r: d.regra, t: agoraIso() }
  )
  return listarRegras(db, d.projetoId)
}

export function removerRegra(db: Banco, id: number): void {
  if (executar(db, 'DELETE FROM regras_dominio WHERE id = :id', { id }).changes === 0) throw naoEncontrado('Regra')
}

// ------------------------------------------------------------------ execuções

const SELECT_EXECUCAO = `
  SELECT id, consulta, status, origem, intervalo_de AS intervaloDe, intervalo_ate AS intervaloAte, iniciada_em AS iniciadaEm,
    concluida_em AS concluidaEm, mensagem_erro AS mensagemErro, fontes_consultadas AS fontesConsultadas,
    fontes_com_erro AS fontesComErro, total_resultados AS totalResultados, criado_em AS criadoEm
  FROM execucoes_pesquisa`

export function listarExecucoes(db: Banco, projetoId: number | null, limite: number): ExecucaoResumo[] {
  return todos<ExecucaoResumo>(db, `${SELECT_EXECUCAO} ${projetoId ? 'WHERE projeto_id = :p' : ''} ORDER BY id DESC LIMIT :limite`, {
    ...(projetoId ? { p: projetoId } : {}),
    limite
  })
}

export function ultimaExecucao(db: Banco): string | null {
  return um<{ t: string | null }>(db, 'SELECT MAX(COALESCE(concluida_em, iniciada_em)) AS t FROM execucoes_pesquisa')?.t ?? null
}

type LinhaResultado = Omit<ResultadoPesquisa, 'explicacao' | 'alertaInjecao'> & { explicacao: string; alertaInjecao: number }

export function obterResultado(db: Banco, id: number): ResultadoPesquisa & { projetoId: number } {
  const r = um<LinhaResultado & { projetoId: number }>(
    db,
    `SELECT r.*, r.fonte_nome AS fonteNome, r.publicada_em AS publicadaEm, r.acessada_em AS acessadaEm, r.tipo_fonte AS tipoFonte,
       r.duplicado_de AS duplicadoDe, r.alerta_injecao AS alertaInjecao, e.projeto_id AS projetoId
     FROM resultados_pesquisa r JOIN execucoes_pesquisa e ON e.id = r.execucao_id WHERE r.id = :id`,
    { id }
  )
  if (!r) throw naoEncontrado('Resultado')
  return { ...r, explicacao: JSON.parse(r.explicacao) as string[], alertaInjecao: Boolean(r.alertaInjecao) }
}

export function obterExecucao(db: Banco, id: number): ExecucaoDetalhe {
  const e = um<ExecucaoResumo>(db, `${SELECT_EXECUCAO} WHERE id = :id`, { id })
  if (!e) throw naoEncontrado('Pesquisa')
  const resultados = todos<LinhaResultado>(
    db,
    `SELECT id, fonte_nome AS fonteNome, titulo, url, dominio, autor, publicada_em AS publicadaEm, acessada_em AS acessadaEm, trecho, idioma,
       tipo_fonte AS tipoFonte, relevancia, atualidade, confiabilidade, nicho, pontuacao, explicacao, grupo, duplicado_de AS duplicadoDe,
       alerta_injecao AS alertaInjecao
     FROM resultados_pesquisa WHERE execucao_id = :id ORDER BY pontuacao DESC, id`,
    { id }
  ).map((r) => ({ ...r, explicacao: JSON.parse(r.explicacao) as string[], alertaInjecao: Boolean(r.alertaInjecao) }))
  const registros = todos<RegistroExecucao>(
    db,
    'SELECT id, fonte, nivel, mensagem, criado_em AS criadoEm FROM execucao_registros WHERE execucao_id = :id ORDER BY id',
    { id }
  )
  return { ...e, resultados, registros }
}

/** Guarda um resultado como fonte do roteiro, com título, URL, autor e datas reais do resultado. */
export function resultadoParaRoteiro(db: Banco, resultadoId: number, roteiroId: number): RoteiroCompleto {
  const r = obterResultado(db, resultadoId)
  const rot = obterRoteiro(db, roteiroId)
  if (rot.projetoId !== r.projetoId) throw new ErroApp('projeto_diferente', 'O resultado e o roteiro pertencem a projetos diferentes.')
  if (rot.fontes.some((f) => f.url === r.url)) throw new ErroApp('duplicado', 'Esta fonte já está vinculada ao roteiro.')
  const { id } = executar(
    db,
    `INSERT INTO fontes (projeto_id, execucao_pesquisa_id, titulo, url, autor, tipo_fonte, publicada_em, acessada_em, notas, criado_em)
     SELECT e.projeto_id, r.execucao_id, r.titulo, r.url, r.autor, r.tipo_fonte, substr(r.publicada_em, 1, 10), substr(r.acessada_em, 1, 10), r.trecho, :t
     FROM resultados_pesquisa r JOIN execucoes_pesquisa e ON e.id = r.execucao_id WHERE r.id = :rid`,
    { rid: resultadoId, t: agoraIso() }
  )
  executar(db, 'INSERT INTO roteiro_fontes (roteiro_id, fonte_id) VALUES (:r, :f)', { r: roteiroId, f: id })
  return obterRoteiro(db, roteiroId)
}
