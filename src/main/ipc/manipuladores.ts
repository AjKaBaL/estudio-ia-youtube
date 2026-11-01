import { basename, join as juntar } from 'node:path'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import type { Contexto } from '../contexto'
import { criarBackup, listarBackups } from '../db/backup'
import { executar, todos, um } from '../db/conexao'
import { listarEventos, registrarEvento } from '../db/eventos'
import { versaoAtual } from '../db/migracoes'
import { exportarJson, exportarMarkdown, exportarTxt, nomeArquivo } from '../exportacao'
import * as agenda from '../repositorios/agenda'
import { lerConfig, gravarConfig } from '../repositorios/configuracoes'
import { comAlertas, lerEditorial, salvarEditorial } from '../repositorios/editorial'
import * as pautas from '../repositorios/pautas'
import * as lotes from '../repositorios/lotes'
import * as dossie from '../repositorios/dossie'
import * as ia from '../ia/central'
import * as gerador from '../roteiros/gerador'
import * as revisao from '../revisao/fluxo'
import * as midia from '../midia/biblioteca'
import * as edicao from '../midia/edicao'
import * as producao from '../midia/producao'
import { TIPOS_ACEITOS } from '../midia/biblioteca'
import { localizarFerramentas, versaoFfmpeg } from '../midia/ffmpeg'
import { PREFERENCIA_RENDER_PADRAO, type PreferenciaRender } from '@shared/midia'
import { estadoAssistente, salvarAssistente } from '../repositorios/assistente'
import * as links from '../repositorios/links'
import * as miniaturas from '../midia/miniaturas'
import * as publicacoes from '../youtube/publicacao'
import * as fila from '../producao/fila'
import * as etapas from '../producao/etapas'
import * as piloto from '../piloto'
import * as rapido from '../configRapida'
import * as midiaAuto from '../midia/automatica'
import { listarVozesWindows, piperInstalado, sintetizar } from '../midia/voz'
import { wingetDisponivel } from '../instaladores'
import { requisitarJson } from '../ia/http'
import { rotas as rotasIa } from '../ia/roteador'
import * as interna from '../revisao/interna'
import * as painel from '../producao/painel'
import { identificarFonte } from '../pesquisa/descoberta'
import { buscarSeguro, ErroRede } from '../pesquisa/rede'
import { lerArquivoCliente, procurarArquivoCliente } from '../youtube/arquivoCliente'
import * as derivados from '../producao/derivados'
import * as metricas from '../producao/metricas'
import { DESCRICAO_ESCOPOS, ErroYouTube } from '@estudio/youtube'

function exigirFfmpeg(ctx: Contexto): NonNullable<ReturnType<Contexto['ferramentas']>> {
  const f = ctx.ferramentas()
  if (!f) throw new ErroApp('sem_ffmpeg', 'FFmpeg não encontrado. Instale-o em Configurações › Vídeo e renderização.')
  return f
}

async function estadoDoAssistente(ctx: Contexto): Promise<import('@shared/tipos').EstadoAssistente> {
  const yt = await ctx.youtube.status().catch(() => ({ estado: 'erro' as const }))
  return estadoAssistente(ctx.db, { ffmpeg: ctx.ferramentas() !== null, youtube: yt.estado, backups: listarBackups(ctx.pastaBackups).length })
}

async function painelYouTube(ctx: Contexto): Promise<import('@shared/tipos').PainelYouTube> {
  const s = await ctx.youtube.status()
  return {
    status: { estado: s.estado, mensagem: s.mensagem, versaoRegras: s.versaoRegras, escopos: s.escopos.map((e) => ({ escopo: e, descricao: DESCRICAO_ESCOPOS[e] ?? e })) },
    aprovacaoObrigatoria: publicacoes.lerOpcoesYouTube(ctx.db).aprovacaoObrigatoria,
    envioEmAndamento: ctx.envios.emAndamento()
  }
}

/** Converte erros do pacote do YouTube em mensagens amigáveis para a interface. */
async function comYouTube<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    if (e instanceof ErroYouTube) throw new ErroApp(`youtube_${e.tipo}`, e.message)
    throw e
  }
}

// Uma geração por vez; permite cancelar a chamada em andamento.
const revisoesEmAndamento = new Set<number>()
const producoesMidia = new Set<number>()
const progressoMidia = new Map<number, ProgressoTarefa>()

async function painelMidia(ctx: Contexto): Promise<PainelMidiaAuto> {
  const ferr = juntar(ctx.pastaDados, 'ferramentas')
  const servicos = ['pexels', 'pixabay', 'pollinations', 'huggingface', 'cloudflare'] as const
  return {
    preferencia: midiaAuto.lerPreferenciaMidia(ctx),
    chaves: Object.fromEntries(servicos.map((s) => [s, ctx.cofre.possui(midiaAuto.chaveServico(s))])) as PainelMidiaAuto['chaves'],
    vozesWindows: await listarVozesWindows(ferr),
    piperInstalado: piperInstalado(ferr)
  }
}
const progressoQualidade = etapas.progressoQualidade

async function revisarEmSegundoPlano(ctx: Contexto, roteiroId: number): Promise<void> {
  if (revisoesEmAndamento.has(roteiroId)) return
  revisoesEmAndamento.add(roteiroId)
  try {
    const r = await interna.revisarInternamente(ctx.db, ctx.cofre, roteiroId)
    registrarEvento(ctx.db, r.resultado === 'reprovada' ? 'aviso' : 'info', 'revisao', `Revisão interna do roteiro nº ${roteiroId}: ${r.resultado} (${r.revisor}).`)
  } catch (e) {
    registrarEvento(ctx.db, 'erro', 'revisao', `Revisão interna do roteiro nº ${roteiroId} falhou: ${e instanceof Error ? e.message : String(e)}`)
  } finally {
    revisoesEmAndamento.delete(roteiroId)
  }
}

/** Painel do administrador com a situação de cada vídeo segundo o piloto automático. */
function painelCompleto(ctx: Contexto): import('@shared/tipos').PainelAdmin {
  const p = painel.painelAdmin(ctx.db)
  const s = piloto.situacoesVideos(ctx.db)
  return { ...p, videos: p.videos.map((v) => ({ ...v, situacao: s.get(v.id) })) }
}

let geracaoAtiva: AbortController | null = null

/** Tudo o que está acontecendo agora, para a barra de status do topo. Só leitura, rápido. */
function estadoAtividade(ctx: Contexto, agora = new Date()): EstadoAtividade {
  const atividades: EstadoAtividade['atividades'] = []
  const idPesquisa = ctx.pesquisas.emAndamento()
  if (idPesquisa !== null) {
    const p = ctx.pesquisas.progresso(idPesquisa)
    atividades.push({ tipo: 'pesquisa', titulo: 'Pesquisando novidades', percentual: p?.fontesTotal ? Math.round((p.fontesFeitas / p.fontesTotal) * 90) : null, detalhe: p ? `${p.etapa} · ${p.fontesFeitas} de ${p.fontesTotal || '?'} fonte(s)` : '' })
  }
  for (const r of todos<{ id: number; progresso: number }>(ctx.db, "SELECT id, progresso FROM renderizacoes WHERE status = 'em_andamento'")) {
    atividades.push({ tipo: 'render', titulo: `Renderizando o vídeo nº ${r.id}`, percentual: Math.round(r.progresso * 100), detalhe: '' })
  }
  for (const [id, q] of progressoQualidade) if (q.ativo) atividades.push({ tipo: 'qualidade', titulo: `Controle de qualidade nº ${id}`, percentual: q.percentual, detalhe: q.etapa })
  for (const e of todos<{ titulo: string; bytes: number; tamanho: number | null }>(ctx.db, "SELECT titulo, bytes_enviados AS bytes, tamanho FROM publicacoes WHERE status = 'enviando'")) {
    atividades.push({ tipo: 'envio', titulo: `Enviando ao YouTube: ${e.titulo}`, percentual: e.tamanho ? Math.round((e.bytes / e.tamanho) * 100) : null, detalhe: '' })
  }
  if (geracaoAtiva) atividades.push({ tipo: 'geracao', titulo: 'A IA está escrevendo um roteiro', percentual: null, detalhe: '' })
  for (const id of revisoesEmAndamento) atividades.push({ tipo: 'revisao', titulo: `Revisão interna do roteiro nº ${id}`, percentual: null, detalhe: '' })
  for (const [id, m] of progressoMidia) if (m.ativo) atividades.push({ tipo: 'midia', titulo: `Produzindo narração e imagens (edição nº ${id})`, percentual: m.percentual, detalhe: m.detalhe || m.etapa })
  const pil = piloto.pilotoOcupado()
  if (pil.rodando) atividades.push({ tipo: 'piloto', titulo: 'Piloto automático trabalhando', percentual: null, detalhe: pil.etapa ?? 'Conferindo as etapas dos vídeos' })
  const inst = rapido.progressoInstalacao()
  if (inst?.ativo) atividades.push({ tipo: 'instalacao', titulo: `Instalando ${inst.pacote === 'ollama' ? 'o Ollama' : inst.pacote === 'piper' ? 'a voz neural' : 'o FFmpeg'}`, percentual: inst.percentual, detalhe: inst.etapa })

  const cfg = lerEditorial(ctx.db)
  const proxima = horariosPesquisa(cfg, agora, new Date(agora.getTime() + 8 * 86_400_000), 1)[0] ?? null
  const ultima = um<{ quando: string; status: string; resultados: number }>(
    ctx.db,
    'SELECT COALESCE(concluida_em, iniciada_em, criado_em) AS quando, status, total_resultados AS resultados FROM execucoes_pesquisa ORDER BY id DESC LIMIT 1'
  )
  const n = (sql: string): number => um<{ n: number }>(ctx.db, sql)?.n ?? 0
  const avisos: string[] = []
  if (!n('SELECT COUNT(*) AS n FROM projetos WHERE arquivado_em IS NULL')) avisos.push('Nenhum projeto criado.')
  if (!n('SELECT COUNT(*) AS n FROM fontes_pesquisa WHERE ativo = 1')) avisos.push('Nenhuma fonte de pesquisa ativa.')
  if (!pesquisa.lerOpcoesPesquisa(ctx.db).termosMonitorados.length) avisos.push('Nenhum termo monitorado para as pesquisas automáticas.')
  if (cfg.pesquisa.frequencia === 'manual') avisos.push('As pesquisas automáticas estão em “somente manual”.')
  const pausada = fila.automacaoPausada(ctx.db)
  const cfgPiloto = piloto.lerConfigPiloto(ctx.db)
  const pilotoIa = cfgPiloto.ligado && cfgPiloto.aprovarComIa
  return {
    modo: pausada ? 'pausado' : atividades.length ? 'trabalhando' : 'espera',
    atividades,
    pilotoLigado: piloto.lerConfigPiloto(ctx.db).ligado,
    proximaPesquisa: pausada ? null : (proxima?.toISOString() ?? null),
    frequencia: ROTULO_FREQUENCIA[cfg.pesquisa.frequencia],
    ultimaPesquisa: ultima ?? null,
    pendentes: {
      revisar: pilotoIa ? 0 : n("SELECT COUNT(*) AS n FROM roteiros WHERE arquivado_em IS NULL AND status IN ('precisa_verificacao','pronto_revisao','em_revisao')"),
      pautasSemRoteiro: n("SELECT COUNT(*) AS n FROM pautas a WHERE a.status = 'aprovada' AND a.combinada_em IS NULL AND NOT EXISTS (SELECT 1 FROM roteiros r WHERE r.pauta_id = a.id)"),
      publicacoes: pilotoIa ? 0 : n("SELECT COUNT(*) AS n FROM publicacoes WHERE status = 'rascunho'")
    },
    avisos
  }
}

/** "Trabalhar agora": retoma as tarefas automáticas (se pausadas) e dispara a pesquisa com os termos monitorados. */
function trabalharAgora(ctx: Contexto): string {
  const pausada = fila.automacaoPausada(ctx.db)
  if (pausada) fila.definirPausaGlobal(ctx.db, false)
  // Um botão produz tudo: liga o piloto automático (se estiver desligado) e começa já.
  const cfgPiloto = piloto.lerConfigPiloto(ctx.db)
  const ligou = !cfgPiloto.ligado
  if (ligou) piloto.salvarConfigPiloto(ctx.db, { ...cfgPiloto, ligado: true })
  if (ctx.pesquisas.emAndamento() !== null) {
    void piloto.cicloPiloto(ctx).catch((e: unknown) => registrarEvento(ctx.db, 'erro', 'piloto', e instanceof Error ? e.message : String(e)))
    return `${ligou ? 'Piloto automático ligado. ' : ''}Já há uma pesquisa em andamento; o piloto segue produzindo.`
  }
  if (ctx.pesquisas.emAndamento() !== null) return pausada ? 'Tarefas automáticas retomadas. Já há uma pesquisa em andamento.' : 'Já há uma pesquisa em andamento.'
  const termos = pesquisa.lerOpcoesPesquisa(ctx.db).termosMonitorados
  if (!um(ctx.db, 'SELECT 1 FROM projetos WHERE arquivado_em IS NULL')) throw new ErroApp('sem_projeto', 'Crie o projeto do canal (Primeiros passos › Configurar tudo com o recomendado).')
  if (!termos.length) throw new ErroApp('sem_termos', 'Não há termos monitorados. Use “Usar termos padrão” em Pautas e pesquisas › Fontes e opções.')
  if (!um(ctx.db, 'SELECT 1 FROM fontes_pesquisa WHERE ativo = 1')) throw new ErroApp('sem_fontes', 'Não há fontes ativas. Use “Restaurar fontes padrão” em Pautas e pesquisas › Fontes e opções.')
  const t = new Date().toISOString()
  executar(
    ctx.db,
    `INSERT OR IGNORE INTO tarefas (tipo, descricao, status, agendada_para, criado_em, atualizado_em) VALUES (:tipo, 'Pesquisa iniciada pelo botão “Trabalhar agora”', 'pendente', :t, :t, :t)`,
    { tipo: TIPO_PESQUISA_AGENDADA, t }
  )
  void processarFilaPesquisa(ctx.db, ctx.pesquisas)?.catch((e: unknown) => registrarEvento(ctx.db, 'erro', 'pesquisa', e instanceof Error ? e.message : String(e)))
  registrarEvento(ctx.db, 'info', 'automacao', 'Trabalho iniciado pelo botão “Trabalhar agora”.')
  // Com o piloto ligado, avança também as etapas dos vídeos agora (sem esperar o próximo ciclo).
  if (piloto.lerConfigPiloto(ctx.db).ligado) void piloto.cicloPiloto(ctx).catch((e: unknown) => registrarEvento(ctx.db, 'erro', 'piloto', e instanceof Error ? e.message : String(e)))
  return `${pausada ? 'Tarefas automáticas retomadas. ' : ''}${ligou ? 'Piloto automático ligado: ele produz tudo sozinho, do tema ao envio privado. ' : ''}Pesquisa de novidades iniciada com ${termos.length} termo(s).`
}


import { PESOS_PADRAO } from '@shared/planejador'
import * as projetos from '../repositorios/projetos'
import * as roteiros from '../repositorios/roteiros'
import * as tarefas from '../repositorios/tarefas'
import * as pesquisa from '../repositorios/pesquisa'
import { PROVEDORES, type FonteConfigurada } from '../pesquisa/provedores'
import { ErroApp } from '../erros'
import { horariosPesquisa, intervaloPesquisa, ROTULO_FREQUENCIA, ROTULO_PERIODO } from '@shared/editorial'
import { processarFilaPesquisa } from '../pesquisa/agendadas'
import { TIPO_PESQUISA_AGENDADA } from '../repositorios/tarefas'
import { obterVisaoGeral } from '../repositorios/visaoGeral'
import type { Canal } from '@shared/canais'
import type { EntradaValidada, Saidas } from '@shared/ipc'
import { estadoUiSchema } from '@shared/schemas'
import type { EstadoAtividade, PainelMidiaAuto, ProgressoTarefa, ServicoStatus } from '@shared/tipos'

function registrarEventoSeguro(ctx: Contexto, e: unknown): void {
  registrarEvento(ctx.db, 'erro', 'publicacao', e instanceof Error ? e.message : String(e))
}

export type Manipuladores = { [C in Canal]: (entrada: EntradaValidada<C>, ctx: Contexto) => Saidas[C] | Promise<Saidas[C]> }

async function servicos(ctx: Contexto): Promise<ServicoStatus[]> {
  const yt = await ctx.youtube.status()
  return [
    { nome: 'Banco de dados local', estado: 'local', mensagem: `Funcionando (versão ${versaoAtual(ctx.db)}).` },
    { nome: 'YouTube', estado: yt.estado === 'conectado' ? 'conectado' : yt.estado === 'erro' ? 'erro' : 'nao_configurado', mensagem: yt.mensagem }
  ]
}

export const manipuladores: Manipuladores = {
  'sistema:info': (_, ctx) => ({
    versaoApp: ctx.versaoApp,
    versaoBanco: versaoAtual(ctx.db),
    pastaDados: ctx.pastaDados,
    backups: listarBackups(ctx.pastaBackups),
    automacaoSoComAppAberto: true
  }),
  'sistema:backup': (_, ctx) => ({ arquivo: criarBackup(ctx.db, ctx.pastaBackups, 'manual').arquivo }),
  'sistema:abrirPastaDados': async (_, ctx) => {
    await ctx.plataforma.abrirPasta(ctx.pastaDados)
    return null
  },
  'sistema:eventos': (_, ctx) => listarEventos(ctx.db, 200),
  'sistema:segundoPlano': (_, ctx) => ({ ...(ctx.plataforma.segundoPlano?.ler() ?? { bandeja: false, iniciarComWindows: false }), disponivel: Boolean(ctx.plataforma.segundoPlano) }),
  'sistema:definirSegundoPlano': (e, ctx) => {
    if (!ctx.plataforma.segundoPlano) throw new ErroApp('indisponivel', 'Disponível só no aplicativo aberto pelo Windows.')
    registrarEvento(ctx.db, 'info', 'sistema', `Segundo plano: bandeja ${e.bandeja ? 'ligada' : 'desligada'}, iniciar com o Windows ${e.iniciarComWindows ? 'ligado' : 'desligado'}.`)
    return { ...ctx.plataforma.segundoPlano.definir(e), disponivel: true }
  },

  'ui:obterEstado': (_, ctx) => {
    const r = estadoUiSchema.safeParse(lerConfig(ctx.db, 'ui.estado'))
    return r.success ? r.data : null
  },
  'ui:salvarEstado': (e, ctx) => {
    gravarConfig(ctx.db, 'ui.estado', e)
    return null
  },

  'visaoGeral:obter': async (_, ctx) => obterVisaoGeral(ctx.db, await servicos(ctx)),

  'projetos:listar': (_, ctx) => projetos.listarProjetos(ctx.db),
  'projetos:criar': (e, ctx) => {
    const p = projetos.criarProjeto(ctx.db, e)
    pesquisa.aplicarPadroesPesquisa(ctx.db)
    return projetos.obterProjeto(ctx.db, p.id)
  },
  'projetos:atualizar': (e, ctx) => projetos.atualizarProjeto(ctx.db, e),
  'projetos:excluir': (e, ctx) => {
    projetos.excluirProjeto(ctx.db, e.id)
    return null
  },

  'roteiros:buscar': (e, ctx) => roteiros.buscarRoteiros(ctx.db, e),
  'roteiros:obter': (e, ctx) => roteiros.obterRoteiro(ctx.db, e.id),
  'roteiros:criar': (e, ctx) => roteiros.criarRoteiro(ctx.db, e),
  'roteiros:salvar': (e, ctx) => roteiros.salvarRoteiro(ctx.db, e),
  'roteiros:renomear': (e, ctx) => roteiros.renomearRoteiro(ctx.db, e.id, e.titulo),
  'roteiros:duplicar': (e, ctx) => roteiros.duplicarRoteiro(ctx.db, e.id),
  'roteiros:arquivar': (e, ctx) => {
    roteiros.arquivarRoteiro(ctx.db, e.id, true)
    return null
  },
  'roteiros:restaurar': (e, ctx) => {
    roteiros.arquivarRoteiro(ctx.db, e.id, false)
    return null
  },
  'roteiros:excluir': (e, ctx) => {
    roteiros.excluirRoteiro(ctx.db, e.id)
    return null
  },
  'roteiros:alterarStatus': (e, ctx) => {
    // Etapa 9: "aprovado" só pelo fluxo de revisão; "publicado" só a partir de "aprovado".
    const atual = roteiros.obterRoteiro(ctx.db, e.id)
    if (e.status === 'aprovado') throw new ErroApp('fluxo', 'Use “Aprovar para produção” na tela de Revisão editorial.')
    if (e.status === 'publicado' && atual.status !== 'aprovado') throw new ErroApp('fluxo', 'Só um roteiro aprovado para produção pode ser marcado como publicado.')
    // Etapa 7: conferência factual obrigatória antes da revisão editorial.
    if (e.status === 'em_revisao') dossie.conferirAntesDaRevisao(ctx.db, e.id)
    return roteiros.alterarStatus(ctx.db, e.id, e.status)
  },
  'roteiros:versoes': (e, ctx) => roteiros.listarVersoes(ctx.db, e.id),
  'roteiros:versao': (e, ctx) => roteiros.obterVersao(ctx.db, e.roteiroId, e.numero),
  'roteiros:exportar': async (e, ctx) => {
    const r = roteiros.obterRoteiro(ctx.db, e.id)
    const conteudo =
      e.formato === 'txt'
        ? exportarTxt(r)
        : e.formato === 'md'
          ? exportarMarkdown(r)
          : exportarJson(
              r,
              roteiros.listarVersoes(ctx.db, r.id).map((v) => roteiros.obterVersao(ctx.db, r.id, v.numero)),
              ctx.versaoApp
            )
    const filtro = { txt: { nome: 'Texto', extensao: 'txt' }, md: { nome: 'Markdown', extensao: 'md' }, json: { nome: 'JSON', extensao: 'json' } }[e.formato]
    const caminho = await ctx.plataforma.salvarTexto(nomeArquivo(r.titulo, filtro.extensao), conteudo, filtro)
    return { salvo: caminho !== null, arquivo: caminho ? basename(caminho) : null }
  },
  'roteiros:adicionarFonte': (e, ctx) => roteiros.adicionarFonte(ctx.db, e),
  'roteiros:removerFonte': (e, ctx) => roteiros.removerFonte(ctx.db, e.roteiroId, e.fonteId),
  'roteiros:comentar': (e, ctx) => roteiros.comentar(ctx.db, e.roteiroId, e.texto),
  'roteiros:resolverComentario': (e, ctx) => {
    roteiros.resolverComentario(ctx.db, e.id)
    return null
  },

  'pautas:listar': (e, ctx) => pautas.listarPautas(ctx.db, e),
  'pautas:criar': (e, ctx) => pautas.criarPauta(ctx.db, e),
  'pautas:atualizar': (e, ctx) => pautas.atualizarPauta(ctx.db, e),
  'pautas:excluir': (e, ctx) => {
    pautas.excluirPauta(ctx.db, e.id)
    return null
  },
  'pautas:excluirVarias': (e, ctx) => pautas.excluirPautas(ctx.db, e.ids),
  'pautas:obter': (e, ctx) => pautas.obterPauta(ctx.db, e.id),
  'pautas:alterarStatus': (e, ctx) => pautas.alterarStatusPauta(ctx.db, e.id, e.status),
  'pautas:deResultados': (e, ctx) => pautas.pautaDeResultados(ctx.db, e.projetoId, e.resultadoIds),
  'pautas:removerResultado': (e, ctx) => pautas.removerResultadoDaPauta(ctx.db, e.pautaId, e.resultadoId),
  'pautas:combinar': (e, ctx) => pautas.combinarPautas(ctx.db, e.ids, e.titulo),
  'pautas:filaPesquisa': (e, ctx) => pautas.colocarNaFilaPesquisa(ctx.db, e.id),
  'planejador:pesos': (_, ctx) => ({ pesos: pautas.lerPesos(ctx.db), padrao: PESOS_PADRAO }),
  'planejador:salvarPesos': (e, ctx) => ({ pesos: pautas.salvarPesos(ctx.db, e), padrao: PESOS_PADRAO }),
  'lotes:listar': (e, ctx) => lotes.listarLotes(ctx.db, e.projetoId),
  'lotes:obter': (e, ctx) => lotes.obterLote(ctx.db, e.id),
  'lotes:criar': (e, ctx) => lotes.criarLote(ctx.db, e),
  'lotes:gerarSemanal': (e, ctx) => lotes.gerarLoteSemanal(ctx.db, e.projetoId),
  'lotes:adicionarPauta': (e, ctx) => lotes.adicionarAoLote(ctx.db, e.loteId, e.pautaId),
  'lotes:removerPauta': (e, ctx) => lotes.removerDoLote(ctx.db, e.loteId, e.pautaId),
  'lotes:selecionar': (e, ctx) => lotes.selecionarNoLote(ctx.db, e.loteId, e.pautaId, e.selecionada),
  'lotes:fechar': (e, ctx) => lotes.fecharLote(ctx.db, e.id, e.fechado),
  'lotes:excluir': (e, ctx) => {
    lotes.excluirLote(ctx.db, e.id)
    return null
  },

  'editorial:obter': (_, ctx) => comAlertas(lerEditorial(ctx.db)),
  'editorial:salvar': (e, ctx) => salvarEditorial(ctx.db, e),

  'agenda:listar': (e, ctx) => agenda.listarAgenda(ctx.db, lerEditorial(ctx.db), e.de, e.ate),
  'agenda:horariosLivres': (_, ctx) => agenda.horariosLivres(ctx.db, lerEditorial(ctx.db)),
  'agenda:agendar': (e, ctx) => agenda.agendar(ctx.db, lerEditorial(ctx.db), e),
  'agenda:reagendar': (e, ctx) => agenda.reagendar(ctx.db, lerEditorial(ctx.db), e.id, e.data, e.hora),
  'agenda:cancelar': (e, ctx) => {
    agenda.cancelarAgendamento(ctx.db, e.id)
    return null
  },

  'tarefas:listar': (_, ctx) => tarefas.listarTarefas(ctx.db),
  'tarefas:ignorar': (e, ctx) => {
    tarefas.ignorarTarefa(ctx.db, e.id)
    return null
  },
  'tarefas:repetir': (e, ctx) => {
    tarefas.repetirTarefa(ctx.db, e.id)
    return null
  },

  'pesquisa:painel': (e, ctx) => {
    const fontes: FonteConfigurada[] = e.projetoId ? pesquisa.listarFontesPesquisa(ctx.db, e.projetoId).filter((f) => f.ativo) : []
    const em = ctx.pesquisas.emAndamento()
    const cfg = lerEditorial(ctx.db).pesquisa
    const { de, ate } = intervaloPesquisa(cfg, new Date())
    return {
      provedores: PROVEDORES.map((p) => ({ id: p.id, nome: p.nome, descricao: p.descricao, exigeChave: p.exigeChave, ...p.estado(fontes) })),
      emAndamento: em === null ? null : ctx.pesquisas.progresso(em),
      ultimaExecucao: pesquisa.ultimaExecucao(ctx.db),
      intervaloAtual: { de: de.toISOString(), ate: ate.toISOString(), rotulo: ROTULO_PERIODO[cfg.periodo] }
    }
  },
  'pesquisa:opcoes': (_, ctx) => pesquisa.lerOpcoesPesquisa(ctx.db),
  'pesquisa:salvarOpcoes': (e, ctx) => pesquisa.salvarOpcoesPesquisa(ctx.db, e),
  'pesquisa:fontes': (e, ctx) => pesquisa.listarFontesPesquisa(ctx.db, e.projetoId),
  'pesquisa:adicionarFonte': (e, ctx) => pesquisa.adicionarFontePesquisa(ctx.db, e),
  'pesquisa:ativarFonte': (e, ctx) => {
    pesquisa.ativarFontePesquisa(ctx.db, e.id, e.ativo)
    return null
  },
  'pesquisa:removerFonte': (e, ctx) => {
    pesquisa.removerFontePesquisa(ctx.db, e.id)
    return null
  },
  'pesquisa:identificarFonte': async (e) => {
    const endereco = /^https?:\/\//i.test(e.url) ? e.url : `https://${e.url}`
    try {
      return await identificarFonte(endereco, buscarSeguro)
    } catch (erro) {
      if (erro instanceof ErroRede) throw new ErroApp('rede', `Não foi possível abrir o endereço: ${erro.message}`)
      throw new ErroApp('url_invalida', 'Endereço inválido. Exemplo: tecnoblog.net ou https://tecnoblog.net/feed/')
    }
  },
  'pesquisa:restaurarFontesPadrao': (e, ctx) => ({ adicionadas: pesquisa.restaurarFontesPadrao(ctx.db, e.projetoId) }),
  'pesquisa:sugestoesFontes': (e, ctx) => pesquisa.listarSugestoesFontes(ctx.db, e.projetoId),
  'pesquisa:aprovarSugestao': (e, ctx) => pesquisa.aprovarSugestaoFonte(ctx.db, e.id),
  'pesquisa:recusarSugestao': (e, ctx) => {
    pesquisa.recusarSugestaoFonte(ctx.db, e.id)
    return null
  },
  'pesquisa:regras': (e, ctx) => pesquisa.listarRegras(ctx.db, e.projetoId),
  'pesquisa:definirRegra': (e, ctx) => pesquisa.definirRegra(ctx.db, e),
  'pesquisa:removerRegra': (e, ctx) => {
    pesquisa.removerRegra(ctx.db, e.id)
    return null
  },
  'pesquisa:iniciar': (e, ctx) => {
    if (ctx.pesquisas.emAndamento() !== null) throw new ErroApp('ocupado', 'Já existe uma pesquisa em andamento. Aguarde ou cancele.')
    return { id: ctx.pesquisas.iniciar({ ...e, origem: 'manual' }).id }
  },
  'pesquisa:progresso': (e, ctx) => ctx.pesquisas.progresso(e.id),
  'pesquisa:cancelar': (e, ctx) => ({ cancelada: ctx.pesquisas.cancelar(e.id) }),
  'pesquisa:execucoes': (e, ctx) => pesquisa.listarExecucoes(ctx.db, e.projetoId, e.limite),
  'pesquisa:execucao': (e, ctx) => pesquisa.obterExecucao(ctx.db, e.id),
  'pesquisa:resultadoParaRoteiro': (e, ctx) => pesquisa.resultadoParaRoteiro(ctx.db, e.resultadoId, e.roteiroId),

  'dossie:obter': (e, ctx) => dossie.relatorio(ctx.db, e),
  'dossie:criarAfirmacao': (e, ctx) => {
    dossie.criarAfirmacao(ctx.db, e.alvo, e)
    return dossie.relatorio(ctx.db, e.alvo)
  },
  'dossie:atualizarAfirmacao': (e, ctx) => {
    dossie.atualizarAfirmacao(ctx.db, e.id, e)
    const a = ctx.db.prepare('SELECT pauta_id AS pautaId, roteiro_id AS roteiroId FROM afirmacoes WHERE id = ?').get(e.id) as { pautaId: number | null; roteiroId: number | null }
    return dossie.relatorio(ctx.db, a.roteiroId ? { pautaId: null, roteiroId: a.roteiroId } : { pautaId: a.pautaId, roteiroId: null })
  },
  'dossie:excluirAfirmacao': (e, ctx) => {
    dossie.excluirAfirmacao(ctx.db, e.id)
    return null
  },
  'dossie:vincularResultado': (e, ctx) => {
    dossie.vincularResultado(ctx.db, e.afirmacaoId, e.resultadoId, e)
    return null
  },
  'dossie:vincularNovaFonte': (e, ctx) => {
    dossie.vincularNovaFonte(ctx.db, e.afirmacaoId, e, e)
    return null
  },
  'dossie:desvincular': (e, ctx) => {
    dossie.desvincularFonte(ctx.db, e.afirmacaoId, e.fonteId)
    return null
  },
  'geracao:planejar': (e, ctx) => gerador.planejarGeracao(ctx.db, ctx.cofre, e),
  'geracao:gerar': async (e, ctx) => {
    if (geracaoAtiva) throw new ErroApp('ocupado', 'Já existe uma geração em andamento.')
    geracaoAtiva = new AbortController()
    try {
      const r = await gerador.gerarRoteiro(ctx.db, ctx.cofre, e.pedido, e.autorizacao, geracaoAtiva.signal)
      // Revisão interna em segundo plano, logo depois de gerar (se a política estiver ligada).
      if (ia.lerPolitica(ctx.db).revisaoInterna.automatica) void revisarEmSegundoPlano(ctx, r.roteiroId)
      return r
    } finally {
      geracaoAtiva = null
    }
  },
  'geracao:cancelar': () => {
    const ativa = geracaoAtiva
    ativa?.abort()
    return { cancelada: ativa !== null }
  },
  'roteiros:alertasVersao': (e, ctx) => gerador.alertasDaVersao(ctx.db, e.roteiroId, e.numero),
  'revisao:painel': (e, ctx) => revisao.painelRevisao(ctx.db, e.id),
  'revisao:aprovarFactual': (e, ctx) => revisao.aprovarFactual(ctx.db, e.id, e.comentario),
  'revisao:aprovarEditorial': (e, ctx) => revisao.aprovarEditorial(ctx.db, e.id, e.comentario),
  'revisao:aprovarProducao': (e, ctx) => revisao.aprovarParaProducao(ctx.db, e.id, e.comentario),
  'revisao:solicitarCorrecoes': (e, ctx) => revisao.solicitarCorrecoes(ctx.db, e.id, e.tipo, e.comentario),
  'revisao:rejeitar': (e, ctx) => {
    revisao.rejeitar(ctx.db, e.id, e.comentario)
    return null
  },
  'dossie:marcarVerificada': (e, ctx) => {
    dossie.marcarVerificada(ctx.db, e.id, e.nota)
    return null
  },
  'dossie:desmarcarVerificada': (e, ctx) => {
    dossie.desmarcarVerificada(ctx.db, e.id)
    return null
  },
  'midia:listar': (e, ctx) => midia.listarMidia(ctx.db, e),
  'midia:importar': async (e, ctx) => {
    const arquivos = await ctx.plataforma.escolherArquivos({ nome: 'Mídia', extensoes: Object.keys(TIPOS_ACEITOS).map((x) => x.slice(1)) }, true)
    const importados = []
    const erros: { arquivo: string; mensagem: string }[] = []
    for (const caminho of arquivos.slice(0, 50)) {
      try {
        const m = await midia.importarMidia(ctx.db, ctx.pastaMidia, { ...e, caminho })
        const f = ctx.ferramentas()
        if (f) await producao.preencherMetadados(ctx.db, m.id, f).catch(() => undefined)
        importados.push(f ? midia.obterMidia(ctx.db, m.id) : m)
      } catch (err) {
        erros.push({ arquivo: basename(caminho), mensagem: err instanceof ErroApp ? err.message : 'Falha ao importar.' })
      }
    }
    return { importados, erros }
  },
  'midia:atualizar': (e, ctx) => midia.atualizarMidia(ctx.db, e),
  'midia:remover': (e, ctx) => {
    midia.removerMidia(ctx.db, e.id)
    return null
  },
  'midia:verificar': (e, ctx) => midia.verificarBiblioteca(ctx.db, e.projetoId),
  'edicao:listar': (_, ctx) => edicao.listarEdicoes(ctx.db),
  'edicao:obter': (e, ctx) => edicao.obterEdicao(ctx.db, e.id),
  'edicao:criar': (e, ctx) => edicao.criarEdicao(ctx.db, e.roteiroId, e.formato),
  'edicao:salvar': (e, ctx) => edicao.salvarEdicao(ctx.db, e.id, e.revisaoBase, e.estado),
  'edicao:snapshots': (e, ctx) => edicao.listarSnapshots(ctx.db, e.id),
  'edicao:restaurar': (e, ctx) => edicao.restaurarSnapshot(ctx.db, e.id, e.snapshotId),
  'edicao:excluir': (e, ctx) => {
    edicao.excluirEdicao(ctx.db, e.id)
    return null
  },
  'producao:ferramentas': (_, ctx) => {
    const f = ctx.ferramentas()
    return { encontrado: f !== null, ffmpeg: f?.ffmpeg ?? null, versao: f ? versaoFfmpeg(f) : null }
  },
  'producao:escolherFfmpeg': async (_, ctx) => {
    const [caminho] = await ctx.plataforma.escolherArquivos({ nome: 'ffmpeg.exe', extensoes: ['exe'] }, false)
    if (!caminho) {
      const f = ctx.ferramentas()
      return { encontrado: f !== null, ffmpeg: f?.ffmpeg ?? null, versao: f ? versaoFfmpeg(f) : null }
    }
    const f = localizarFerramentas(caminho)
    const versao = f ? versaoFfmpeg(f) : null
    if (!f || !versao?.toLowerCase().startsWith('ffmpeg version')) throw new ErroApp('ffmpeg_invalido', 'O arquivo escolhido não parece ser o ffmpeg.exe (o ffprobe.exe precisa estar na mesma pasta).')
    gravarConfig(ctx.db, 'midia.ffmpeg', f.ffmpeg)
    return { encontrado: true, ffmpeg: f.ffmpeg, versao }
  },
  'producao:renderizar': (e, ctx) => ({ id: ctx.producao.iniciar(e.edicaoId, e.preset, e.opcoes).id }),
  'producao:recomendacao': (e, ctx) => producao.recomendacaoParaEdicao(ctx.db, e.edicaoId, ctx.ferramentas(), ctx.pastaRender),
  'render:preferencia': (_, ctx) => ({ ...PREFERENCIA_RENDER_PADRAO, ...(lerConfig<PreferenciaRender>(ctx.db, 'render_preferencia') ?? {}) }),
  'render:salvarPreferencia': (e, ctx) => {
    gravarConfig(ctx.db, 'render_preferencia', e)
    return e
  },
  'assistente:estado': (_, ctx) => estadoDoAssistente(ctx),
  'assistente:salvar': (e, ctx) => {
    salvarAssistente(ctx.db, e)
    return estadoDoAssistente(ctx)
  },
  'rapido:aplicar': async (e, ctx) => {
    const mensagens = rapido.aplicarRapido(ctx, e.acao)
    return { mensagens, estado: await estadoDoAssistente(ctx) }
  },
  'rapido:ambiente': async (_, ctx) => {
    const ollama = await requisitarJson('http://127.0.0.1:11434/api/tags', { local: true, tempoLimiteMs: 2000 }).then(
      () => true,
      () => false
    )
    return { winget: wingetDisponivel(), ollama, ffmpeg: ctx.ferramentas() !== null }
  },
  'rapido:instalarOllama': async (_, ctx) => ({ mensagem: await rapido.instalarOllama(ctx) }),
  'rapido:instalarFfmpeg': async (_, ctx) => ({ mensagem: await rapido.instalarFfmpeg(ctx) }),
  'rapido:progresso': () => rapido.progressoInstalacao(),
  'rapido:instalarPiper': async (_, ctx) => ({ mensagem: await rapido.instalarPiperRapido(ctx) }),
  'midiaAuto:painel': (_, ctx) => painelMidia(ctx),
  'midiaAuto:salvarPreferencia': (e, ctx) => {
    gravarConfig(ctx.db, midiaAuto.CHAVE_PREFERENCIA, e)
    return painelMidia(ctx)
  },
  'midiaAuto:definirChave': (e, ctx) => {
    if (e.chave === null) ctx.cofre.remover(midiaAuto.chaveServico(e.servico))
    else ctx.cofre.guardar(midiaAuto.chaveServico(e.servico), e.chave)
    return painelMidia(ctx)
  },
  'midiaAuto:testarVoz': async (e, ctx) => {
    const pasta = juntar(ctx.pastaMidia, 'temporario')
    mkdirSync(pasta, { recursive: true })
    const arq = juntar(pasta, `teste-voz-${Date.now()}.wav`)
    try {
      const r = await sintetizar(midiaAuto.lerPreferenciaMidia(ctx).voz, e.texto, arq, juntar(ctx.pastaDados, 'ferramentas'))
      return { base64: readFileSync(arq).toString('base64'), descricao: r.descricao }
    } finally {
      rmSync(arq, { force: true })
    }
  },
  'midiaAuto:produzir': async (e, ctx) => {
    if (producoesMidia.has(e.edicaoId)) throw new ErroApp('ocupado', 'A produção de mídias desta edição já está em andamento.')
    const iniciadoEm = new Date().toISOString()
    const marcar = (percentual: number, etapa: string, detalhe = '', ativo = true): void => {
      const antes = progressoMidia.get(e.edicaoId)?.percentual ?? 0
      progressoMidia.set(e.edicaoId, { etapa, percentual: Math.max(antes, percentual), detalhe, iniciadoEm, ativo })
    }
    producoesMidia.add(e.edicaoId)
    progressoMidia.delete(e.edicaoId)
    marcar(0, 'Preparando')
    try {
      const r = await midiaAuto.produzirMidias(ctx, e.edicaoId, { narracao: e.narracao, imagens: e.imagens }, (p, etapa, detalhe) => marcar(p, etapa, detalhe))
      marcar(100, 'Concluído', '', false)
      return r
    } catch (erro) {
      marcar(progressoMidia.get(e.edicaoId)?.percentual ?? 0, 'Erro', erro instanceof Error ? erro.message : '', false)
      throw erro
    } finally {
      producoesMidia.delete(e.edicaoId)
    }
  },
  'midiaAuto:progresso': (e) => progressoMidia.get(e.id) ?? null,
  'producao:renderizacoes': (e, ctx) => producao.listarRenderizacoes(ctx.db, e.edicaoId),
  'producao:cancelar': (e, ctx) => ({ cancelada: ctx.producao.cancelar(e.id) }),
  'producao:mostrarArquivo': (e, ctx) => {
    const r = producao.obterRenderizacao(ctx.db, e.id)
    if (r.arquivo) ctx.plataforma.mostrarNoExplorador(r.arquivo)
    return null
  },
  'qualidade:executar': (e, ctx) => etapas.executarQualidade(ctx, e.id),
  'qualidade:progresso': (e) => progressoQualidade.get(e.id) ?? null,
  'qualidade:relatorios': (e, ctx) => producao.relatoriosDaRenderizacao(ctx.db, e.id),
  'qualidade:aceitar': (e, ctx) => producao.aceitarExcecao(ctx.db, e.relatorioId, e.codigo, e.justificativa),
  'youtube:painel': (_, ctx) => painelYouTube(ctx),
  'youtube:configurarCliente': async (e, ctx) => {
    await comYouTube(async () => ctx.youtube.configurarCliente(e.clientId, e.clientSecret))
    return painelYouTube(ctx)
  },
  'youtube:removerCliente': async (_, ctx) => {
    await comYouTube(() => ctx.youtube.desconectar())
    ctx.youtube.removerCliente()
    return painelYouTube(ctx)
  },
  'youtube:conectar': async (e, ctx) => {
    await comYouTube(() => ctx.youtube.conectar({ ...e, abrirNavegador: ctx.abrirNavegador }))
    return painelYouTube(ctx)
  },
  'youtube:desconectar': async (_, ctx) => {
    await comYouTube(() => ctx.youtube.desconectar())
    return painelYouTube(ctx)
  },
  'youtube:canais': (_, ctx) => comYouTube(() => ctx.youtube.listarCanais()),
  'youtube:playlists': (_, ctx) => comYouTube(() => ctx.youtube.listarPlaylists()),
  'youtube:procurarArquivoCliente': (_, ctx) => {
    const a = procurarArquivoCliente(ctx.plataforma.pastaDownloads)
    return a ? { nome: a.nome, modificadoEm: a.modificadoEm } : null
  },
  'youtube:importarArquivoCliente': async (e, ctx) => {
    // O caminho nunca vem da tela: ou é o arquivo achado em Downloads, ou o escolhido na caixa "Abrir".
    const caminho = e.usarEncontrado
      ? procurarArquivoCliente(ctx.plataforma.pastaDownloads)?.caminho
      : (await ctx.plataforma.escolherArquivos({ nome: 'Credenciais do Google (client_secret….json)', extensoes: ['json'] }, false))[0]
    if (!caminho) return null
    const c = lerArquivoCliente(caminho)
    await comYouTube(async () => ctx.youtube.configurarCliente(c.clientId, c.clientSecret))
    registrarEvento(ctx.db, 'info', 'youtube', `Credenciais do projeto importadas do arquivo ${basename(caminho)}.`)
    return painelYouTube(ctx)
  },
  'youtube:salvarOpcoes': (e, ctx) => {
    publicacoes.salvarOpcoesYouTube(ctx.db, e)
    return painelYouTube(ctx)
  },
  'publicacoes:listar': (_, ctx) => publicacoes.listarPublicacoes(ctx.db),
  'publicacoes:preparar': (e, ctx) => etapas.prepararPublicacaoCompleta(ctx, e.renderizacaoId),
  'publicacoes:gerarDescricao': (e, ctx) => publicacoes.gerarDescricaoPublicacao(ctx.db, e.id, e.links, e.tags),
  'links:listar': (e, ctx) => links.listarLinks(ctx.db, e.projetoId),
  'links:salvar': (e, ctx) => links.salvarLink(ctx.db, e),
  'links:remover': (e, ctx) => {
    links.removerLink(ctx.db, e.id)
    return null
  },
  'miniaturas:quadros': (e, ctx) => miniaturas.quadrosCandidatos(ctx.db, exigirFfmpeg(ctx), e.renderizacaoId),
  'miniaturas:previa': (e, ctx) => miniaturas.previaMiniatura(ctx.db, exigirFfmpeg(ctx), e.fonte, e.opcoes, juntar(ctx.pastaRender, 'miniaturas')),
  'miniaturas:salvar': (e, ctx) => miniaturas.salvarMiniatura(ctx.db, exigirFfmpeg(ctx), e.fonte, e.opcoes, { trabalho: juntar(ctx.pastaRender, 'miniaturas'), midia: ctx.pastaMidia }, e.publicacaoId),
  'miniaturas:definir': (e, ctx) => {
    miniaturas.definirMiniaturaPublicacao(ctx.db, e.publicacaoId, e.recursoId)
    return publicacoes.obterPublicacao(ctx.db, e.publicacaoId)
  },
  'publicacoes:atualizar': (e, ctx) => publicacoes.atualizarPublicacao(ctx.db, e.id, e),
  'publicacoes:aprovar': (e, ctx) => publicacoes.aprovarPublicacao(ctx.db, e.id, e.confirmarPublico),
  'publicacoes:enviar': (e, ctx) => {
    // Começa em segundo plano (com o app aberto); a tela acompanha pelo estado salvo.
    ctx.envios.validarParaEnvio(e.id)
    void ctx.envios.enviar(e.id).catch((err: unknown) => registrarEventoSeguro(ctx, err))
    return { iniciado: true }
  },
  'publicacoes:pausar': (e, ctx) => ({ pausado: ctx.envios.pausar(e.id) }),
  'publicacoes:cancelar': (e, ctx) => publicacoes.cancelarPublicacao(ctx.db, ctx.cofre, e.id),
  'publicacoes:atualizarStatus': (e, ctx) => comYouTube(() => ctx.envios.atualizarStatus(e.id)),
  'publicacoes:pendencias': (e, ctx) => publicacoes.pendenciasPublicacao(ctx.db, publicacoes.obterPublicacao(ctx.db, e.id)),
  'fila:itens': (_, ctx) => fila.montarFila(ctx.db),
  'fila:pausarItem': (e, ctx) => {
    fila.pausarItem(ctx.db, e.id, e.pausado)
    return null
  },
  'fila:priorizar': (e, ctx) => {
    fila.priorizarItem(ctx.db, e.id, e.delta)
    return null
  },
  'painel:dados': (_, ctx) => painelCompleto(ctx),
  'painel:moverVideo': (e, ctx) => {
    painel.moverVideo(ctx.db, e.id, e.direcao)
    return painelCompleto(ctx)
  },
  'painel:priorizarTema': (e, ctx) => {
    painel.priorizarTema(ctx.db, e.id, e.delta)
    return painelCompleto(ctx)
  },
  'painel:agendarTema': (e, ctx) => {
    painel.agendarTema(ctx.db, e.id, e.tipoVideo)
    return painelCompleto(ctx)
  },
  'painel:produzirAgora': (e, ctx) => ({ mensagem: piloto.produzirAgora(ctx, e.id), painel: painelCompleto(ctx) }),
  'painel:frequencia': (e, ctx) => {
    painel.definirFrequencia(ctx.db, e.tipo, e.porSemana, e.hora)
    return painelCompleto(ctx)
  },
  'piloto:postarAgora': async (e, ctx) => ({ mensagem: await piloto.postarAgora(ctx, e.id), painel: painelCompleto(ctx) }),
  'atividade:estado': (_, ctx) => estadoAtividade(ctx),
  'piloto:estado': (_, ctx) => piloto.estadoPiloto(ctx.db),
  'piloto:salvar': (e, ctx) => {
    piloto.salvarConfigPiloto(ctx.db, e)
    if (e.ligado) void piloto.cicloPiloto(ctx).catch((err: unknown) => registrarEvento(ctx.db, 'erro', 'piloto', err instanceof Error ? err.message : String(err)))
    return piloto.estadoPiloto(ctx.db)
  },
  'piloto:recomecarFila': (_, ctx) => {
    const m = piloto.recomecarFila(ctx.db)
    // Começa de novo já: pesquisa de novidades e ciclo do piloto (pautas novas, com a pesquisa extra de fontes).
    let extra: string
    try {
      extra = ` ${trabalharAgora(ctx)}`
    } catch (err) {
      extra = ` ${err instanceof Error ? err.message : String(err)}`
    }
    return { mensagem: `${m}${extra}`, estado: piloto.estadoPiloto(ctx.db) }
  },
  'piloto:rodarAgora': (_, ctx) => {
    if (fila.automacaoPausada(ctx.db)) throw new ErroApp('pausado', 'As tarefas automáticas estão pausadas. Use “Retomar e trabalhar agora” no topo.')
    void piloto.cicloPiloto(ctx, { forcar: true }).catch((err: unknown) => registrarEvento(ctx.db, 'erro', 'piloto', err instanceof Error ? err.message : String(err)))
    return piloto.estadoPiloto(ctx.db)
  },
  'atividade:trabalharAgora': (_, ctx) => {
    const mensagem = trabalharAgora(ctx)
    return { mensagem, estado: estadoAtividade(ctx) }
  },
  'fila:pausaGlobal': (_, ctx) => ({ pausada: fila.automacaoPausada(ctx.db) }),
  'fila:definirPausaGlobal': (e, ctx) => {
    fila.definirPausaGlobal(ctx.db, e.pausada)
    if (e.pausada) {
      const pesquisa = ctx.pesquisas.emAndamento()
      if (pesquisa !== null) ctx.pesquisas.cancelar(pesquisa)
    }
    return { pausada: fila.automacaoPausada(ctx.db) }
  },
  'derivados:ideias': (e, ctx) => derivados.ideiasParaShorts(ctx.db, e.id),
  'derivados:criar': (e, ctx) => derivados.criarShortDerivado(ctx.db, e.roteiroId, e.chave),
  'metricas:painel': (e, ctx) => metricas.painelMetricas(ctx.db, e),
  'metricas:coletar': (_, ctx) => comYouTube(() => metricas.coletarMetricas(ctx.db, ctx.youtube)),
  'metricas:trafego': (e, ctx) => comYouTube(() => ctx.youtube.fontesTrafego(e.de, e.ate)),
  'metricas:relatorios': (_, ctx) => metricas.listarRelatoriosSemanais(ctx.db),
  'metricas:gerarRelatorio': (e, ctx) => metricas.gerarRelatorioSemanal(ctx.db, e.dataReferencia),
  'metricas:relatorio': (e, ctx) => metricas.obterRelatorioSemanal(ctx.db, e.id),
  'metricas:exportarRelatorio': async (e, ctx) => {
    const r = metricas.obterRelatorioSemanal(ctx.db, e.id)
    const caminho = await ctx.plataforma.salvarTexto(`relatorio-semanal-${r.conteudo.semana.inicio}.md`, metricas.relatorioSemanalMarkdown(r), { nome: 'Markdown', extensao: 'md' })
    return { salvo: caminho !== null, arquivo: caminho ? basename(caminho) : null }
  },
  'metricas:sugestoes': (_, ctx) => metricas.listarSugestoes(ctx.db, null),
  'metricas:decidir': (e, ctx) => {
    metricas.decidirSugestao(ctx.db, e.id, e.aceita)
    return null
  },
  'ia:central': (_, ctx) => ia.central(ctx.db, ctx.cofre, new Date(), rotasIa(ctx.db, ctx.cofre)),
  'ia:salvarPolitica': (e, ctx) => {
    ia.salvarPolitica(ctx.db, e)
    return ia.central(ctx.db, ctx.cofre, new Date(), rotasIa(ctx.db, ctx.cofre))
  },
  'ia:adicionarCatalogo': (e, ctx) => ia.adicionarDoCatalogo(ctx.db, ctx.cofre, e.catalogo, e.chave),
  'ia:modelos': (e, ctx) => ia.listarModelos(ctx.db, ctx.cofre, e.id),
  'ia:reativar': (e, ctx) => {
    ia.reativarProvedor(ctx.db, e.id)
    return null
  },
  'revisao:interna': async (e, ctx) => {
    if (revisoesEmAndamento.has(e.id)) throw new ErroApp('ocupado', 'A revisão interna deste roteiro já está em andamento.')
    revisoesEmAndamento.add(e.id)
    try {
      return await interna.revisarInternamente(ctx.db, ctx.cofre, e.id)
    } finally {
      revisoesEmAndamento.delete(e.id)
    }
  },
  'revisao:conferirInterna': (e, ctx) => interna.conferirItem(ctx.db, e.revisaoId, e.indice, e.nota),
  'revisao:historicoInterna': (e, ctx) => interna.historicoRevisoesInternas(ctx.db, e.id),
  'ia:salvarProvedor': (e, ctx) => ia.salvarProvedor(ctx.db, ctx.cofre, e.id, e.config),
  'ia:ativarProvedor': (e, ctx) => {
    ia.ativarProvedor(ctx.db, e.id, e.ativo)
    return null
  },
  'ia:removerProvedor': (e, ctx) => {
    ia.removerProvedor(ctx.db, ctx.cofre, e.id)
    return null
  },
  'ia:definirChave': (e, ctx) => {
    ia.definirChave(ctx.db, ctx.cofre, e.id, e.chave)
    return null
  },
  'ia:testarProvedor': async (e, ctx) => ({ mensagem: await ia.testarProvedor(ctx.db, ctx.cofre, e.id) }),
  'tarefas:cancelar': (e, ctx) => {
    tarefas.cancelarTarefa(ctx.db, e.id)
    return null
  },
  'dossie:exportar': async (e, ctx) => {
    const titulo = e.roteiroId ? roteiros.obterRoteiro(ctx.db, e.roteiroId).titulo : pautas.obterPauta(ctx.db, e.pautaId!).titulo
    const caminho = await ctx.plataforma.salvarTexto(nomeArquivo(`verificacao-${titulo}`, 'md'), dossie.relatorioMarkdown(dossie.relatorio(ctx.db, e), titulo), { nome: 'Markdown', extensao: 'md' })
    return { salvo: caminho !== null, arquivo: caminho ? basename(caminho) : null }
  }
}
