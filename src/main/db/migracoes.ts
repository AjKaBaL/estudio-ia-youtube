import { type Banco, transacao } from './conexao'

/**
 * Migrações versionadas. Regras:
 * - Nunca edite uma migração já publicada; crie uma nova no fim da lista.
 * - A versão aplicada fica em PRAGMA user_version.
 * - Cada migração roda inteira dentro de uma transação.
 */
export interface Migracao {
  versao: number
  nome: string
  sql: string
  /** Desliga as chaves estrangeiras durante a migração (necessário para recriar tabelas). */
  semChavesEstrangeiras?: boolean
}

export const MIGRACOES: readonly Migracao[] = [
  {
    versao: 1,
    nome: 'Etapa 3 — biblioteca de projetos, pautas e roteiros',
    sql: `
CREATE TABLE projetos (
  id INTEGER PRIMARY KEY,
  nome TEXT NOT NULL,
  descricao TEXT NOT NULL DEFAULT '',
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL,
  arquivado_em TEXT
);

CREATE TABLE palavras_chave (
  id INTEGER PRIMARY KEY,
  termo TEXT NOT NULL UNIQUE COLLATE NOCASE
);

CREATE TABLE pautas (
  id INTEGER PRIMARY KEY,
  projeto_id INTEGER NOT NULL REFERENCES projetos(id) ON DELETE RESTRICT,
  titulo TEXT NOT NULL,
  tema TEXT NOT NULL DEFAULT '',
  notas TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ideia' CHECK (status IN ('ideia','aprovada','descartada')),
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);

CREATE TABLE pauta_palavras_chave (
  pauta_id INTEGER NOT NULL REFERENCES pautas(id) ON DELETE CASCADE,
  palavra_chave_id INTEGER NOT NULL REFERENCES palavras_chave(id) ON DELETE CASCADE,
  PRIMARY KEY (pauta_id, palavra_chave_id)
);

CREATE TABLE execucoes_pesquisa (
  id INTEGER PRIMARY KEY,
  projeto_id INTEGER NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
  pauta_id INTEGER REFERENCES pautas(id) ON DELETE SET NULL,
  consulta TEXT NOT NULL,
  origem TEXT NOT NULL DEFAULT 'manual' CHECK (origem IN ('manual','agendada')),
  status TEXT NOT NULL CHECK (status IN ('pendente','em_andamento','concluida','erro','cancelada')),
  intervalo_de TEXT,
  intervalo_ate TEXT,
  iniciada_em TEXT,
  concluida_em TEXT,
  mensagem_erro TEXT,
  criado_em TEXT NOT NULL
);

CREATE TABLE fontes (
  id INTEGER PRIMARY KEY,
  projeto_id INTEGER NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
  execucao_pesquisa_id INTEGER REFERENCES execucoes_pesquisa(id) ON DELETE SET NULL,
  titulo TEXT NOT NULL,
  url TEXT NOT NULL,
  autor TEXT NOT NULL DEFAULT '',
  tipo_fonte TEXT NOT NULL DEFAULT 'outro',
  publicada_em TEXT,
  acessada_em TEXT NOT NULL,
  notas TEXT NOT NULL DEFAULT '',
  criado_em TEXT NOT NULL
);

CREATE TABLE roteiros (
  id INTEGER PRIMARY KEY,
  projeto_id INTEGER NOT NULL REFERENCES projetos(id) ON DELETE RESTRICT,
  pauta_id INTEGER REFERENCES pautas(id) ON DELETE SET NULL,
  titulo TEXT NOT NULL,
  tema TEXT NOT NULL DEFAULT '',
  tipo_video TEXT NOT NULL CHECK (tipo_video IN ('longo','short')),
  status TEXT NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho','em_revisao','aprovado','publicado')),
  notas TEXT NOT NULL DEFAULT '',
  data_prevista TEXT,
  versao_atual INTEGER NOT NULL DEFAULT 1,
  arquivado_em TEXT,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);
CREATE INDEX ix_roteiros_projeto ON roteiros(projeto_id);
CREATE INDEX ix_roteiros_status ON roteiros(status);

CREATE TABLE roteiro_versoes (
  id INTEGER PRIMARY KEY,
  roteiro_id INTEGER NOT NULL REFERENCES roteiros(id) ON DELETE CASCADE,
  numero INTEGER NOT NULL,
  titulo TEXT NOT NULL,
  conteudo TEXT NOT NULL,
  resumo_alteracoes TEXT NOT NULL,
  criado_em TEXT NOT NULL,
  UNIQUE (roteiro_id, numero)
);

CREATE TABLE roteiro_palavras_chave (
  roteiro_id INTEGER NOT NULL REFERENCES roteiros(id) ON DELETE CASCADE,
  palavra_chave_id INTEGER NOT NULL REFERENCES palavras_chave(id) ON DELETE CASCADE,
  PRIMARY KEY (roteiro_id, palavra_chave_id)
);

CREATE TABLE roteiro_fontes (
  roteiro_id INTEGER NOT NULL REFERENCES roteiros(id) ON DELETE CASCADE,
  fonte_id INTEGER NOT NULL REFERENCES fontes(id) ON DELETE CASCADE,
  PRIMARY KEY (roteiro_id, fonte_id)
);

CREATE TABLE comentarios_revisao (
  id INTEGER PRIMARY KEY,
  roteiro_id INTEGER NOT NULL REFERENCES roteiros(id) ON DELETE CASCADE,
  versao_numero INTEGER NOT NULL,
  texto TEXT NOT NULL,
  resolvido_em TEXT,
  criado_em TEXT NOT NULL
);

CREATE TABLE tarefas (
  id INTEGER PRIMARY KEY,
  tipo TEXT NOT NULL,
  descricao TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pendente','em_andamento','concluida','erro','perdida','ignorada','cancelada')),
  referencia_tipo TEXT,
  referencia_id INTEGER,
  agendada_para TEXT,
  iniciada_em TEXT,
  concluida_em TEXT,
  diagnostico TEXT,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);

CREATE TABLE tarefa_registros (
  id INTEGER PRIMARY KEY,
  tarefa_id INTEGER NOT NULL REFERENCES tarefas(id) ON DELETE CASCADE,
  nivel TEXT NOT NULL CHECK (nivel IN ('info','aviso','erro')),
  mensagem TEXT NOT NULL,
  criado_em TEXT NOT NULL
);

CREATE TABLE recursos_midia (
  id INTEGER PRIMARY KEY,
  projeto_id INTEGER NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
  roteiro_id INTEGER REFERENCES roteiros(id) ON DELETE SET NULL,
  tipo TEXT NOT NULL,
  caminho TEXT NOT NULL,
  nome_original TEXT NOT NULL,
  tamanho_bytes INTEGER,
  sha256 TEXT,
  origem TEXT NOT NULL DEFAULT '',
  licenca TEXT NOT NULL DEFAULT '',
  criado_em TEXT NOT NULL
);

CREATE TABLE calendario_entradas (
  id INTEGER PRIMARY KEY,
  projeto_id INTEGER NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
  roteiro_id INTEGER REFERENCES roteiros(id) ON DELETE SET NULL,
  titulo TEXT NOT NULL,
  tipo_video TEXT NOT NULL CHECK (tipo_video IN ('longo','short')),
  inicio_utc TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planejado' CHECK (status IN ('planejado','cancelado','publicado')),
  notas TEXT NOT NULL DEFAULT '',
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_calendario_roteiro ON calendario_entradas(roteiro_id)
  WHERE roteiro_id IS NOT NULL AND status <> 'cancelado';

-- Somente valores NÃO secretos. Credenciais nunca são gravadas aqui.
CREATE TABLE configuracoes (
  chave TEXT PRIMARY KEY,
  valor TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);

-- Histórico de eventos e erros, sem dados sensíveis (mensagens passam por higienização).
CREATE TABLE eventos (
  id INTEGER PRIMARY KEY,
  nivel TEXT NOT NULL CHECK (nivel IN ('info','aviso','erro')),
  categoria TEXT NOT NULL,
  mensagem TEXT NOT NULL,
  criado_em TEXT NOT NULL
);
CREATE INDEX ix_eventos_data ON eventos(criado_em);
`
  },
  {
    versao: 2,
    nome: 'Etapa 4 — agenda e tarefas agendadas sem duplicidade',
    sql: `
-- Impede registrar duas vezes a mesma execução agendada (por exemplo, pesquisa das 08:00 de um dia).
CREATE UNIQUE INDEX ux_tarefas_agendadas ON tarefas(tipo, agendada_para) WHERE agendada_para IS NOT NULL;
CREATE INDEX ix_calendario_inicio ON calendario_entradas(inicio_utc);
`
  },
  {
    versao: 3,
    nome: 'Etapa 5 — mecanismo de pesquisa online e conexões de fontes',
    sql: `
-- Fontes configuradas pelo usuário (feeds RSS/Atom e páginas).
CREATE TABLE fontes_pesquisa (
  id INTEGER PRIMARY KEY,
  projeto_id INTEGER NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN ('rss','url')),
  nome TEXT NOT NULL,
  url TEXT NOT NULL,
  ativo INTEGER NOT NULL DEFAULT 1,
  ultimo_status TEXT,
  ultima_execucao TEXT,
  criado_em TEXT NOT NULL,
  UNIQUE (projeto_id, url)
);

-- Domínios confiáveis ou bloqueados.
CREATE TABLE regras_dominio (
  id INTEGER PRIMARY KEY,
  projeto_id INTEGER NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
  dominio TEXT NOT NULL COLLATE NOCASE,
  regra TEXT NOT NULL CHECK (regra IN ('confiavel','bloqueado')),
  criado_em TEXT NOT NULL,
  UNIQUE (projeto_id, dominio)
);

CREATE TABLE resultados_pesquisa (
  id INTEGER PRIMARY KEY,
  execucao_id INTEGER NOT NULL REFERENCES execucoes_pesquisa(id) ON DELETE CASCADE,
  fonte_pesquisa_id INTEGER REFERENCES fontes_pesquisa(id) ON DELETE SET NULL,
  fonte_nome TEXT NOT NULL,
  titulo TEXT NOT NULL,
  url TEXT NOT NULL,
  url_canonica TEXT NOT NULL,
  dominio TEXT NOT NULL,
  autor TEXT NOT NULL DEFAULT '',
  publicada_em TEXT,
  acessada_em TEXT NOT NULL,
  trecho TEXT NOT NULL DEFAULT '',
  idioma TEXT NOT NULL DEFAULT 'desconhecido',
  tipo_fonte TEXT NOT NULL DEFAULT 'outro',
  relevancia REAL NOT NULL,
  atualidade REAL NOT NULL,
  confiabilidade REAL NOT NULL,
  nicho REAL NOT NULL,
  pontuacao INTEGER NOT NULL,
  explicacao TEXT NOT NULL,
  grupo INTEGER,
  duplicado_de INTEGER,
  alerta_injecao INTEGER NOT NULL DEFAULT 0,
  criado_em TEXT NOT NULL
);
CREATE INDEX ix_resultados_execucao ON resultados_pesquisa(execucao_id);

-- Registro por fonte de cada execução (progresso, erros, limites).
CREATE TABLE execucao_registros (
  id INTEGER PRIMARY KEY,
  execucao_id INTEGER NOT NULL REFERENCES execucoes_pesquisa(id) ON DELETE CASCADE,
  fonte TEXT NOT NULL,
  nivel TEXT NOT NULL CHECK (nivel IN ('info','aviso','erro')),
  mensagem TEXT NOT NULL,
  criado_em TEXT NOT NULL
);

ALTER TABLE execucoes_pesquisa ADD COLUMN fontes_consultadas INTEGER NOT NULL DEFAULT 0;
ALTER TABLE execucoes_pesquisa ADD COLUMN fontes_com_erro INTEGER NOT NULL DEFAULT 0;
ALTER TABLE execucoes_pesquisa ADD COLUMN total_resultados INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tarefas ADD COLUMN execucao_pesquisa_id INTEGER REFERENCES execucoes_pesquisa(id) ON DELETE SET NULL;
`
  },
  {
    versao: 4,
    nome: 'Etapa 6 — planejador de pautas e lotes de pesquisa',
    sql: `
ALTER TABLE pautas ADD COLUMN pergunta_central TEXT NOT NULL DEFAULT '';
ALTER TABLE pautas ADD COLUMN resumo TEXT NOT NULL DEFAULT '';
ALTER TABLE pautas ADD COLUMN publico TEXT NOT NULL DEFAULT '';
ALTER TABLE pautas ADD COLUMN tipo_sugerido TEXT CHECK (tipo_sugerido IN ('longo','short'));
ALTER TABLE pautas ADD COLUMN potencial_narrativa INTEGER CHECK (potencial_narrativa BETWEEN 1 AND 5);
ALTER TABLE pautas ADD COLUMN combinada_em INTEGER REFERENCES pautas(id) ON DELETE SET NULL;
ALTER TABLE pautas ADD COLUMN na_fila_pesquisa INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pautas ADD COLUMN origem TEXT NOT NULL DEFAULT 'manual';

-- Resultados de pesquisa usados como fontes preliminares da pauta.
CREATE TABLE pauta_resultados (
  pauta_id INTEGER NOT NULL REFERENCES pautas(id) ON DELETE CASCADE,
  resultado_id INTEGER NOT NULL REFERENCES resultados_pesquisa(id) ON DELETE CASCADE,
  PRIMARY KEY (pauta_id, resultado_id)
);

-- Lotes: por exemplo, a lista semanal para escolher 1 vídeo longo e 3 Shorts.
CREATE TABLE lotes (
  id INTEGER PRIMARY KEY,
  projeto_id INTEGER NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  inicio TEXT NOT NULL,
  fim TEXT NOT NULL,
  meta_longos INTEGER NOT NULL,
  meta_shorts INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto','fechado')),
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);
CREATE TABLE lote_pautas (
  lote_id INTEGER NOT NULL REFERENCES lotes(id) ON DELETE CASCADE,
  pauta_id INTEGER NOT NULL REFERENCES pautas(id) ON DELETE CASCADE,
  selecionada INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (lote_id, pauta_id)
);
`
  },
  {
    versao: 5,
    nome: 'Etapa 7 — verificação de fatos e dossiê de fontes',
    sql: `
CREATE TABLE afirmacoes (
  id INTEGER PRIMARY KEY,
  pauta_id INTEGER REFERENCES pautas(id) ON DELETE CASCADE,
  roteiro_id INTEGER REFERENCES roteiros(id) ON DELETE CASCADE,
  texto TEXT NOT NULL,
  natureza TEXT NOT NULL CHECK (natureza IN ('fato','estimativa','opiniao','previsao','hipotese')),
  relevante INTEGER NOT NULL DEFAULT 1,
  tema_rapido INTEGER NOT NULL DEFAULT 0,
  decisao TEXT CHECK (decisao IN ('corrigir','remover','incerto')),
  observacoes TEXT NOT NULL DEFAULT '',
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL,
  CHECK (pauta_id IS NOT NULL OR roteiro_id IS NOT NULL)
);
CREATE INDEX ix_afirmacoes_pauta ON afirmacoes(pauta_id);
CREATE INDEX ix_afirmacoes_roteiro ON afirmacoes(roteiro_id);

-- Cada vínculo diz qual trecho da fonte sustenta (ou contradiz) a afirmação.
CREATE TABLE afirmacao_fontes (
  afirmacao_id INTEGER NOT NULL REFERENCES afirmacoes(id) ON DELETE CASCADE,
  fonte_id INTEGER NOT NULL REFERENCES fontes(id) ON DELETE CASCADE,
  trecho TEXT NOT NULL,
  papel TEXT NOT NULL CHECK (papel IN ('primaria','secundaria')),
  posicao TEXT NOT NULL CHECK (posicao IN ('sustenta','parcial','contradiz')),
  criado_em TEXT NOT NULL,
  PRIMARY KEY (afirmacao_id, fonte_id)
);
`
  },
  {
    versao: 6,
    nome: 'Etapa 10 — central de serviços de IA, orçamento e tarefas reexecutáveis',
    sql: `
-- Configuração NÃO secreta dos provedores. Chaves ficam no cofre criptografado, fora do banco.
CREATE TABLE provedores_ia (
  id INTEGER PRIMARY KEY,
  categoria TEXT NOT NULL DEFAULT 'llm',
  adaptador TEXT NOT NULL,
  nome TEXT NOT NULL,
  ativo INTEGER NOT NULL DEFAULT 1,
  config TEXT NOT NULL,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);

-- Uso e custo aproximado por chamada (sem conteúdo enviado, sem chaves).
CREATE TABLE uso_servicos (
  id INTEGER PRIMARY KEY,
  provedor_id INTEGER REFERENCES provedores_ia(id) ON DELETE SET NULL,
  provedor_nome TEXT NOT NULL,
  finalidade TEXT NOT NULL,
  tokens_entrada INTEGER,
  tokens_saida INTEGER,
  custo REAL,
  moeda TEXT NOT NULL,
  sucesso INTEGER NOT NULL,
  criado_em TEXT NOT NULL
);
CREATE INDEX ix_uso_data ON uso_servicos(criado_em);

ALTER TABLE tarefas ADD COLUMN parametros TEXT;
`
  },
  {
    versao: 7,
    nome: 'Etapa 8 — novos estados de roteiro e estrutura das versões geradas',
    // Recria a tabela "roteiros" para ampliar a regra de status (procedimento oficial do SQLite).
    semChavesEstrangeiras: true,
    sql: `
CREATE TABLE roteiros_novo (
  id INTEGER PRIMARY KEY,
  projeto_id INTEGER NOT NULL REFERENCES projetos(id) ON DELETE RESTRICT,
  pauta_id INTEGER REFERENCES pautas(id) ON DELETE SET NULL,
  titulo TEXT NOT NULL,
  tema TEXT NOT NULL DEFAULT '',
  tipo_video TEXT NOT NULL CHECK (tipo_video IN ('longo','short')),
  status TEXT NOT NULL DEFAULT 'rascunho'
    CHECK (status IN ('rascunho','precisa_verificacao','pronto_revisao','em_revisao','aprovado','publicado')),
  notas TEXT NOT NULL DEFAULT '',
  data_prevista TEXT,
  versao_atual INTEGER NOT NULL DEFAULT 1,
  arquivado_em TEXT,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);
INSERT INTO roteiros_novo SELECT id, projeto_id, pauta_id, titulo, tema, tipo_video, status, notas, data_prevista, versao_atual, arquivado_em, criado_em, atualizado_em FROM roteiros;
DROP TABLE roteiros;
ALTER TABLE roteiros_novo RENAME TO roteiros;
CREATE INDEX ix_roteiros_projeto ON roteiros(projeto_id);
CREATE INDEX ix_roteiros_status ON roteiros(status);

ALTER TABLE roteiro_versoes ADD COLUMN origem TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE roteiro_versoes ADD COLUMN estrutura TEXT;
ALTER TABLE roteiro_versoes ADD COLUMN alertas TEXT;
`
  },
  {
    versao: 8,
    nome: 'Etapa 9 — revisão editorial obrigatória e histórico de aprovações',
    sql: `
-- Histórico auditável: cada decisão registra data, versão, tipo de revisão e ação.
CREATE TABLE aprovacoes (
  id INTEGER PRIMARY KEY,
  roteiro_id INTEGER NOT NULL REFERENCES roteiros(id) ON DELETE CASCADE,
  versao_numero INTEGER NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('factual','editorial','producao')),
  acao TEXT NOT NULL CHECK (acao IN ('aprovado','correcoes','rejeitado','invalidada')),
  comentario TEXT NOT NULL DEFAULT '',
  secoes TEXT NOT NULL DEFAULT '[]',
  invalidada_em TEXT,
  invalidada_motivo TEXT,
  criado_em TEXT NOT NULL
);
CREATE INDEX ix_aprovacoes_roteiro ON aprovacoes(roteiro_id);

ALTER TABLE afirmacoes ADD COLUMN verificada_em TEXT;
ALTER TABLE afirmacoes ADD COLUMN verificada_nota TEXT NOT NULL DEFAULT '';
`
  },
  {
    versao: 9,
    nome: 'Etapa 11 — biblioteca de mídia, projetos de edição e renderizações',
    sql: `
ALTER TABLE recursos_midia ADD COLUMN cena TEXT NOT NULL DEFAULT '';
ALTER TABLE recursos_midia ADD COLUMN mime TEXT NOT NULL DEFAULT '';
ALTER TABLE recursos_midia ADD COLUMN autor TEXT NOT NULL DEFAULT '';
ALTER TABLE recursos_midia ADD COLUMN url_origem TEXT NOT NULL DEFAULT '';
ALTER TABLE recursos_midia ADD COLUMN situacao_licenca TEXT NOT NULL DEFAULT 'nao_verificado'
  CHECK (situacao_licenca IN ('criado_usuario','gerado_ia','licenciado','dominio_publico_verificar','nao_verificado'));
ALTER TABLE recursos_midia ADD COLUMN obtido_em TEXT;
ALTER TABLE recursos_midia ADD COLUMN duracao_seg REAL;
ALTER TABLE recursos_midia ADD COLUMN largura INTEGER;
ALTER TABLE recursos_midia ADD COLUMN altura INTEGER;
CREATE UNIQUE INDEX ux_midia_hash ON recursos_midia(projeto_id, sha256) WHERE sha256 IS NOT NULL;

CREATE TABLE projetos_edicao (
  id INTEGER PRIMARY KEY,
  roteiro_id INTEGER NOT NULL REFERENCES roteiros(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  formato TEXT NOT NULL CHECK (formato IN ('16:9','9:16')),
  estado TEXT NOT NULL,
  revisao INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);

-- Cópias periódicas para recuperação após falha (mantidas as mais recentes).
CREATE TABLE edicao_snapshots (
  id INTEGER PRIMARY KEY,
  edicao_id INTEGER NOT NULL REFERENCES projetos_edicao(id) ON DELETE CASCADE,
  revisao INTEGER NOT NULL,
  estado TEXT NOT NULL,
  criado_em TEXT NOT NULL
);

CREATE TABLE renderizacoes (
  id INTEGER PRIMARY KEY,
  edicao_id INTEGER NOT NULL REFERENCES projetos_edicao(id) ON DELETE CASCADE,
  revisao INTEGER NOT NULL,
  preset TEXT NOT NULL,
  arquivo TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pendente','em_andamento','concluida','erro','cancelada')),
  progresso REAL NOT NULL DEFAULT 0,
  mensagem TEXT,
  conferencia TEXT,
  iniciada_em TEXT,
  concluida_em TEXT,
  criado_em TEXT NOT NULL
);
`
  },
  {
    versao: 10,
    nome: 'Etapa 12 — relatórios de controle de qualidade',
    sql: `
CREATE TABLE relatorios_qualidade (
  id INTEGER PRIMARY KEY,
  renderizacao_id INTEGER NOT NULL REFERENCES renderizacoes(id) ON DELETE CASCADE,
  itens TEXT NOT NULL,
  bloqueadores INTEGER NOT NULL,
  avisos INTEGER NOT NULL,
  excecoes TEXT NOT NULL DEFAULT '[]',
  aprovado INTEGER NOT NULL DEFAULT 0,
  pasta_capturas TEXT,
  capturas TEXT NOT NULL DEFAULT '[]',
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);
`
  },
  {
    versao: 11,
    nome: 'Etapa 13 — publicações no YouTube com estado persistido',
    sql: `
CREATE TABLE publicacoes (
  id INTEGER PRIMARY KEY,
  renderizacao_id INTEGER NOT NULL REFERENCES renderizacoes(id) ON DELETE RESTRICT,
  roteiro_id INTEGER NOT NULL REFERENCES roteiros(id) ON DELETE RESTRICT,
  id_operacao TEXT NOT NULL UNIQUE,
  titulo TEXT NOT NULL,
  descricao TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  categoria_id TEXT NOT NULL DEFAULT '28',
  playlist_id TEXT,
  privacidade TEXT NOT NULL DEFAULT 'private' CHECK (privacidade IN ('private','unlisted','public')),
  publicar_em TEXT,
  feito_para_criancas INTEGER CHECK (feito_para_criancas IN (0,1)),
  conteudo_sintetico INTEGER NOT NULL DEFAULT 0,
  miniatura_recurso_id INTEGER REFERENCES recursos_midia(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'rascunho'
    CHECK (status IN ('rascunho','aprovada','enviando','pausada','processando','concluida','erro','cancelada')),
  aprovada_em TEXT,
  aprovacao_publica INTEGER NOT NULL DEFAULT 0,
  tamanho INTEGER,
  sha256 TEXT,
  bytes_enviados INTEGER NOT NULL DEFAULT 0,
  video_id TEXT,
  video_url TEXT,
  enviado_em TEXT,
  mensagem TEXT,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);
-- Uma publicação ativa por renderização: impede envio duplicado do mesmo vídeo.
CREATE UNIQUE INDEX ux_publicacao_ativa ON publicacoes(renderizacao_id) WHERE status NOT IN ('cancelada','erro');
`
  },
  {
    versao: 12,
    nome: 'Etapa 14 — fila de produção, prioridades e Shorts derivados',
    sql: `
ALTER TABLE roteiros ADD COLUMN origem_roteiro_id INTEGER REFERENCES roteiros(id) ON DELETE SET NULL;
ALTER TABLE calendario_entradas ADD COLUMN prioridade INTEGER NOT NULL DEFAULT 0;
ALTER TABLE calendario_entradas ADD COLUMN pausado INTEGER NOT NULL DEFAULT 0;
`
  },
  {
    versao: 13,
    nome: 'Etapa 15 — métricas autorizadas, relatórios semanais e sugestões',
    sql: `
CREATE TABLE metricas_videos (
  id INTEGER PRIMARY KEY,
  publicacao_id INTEGER NOT NULL REFERENCES publicacoes(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL,
  coletado_em TEXT NOT NULL,
  periodo_inicio TEXT NOT NULL,
  periodo_fim TEXT NOT NULL,
  visualizacoes INTEGER,
  minutos_assistidos REAL,
  duracao_media_seg REAL,
  percentual_medio REAL,
  inscritos_ganhos INTEGER
);
CREATE INDEX ix_metricas_publicacao ON metricas_videos(publicacao_id);

CREATE TABLE relatorios_semanais (
  id INTEGER PRIMARY KEY,
  semana_inicio TEXT NOT NULL,
  conteudo TEXT NOT NULL,
  criado_em TEXT NOT NULL
);

-- Sugestões só valem depois de aprovadas pelo usuário; nada muda automaticamente.
CREATE TABLE sugestoes (
  id INTEGER PRIMARY KEY,
  relatorio_id INTEGER REFERENCES relatorios_semanais(id) ON DELETE SET NULL,
  tipo TEXT NOT NULL,
  texto TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','aceita','rejeitada')),
  criado_em TEXT NOT NULL,
  decidido_em TEXT
);
`
  },
  {
    versao: 14,
    nome: 'Renderização até 4K com opções e metadados das mídias',
    sql: `
ALTER TABLE renderizacoes ADD COLUMN opcoes TEXT NOT NULL DEFAULT '{}';
ALTER TABLE recursos_midia ADD COLUMN fps REAL;
`
  },
  {
    versao: 15,
    nome: 'Links para descrições (produtos, afiliados, redes sociais) e miniaturas',
    sql: `
CREATE TABLE links (
  id INTEGER PRIMARY KEY,
  projeto_id INTEGER REFERENCES projetos(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  url TEXT NOT NULL,
  categoria TEXT NOT NULL CHECK (categoria IN ('rede_social','produto','afiliado','patrocinio','site','outro')),
  descricao TEXT NOT NULL DEFAULT '',
  padrao INTEGER NOT NULL DEFAULT 0,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);
CREATE INDEX ix_links_projeto ON links(projeto_id);
-- Links escolhidos para cada publicação (lista de ids em JSON).
ALTER TABLE publicacoes ADD COLUMN links TEXT NOT NULL DEFAULT '[]';
`
  },
  {
    versao: 16,
    nome: 'Fontes padrão, sugestões de novas fontes e prioridade das pautas',
    sql: `
-- De onde veio cada fonte: padrão do app, sugestão aprovada ou cadastro do usuário.
ALTER TABLE fontes_pesquisa ADD COLUMN origem TEXT NOT NULL DEFAULT 'usuario' CHECK (origem IN ('usuario','padrao','sugestao'));

-- Sites vistos nos resultados que ainda não são fontes. "observada" fica oculta até aparecer de novo;
-- "pendente" aguarda a aprovação do usuário; "sem_feed" não tem feed e não é sugerido.
CREATE TABLE sugestoes_fontes (
  id INTEGER PRIMARY KEY,
  projeto_id INTEGER NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
  dominio TEXT NOT NULL COLLATE NOCASE,
  nome TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  ocorrencias INTEGER NOT NULL DEFAULT 1,
  exemplo_titulo TEXT NOT NULL DEFAULT '',
  exemplo_url TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'observada' CHECK (status IN ('observada','pendente','aprovada','recusada','sem_feed')),
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL,
  UNIQUE (projeto_id, dominio)
);

-- Ordem manual dos próximos temas (adiantar/adiar no painel).
ALTER TABLE pautas ADD COLUMN prioridade INTEGER NOT NULL DEFAULT 0;
-- Tema agendado direto do painel (mesmo antes de existir roteiro).
ALTER TABLE calendario_entradas ADD COLUMN pauta_id INTEGER REFERENCES pautas(id) ON DELETE SET NULL;
`
  },
  {
    versao: 17,
    nome: 'IA híbrida com várias IAs gratuitas e revisão interna automática',
    sql: `
-- Pausa automática quando o fornecedor avisa que o limite acabou (429) ou falha seguidamente.
ALTER TABLE provedores_ia ADD COLUMN pausado_ate TEXT;
ALTER TABLE provedores_ia ADD COLUMN ultimo_erro TEXT;
ALTER TABLE uso_servicos ADD COLUMN tarefa TEXT;
ALTER TABLE uso_servicos ADD COLUMN erro TEXT;

-- Revisão interna feita pelo app (regras fixas + IA revisora) para cada versão do roteiro.
CREATE TABLE revisoes_internas (
  id INTEGER PRIMARY KEY,
  roteiro_id INTEGER NOT NULL REFERENCES roteiros(id) ON DELETE CASCADE,
  versao_numero INTEGER NOT NULL,
  resultado TEXT NOT NULL CHECK (resultado IN ('aprovada','com_alertas','reprovada')),
  revisor TEXT NOT NULL,
  nota INTEGER,
  resumo TEXT NOT NULL DEFAULT '',
  itens TEXT NOT NULL DEFAULT '[]',
  observacoes TEXT NOT NULL DEFAULT '[]',
  criado_em TEXT NOT NULL
);
CREATE INDEX ix_revisoes_internas ON revisoes_internas(roteiro_id, versao_numero);
`
  },
  {
    versao: 18,
    nome: 'Piloto automático: registro do que foi feito em cada vídeo',
    sql: `
CREATE TABLE piloto_registros (
  id INTEGER PRIMARY KEY,
  calendario_id INTEGER REFERENCES calendario_entradas(id) ON DELETE SET NULL,
  titulo TEXT NOT NULL DEFAULT '',
  etapa TEXT NOT NULL,
  resultado TEXT NOT NULL CHECK (resultado IN ('feito','aguardando','erro')),
  mensagem TEXT NOT NULL DEFAULT '',
  criado_em TEXT NOT NULL
);
CREATE INDEX ix_piloto_registros ON piloto_registros(calendario_id, id);
`
  },
  {
    versao: 19,
    nome: 'Piloto automático: marca o que realmente precisa do usuário',
    sql: `
ALTER TABLE piloto_registros ADD COLUMN precisa_usuario INTEGER NOT NULL DEFAULT 0;
`
  },
  {
    versao: 20,
    nome: 'Narração: voz neural (Piper) no lugar da voz do Windows, a pedido do usuário',
    sql: `
UPDATE configuracoes SET valor = json_set(valor, '$.voz.motor', 'piper') WHERE chave = 'midia.automatica' AND json_valid(valor) AND json_extract(valor, '$.voz.motor') = 'windows';
`
  }
]

export function versaoAtual(db: Banco): number {
  const r = db.prepare('PRAGMA user_version').get() as { user_version: number }
  return r.user_version
}

export function migracoesPendentes(db: Banco): Migracao[] {
  const atual = versaoAtual(db)
  return MIGRACOES.filter((m) => m.versao > atual)
}

/** Aplica as migrações pendentes. Recusa abrir banco criado por versão mais nova do app. */
export function migrar(db: Banco): number[] {
  const atual = versaoAtual(db)
  const ultima = MIGRACOES.at(-1)?.versao ?? 0
  if (atual > ultima) {
    throw new Error(
      `O banco de dados é de uma versão mais nova do aplicativo (versão ${atual}). Atualize o aplicativo antes de abrir.`
    )
  }
  const aplicadas: number[] = []
  for (const m of migracoesPendentes(db)) {
    if (m.semChavesEstrangeiras) db.exec('PRAGMA foreign_keys = OFF')
    try {
      transacao(db, () => {
        db.exec(m.sql)
        if (m.semChavesEstrangeiras) {
          const problemas = db.prepare('PRAGMA foreign_key_check').all()
          if (problemas.length) throw new Error(`A migração ${m.versao} deixaria referências inválidas; nada foi alterado.`)
        }
        db.exec(`PRAGMA user_version = ${m.versao}`)
      })
    } finally {
      if (m.semChavesEstrangeiras) db.exec('PRAGMA foreign_keys = ON')
    }
    aplicadas.push(m.versao)
  }
  return aplicadas
}
