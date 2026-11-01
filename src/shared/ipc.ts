import { z } from 'zod'
import type { Canal } from './canais'
import * as s from './schemas'
import { pesosSchema, type PesosPlanejador } from './planejador'
import { politicaIaSchema } from './ia'
import type * as t from './tipos'
import type { PreferenciaRender } from './midia'
import type { DescricaoGerada } from './publicacao'
import type { ProgressoInstalacao } from './configRapida'
import { preferenciaMidiaSchema } from './geracaoMidia'
import { configPilotoSchema, type EstadoPiloto } from './piloto'

const nada = z.undefined()

/** Esquema de validação da entrada de cada canal. O "satisfies" garante que todos os canais tenham esquema. */
export const ENTRADAS = {
  'sistema:info': nada,
  'sistema:backup': nada,
  'sistema:abrirPastaDados': nada,
  'sistema:eventos': nada,
  'sistema:segundoPlano': nada,
  'sistema:definirSegundoPlano': z.object({ bandeja: z.boolean(), iniciarComWindows: z.boolean() }),
  'ui:obterEstado': nada,
  'ui:salvarEstado': s.estadoUiSchema,
  'visaoGeral:obter': nada,
  'projetos:listar': nada,
  'projetos:criar': s.projetoNovoSchema,
  'projetos:atualizar': s.projetoAtualizarSchema,
  'projetos:excluir': s.porId,
  'roteiros:buscar': s.filtroRoteirosSchema,
  'roteiros:obter': s.porId,
  'roteiros:criar': s.roteiroNovoSchema,
  'roteiros:salvar': s.roteiroSalvarSchema,
  'roteiros:renomear': s.roteiroRenomearSchema,
  'roteiros:duplicar': s.porId,
  'roteiros:arquivar': s.porId,
  'roteiros:restaurar': s.porId,
  'roteiros:excluir': s.porId,
  'roteiros:alterarStatus': s.roteiroStatusSchema,
  'roteiros:versoes': s.porId,
  'roteiros:versao': s.versaoSchema,
  'roteiros:exportar': s.exportarSchema,
  'roteiros:adicionarFonte': s.fonteNovaSchema,
  'roteiros:removerFonte': s.removerFonteSchema,
  'roteiros:comentar': s.comentarioNovoSchema,
  'roteiros:resolverComentario': s.porId,
  'pautas:listar': s.filtroPautasSchema,
  'pautas:criar': s.pautaNovaSchema,
  'pautas:atualizar': s.pautaAtualizarSchema,
  'pautas:excluir': s.porId,
  'pautas:excluirVarias': s.excluirPautasSchema,
  'pautas:obter': s.porId,
  'pautas:alterarStatus': s.pautaStatusSchema,
  'pautas:deResultados': s.pautaDeResultadosSchema,
  'pautas:removerResultado': s.pautaResultadoSchema,
  'pautas:combinar': s.combinarPautasSchema,
  'pautas:filaPesquisa': s.porId,
  'planejador:pesos': nada,
  'planejador:salvarPesos': pesosSchema,
  'lotes:listar': z.object({ projetoId: s.id }),
  'lotes:obter': s.porId,
  'lotes:criar': s.loteNovoSchema,
  'lotes:gerarSemanal': z.object({ projetoId: s.id }),
  'lotes:adicionarPauta': s.lotePautaSchema,
  'lotes:removerPauta': s.lotePautaSchema,
  'lotes:selecionar': s.loteSelecaoSchema,
  'lotes:fechar': s.loteFecharSchema,
  'lotes:excluir': s.porId,
  'editorial:obter': nada,
  'editorial:salvar': s.salvarConfigEditorialSchema,
  'agenda:listar': s.intervaloSchema,
  'agenda:horariosLivres': nada,
  'agenda:agendar': s.agendarSchema,
  'agenda:reagendar': s.reagendarSchema,
  'agenda:cancelar': s.porId,
  'tarefas:listar': nada,
  'tarefas:ignorar': s.porId,
  'tarefas:repetir': s.porId,
  'pesquisa:painel': z.object({ projetoId: s.id.nullable() }),
  'pesquisa:opcoes': nada,
  'pesquisa:salvarOpcoes': s.opcoesPesquisaSchema,
  'pesquisa:fontes': z.object({ projetoId: s.id }),
  'pesquisa:adicionarFonte': s.fontePesquisaNovaSchema,
  'pesquisa:ativarFonte': s.fontePesquisaAtivaSchema,
  'pesquisa:removerFonte': s.porId,
  'pesquisa:identificarFonte': s.identificarFonteSchema,
  'pesquisa:restaurarFontesPadrao': z.object({ projetoId: s.id }),
  'pesquisa:sugestoesFontes': z.object({ projetoId: s.id }),
  'pesquisa:aprovarSugestao': s.porId,
  'pesquisa:recusarSugestao': s.porId,
  'pesquisa:regras': z.object({ projetoId: s.id }),
  'pesquisa:definirRegra': s.regraDominioSchema,
  'pesquisa:removerRegra': s.porId,
  'pesquisa:iniciar': s.iniciarPesquisaSchema,
  'pesquisa:progresso': s.porId,
  'pesquisa:cancelar': s.porId,
  'pesquisa:execucoes': s.listarExecucoesSchema,
  'pesquisa:execucao': s.porId,
  'pesquisa:resultadoParaRoteiro': s.resultadoParaRoteiroSchema,
  'dossie:obter': s.alvoDossieSchema,
  'dossie:criarAfirmacao': s.afirmacaoNovaSchema,
  'dossie:atualizarAfirmacao': s.afirmacaoAtualizarSchema,
  'dossie:excluirAfirmacao': s.porId,
  'dossie:vincularResultado': s.vincularResultadoSchema,
  'dossie:vincularNovaFonte': s.vincularNovaFonteSchema,
  'dossie:desvincular': s.desvincularFonteSchema,
  'dossie:exportar': s.alvoDossieSchema,
  'ia:central': nada,
  'ia:salvarPolitica': politicaIaSchema,
  'ia:salvarProvedor': s.salvarProvedorSchema,
  'ia:ativarProvedor': s.ativarProvedorSchema,
  'ia:removerProvedor': s.porId,
  'ia:definirChave': s.chaveProvedorSchema,
  'ia:testarProvedor': s.porId,
  'ia:adicionarCatalogo': s.adicionarCatalogoSchema,
  'ia:modelos': s.porId,
  'ia:reativar': s.porId,
  'tarefas:cancelar': s.porId,
  'geracao:planejar': s.pedidoGeracaoSchema,
  'geracao:gerar': s.gerarSchema,
  'geracao:cancelar': nada,
  'roteiros:alertasVersao': s.versaoSchema,
  'revisao:painel': s.porId,
  'revisao:aprovarFactual': s.revisaoAcaoSchema,
  'revisao:aprovarEditorial': s.revisaoAcaoSchema,
  'revisao:aprovarProducao': s.revisaoAcaoSchema,
  'revisao:solicitarCorrecoes': s.revisaoCorrecaoSchema,
  'revisao:rejeitar': s.revisaoAcaoSchema,
  'revisao:interna': s.porId,
  'revisao:conferirInterna': s.conferirInternaSchema,
  'revisao:historicoInterna': s.porId,
  'dossie:marcarVerificada': s.marcarVerificadaSchema,
  'dossie:desmarcarVerificada': s.porId,
  'midia:listar': s.listarMidiaSchema,
  'midia:importar': s.importarMidiaSchema,
  'midia:atualizar': s.atualizarMidiaSchema,
  'midia:remover': s.porId,
  'midia:verificar': z.object({ projetoId: s.id }),
  'edicao:listar': nada,
  'edicao:obter': s.porId,
  'edicao:criar': s.criarEdicaoSchema,
  'edicao:salvar': s.salvarEdicaoSchema,
  'edicao:snapshots': s.porId,
  'edicao:restaurar': s.restaurarSnapshotSchema,
  'edicao:excluir': s.porId,
  'producao:ferramentas': nada,
  'producao:escolherFfmpeg': nada,
  'producao:renderizar': s.renderizarSchema,
  'producao:renderizacoes': z.object({ edicaoId: s.id }),
  'producao:recomendacao': z.object({ edicaoId: s.id }),
  'render:preferencia': nada,
  'render:salvarPreferencia': s.preferenciaRenderSchema,
  'assistente:estado': nada,
  'assistente:salvar': s.salvarAssistenteSchema,
  'rapido:aplicar': s.acaoRapidaSchema,
  'rapido:ambiente': nada,
  'rapido:instalarOllama': nada,
  'rapido:instalarFfmpeg': nada,
  'rapido:progresso': nada,
  'rapido:instalarPiper': nada,
  'midiaAuto:painel': nada,
  'midiaAuto:salvarPreferencia': preferenciaMidiaSchema,
  'midiaAuto:definirChave': s.chaveMidiaSchema,
  'midiaAuto:testarVoz': s.testarVozSchema,
  'midiaAuto:produzir': s.produzirMidiasSchema,
  'midiaAuto:progresso': s.porId,
  'producao:cancelar': s.porId,
  'producao:mostrarArquivo': s.porId,
  'qualidade:executar': s.porId,
  'qualidade:relatorios': s.porId,
  'qualidade:progresso': s.porId,
  'qualidade:aceitar': s.aceitarExcecaoSchema,
  'youtube:painel': nada,
  'youtube:configurarCliente': s.clienteOAuthSchema,
  'youtube:removerCliente': nada,
  'youtube:conectar': s.conectarYouTubeSchema,
  'youtube:desconectar': nada,
  'youtube:canais': nada,
  'youtube:playlists': nada,
  'youtube:salvarOpcoes': z.object({ aprovacaoObrigatoria: z.boolean() }),
  'youtube:procurarArquivoCliente': nada,
  'youtube:importarArquivoCliente': z.object({ usarEncontrado: z.boolean() }),
  'publicacoes:listar': nada,
  'publicacoes:preparar': z.object({ renderizacaoId: s.id }),
  'publicacoes:atualizar': s.atualizarPublicacaoSchema,
  'publicacoes:aprovar': s.aprovarPublicacaoSchema,
  'publicacoes:enviar': s.porId,
  'publicacoes:pausar': s.porId,
  'publicacoes:cancelar': s.porId,
  'publicacoes:atualizarStatus': s.porId,
  'publicacoes:pendencias': s.porId,
  'publicacoes:gerarDescricao': s.gerarDescricaoSchema,
  'links:listar': z.object({ projetoId: s.id.nullable() }),
  'links:salvar': s.linkSchema,
  'links:remover': s.porId,
  'miniaturas:quadros': z.object({ renderizacaoId: s.id }),
  'miniaturas:previa': s.miniaturaSchema,
  'miniaturas:salvar': s.miniaturaSchema,
  'miniaturas:definir': s.definirMiniaturaSchema,
  'fila:itens': nada,
  'fila:pausarItem': s.pausarItemSchema,
  'fila:priorizar': s.priorizarSchema,
  'atividade:estado': nada,
  'atividade:trabalharAgora': nada,
  'piloto:estado': nada,
  'piloto:salvar': configPilotoSchema,
  'piloto:rodarAgora': nada,
  'piloto:postarAgora': s.porId,
  'piloto:recomecarFila': nada,
  'painel:dados': nada,
  'painel:moverVideo': s.moverVideoSchema,
  'painel:priorizarTema': s.priorizarTemaSchema,
  'painel:agendarTema': s.agendarTemaSchema,
  'painel:produzirAgora': s.porId,
  'painel:frequencia': s.frequenciaSchema,
  'fila:pausaGlobal': nada,
  'fila:definirPausaGlobal': z.object({ pausada: z.boolean() }),
  'derivados:ideias': s.porId,
  'derivados:criar': s.derivarShortSchema,
  'metricas:painel': s.filtroMetricasSchema,
  'metricas:coletar': nada,
  'metricas:trafego': z.object({ de: s.dataIso, ate: s.dataIso }),
  'metricas:relatorios': nada,
  'metricas:gerarRelatorio': z.object({ dataReferencia: s.dataIso }),
  'metricas:relatorio': s.porId,
  'metricas:exportarRelatorio': s.porId,
  'metricas:sugestoes': nada,
  'metricas:decidir': s.decidirSugestaoSchema
} satisfies Record<Canal, z.ZodType>

/** Tipo de retorno de cada canal. */
export interface Saidas {
  'sistema:info': t.InfoSistema
  'sistema:backup': { arquivo: string }
  'sistema:abrirPastaDados': null
  'sistema:eventos': t.EventoLog[]
  'sistema:segundoPlano': { bandeja: boolean; iniciarComWindows: boolean; disponivel: boolean }
  'sistema:definirSegundoPlano': { bandeja: boolean; iniciarComWindows: boolean; disponivel: boolean }
  'ui:obterEstado': s.EstadoUi | null
  'ui:salvarEstado': null
  'visaoGeral:obter': t.VisaoGeral
  'projetos:listar': t.Projeto[]
  'projetos:criar': t.Projeto
  'projetos:atualizar': t.Projeto
  'projetos:excluir': null
  'roteiros:buscar': t.RoteiroResumo[]
  'roteiros:obter': t.RoteiroCompleto
  'roteiros:criar': t.RoteiroCompleto
  'roteiros:salvar': t.RoteiroCompleto
  'roteiros:renomear': t.RoteiroCompleto
  'roteiros:duplicar': t.RoteiroCompleto
  'roteiros:arquivar': null
  'roteiros:restaurar': null
  'roteiros:excluir': null
  'roteiros:alterarStatus': t.RoteiroCompleto
  'roteiros:versoes': t.VersaoResumo[]
  'roteiros:versao': t.Versao
  'roteiros:exportar': t.ResultadoExportacao
  'roteiros:adicionarFonte': t.RoteiroCompleto
  'roteiros:removerFonte': t.RoteiroCompleto
  'roteiros:comentar': t.RoteiroCompleto
  'roteiros:resolverComentario': null
  'pautas:listar': t.Pauta[]
  'pautas:criar': t.PautaDetalhe
  'pautas:atualizar': t.PautaDetalhe
  'pautas:excluir': null
  'pautas:excluirVarias': { excluidas: number; mantidas: number }
  'pautas:obter': t.PautaDetalhe
  'pautas:alterarStatus': t.PautaDetalhe
  'pautas:deResultados': t.PautaDetalhe
  'pautas:removerResultado': t.PautaDetalhe
  'pautas:combinar': t.PautaDetalhe
  'pautas:filaPesquisa': t.PautaDetalhe
  'planejador:pesos': { pesos: PesosPlanejador; padrao: PesosPlanejador }
  'planejador:salvarPesos': { pesos: PesosPlanejador; padrao: PesosPlanejador }
  'lotes:listar': t.Lote[]
  'lotes:obter': t.LoteDetalhe
  'lotes:criar': t.LoteDetalhe
  'lotes:gerarSemanal': t.LoteDetalhe
  'lotes:adicionarPauta': t.LoteDetalhe
  'lotes:removerPauta': t.LoteDetalhe
  'lotes:selecionar': t.LoteDetalhe
  'lotes:fechar': t.LoteDetalhe
  'lotes:excluir': null
  'editorial:obter': t.ConfigEditorialComAlertas
  'editorial:salvar': t.ConfigEditorialComAlertas
  'agenda:listar': t.Agendamento[]
  'agenda:horariosLivres': t.HorarioLivre[]
  'agenda:agendar': t.Agendamento
  'agenda:reagendar': t.Agendamento
  'agenda:cancelar': null
  'tarefas:listar': t.Tarefa[]
  'tarefas:ignorar': null
  'tarefas:repetir': null
  'pesquisa:painel': t.PainelPesquisa
  'pesquisa:opcoes': s.OpcoesPesquisa
  'pesquisa:salvarOpcoes': s.OpcoesPesquisa
  'pesquisa:fontes': t.FontePesquisa[]
  'pesquisa:adicionarFonte': t.FontePesquisa
  'pesquisa:ativarFonte': null
  'pesquisa:removerFonte': null
  'pesquisa:identificarFonte': t.FonteIdentificada
  'pesquisa:restaurarFontesPadrao': { adicionadas: number }
  'pesquisa:sugestoesFontes': t.SugestaoFonte[]
  'pesquisa:aprovarSugestao': t.FontePesquisa
  'pesquisa:recusarSugestao': null
  'pesquisa:regras': t.RegraDominio[]
  'pesquisa:definirRegra': t.RegraDominio[]
  'pesquisa:removerRegra': null
  'pesquisa:iniciar': { id: number }
  'pesquisa:progresso': t.ProgressoPesquisa | null
  'pesquisa:cancelar': { cancelada: boolean }
  'pesquisa:execucoes': t.ExecucaoResumo[]
  'pesquisa:execucao': t.ExecucaoDetalhe
  'pesquisa:resultadoParaRoteiro': t.RoteiroCompleto
  'dossie:obter': t.RelatorioVerificacao
  'dossie:criarAfirmacao': t.RelatorioVerificacao
  'dossie:atualizarAfirmacao': t.RelatorioVerificacao
  'dossie:excluirAfirmacao': null
  'dossie:vincularResultado': null
  'dossie:vincularNovaFonte': null
  'dossie:desvincular': null
  'dossie:exportar': t.ResultadoExportacao
  'ia:central': t.CentralServicos
  'ia:salvarPolitica': t.CentralServicos
  'ia:salvarProvedor': t.ProvedorIa
  'ia:ativarProvedor': null
  'ia:removerProvedor': null
  'ia:definirChave': null
  'ia:testarProvedor': { mensagem: string }
  'ia:adicionarCatalogo': { provedor: t.ProvedorIa; modelos: string[]; mensagem: string }
  'ia:modelos': string[]
  'ia:reativar': null
  'tarefas:cancelar': null
  'geracao:planejar': t.PlanoGeracao
  'geracao:gerar': t.ResultadoGeracao
  'geracao:cancelar': { cancelada: boolean }
  'roteiros:alertasVersao': import('./estrutura').AlertaGeracao[]
  'revisao:painel': t.PainelRevisao
  'revisao:aprovarFactual': t.PainelRevisao
  'revisao:aprovarEditorial': t.PainelRevisao
  'revisao:aprovarProducao': t.PainelRevisao
  'revisao:solicitarCorrecoes': t.PainelRevisao
  'revisao:rejeitar': null
  'revisao:interna': t.RevisaoInterna
  'revisao:conferirInterna': t.RevisaoInterna
  'revisao:historicoInterna': t.RevisaoInterna[]
  'dossie:marcarVerificada': null
  'dossie:desmarcarVerificada': null
  'midia:listar': t.RecursoMidia[]
  'midia:importar': { importados: t.RecursoMidia[]; erros: { arquivo: string; mensagem: string }[] }
  'midia:atualizar': t.RecursoMidia
  'midia:remover': null
  'midia:verificar': { ausentes: number[]; duplicados: number[][]; semLicenca: number[]; total: number }
  'edicao:listar': Omit<t.ProjetoEdicao, 'estado'>[]
  'edicao:obter': t.ProjetoEdicao
  'edicao:criar': t.ProjetoEdicao
  'edicao:salvar': { revisao: number; salvoEm: string }
  'edicao:snapshots': { id: number; revisao: number; criadoEm: string; clips: number }[]
  'edicao:restaurar': t.ProjetoEdicao
  'edicao:excluir': null
  'producao:ferramentas': t.EstadoFerramentas
  'producao:escolherFfmpeg': t.EstadoFerramentas
  'producao:renderizar': { id: number }
  'producao:renderizacoes': t.Renderizacao[]
  'producao:recomendacao': t.DadosRecomendacao
  'render:preferencia': PreferenciaRender
  'render:salvarPreferencia': PreferenciaRender
  'assistente:estado': t.EstadoAssistente
  'assistente:salvar': t.EstadoAssistente
  'rapido:aplicar': { mensagens: string[]; estado: t.EstadoAssistente }
  'rapido:ambiente': { winget: boolean; ollama: boolean; ffmpeg: boolean }
  'rapido:instalarOllama': { mensagem: string }
  'rapido:instalarFfmpeg': { mensagem: string }
  'rapido:progresso': ProgressoInstalacao | null
  'rapido:instalarPiper': { mensagem: string }
  'midiaAuto:painel': t.PainelMidiaAuto
  'midiaAuto:salvarPreferencia': t.PainelMidiaAuto
  'midiaAuto:definirChave': t.PainelMidiaAuto
  'midiaAuto:testarVoz': { base64: string; descricao: string }
  'midiaAuto:produzir': { relatorio: string[]; revisao: number }
  'midiaAuto:progresso': t.ProgressoTarefa | null
  'producao:cancelar': { cancelada: boolean }
  'producao:mostrarArquivo': null
  'qualidade:executar': t.RelatorioQualidade
  'qualidade:relatorios': t.RelatorioQualidade[]
  'qualidade:progresso': t.ProgressoTarefa | null
  'qualidade:aceitar': t.RelatorioQualidade
  'youtube:painel': t.PainelYouTube
  'youtube:configurarCliente': t.PainelYouTube
  'youtube:removerCliente': t.PainelYouTube
  'youtube:conectar': t.PainelYouTube
  'youtube:desconectar': t.PainelYouTube
  'youtube:canais': { id: string; titulo: string }[]
  'youtube:playlists': { id: string; titulo: string }[]
  'youtube:salvarOpcoes': t.PainelYouTube
  'youtube:procurarArquivoCliente': { nome: string; modificadoEm: string } | null
  'youtube:importarArquivoCliente': t.PainelYouTube | null
  'publicacoes:listar': t.Publicacao[]
  'publicacoes:preparar': t.Publicacao
  'publicacoes:atualizar': t.Publicacao
  'publicacoes:aprovar': t.Publicacao
  'publicacoes:enviar': { iniciado: boolean }
  'publicacoes:pausar': { pausado: boolean }
  'publicacoes:cancelar': t.Publicacao
  'publicacoes:atualizarStatus': t.Publicacao
  'publicacoes:pendencias': string[]
  'publicacoes:gerarDescricao': DescricaoGerada
  'links:listar': t.LinkCadastrado[]
  'links:salvar': t.LinkCadastrado
  'links:remover': null
  'miniaturas:quadros': t.QuadroCandidato[]
  'miniaturas:previa': { dataUrl: string; bytes: number; linhasCortadas: boolean }
  'miniaturas:salvar': t.RecursoMidia
  'miniaturas:definir': t.Publicacao
  'fila:itens': t.ItemFila[]
  'fila:pausarItem': null
  'fila:priorizar': null
  'atividade:estado': t.EstadoAtividade
  'atividade:trabalharAgora': { mensagem: string; estado: t.EstadoAtividade }
  'piloto:estado': EstadoPiloto
  'piloto:salvar': EstadoPiloto
  'piloto:rodarAgora': EstadoPiloto
  'painel:dados': t.PainelAdmin
  'painel:moverVideo': t.PainelAdmin
  'painel:priorizarTema': t.PainelAdmin
  'painel:agendarTema': t.PainelAdmin
  'painel:produzirAgora': { mensagem: string; painel: t.PainelAdmin }
  'piloto:postarAgora': { mensagem: string; painel: t.PainelAdmin }
  'piloto:recomecarFila': { mensagem: string; estado: EstadoPiloto }
  'painel:frequencia': t.PainelAdmin
  'fila:pausaGlobal': { pausada: boolean }
  'fila:definirPausaGlobal': { pausada: boolean }
  'derivados:ideias': t.IdeiaShort[]
  'derivados:criar': t.RoteiroCompleto
  'metricas:painel': t.PainelMetricas
  'metricas:coletar': { coletados: number }
  'metricas:trafego': { fonte: string; visualizacoes: number }[]
  'metricas:relatorios': { id: number; semanaInicio: string; criadoEm: string }[]
  'metricas:gerarRelatorio': t.RelatorioSemanal
  'metricas:relatorio': t.RelatorioSemanal
  'metricas:exportarRelatorio': t.ResultadoExportacao
  'metricas:sugestoes': t.Sugestao[]
  'metricas:decidir': null
}

export type Entrada<C extends Canal> = z.input<(typeof ENTRADAS)[C]>
export type EntradaValidada<C extends Canal> = z.output<(typeof ENTRADAS)[C]>
