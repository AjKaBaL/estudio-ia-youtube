import type {
  StatusAgendamento,
  StatusPauta,
  StatusPesquisa,
  StatusRoteiro,
  StatusTarefa,
  TipoFonte,
  TipoVideo
} from './dominio'
import type { ConfigEditorial } from './editorial'
import type { AvaliacaoPauta } from './planejador'
import type { Decisao, Natureza, ResultadoVerificacao } from './verificacao'
import type { CategoriaServico, PlanoEnvio, PoliticaIa, ProvedorIaConfig } from './ia'
import type { AlertaGeracao } from './estrutura'
import type { AlertaTexto } from './analiseTexto'
import type { CategoriaMidia, FonteVisual, OpcoesRender, PreferenciaRender, PresetRender, RecomendacaoRender, SituacaoLicenca } from './midia'
import type { EtapaAssistente } from './schemas'
import type { CategoriaLink } from './publicacao'
import type { PreferenciaMidia } from './geracaoMidia'
import type { EstadoEdicao, Formato } from './edicao'
import type { Excecao, ItemQualidade } from './qualidade'

/** Tipos dos dados que o processo principal devolve à interface. */

export interface Projeto {
  id: number
  nome: string
  descricao: string
  criadoEm: string
  atualizadoEm: string
  totalRoteiros: number
  totalPautas: number
}

export interface RoteiroResumo {
  id: number
  projetoId: number
  projetoNome: string
  titulo: string
  tema: string
  tipoVideo: TipoVideo
  status: StatusRoteiro
  dataPrevista: string | null
  versaoAtual: number
  palavrasChave: string[]
  arquivadoEm: string | null
  criadoEm: string
  atualizadoEm: string
}

export interface Fonte {
  id: number
  titulo: string
  url: string
  autor: string
  tipoFonte: TipoFonte
  publicadaEm: string | null
  acessadaEm: string
  notas: string
}

export interface Comentario {
  id: number
  versaoNumero: number
  texto: string
  resolvidoEm: string | null
  criadoEm: string
}

export interface RoteiroCompleto extends RoteiroResumo {
  pautaId: number | null
  notas: string
  conteudo: string
  fontes: Fonte[]
  comentarios: Comentario[]
}

export interface VersaoResumo {
  numero: number
  titulo: string
  resumoAlteracoes: string
  criadoEm: string
}

export interface Versao extends VersaoResumo {
  conteudo: string
}

export interface Pauta {
  id: number
  projetoId: number
  projetoNome: string
  titulo: string
  tema: string
  notas: string
  status: StatusPauta
  palavrasChave: string[]
  perguntaCentral: string
  resumo: string
  publico: string
  tipoSugerido: TipoVideo | null
  potencialNarrativa: number | null
  combinadaEm: number | null
  naFilaPesquisa: boolean
  origem: string
  prioridade: number
  pontuacao: number
  riscos: number
  riscosAltos: number
  criadoEm: string
  atualizadoEm: string
}

export interface PautaDetalhe extends Pauta {
  avaliacao: AvaliacaoPauta
  fontes: ResultadoPesquisa[]
}

export interface Lote {
  id: number
  projetoId: number
  nome: string
  inicio: string
  fim: string
  metaLongos: number
  metaShorts: number
  status: 'aberto' | 'fechado'
  criadoEm: string
  totalPautas: number
  selecionadas: number
}

export interface LoteDetalhe extends Lote {
  pautas: (Pauta & { selecionada: boolean; tipoEfetivo: TipoVideo })[]
  selecaoLongos: number
  selecaoShorts: number
  alertas: string[]
}

export interface ExecucaoPesquisa {
  id: number
  consulta: string
  status: StatusPesquisa
  origem: 'manual' | 'agendada'
  intervaloDe: string | null
  intervaloAte: string | null
  iniciadaEm: string | null
  concluidaEm: string | null
  mensagemErro: string | null
}

export interface Tarefa {
  id: number
  tipo: string
  descricao: string
  status: StatusTarefa
  agendadaPara: string | null
  iniciadaEm: string | null
  concluidaEm: string | null
  diagnostico: string | null
  criadoEm: string
}

export interface Agendamento {
  id: number
  projetoId: number
  roteiroId: number | null
  titulo: string
  tipoVideo: TipoVideo
  inicioUtc: string
  status: StatusAgendamento
  notas: string
  statusRoteiro: StatusRoteiro | null
}

export interface HorarioLivre {
  tipoVideo: TipoVideo
  inicioUtc: string
  data: string
  hora: string
}

export interface ServicoStatus {
  nome: string
  estado: 'nao_configurado' | 'conectado' | 'erro' | 'local'
  mensagem: string
}

export interface VisaoGeral {
  temProjetos: boolean
  proximos: Agendamento[]
  aguardandoRevisao: RoteiroResumo[]
  pesquisas: ExecucaoPesquisa[]
  recentes: RoteiroResumo[]
  servicos: ServicoStatus[]
  tarefasPerdidas: number
  alertasAgenda: string[]
}

export interface InfoSistema {
  versaoApp: string
  versaoBanco: number
  pastaDados: string
  backups: { arquivo: string; tamanhoBytes: number; criadoEm: string }[]
  automacaoSoComAppAberto: true
}

export interface EventoLog {
  id: number
  nivel: 'info' | 'aviso' | 'erro'
  categoria: string
  mensagem: string
  criadoEm: string
}

export interface ConfigEditorialComAlertas {
  config: ConfigEditorial
  alertas: string[]
  padrao: ConfigEditorial
}

export interface ResultadoExportacao {
  salvo: boolean
  arquivo: string | null
}

// ---------------------------------------------------------------- pesquisa (etapa 5)

export interface ProgressoPesquisa {
  execucaoId: number
  etapa: string
  fontesFeitas: number
  fontesTotal: number
  resultados: number
}

export interface FontePesquisa {
  id: number
  tipo: 'rss' | 'url'
  nome: string
  url: string
  ativo: boolean
  ultimoStatus: string | null
  ultimaExecucao: string | null
  origem: 'usuario' | 'padrao' | 'sugestao'
}

export interface SugestaoFonte {
  id: number
  dominio: string
  nome: string
  url: string
  ocorrencias: number
  exemploTitulo: string
  exemploUrl: string
  criadoEm: string
}

/** Resultado de "identificar" um endereço colado pelo usuário. */
export interface FonteIdentificada {
  tipo: 'rss' | 'url'
  url: string
  nome: string
  detalhe: string
}

export interface RegraDominio {
  id: number
  dominio: string
  regra: 'confiavel' | 'bloqueado'
}

export interface EstadoProvedorPesquisa {
  id: string
  nome: string
  descricao: string
  exigeChave: boolean
  configurado: boolean
  mensagem: string
}

export interface ResultadoPesquisa {
  id: number
  fonteNome: string
  titulo: string
  url: string
  dominio: string
  autor: string
  publicadaEm: string | null
  acessadaEm: string
  trecho: string
  idioma: string
  tipoFonte: TipoFonte
  relevancia: number
  atualidade: number
  confiabilidade: number
  nicho: number
  pontuacao: number
  explicacao: string[]
  grupo: number | null
  duplicadoDe: number | null
  alertaInjecao: boolean
}

export interface RegistroExecucao {
  id: number
  fonte: string
  nivel: 'info' | 'aviso' | 'erro'
  mensagem: string
  criadoEm: string
}

export interface ExecucaoResumo extends ExecucaoPesquisa {
  fontesConsultadas: number
  fontesComErro: number
  totalResultados: number
  criadoEm: string
}

export interface ExecucaoDetalhe extends ExecucaoResumo {
  resultados: ResultadoPesquisa[]
  registros: RegistroExecucao[]
}

export interface PainelPesquisa {
  provedores: EstadoProvedorPesquisa[]
  emAndamento: ProgressoPesquisa | null
  ultimaExecucao: string | null
  intervaloAtual: { de: string; ate: string; rotulo: string }
}

// ---------------------------------------------------------------- verificação (etapa 7)

export interface FonteDaAfirmacao {
  fonteId: number
  titulo: string
  url: string
  autor: string
  tipoFonte: TipoFonte
  publicadaEm: string | null
  acessadaEm: string
  trecho: string
  papel: 'primaria' | 'secundaria'
  posicao: 'sustenta' | 'parcial' | 'contradiz'
}

export interface AfirmacaoDetalhe {
  id: number
  pautaId: number | null
  roteiroId: number | null
  texto: string
  natureza: Natureza
  relevante: boolean
  temaRapido: boolean
  decisao: Decisao | null
  observacoes: string
  atualizadoEm: string
  verificadaEm: string | null
  verificadaNota: string
  fontes: FonteDaAfirmacao[]
  verificacao: ResultadoVerificacao
}

export interface RelatorioVerificacao {
  afirmacoes: AfirmacaoDetalhe[]
  resumo: { total: number; prontas: number; removidas: number; porSituacao: Record<string, number> }
  pendencias: { afirmacaoId: number; texto: string; motivo: string }[]
  geradoEm: string
}

// ---------------------------------------------------------------- serviços de IA (etapa 10)

export interface ProvedorIa {
  id: number
  ativo: boolean
  config: ProvedorIaConfig
  local: boolean
  exigeChave: boolean
  chaveConfigurada: boolean
  ultimaUtilizacao: string | null
  /** Em pausa automática (limite do fornecedor ou erro de chave) até este momento. */
  pausadoAte: string | null
  ultimoErro: string | null
  usoHoje: number
}

/** Como o roteador está decidindo agora, para cada tarefa (mostrado na tela). */
export interface RotaIa {
  tarefa: 'escrever' | 'revisar'
  ordem: { id: number; nome: string; local: boolean }[]
  descartados: { nome: string; motivo: string }[]
}

export interface CentralServicos {
  politica: PoliticaIa
  provedores: ProvedorIa[]
  categorias: { categoria: CategoriaServico; disponivel: boolean; mensagem: string }[]
  gastoMes: number
  chamadasSemCustoEstimadoNoMes: number
  cofreDisponivel: boolean
  rotas: RotaIa[]
  usoRecente: { provedor: string; finalidade: string; tokensEntrada: number | null; tokensSaida: number | null; custo: number | null; moeda: string; sucesso: boolean; criadoEm: string }[]
}

// ---------------------------------------------------------------- geração e revisão (etapas 8 e 9)

export interface PlanoGeracao {
  plano: PlanoEnvio | null
  afirmacoesProntas: number
  /** No modo automático: a ordem em que o app vai tentar as IAs. */
  rota: RotaIa | null
}

export interface ResultadoGeracao {
  roteiroId: number
  versao: number
  status: StatusRoteiro
  alertas: AlertaGeracao[]
  palavras: number
  duracaoSeg: number
  origem: string
}

export interface RegistroAprovacao {
  id: number
  versao: number
  tipo: 'factual' | 'editorial' | 'producao'
  acao: 'aprovado' | 'correcoes' | 'rejeitado' | 'invalidada'
  comentario: string
  invalidadaEm: string | null
  invalidadaMotivo: string | null
  criadoEm: string
}

export interface PainelRevisao {
  roteiro: RoteiroCompleto
  dossie: RelatorioVerificacao
  alertasTexto: AlertaTexto[]
  pendenciasFactuais: string[]
  duracaoSeg: number
  historico: RegistroAprovacao[]
  aprovacaoFactual: RegistroAprovacao | null
  aprovacaoEditorial: RegistroAprovacao | null
  secoesAlteradasDesdeAprovacao: string[]
  podeAprovarProducao: boolean
  motivosBloqueio: string[]
  revisaoInterna: RevisaoInterna | null
}

/** Um ponto apontado pela revisão interna (regras fixas do app ou IA revisora). */
export interface ItemRevisaoInterna {
  origem: 'regras' | 'ia'
  tipo: string
  gravidade: 'critico' | 'aviso'
  trecho: string
  problema: string
  sugestao: string
  conferido: boolean
  nota: string
}

export interface RevisaoInterna {
  id: number
  roteiroId: number
  versao: number
  resultado: 'aprovada' | 'com_alertas' | 'reprovada'
  /** "regras" ou "regras + IA: <nome>". */
  revisor: string
  nota: number | null
  resumo: string
  itens: ItemRevisaoInterna[]
  observacoes: string[]
  criadoEm: string
}

// ---------------------------------------------------------------- mídia, edição e qualidade (etapas 11 e 12)

export interface RecursoMidia {
  id: number
  projetoId: number
  roteiroId: number | null
  cena: string
  categoria: CategoriaMidia
  caminho: string
  nomeOriginal: string
  tamanhoBytes: number
  sha256: string
  mime: string
  origem: string
  autor: string
  urlOrigem: string
  licenca: string
  situacaoLicenca: SituacaoLicenca
  obtidoEm: string | null
  duracaoSeg: number | null
  largura: number | null
  altura: number | null
  criadoEm: string
  arquivoExiste: boolean
  alertas: string[]
}

export interface ProjetoEdicao {
  id: number
  roteiroId: number
  roteiroTitulo: string
  nome: string
  formato: Formato
  estado: EstadoEdicao
  revisao: number
  criadoEm: string
  atualizadoEm: string
}

export interface Renderizacao {
  id: number
  edicaoId: number
  revisao: number
  preset: string
  /** JSON de OpcoesRender ('{}' em renderizações antigas). */
  opcoes: string
  arquivo: string
  status: 'pendente' | 'em_andamento' | 'concluida' | 'erro' | 'cancelada'
  progresso: number
  mensagem: string | null
  conferencia: string | null
  iniciadaEm: string | null
  concluidaEm: string | null
  criadoEm: string
}

export interface RelatorioQualidade {
  id: number
  renderizacaoId: number
  itens: ItemQualidade[]
  bloqueadores: number
  avisos: number
  excecoes: Excecao[]
  aprovado: boolean
  pastaCapturas: string | null
  capturas: string[]
  criadoEm: string
}

export interface DadosRecomendacao {
  recomendacao: RecomendacaoRender
  preferencia: PreferenciaRender
  sugerido: { preset: PresetRender; opcoes: OpcoesRender }
  duracaoSeg: number
  livreBytes: number | null
  fontes: (FonteVisual & { nome: string })[]
}

export interface EtapaAssistenteEstado {
  feito: boolean
  opcional: boolean
  detalhe: string
}
export interface EstadoAssistente {
  concluido: boolean
  dispensado: boolean
  etapas: Record<EtapaAssistente, EtapaAssistenteEstado>
  projetoId: number | null
  concluidas: number
  obrigatorias: number
}

export interface EstadoFerramentas {
  encontrado: boolean
  ffmpeg: string | null
  versao: string | null
}

// ---------------------------------------------------------------- YouTube (etapa 13)

export interface Publicacao {
  id: number
  renderizacaoId: number
  roteiroId: number
  roteiroTitulo: string
  idOperacao: string
  titulo: string
  descricao: string
  tags: string[]
  /** Ids dos links cadastrados escolhidos para a descrição. */
  links: number[]
  categoriaId: string
  playlistId: string | null
  privacidade: 'private' | 'unlisted' | 'public'
  publicarEm: string | null
  feitoParaCriancas: boolean | null
  conteudoSintetico: boolean
  miniaturaRecursoId: number | null
  status: 'rascunho' | 'aprovada' | 'enviando' | 'pausada' | 'processando' | 'concluida' | 'erro' | 'cancelada'
  aprovadaEm: string | null
  aprovacaoPublica: boolean
  tamanho: number | null
  bytesEnviados: number
  videoId: string | null
  videoUrl: string | null
  enviadoEm: string | null
  mensagem: string | null
  criadoEm: string
  atualizadoEm: string
}

export interface LinkCadastrado {
  id: number
  projetoId: number | null
  nome: string
  url: string
  categoria: CategoriaLink
  descricao: string
  padrao: boolean
  ativo: boolean
  criadoEm: string
  atualizadoEm: string
}

export interface QuadroCandidato {
  indice: number
  tempo: number
  bytes: number
  sugerido: boolean
}

export interface PainelYouTube {
  status: { estado: 'nao_configurado' | 'desconectado' | 'conectado' | 'erro'; mensagem: string; escopos: { escopo: string; descricao: string }[]; versaoRegras: string }
  aprovacaoObrigatoria: boolean
  envioEmAndamento: number | null
}

// ---------------------------------------------------------------- fila e métricas (etapas 14 e 15)

export interface ItemFila {
  id: number
  roteiroId: number | null
  titulo: string
  tipoVideo: TipoVideo
  inicioUtc: string
  prioridade: number
  pausado: boolean
  statusRoteiro: StatusRoteiro | null
  revisao: string
  producao: string
  qualidade: string
  publicacao: string
  pendencias: string[]
  bloqueiaPublicacao: boolean
  atrasado: boolean
  /** Preenchido pelo piloto automático no painel. */
  situacao?: import('./piloto').SituacaoVideo
}

/** Progresso de uma tarefa demorada (barra com porcentagem e tempo estimado). */
export interface ProgressoTarefa {
  etapa: string
  /** 0 a 100. */
  percentual: number
  detalhe: string
  iniciadoEm: string
  /** false quando terminou (com sucesso ou erro). */
  ativo: boolean
}

/** Configuração da produção automática de mídia (voz, busca e geração de imagens). */
export interface PainelMidiaAuto {
  preferencia: PreferenciaMidia
  /** Quais serviços têm chave guardada no cofre (as chaves nunca voltam para a tela). */
  chaves: Record<'pexels' | 'pixabay' | 'pollinations' | 'huggingface' | 'cloudflare', boolean>
  vozesWindows: { nome: string; idioma: string }[]
  piperInstalado: boolean
}

/** Barra de status do topo: o que o aplicativo está fazendo agora. */
export interface EstadoAtividade {
  modo: 'trabalhando' | 'espera' | 'pausado'
  atividades: { tipo: 'pesquisa' | 'render' | 'qualidade' | 'envio' | 'geracao' | 'revisao' | 'midia' | 'instalacao' | 'piloto'; titulo: string; percentual: number | null; detalhe: string }[]
  pilotoLigado: boolean
  proximaPesquisa: string | null
  frequencia: string
  ultimaPesquisa: { quando: string; status: string; resultados: number } | null
  pendentes: { revisar: number; pautasSemRoteiro: number; publicacoes: number }
  avisos: string[]
}

/** Painel do administrador: o que vem por aí e como ajustar. */
export interface FrequenciaFormato {
  porSemana: number
  hora: string
  dias: number[]
  pausado: boolean
}

export interface TemaProximo {
  id: number
  titulo: string
  status: StatusPauta
  tipoVideo: TipoVideo
  prioridade: number
  pontuacao: number
  riscosAltos: number
  origem: string
  roteiroId: number | null
  criadoEm: string
}

export interface PainelAdmin {
  videos: ItemFila[]
  temas: TemaProximo[]
  frequencia: Record<TipoVideo, FrequenciaFormato>
  livres: Record<TipoVideo, number>
  horizonteDias: number
  sugestoesFontes: number
  fontesAtivas: number
  pausaGlobal: boolean
  agendaPausada: boolean
}

export interface IdeiaShort {
  chave: string
  titulo: string
  texto: string
  palavras: number
  origem: 'cena' | 'afirmacao'
}

export interface LinhaPainelMetricas {
  publicacaoId: number
  videoId: string
  videoUrl: string | null
  titulo: string
  tipoVideo: TipoVideo
  publicadoEm: string | null
  diasDesdePublicacao: number | null
  duracaoRoteiroSeg: number
  visualizacoes: number | null
  minutosAssistidos: number | null
  duracaoMediaSeg: number | null
  percentualMedio: number | null
  inscritosGanhos: number | null
  coletadoEm: string | null
  relacaoComMediana: number | null
  custoEstimado: number | null
}

export interface PainelMetricas {
  linhas: LinhaPainelMetricas[]
  limitacoes: string[]
  amostra: { longo: number; short: number }
}

export interface Sugestao {
  id: number
  relatorioId: number | null
  tipo: string
  texto: string
  status: 'pendente' | 'aceita' | 'rejeitada'
  criadoEm: string
  decididoEm: string | null
}

export interface RelatorioSemanal {
  id: number
  semanaInicio: string
  criadoEm: string
  conteudo: {
    semana: { inicio: string; fim: string }
    publicados: { titulo: string; tipo: TipoVideo; url: string | null; publicadoEm: string | null }[]
    resultados: { titulo: string; visualizacoes: number | null; percentualMedio: number | null; dias: number | null }[]
    observacoes: string[]
    custos: { valor: number; chamadas: number }
    limitacoes: string[]
  }
  sugestoes: Sugestao[]
}

/** Resposta padronizada de toda chamada IPC. */
export type Resposta<T> = { ok: true; dados: T } | { ok: false; erro: { codigo: string; mensagem: string } }
