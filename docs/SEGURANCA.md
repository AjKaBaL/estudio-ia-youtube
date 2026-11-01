# Revisão de segurança (Etapa 16)

Data: 31/10/2026. Escopo: todo o código em `src/` e `packages/youtube`, configuração do Electron, empacotamento e dependências.
Este relatório **não** declara o aplicativo "invulnerável" ou "100% seguro". Ele descreve os controles existentes, os problemas encontrados, o que foi corrigido e o que continua pendente.

## 1. Controles verificados (impostos pelo código, não pela IA)

| Área | Controle | Onde | Teste |
| --- | --- | --- | --- |
| Separação interface × sistema | `contextIsolation`, `sandbox`, `nodeIntegration: false`, `webviewTag: false`, DevTools desligado no app instalado | `src/main/politicaJanela.ts` | `seguranca.test.ts` |
| IPC | Preload com uma única função; lista permitida de canais; validação Zod de toda entrada; somente a página do app pode chamar (verificação de origem); erros sem detalhes internos | `src/preload`, `src/shared/canais.ts`, `src/main/ipc/despachar.ts` | `ipc.test.ts`, `seguranca.test.ts` |
| Conteúdo | CSP sem scripts externos, sem `eval`, `connect-src 'none'`; navegação e novas janelas bloqueadas; permissões do navegador negadas | `politicaJanela.ts`, `seguranca.ts` | `seguranca.test.ts` |
| XSS | React escapa todo texto; nenhum `dangerouslySetInnerHTML`; links só http(s) (validados na entrada) e abertos fora do app | interface | revisão de código |
| SQL | Consultas parametrizadas; nomes de tabela/ordenação só de listas fixas; curingas de LIKE escapados | `src/main/repositorios` | `seguranca.test.ts` (tentativa de injeção) |
| Execução de comandos | `spawn` sem shell, argumentos em lista; nada vindo de roteiros/páginas é usado como comando; textos vão para arquivos SRT | `src/main/midia/ffmpeg.ts` | `midia.test.ts` (nome de arquivo malicioso) |
| Path traversal | Arquivos só por caixa de diálogo nativa; mídia servida por id do banco (`midia://recurso/<id>`); capturas com nome validado por expressão regular; nomes de exportação higienizados | `index.ts`, `biblioteca.ts`, `exportacao.ts` | `biblioteca.test.ts` |
| SSRF | Só http/https e portas 80/443; bloqueio de IPs internos no momento da conexão (anti DNS rebinding); redirecionamentos revalidados; provedores locais só em 127.0.0.1; YouTube só nos hosts oficiais | `pesquisa/rede.ts`, `ia/http.ts`, `youtube/http.ts` | `pesquisa.test.ts`, `ia.test.ts` |
| Downloads e formatos | Limite de tamanho e tempo; tipos de conteúdo permitidos; sem descompressão; mídia conferida pela assinatura; executáveis recusados | `rede.ts`, `biblioteca.ts` | `pesquisa.test.ts`, `midia.test.ts` |
| Segredos | Chaves, tokens OAuth e sessões de envio no cofre criptografado (DPAPI via `safeStorage`), fora do banco; configurações comuns recusam chaves com cara de segredo; chaves nunca voltam para a interface | `ia/cofre.ts`, `configuracoes.ts` | `ia.test.ts`, `seguranca.test.ts` |
| Logs | Higienização de tokens, chaves, e-mails e pasta do usuário; uso de serviços registrado sem conteúdo | `db/eventos.ts`, `ia/central.ts` | `ipc.test.ts`, `seguranca.test.ts` |
| Prompt injection | Conteúdo externo tratado como dado (delimitado e marcado); detecção de frases de instrução; a IA não tem ferramentas nem acesso a publicação; saída validada por esquema e conferida contra o dossiê | `pesquisa/texto.ts`, `roteiros/gerador.ts`, `shared/estrutura.ts` | `pesquisa.test.ts`, `roteiros-revisao.test.ts`, `seguranca.test.ts` |
| Custos e abuso | Tetos mensal e por execução; custo não estimável exige autorização; autorização vale só para o conteúdo exato (assinatura); limites de tempo, tamanho, fontes e resultados por pesquisa; uma pesquisa/geração/render/envio por vez | `ia/central.ts`, `pesquisa/executor.ts` | `ia.test.ts` |
| Publicação | Aprovação obrigatória por padrão; privado por padrão; público só com confirmação; pré-requisitos (roteiro aprovado, QC aprovado); sem envio duplicado | `youtube/publicacao.ts` | `publicacao-fila.test.ts` |
| OAuth | PKCE, `state` aleatório, servidor local só em 127.0.0.1, uma resposta, tempo limite; escopos mínimos; revogação ao desconectar | `packages/youtube/src/oauth.ts` | `packages/youtube/src/index.test.ts` |
| Portas de rede | Nenhum servidor permanente. O único servidor é o do retorno do OAuth, temporário e em loopback | — | revisão de código |
| Ações destrutivas | Confirmação na interface; projetos com conteúdo não podem ser excluídos; mídia em uso não pode ser removida; exclusões apagam dados do arquivo (`secure_delete`) | interface e repositórios | testes de repositório |

## 2. Achados desta revisão

| # | Gravidade | Achado | Reprodução segura | Correção | Teste de regressão |
| --- | --- | --- | --- | --- | --- |
| 1 | Média | Saída de IA podia conter **URLs inventadas** (não presentes no dossiê) sem alerta | Gerar um roteiro com o adaptador e incluir `https://golpe.exemplo/login` na abertura | `conferirEstrutura` passou a sinalizar qualquer endereço fora do dossiê | `seguranca.test.ts` › endereços não estão no dossiê |
| 2 | Baixa | **Mistura entre projetos**: agendar roteiro de outro projeto, criar roteiro com pauta de outro projeto, ligar mídia a roteiro de outro projeto | Chamar `agenda:agendar` com `projetoId` de A e `roteiroId` de B | Verificação de projeto em `agendar`, `criarRoteiro` e `atualizarMidia` | `seguranca.test.ts` › isolamento entre projetos |
| 3 | Baixa | **DevTools** disponível no app instalado (facilita inspeção/alteração da interface) | Abrir o app empacotado e pressionar Ctrl+Shift+I | `devTools: !empacotado` | `seguranca.test.ts` › janela |
| 4 | Baixa | Dados excluídos podiam continuar **recuperáveis no arquivo do banco** | Excluir um roteiro e procurar o texto no arquivo `.sqlite` | `PRAGMA secure_delete = ON` | revisão de código |
| 5 | Baixa | Um teste automático chamava um **domínio real** com chave de teste | Ver `seguranca.test.ts` (versão anterior) | Testes passaram a usar domínios reservados `.invalid` | os próprios testes |
| 6 | Informativo | Validação de origem do modo desenvolvimento aceitava qualquer host na porta | — | Agora exige `localhost`/`127.0.0.1` | `seguranca.test.ts` |

Nenhum achado crítico ficou aberto.

## 3. Dependências

- Versões fixas (sem `^`), publicadas há pelo menos duas semanas, exceto a correção de segurança do Electron (44.9.3, que corrige um alerta de certificados das versões anteriores).
- `npm audit` em 31/10/2026: 25 alertas **moderados**, todos em `minimatch` usado por ferramentas de build e lint (electron-builder, eslint). Confirmado que esse pacote **não** entra no aplicativo gerado (`out/` não o contém). Ação: atualizar quando as ferramentas publicarem versões corrigidas.
- Scripts de instalação: `electron-winstaller` (ferramenta de empacotamento). O Electron baixa o próprio binário no primeiro uso.
- O aplicativo não tem dependências em tempo de execução fora do que é empacotado pelo build (React, Zod e o pacote interno do YouTube).

## 4. Pendências e riscos conhecidos (antes de uso real)

| Item | Risco | Recomendação |
| --- | --- | --- |
| Instalador sem assinatura digital | Windows SmartScreen alerta; usuário não consegue verificar a origem do arquivo | Assinar o instalador com certificado de código antes de distribuir |
| Sem atualização automática | Correções de segurança dependem de reinstalação manual | Distribuir versões assinadas com notas de versão; avaliar atualização automática assinada no futuro |
| Backups não criptografados | Backups contêm roteiros e pesquisas (não contêm chaves, que ficam no cofre) | Guardar backups em local protegido; criptografia de backup como melhoria futura |
| FFmpeg localizado pelo PATH | Um `ffmpeg.exe` malicioso colocado antes no PATH seria executado | Preferir configurar o caminho explícito em Estúdio › Ferramentas |
| YouTube e provedores de IA reais não testados de ponta a ponta (a renderização com FFmpeg real já foi testada) | Comportamentos reais de Google/fornecedores podem diferir dos simulados | Fazer o roteiro de testes manuais de `docs/MANUAL.md` antes de uso real |
| Heurísticas de texto | Alertas de cópia, exagero e injeção são por regras e podem falhar | Manter a revisão humana obrigatória |
