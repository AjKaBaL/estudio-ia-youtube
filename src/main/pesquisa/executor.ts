import { type Banco, agoraIso, executar, todos, transacao, um } from '../db/conexao'
import { registrarEvento } from '../db/eventos'
import { lerEditorial } from '../repositorios/editorial'
import { lerOpcoesPesquisa } from '../repositorios/pesquisa'
import { intervaloPesquisa } from '@shared/editorial'
import type { ProgressoPesquisa } from '@shared/tipos'
import { agrupar, analisarConsulta, classificarTipoFonte, dominioCasa, dominioDe, pontuar, urlCanonica } from './pontuacao'
import { PROVEDORES, type FonteConfigurada, type ResultadoBruto } from './provedores'
import { buscarSeguro } from './rede'
import { registrarSugestoes } from './descoberta'
import { detectarIdioma, pareceInjecao } from './texto'

/** Limites de cada execução, para controlar tempo, memória e carga sobre os sites. */
export const LIMITES = {
  duracaoMaximaMs: 120_000,
  maxFontes: 30,
  itensPorFonte: 50,
  resultadosMaximos: 200,
  tempoPorFonteMs: 15_000,
  tamanhoMaximo: 2 * 1024 * 1024
}

export interface DependenciasPesquisa {
  buscar: typeof buscarSeguro
  agora: () => Date
}

export const DEPENDENCIAS_PADRAO: DependenciasPesquisa = { buscar: buscarSeguro, agora: () => new Date() }

export function criarExecucao(db: Banco, d: { projetoId: number; consulta: string; pautaId: number | null; origem: 'manual' | 'agendada' }, agora: Date): number {
  const { de, ate } = intervaloPesquisa(lerEditorial(db).pesquisa, agora)
  return executar(
    db,
    `INSERT INTO execucoes_pesquisa (projeto_id, pauta_id, consulta, origem, status, intervalo_de, intervalo_ate, criado_em)
     VALUES (:projetoId, :pautaId, :consulta, :origem, 'pendente', :de, :ate, :agora)`,
    { ...d, de: de.toISOString(), ate: ate.toISOString(), agora: agora.toISOString() }
  ).id
}

/** Executa uma pesquisa já criada. Não lança erro: o resultado fica registrado na própria execução. */
export async function executarPesquisa(
  db: Banco,
  execucaoId: number,
  deps: DependenciasPesquisa,
  sinalExterno: AbortSignal,
  aoProgredir: (p: ProgressoPesquisa) => void = () => undefined
): Promise<void> {
  const ex = um<{ projeto_id: number; consulta: string; intervalo_de: string; intervalo_ate: string }>(
    db,
    'SELECT projeto_id, consulta, intervalo_de, intervalo_ate FROM execucoes_pesquisa WHERE id = :id',
    { id: execucaoId }
  )
  if (!ex) return
  const inicio = deps.agora()
  const registrar = (fonte: string, nivel: 'info' | 'aviso' | 'erro', mensagem: string): void => {
    executar(db, 'INSERT INTO execucao_registros (execucao_id, fonte, nivel, mensagem, criado_em) VALUES (:e, :f, :n, :m, :t)', {
      e: execucaoId,
      f: fonte.slice(0, 120),
      n: nivel,
      m: mensagem.slice(0, 500),
      t: agoraIso()
    })
  }
  const finalizar = (status: string, mensagemErro: string | null, extra: { consultadas: number; comErro: number; total: number }): void => {
    executar(
      db,
      `UPDATE execucoes_pesquisa SET status = :status, mensagem_erro = :erro, concluida_em = :t,
         fontes_consultadas = :consultadas, fontes_com_erro = :comErro, total_resultados = :total WHERE id = :id`,
      { id: execucaoId, status, erro: mensagemErro, t: agoraIso(), ...extra }
    )
  }

  executar(db, "UPDATE execucoes_pesquisa SET status = 'em_andamento', iniciada_em = :t WHERE id = :id", { id: execucaoId, t: inicio.toISOString() })
  const opcoes = lerOpcoesPesquisa(db)
  const regras = todos<{ dominio: string; regra: string }>(db, 'SELECT dominio, regra FROM regras_dominio WHERE projeto_id = :p', { p: ex.projeto_id })
  const confiaveis = regras.filter((r) => r.regra === 'confiavel').map((r) => r.dominio)
  const bloqueados = regras.filter((r) => r.regra === 'bloqueado').map((r) => r.dominio)
  const fontes = todos<FonteConfigurada>(db, 'SELECT id, tipo, nome, url FROM fontes_pesquisa WHERE projeto_id = :p AND ativo = 1 ORDER BY id LIMIT :n', {
    p: ex.projeto_id,
    n: LIMITES.maxFontes
  })
  if (fontes.length === 0) {
    registrar('—', 'erro', 'Nenhuma fonte ativa. Adicione feeds RSS ou páginas em Pautas e pesquisas › Fontes.')
    finalizar('erro', 'Nenhuma fonte ativa configurada.', { consultadas: 0, comErro: 0, total: 0 })
    return
  }

  const limiteTempo = AbortSignal.timeout(LIMITES.duracaoMaximaMs)
  const sinal = AbortSignal.any([sinalExterno, limiteTempo])
  const consulta = analisarConsulta(ex.consulta)
  let feitas = 0
  let comErro = 0
  const progresso = (etapa: string, resultados = 0): void => aoProgredir({ execucaoId, etapa, fontesFeitas: feitas, fontesTotal: fontes.length, resultados })
  progresso('Consultando fontes')

  const brutos: ResultadoBruto[] = []
  for (const provedor of PROVEDORES) {
    if (sinal.aborted || !provedor.estado(fontes).configurado) continue
    const r = await provedor.executar({
      consulta,
      fontes,
      sinal,
      buscar: deps.buscar,
      registrar,
      limites: { itensPorFonte: LIMITES.itensPorFonte, tempoPorFonteMs: LIMITES.tempoPorFonteMs, tamanhoMaximo: LIMITES.tamanhoMaximo },
      aoConcluirFonte: (f, ok, status) => {
        feitas++
        if (!ok) comErro++
        executar(db, 'UPDATE fontes_pesquisa SET ultimo_status = :s, ultima_execucao = :t WHERE id = :id', { id: f.id, s: status.slice(0, 200), t: agoraIso() })
        progresso(`Consultando fontes (${f.nome})`, brutos.length)
      }
    })
    brutos.push(...r)
  }

  if (limiteTempo.aborted) registrar('—', 'aviso', `Limite de ${LIMITES.duracaoMaximaMs / 1000} s atingido; resultados parciais foram mantidos.`)
  progresso('Classificando resultados', brutos.length)

  // Filtros: domínios bloqueados, somente confiáveis (opcional) e intervalo de datas.
  const de = new Date(ex.intervalo_de)
  const ate = new Date(ex.intervalo_ate)
  let foraDoPeriodo = 0
  let descartadosDominio = 0
  const filtrados = brutos.filter((b) => {
    const d = dominioDe(b.site || b.url)
    if (bloqueados.some((r) => dominioCasa(d, r)) || (opcoes.somenteConfiaveis && !confiaveis.some((r) => dominioCasa(d, r)))) {
      descartadosDominio++
      return false
    }
    if (b.publicadaEm) {
      const t = new Date(b.publicadaEm)
      if (t < de || t > new Date(ate.getTime() + 86_400_000)) {
        foraDoPeriodo++
        return false
      }
    }
    return true
  })
  if (descartadosDominio) registrar('—', 'info', `${descartadosDominio} resultado(s) descartado(s) pelas regras de domínio.`)
  if (foraDoPeriodo) registrar('—', 'info', `${foraDoPeriodo} resultado(s) fora do período pesquisado.`)

  const agora = deps.agora()
  // Em agregadores, o domínio que conta (confiabilidade, sugestões) é o do site original.
  const pontuados = filtrados
    .map((b) => ({ b, p: pontuar({ ...b, url: b.site || b.url }, { consulta, nicho: opcoes.nicho, agora, intervalo: { de, ate }, confiaveis }) }))
    .sort((x, y) => y.p.total - x.p.total)
    .slice(0, LIMITES.resultadosMaximos)
  const grupos = agrupar(pontuados.map((x) => x.b))

  transacao(db, () => {
    const ids: number[] = []
    pontuados.forEach(({ b, p }, i) => {
      const g = grupos[i]!
      const idioma = detectarIdioma(`${b.titulo} ${b.trecho}`)
      const explicacao = [...p.explicacao]
      if (idioma !== 'pt' && idioma !== 'desconhecido') explicacao.push('Em outro idioma: o resumo em português dependerá de um provedor de IA configurado.')
      const injecao = pareceInjecao(`${b.titulo} ${b.trecho}`)
      if (injecao) explicacao.push('Atenção: o texto contém frases que parecem instruções para uma IA. Tratado apenas como dado.')
      const { id } = executar(
        db,
        `INSERT INTO resultados_pesquisa (execucao_id, fonte_pesquisa_id, fonte_nome, titulo, url, url_canonica, dominio, autor, publicada_em,
           acessada_em, trecho, idioma, tipo_fonte, relevancia, atualidade, confiabilidade, nicho, pontuacao, explicacao, grupo, duplicado_de,
           alerta_injecao, criado_em)
         VALUES (:e, :f, :fn, :titulo, :url, :canon, :dom, :autor, :pub, :acesso, :trecho, :idioma, :tipo, :rel, :atu, :conf, :nicho, :total,
           :expl, NULL, NULL, :inj, :t)`,
        {
          e: execucaoId,
          f: b.fonteId,
          fn: b.fonteNome,
          titulo: b.titulo,
          url: b.url,
          canon: urlCanonica(b.url),
          dom: dominioDe(b.site || b.url),
          autor: b.autor,
          pub: b.publicadaEm,
          acesso: agora.toISOString(),
          trecho: b.trecho,
          idioma,
          tipo: classificarTipoFonte(dominioDe(b.site || b.url)),
          rel: p.relevancia,
          atu: p.atualidade,
          conf: p.confiabilidade,
          nicho: p.nicho,
          total: p.total,
          expl: JSON.stringify(explicacao),
          inj: injecao ? 1 : 0,
          t: agoraIso()
        }
      )
      ids.push(id)
      executar(db, 'UPDATE resultados_pesquisa SET grupo = :g, duplicado_de = :d WHERE id = :id', {
        id,
        g: ids[g.grupo] ?? id,
        d: g.duplicadoDe === null ? null : (ids[g.duplicadoDe] ?? null)
      })
    })
  })

  // Sites novos vistos nos resultados viram sugestões de fonte (só entram com a aprovação do usuário).
  if (!sinal.aborted && pontuados.length) {
    progresso('Procurando novas fontes', pontuados.length)
    try {
      const novas = await registrarSugestoes(db, execucaoId, ex.projeto_id, deps.buscar, sinal)
      if (novas) registrar('—', 'info', `${novas} nova(s) fonte(s) sugerida(s) para a sua aprovação (Pautas e pesquisas › Fontes e opções).`)
    } catch {
      registrar('—', 'aviso', 'Não foi possível procurar novas fontes desta vez.')
    }
  }

  const extra = { consultadas: feitas, comErro, total: pontuados.length }
  if (sinalExterno.aborted) {
    registrar('—', 'aviso', 'Pesquisa cancelada pelo usuário; resultados parciais foram mantidos.')
    finalizar('cancelada', null, extra)
  } else if (feitas > 0 && comErro === feitas) {
    finalizar('erro', 'Todas as fontes falharam. Veja o registro por fonte.', extra)
  } else {
    finalizar('concluida', comErro ? `${comErro} fonte(s) com erro.` : null, extra)
  }
  progresso('Concluída', pontuados.length)
}

/** Controla execuções em andamento (uma por vez), progresso e cancelamento. */
export class GerenciadorPesquisas {
  private ativa: { id: number; controle: AbortController; progresso: ProgressoPesquisa } | null = null

  constructor(
    private readonly db: Banco,
    private readonly deps: DependenciasPesquisa = DEPENDENCIAS_PADRAO
  ) {}

  emAndamento(): number | null {
    return this.ativa?.id ?? null
  }

  progresso(id: number): ProgressoPesquisa | null {
    return this.ativa?.id === id ? this.ativa.progresso : null
  }

  /** Inicia em segundo plano (dentro do app aberto) e devolve o número da execução. */
  iniciar(d: { projetoId: number; consulta: string; pautaId: number | null; origem: 'manual' | 'agendada' }): { id: number; termino: Promise<void> } {
    if (this.ativa) throw new Error('ocupado')
    const id = criarExecucao(this.db, d, this.deps.agora())
    const controle = new AbortController()
    this.ativa = { id, controle, progresso: { execucaoId: id, etapa: 'Iniciando', fontesFeitas: 0, fontesTotal: 0, resultados: 0 } }
    const termino = executarPesquisa(this.db, id, this.deps, controle.signal, (p) => {
      if (this.ativa?.id === id) this.ativa.progresso = p
    })
      .catch((e: unknown) => {
        registrarEvento(this.db, 'erro', 'pesquisa', e instanceof Error ? e.message : String(e))
        executar(this.db, "UPDATE execucoes_pesquisa SET status = 'erro', mensagem_erro = 'Erro inesperado.', concluida_em = :t WHERE id = :id", {
          id,
          t: agoraIso()
        })
      })
      .finally(() => {
        if (this.ativa?.id === id) this.ativa = null
      })
    return { id, termino }
  }

  cancelar(id: number): boolean {
    if (this.ativa?.id !== id) return false
    this.ativa.controle.abort()
    return true
  }
}

/** Ao abrir o app: execuções que ficaram "em andamento" foram interrompidas pelo fechamento. */
export function recuperarInterrompidas(db: Banco): number {
  const r = executar(
    db,
    "UPDATE execucoes_pesquisa SET status = 'erro', mensagem_erro = 'Interrompida porque o aplicativo foi fechado.', concluida_em = :t WHERE status IN ('em_andamento','pendente')",
    { t: agoraIso() }
  )
  executar(
    db,
    "UPDATE tarefas SET status = 'erro', diagnostico = 'Interrompida porque o aplicativo foi fechado. Use “Tentar novamente”.', atualizado_em = :t WHERE status = 'em_andamento'",
    { t: agoraIso() }
  )
  return r.changes
}
