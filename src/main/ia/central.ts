import { createHash } from 'node:crypto'
import { type Banco, agoraIso, executar, todos, um } from '../db/conexao'
import { ErroApp, naoEncontrado } from '../erros'
import { gravarConfig, lerConfig } from '../repositorios/configuracoes'
import {
  CATEGORIAS_SERVICO,
  INFO_ADAPTADOR,
  POLITICA_PADRAO,
  estimarCusto,
  estimarTokens,
  politicaIaSchema,
  provedorIaSchema,
  type PlanoEnvio,
  type PoliticaIa,
  type ProvedorIaConfig,
  type ProvedorIaEntrada
} from '@shared/ia'
import { CATALOGO_IA, escolherModelo, escolherReservas } from '@shared/catalogoIa'
import type { CentralServicos, ProvedorIa, RotaIa } from '@shared/tipos'
import { ErroRede } from '../pesquisa/rede'
import { ADAPTADORES, type RespostaLlm } from './adaptadores'
import type { Cofre } from './cofre'
import { validarUrlProvedor } from './http'
import { abrirOllama } from './ollamaLocal'

const CHAVE_POLITICA = 'ia.politica'

export function lerPolitica(db: Banco): PoliticaIa {
  const r = politicaIaSchema.safeParse(lerConfig(db, CHAVE_POLITICA))
  return r.success ? r.data : POLITICA_PADRAO
}

export function salvarPolitica(db: Banco, p: PoliticaIa): PoliticaIa {
  gravarConfig(db, CHAVE_POLITICA, p)
  return p
}

const chaveCofre = (id: number): string => `provedor:${id}`

type Linha = { id: number; categoria: string; adaptador: string; nome: string; ativo: number; config: string; pausado_ate: string | null; ultimo_erro: string | null }

/** Início do dia em UTC: a maioria dos fornecedores renova a cota diária nesse horário. */
export const inicioDoDia = (agora: Date): string => new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate())).toISOString()

function paraProvedor(l: Linha, cofre: Cofre, db: Banco, agora = new Date()): ProvedorIa {
  const config = provedorIaSchema.parse(JSON.parse(l.config))
  const info = INFO_ADAPTADOR[config.adaptador]
  const ultimo = um<{ t: string }>(db, 'SELECT MAX(criado_em) AS t FROM uso_servicos WHERE provedor_id = :id', { id: l.id })
  const hoje = um<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM uso_servicos WHERE provedor_id = :id AND criado_em >= :d', { id: l.id, d: inicioDoDia(agora) })?.n ?? 0
  return {
    id: l.id,
    ativo: Boolean(l.ativo),
    config,
    local: info.local,
    chaveConfigurada: !info.exigeChave || cofre.possui(chaveCofre(l.id)),
    exigeChave: info.exigeChave,
    ultimaUtilizacao: ultimo?.t ?? null,
    pausadoAte: l.pausado_ate && l.pausado_ate > agora.toISOString() ? l.pausado_ate : null,
    ultimoErro: l.ultimo_erro,
    usoHoje: hoje
  }
}

export function listarProvedores(db: Banco, cofre: Cofre, agora = new Date()): ProvedorIa[] {
  return todos<Linha>(db, 'SELECT * FROM provedores_ia ORDER BY id').map((l) => paraProvedor(l, cofre, db, agora))
}

export function obterProvedor(db: Banco, cofre: Cofre, id: number, agora = new Date()): ProvedorIa {
  const l = um<Linha>(db, 'SELECT * FROM provedores_ia WHERE id = :id', { id })
  if (!l) throw naoEncontrado('Provedor')
  return paraProvedor(l, cofre, db, agora)
}

/** Pausa automática: o roteador pula o provedor até o horário indicado. */
export function pausarProvedor(db: Banco, id: number, ate: Date, motivo: string): void {
  executar(db, 'UPDATE provedores_ia SET pausado_ate = :a, ultimo_erro = :m WHERE id = :id', { id, a: ate.toISOString(), m: motivo.slice(0, 300) })
}

export function reativarProvedor(db: Banco, id: number): void {
  if (executar(db, 'UPDATE provedores_ia SET pausado_ate = NULL, ultimo_erro = NULL WHERE id = :id', { id }).changes === 0) throw naoEncontrado('Provedor')
}

/**
 * Depois de uma falha, decide quanto tempo o provedor descansa:
 * limite (429) → o tempo pedido pelo fornecedor ou 1 hora; chave recusada (401/403) → 24 horas;
 * instabilidade (5xx, tempo esgotado) → 10 minutos. Outros erros não pausam.
 */
export function pausaPorErro(e: unknown, agora: Date): { ate: Date; motivo: string } | null {
  if (!(e instanceof ErroRede)) return null
  if (e.codigo === 'http' && e.status === 429) {
    const ms = Math.min(Math.max(e.repetirAposMs ?? 3_600_000, 60_000), 24 * 3_600_000)
    return { ate: new Date(agora.getTime() + ms), motivo: `Limite do fornecedor atingido (429). ${e.message}` }
  }
  if (e.codigo === 'http' && (e.status === 401 || e.status === 403)) return { ate: new Date(agora.getTime() + 24 * 3_600_000), motivo: `Chave recusada (${e.status}). Confira ou troque a chave.` }
  if ((e.codigo === 'http' && (e.status ?? 0) >= 500) || e.codigo === 'tempo_esgotado' || e.codigo === 'conexao') {
    return { ate: new Date(agora.getTime() + 10 * 60_000), motivo: `Fornecedor instável: ${e.message}` }
  }
  return null
}

function gastoNoMes(db: Banco, agora: Date): number {
  const inicio = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), 1)).toISOString()
  return um<{ s: number | null }>(db, 'SELECT SUM(custo) AS s FROM uso_servicos WHERE criado_em >= :i', { i: inicio })?.s ?? 0
}

export function central(db: Banco, cofre: Cofre, agora = new Date(), rotas: RotaIa[] = []): CentralServicos {
  const provedores = listarProvedores(db, cofre, agora)
  const politica = lerPolitica(db)
  const usoRecente = todos<CentralServicos['usoRecente'][number]>(
    db,
    `SELECT provedor_nome AS provedor, finalidade, tokens_entrada AS tokensEntrada, tokens_saida AS tokensSaida, custo, moeda, sucesso, criado_em AS criadoEm
     FROM uso_servicos ORDER BY id DESC LIMIT 30`
  ).map((u) => ({ ...u, sucesso: Boolean(u.sucesso) }))
  const naoEstimadas = um<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM uso_servicos WHERE custo IS NULL AND criado_em >= :i', {
    i: new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), 1)).toISOString()
  })?.n ?? 0
  return {
    politica,
    provedores,
    categorias: CATEGORIAS_SERVICO.map((c) => ({
      categoria: c,
      disponivel: c === 'llm',
      mensagem: c === 'llm' ? 'Adaptadores: simulado, Ollama (local) e API compatível com OpenAI.' : 'Nenhum adaptador disponível nesta versão.'
    })),
    gastoMes: gastoNoMes(db, agora),
    chamadasSemCustoEstimadoNoMes: naoEstimadas,
    cofreDisponivel: cofre.disponivel(),
    rotas,
    usoRecente
  }
}

function validarConfig(c: ProvedorIaConfig): void {
  const info = INFO_ADAPTADOR[c.adaptador]
  if (c.adaptador !== 'simulado') {
    validarUrlProvedor(c.urlBase, info.local)
    if (!c.modelo) throw new ErroApp('validacao', 'Informe o nome do modelo.')
  }
}

export function salvarProvedor(db: Banco, cofre: Cofre, id: number | null, entrada: ProvedorIaEntrada): ProvedorIa {
  const c = provedorIaSchema.parse(entrada)
  validarConfig(c)
  const t = agoraIso()
  if (id === null) {
    const r = executar(db, "INSERT INTO provedores_ia (categoria, adaptador, nome, config, criado_em, atualizado_em) VALUES ('llm', :a, :n, :c, :t, :t)", {
      a: c.adaptador,
      n: c.nome,
      c: JSON.stringify(c),
      t
    })
    return obterProvedor(db, cofre, r.id)
  }
  if (executar(db, 'UPDATE provedores_ia SET adaptador = :a, nome = :n, config = :c, atualizado_em = :t WHERE id = :id', { id, a: c.adaptador, n: c.nome, c: JSON.stringify(c), t }).changes === 0) {
    throw naoEncontrado('Provedor')
  }
  return obterProvedor(db, cofre, id)
}

export function ativarProvedor(db: Banco, id: number, ativo: boolean): void {
  if (executar(db, 'UPDATE provedores_ia SET ativo = :a WHERE id = :id', { id, a: ativo ? 1 : 0 }).changes === 0) throw naoEncontrado('Provedor')
}

/** Remove o provedor e apaga sua chave do cofre. */
export function removerProvedor(db: Banco, cofre: Cofre, id: number): void {
  if (executar(db, 'DELETE FROM provedores_ia WHERE id = :id', { id }).changes === 0) throw naoEncontrado('Provedor')
  cofre.remover(chaveCofre(id))
}

export function definirChave(db: Banco, cofre: Cofre, id: number, chave: string | null): void {
  obterProvedor(db, cofre, id)
  if (chave === null) cofre.remover(chaveCofre(id))
  else cofre.guardar(chaveCofre(id), chave)
}

export async function testarProvedor(db: Banco, cofre: Cofre, id: number): Promise<string> {
  const p = obterProvedor(db, cofre, id)
  const msg = await ADAPTADORES[p.config.adaptador].testar(p.config, cofre.obter(chaveCofre(id)), AbortSignal.timeout(20_000))
  reativarProvedor(db, id) // funcionou: sai da pausa automática
  return msg
}

export async function listarModelos(db: Banco, cofre: Cofre, id: number): Promise<string[]> {
  const p = obterProvedor(db, cofre, id)
  const item = CATALOGO_IA.find((c) => c.id === p.config.catalogo)
  const modelos = await ADAPTADORES[p.config.adaptador].listarModelos(p.config, cofre.obter(chaveCofre(id)), AbortSignal.timeout(25_000), item?.urlModelos)
  return item?.exigeNoModelo ? modelos.filter((m) => m.includes(item.exigeNoModelo!)) : modelos
}

/**
 * Adiciona uma IA do catálogo em um passo: cria o provedor (gratuito, com a prioridade sugerida), guarda a chave
 * no cofre, busca os modelos disponíveis agora e escolhe um. Se a busca falhar, o provedor fica desativado
 * com a mensagem do erro, para o usuário corrigir a chave.
 */
export async function adicionarDoCatalogo(db: Banco, cofre: Cofre, catalogoId: string, chave: string | null): Promise<{ provedor: ProvedorIa; modelos: string[]; mensagem: string }> {
  const item = CATALOGO_IA.find((c) => c.id === catalogoId)
  if (!item) throw new ErroApp('validacao', 'Item do catálogo desconhecido.')
  const info = INFO_ADAPTADOR[item.adaptador]
  if (info.exigeChave && !chave) throw new ErroApp('validacao', `Cole a chave de ${item.nome}.`)
  const ja = todos<Linha>(db, 'SELECT * FROM provedores_ia').find((l) => provedorIaSchema.parse(JSON.parse(l.config)).catalogo === item.id)
  const config: ProvedorIaConfig = provedorIaSchema.parse({
    nome: item.nome,
    adaptador: item.adaptador,
    urlBase: item.urlBase,
    modelo: '',
    precoEntradaPorMilhao: 0,
    precoSaidaPorMilhao: 0,
    maxTokensSaida: 4000,
    limitesConhecidos: item.limites,
    gratuito: true,
    prioridade: item.prioridade,
    catalogo: item.id
  })
  const provedor = salvarProvedorSemValidarModelo(db, ja?.id ?? null, ja ? { ...provedorIaSchema.parse(JSON.parse(ja.config)), urlBase: item.urlBase } : config)
  if (chave) cofre.guardar(chaveCofre(provedor.id), chave)
  try {
    const modelos = await listarModelos(db, cofre, provedor.id)
    const modelo = escolherModelo(item, modelos)
    if (!modelo) throw new ErroApp('sem_modelo', item.adaptador === 'ollama' ? 'O Ollama está aberto, mas ainda não tem nenhum modelo. Clique em “Configurar o Ollama (1 clique)”: o aplicativo baixa um modelo leve sozinho.' : 'Nenhum modelo de texto disponível para esta chave.')
    const atual = obterProvedor(db, cofre, provedor.id)
    const principal = atual.config.modelo && modelos.includes(atual.config.modelo) ? atual.config.modelo : modelo
    salvarProvedorSemValidarModelo(db, provedor.id, { ...atual.config, modelo: principal, modelosReserva: info.local ? [] : escolherReservas(item, modelos, principal) })
    ativarProvedor(db, provedor.id, true)
    reativarProvedor(db, provedor.id)
    return { provedor: obterProvedor(db, cofre, provedor.id), modelos, mensagem: `${item.nome} conectado. Modelo escolhido: ${obterProvedor(db, cofre, provedor.id).config.modelo}.` }
  } catch (e) {
    ativarProvedor(db, provedor.id, false)
    const msg = e instanceof Error ? e.message : 'Falha ao conectar.'
    executar(db, 'UPDATE provedores_ia SET ultimo_erro = :m WHERE id = :id', { id: provedor.id, m: msg.slice(0, 300) })
    return { provedor: obterProvedor(db, cofre, provedor.id), modelos: [], mensagem: `Não foi possível conectar a ${item.nome}: ${msg}` }
  }
}

function salvarProvedorSemValidarModelo(db: Banco, id: number | null, c: ProvedorIaConfig): { id: number } {
  if (c.adaptador !== 'simulado') validarUrlProvedor(c.urlBase, INFO_ADAPTADOR[c.adaptador].local)
  const t = agoraIso()
  if (id === null) {
    return { id: executar(db, "INSERT INTO provedores_ia (categoria, adaptador, nome, config, criado_em, atualizado_em) VALUES ('llm', :a, :n, :c, :t, :t)", { a: c.adaptador, n: c.nome, c: JSON.stringify(c), t }).id }
  }
  executar(db, 'UPDATE provedores_ia SET adaptador = :a, nome = :n, config = :c, atualizado_em = :t WHERE id = :id', { id, a: c.adaptador, n: c.nome, c: JSON.stringify(c), t })
  return { id }
}

// ------------------------------------------------------------------ plano de envio e execução

export interface PedidoEnvio {
  provedorId: number
  finalidade: string
  partes: { rotulo: string; texto: string }[]
  sistema: string
  maxTokens?: number
}

function assinar(p: Omit<PlanoEnvio, 'assinatura'>, pedido: PedidoEnvio): string {
  const h = createHash('sha256')
  h.update(JSON.stringify({ ...p, bloqueios: undefined, avisos: undefined }))
  h.update(pedido.sistema)
  for (const parte of pedido.partes) h.update(`\u0000${parte.rotulo}\u0000${parte.texto}`)
  return h.digest('hex')
}

/**
 * Monta o plano: o que será enviado, para onde, com qual finalidade e custo estimado.
 * Bloqueia pelas regras do código (modo, tetos, chave) — não depende da IA.
 */
export function planejarEnvio(db: Banco, cofre: Cofre, pedido: PedidoEnvio, agora = new Date()): PlanoEnvio {
  const p = obterProvedor(db, cofre, pedido.provedorId)
  const politica = lerPolitica(db)
  const entrada = estimarTokens(pedido.sistema + pedido.partes.map((x) => x.texto).join('\n'))
  const saida = Math.min(pedido.maxTokens ?? p.config.maxTokensSaida, p.config.maxTokensSaida)
  const valor = p.local || p.config.gratuito ? 0 : estimarCusto(p.config, entrada, saida)
  const bloqueios: string[] = []
  const avisos: string[] = []
  if (!p.ativo) bloqueios.push('O provedor está desativado.')
  if (!p.chaveConfigurada) bloqueios.push('A chave do provedor não foi configurada.')
  if (!p.local && politica.modo === 'local') bloqueios.push('O modo atual é “somente local”: provedores online estão desativados.')
  if (p.pausadoAte) bloqueios.push(`Provedor em pausa automática até ${new Date(p.pausadoAte).toLocaleString('pt-BR')}: ${p.ultimoErro ?? 'limite atingido'}.`)
  if (p.config.limiteDiario !== null && p.usoHoje >= p.config.limiteDiario) bloqueios.push(`Limite diário definido por você atingido (${p.usoHoje}/${p.config.limiteDiario}).`)
  if (!p.local) {
    avisos.push(`Os dados listados serão enviados para ${p.config.urlBase.replace(/^https?:\/\//, '').split('/')[0]} (${p.config.nome}).`)
    if (p.config.gratuito) avisos.push('Marcado como gratuito: custo zero no app. Se o fornecedor passar a cobrar, desmarque “gratuito” e informe os preços.')
    if (valor === null) avisos.push('Não foi possível estimar o custo (preços não informados). Você precisa autorizar explicitamente.')
    else {
      if (politica.tetoPorExecucao !== null && valor > politica.tetoPorExecucao) bloqueios.push(`Custo estimado (${valor.toFixed(4)} ${politica.moeda}) acima do teto por execução (${politica.tetoPorExecucao} ${politica.moeda}).`)
      const gasto = gastoNoMes(db, agora)
      if (politica.tetoMensal !== null && gasto + valor > politica.tetoMensal) bloqueios.push(`O teto mensal (${politica.tetoMensal} ${politica.moeda}) seria ultrapassado: já usado ${gasto.toFixed(4)}, estimado ${valor.toFixed(4)}.`)
    }
    if (p.config.limitesConhecidos) avisos.push(`Limites informados: ${p.config.limitesConhecidos}`)
  }
  const base: Omit<PlanoEnvio, 'assinatura'> = {
    provedorId: p.id,
    provedorNome: p.config.nome,
    adaptador: p.config.adaptador,
    local: p.local,
    destino: p.config.adaptador === 'simulado' ? 'nenhum (simulado)' : p.config.urlBase,
    finalidade: pedido.finalidade,
    dados: pedido.partes.map((x) => ({ rotulo: x.rotulo, caracteres: x.texto.length })),
    tokensEstimados: { entrada, saida },
    custo: { estimavel: valor !== null, valor, moeda: politica.moeda },
    bloqueios,
    avisos,
    // Gratuitos dispensam a autorização a cada envio só se a política permitir (decisão explícita do usuário).
    exigeAutorizacao: !p.local && !(p.config.gratuito && politica.modo !== 'local' && politica.gratuitosAutomaticos)
  }
  return { ...base, assinatura: assinar(base, pedido) }
}

/** Executa somente se o plano não tiver bloqueios e, quando online, se o usuário autorizou exatamente este plano. */
export async function executarEnvio(
  db: Banco,
  cofre: Cofre,
  pedido: PedidoEnvio,
  autorizacao: string | null,
  opcoes: { temperatura: number; json: boolean; sinal: AbortSignal; tarefa?: string }
): Promise<RespostaLlm> {
  const plano = planejarEnvio(db, cofre, pedido)
  if (plano.bloqueios.length) throw new ErroApp('envio_bloqueado', plano.bloqueios.join(' '))
  if (plano.exigeAutorizacao && autorizacao !== plano.assinatura) {
    throw new ErroApp('autorizacao_necessaria', 'O envio precisa da sua autorização para este conteúdo e custo. Revise o plano e autorize.')
  }
  const p = obterProvedor(db, cofre, pedido.provedorId)
  const registrar = (modelo: string, r: RespostaLlm | null, erro: string | null = null): void => {
    const entrada = r?.tokensEntrada ?? plano.tokensEstimados.entrada
    const saida = r?.tokensSaida ?? (r ? plano.tokensEstimados.saida : 0)
    executar(
      db,
      `INSERT INTO uso_servicos (provedor_id, provedor_nome, finalidade, tokens_entrada, tokens_saida, custo, moeda, sucesso, tarefa, erro, criado_em)
       VALUES (:p, :n, :f, :e, :s, :c, :m, :ok, :tarefa, :erro, :t)`,
      {
        p: p.id,
        n: modelo === p.config.modelo ? p.config.nome : `${p.config.nome} (${modelo})`,
        f: pedido.finalidade.slice(0, 120),
        e: entrada,
        s: saida,
        c: p.local || p.config.gratuito ? 0 : estimarCusto(p.config, entrada, saida),
        m: plano.custo.moeda,
        ok: r ? 1 : 0,
        tarefa: opcoes.tarefa ?? null,
        erro: erro?.slice(0, 300) ?? null,
        t: agoraIso()
      }
    )
  }
  const gerar = (modelo: string): Promise<RespostaLlm> =>
    ADAPTADORES[p.config.adaptador].gerar(
      { sistema: pedido.sistema, usuario: pedido.partes.map((x) => `### ${x.rotulo}\n${x.texto}`).join('\n\n'), maxTokens: plano.tokensEstimados.saida, temperatura: opcoes.temperatura, json: opcoes.json },
      { ...p.config, modelo },
      cofre.obter(chaveCofre(p.id)),
      opcoes.sinal
    )
  const modelos = modelosLivres(db, p.config, p.id, new Date())
  let abriuOllama = false
  for (let i = 0; i < modelos.length; i++) {
    const modelo = modelos[i]!
    try {
      const r = await gerar(modelo)
      registrar(modelo, r)
      return r
    } catch (e) {
      registrar(modelo, null, e instanceof Error ? e.message : 'Falha')
      if (opcoes.sinal.aborted) throw e
      // IA local fechada: abre o Ollama e tenta de novo uma vez.
      if (!abriuOllama && p.config.adaptador === 'ollama' && e instanceof ErroRede && e.codigo === 'conexao') {
        abriuOllama = true
        if (await abrirOllama(p.config.urlBase)) {
          i--
          continue
        }
      }
      // Modelo que o fornecedor não tem mais (404) fica de lado por um dia; JSON inválido (400) tenta o próximo modelo.
      if (e instanceof ErroRede && e.codigo === 'http' && (e.status === 404 || e.status === 400)) {
        if (e.status === 404) pausarModelo(db, p.id, modelo, new Date(Date.now() + 24 * 3_600_000))
        if (i < modelos.length - 1) continue
      }
      const pausa = pausaPorErro(e, new Date())
      // Cota esgotada só deste modelo: passa para um modelo reserva do mesmo fornecedor.
      if (pausa && e instanceof ErroRede && e.status === 429) {
        pausarModelo(db, p.id, modelo, pausa.ate)
        if (i === modelos.length - 1) {
          for (const m of await descobrirReservas(db, cofre, p.id)) if (!modelos.includes(m) && !modeloPausado(db, p.id, m, new Date())) modelos.push(m)
        }
        if (i < modelos.length - 1) continue
        // Todos os modelos sem cota: o fornecedor descansa até o primeiro deles voltar.
        pausarProvedor(db, p.id, primeiraVolta(db, p.id, [p.config.modelo, ...p.config.modelosReserva], pausa.ate), pausa.motivo)
        throw e
      }
      if (pausa) pausarProvedor(db, p.id, pausa.ate, pausa.motivo)
      throw e
    }
  }
  throw new ErroApp('envio_bloqueado', 'Todos os modelos deste provedor estão sem cota no momento.')
}

// ------------------------------------------------------------------ modelos reserva (cota por modelo)

const CHAVE_PAUSA_MODELOS = 'ia.pausaModelos'
const chaveModelo = (id: number, modelo: string): string => `${id}:${modelo}`

function pausasModelos(db: Banco): Record<string, string> {
  const v = lerConfig<Record<string, string>>(db, CHAVE_PAUSA_MODELOS)
  return v && typeof v === 'object' ? v : {}
}

function modeloPausado(db: Banco, id: number, modelo: string, agora: Date): boolean {
  const ate = pausasModelos(db)[chaveModelo(id, modelo)]
  return !!ate && ate > agora.toISOString()
}

export function pausarModelo(db: Banco, id: number, modelo: string, ate: Date): void {
  const agora = new Date().toISOString()
  const atuais = Object.fromEntries(Object.entries(pausasModelos(db)).filter(([, v]) => v > agora))
  gravarConfig(db, CHAVE_PAUSA_MODELOS, { ...atuais, [chaveModelo(id, modelo)]: ate.toISOString() })
}

/** Modelo principal e reservas que ainda têm cota agora (o principal primeiro). */
export function modelosLivres(db: Banco, c: ProvedorIaConfig, id: number, agora: Date): string[] {
  const todosModelos = [c.modelo, ...c.modelosReserva.filter((m) => m !== c.modelo)]
  const livres = todosModelos.filter((m) => !modeloPausado(db, id, m, agora))
  return livres.length ? livres : [c.modelo]
}

function primeiraVolta(db: Banco, id: number, modelos: string[], padrao: Date): Date {
  const p = pausasModelos(db)
  const datas = modelos.map((m) => p[chaveModelo(id, m)]).filter((d): d is string => !!d).sort()
  return datas[0] ? new Date(datas[0]) : padrao
}

/**
 * Na primeira vez que o modelo principal esgota a cota, busca na lista atual do fornecedor (com a mesma chave)
 * outros modelos de texto pelas preferências do catálogo e guarda como reserva. Só para itens do catálogo.
 */
async function descobrirReservas(db: Banco, cofre: Cofre, id: number): Promise<string[]> {
  const p = obterProvedor(db, cofre, id)
  if (p.config.modelosReserva.length) return p.config.modelosReserva
  const item = CATALOGO_IA.find((c) => c.id === p.config.catalogo)
  if (!item || p.local) return []
  try {
    const reservas = escolherReservas(item, await listarModelos(db, cofre, id), p.config.modelo)
    if (reservas.length) salvarProvedorSemValidarModelo(db, id, { ...p.config, modelosReserva: reservas })
    return reservas
  } catch {
    return []
  }
}
