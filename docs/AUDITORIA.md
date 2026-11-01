# Auditoria do escopo (Etapa 18)

Data: 31/10/2026. Critério: só é "concluído" o que tem lógica real **e** teste automatizado correspondente. Telas sozinhas não contam.
Resultado da verificação final: typecheck, lint e **143 testes** passando, mais 2 testes opcionais com internet real (passaram quando executados), build ok, capturas de todas as telas sem erros de interface. Depois da instalação do FFmpeg 9.0.2, mais 4 testes opcionais de renderização real passaram (`render-real.test.ts`).

Status: **C** concluído · **P** parcial · **N** não implementado · **B** bloqueado (depende de algo externo).

## Matriz de requisitos

| # | Requisito | Status | Evidência / teste | Limitação | Próxima ação |
| --- | --- | --- | --- | --- | --- |
| 0 | Código do YouTube isolado em pacote próprio | C | `packages/youtube`, regra de lint, `index.test.ts` | — | — |
| 1 | Arquitetura modular, local-first, segura | C | `docs/ARQUITETURA.md`, `seguranca.test.ts` | — | — |
| 1 | IPC com lista permitida, sandbox, preload mínimo | C | `ipc.test.ts`, `seguranca.test.ts` | — | — |
| 2 | Navegação com 10 telas, estados vazios/erro/carregando, confirmações | C | capturas `cap*/`, componentes `ui.tsx` | Sem teste automatizado de interface (só capturas) | Testes de interface automatizados (backlog) |
| 2 | Tema escuro estilo YouTube | C | capturas | — | — |
| 3 | SQLite com migrações versionadas e backup antes de migrar | C | `biblioteca.test.ts`, `roteiros-revisao.test.ts` (migração 7) | — | — |
| 3 | Biblioteca: busca, filtros, ordenação, duplicar, renomear, arquivar, restaurar, excluir | C | `biblioteca.test.ts` | — | — |
| 3 | Versões com diferenças; exportação TXT/MD/JSON; persistência | C | `biblioteca.test.ts`, `fluxo-completo.test.ts` | — | — |
| 3 | Segredos fora do banco | C | `seguranca.test.ts` | — | — |
| 4 | Frequência, período, horizonte, retenção | C | `editorial.test.ts` | Período personalizado só para provedores que o suportem | — |
| 4 | Agenda padrão, limites, fuso, pausa, duplicidade, conflito | C | `editorial.test.ts`, `agenda.test.ts` | — | — |
| 4 | Execuções perdidas com política | C | `agenda.test.ts` | Só com o app aberto (por decisão de segurança) | — |
| 5 | Provedores de pesquisa trocáveis; RSS e páginas | C | `pesquisa.test.ts` | Sem busca na internet inteira | Adaptador de busca por API com chave (backlog) |
| 5 | Anti-SSRF, limites, robots.txt, redirecionamentos, TLS | C | `pesquisa.test.ts`, `rede-real.test.ts` | — | — |
| 5 | Deduplicação, eventos, pontuação explicável, prompt injection | C | `pesquisa.test.ts` | Heurístico | — |
| 5 | Tradução/resumo de fontes estrangeiras | P | idioma detectado e sinalizado | Depende de IA configurada; resumo automático não implementado | Resumo opcional com provedor (média) |
| 6 | Cartões de pauta, pontuação explicável, riscos, semelhança, lotes | C | `planejador.test.ts` | Público/narrativa são preenchidos pelo usuário | — |
| 7 | Dossiê, situação por regras, nada fabricado, relatório | C | `verificacao.test.ts` | — | — |
| 8 | Gerador longo/Short, variações, fatos novos sinalizados, nunca aprova | C | `roteiros-revisao.test.ts` | Modo estruturado produz rascunho a ser reescrito; IA real não testada | Testar com provedor real (pequena) |
| 9 | Revisão factual × editorial, bloqueio, invalidação, histórico | C | `roteiros-revisao.test.ts`, `fluxo-completo.test.ts` | — | — |
| 10 | Cofre, adaptadores, modos, tetos, autorização, plano de envio | C | `ia.test.ts`, `seguranca.test.ts` | Só LLM; TTS/imagem/vídeo/transcrição sem adaptador | Adaptadores dessas categorias (grande) |
| 11 | Biblioteca de mídia com licenças, ausentes, duplicados | C | `midia.test.ts` | Metadados de duração/resolução dependem de FFprobe | — |
| 11 | Editor: linha do tempo, cenas, cortar/mover/ajustar, undo/redo, autosave, recuperação | C | `midia.test.ts` | Pré-visualização sem mistura de áudio; sem transições visuais | Transições simples e prévia de áudio (média) |
| 11 | Renderização 16:9 e 9:16 com progresso, cancelamento, conferência | C | `midia.test.ts`, `render-real.test.ts` (FFmpeg 9.0.2 real) | Testado também pela tela do Estúdio (1080p); vídeos longos reais não testados | Renderizar um vídeo real de vários minutos |
| 11 | Resoluções até 4K com opções e recomendação pelas mídias | C | `render-assistente.test.ts`, `render-real.test.ts` (4K 60 q/s real) | Vídeos longos reais (minutos) em 4K não testados | Renderizar um vídeo real em 4K |
| 17 | Configuração inicial guiada (Primeiros passos) | C | `render-assistente.test.ts`, capturas `cap10/` | — | — |
| 11 | Narração por voz sintética (Windows e Piper), cena por cena, com retemporização | C | `midia-automatica.test.ts` (voz real do Windows), teste pela tela | Piper não executado neste PC (download conferido por SHA-256; primeira execução pelo usuário) | Instalar o Piper pelo botão |
| 11 | Busca de imagens/vídeos com licença livre (Wikimedia, Pexels, Pixabay) e créditos na descrição | C | `rede-real.test.ts` (Wikimedia real, produção completa), `midia-automatica.test.ts` | Pexels e Pixabay sem chave real | Cadastrar chaves gratuitas |
| 11 | Imagens geradas por IA (Pollinations, Hugging Face, Cloudflare) e aviso de conteúdo sintético | P | `midia-automatica.test.ts` (regras) | Nenhum gerador testado com chave real | Cadastrar uma chave e gerar |
| 14 | Segundo plano: bandeja e iniciar com o Windows | P | — (só no app real) | Não testado automaticamente | Ligar e reiniciar o PC |
| — | Controle de versão (git) com .gitignore que exclui banco, cofre e mídia | C | `git log` | — | — |
| 10 | IA híbrida: catálogo de IAs gratuitas, roteador por regras (prioridade, papéis, cotas, pausa automática, reserva), modo automático na geração | C | `ia-hibrida.test.ts` (servidores de IA falsos locais), `rede-real.test.ts` (chave inválida recusada pelo Groq real), teste pela tela | Não testado com chaves reais do usuário | Cadastrar uma IA gratuita e gerar um roteiro |
| 9 | Revisão interna automática (regras + IA revisora diferente da escritora; trecho inexistente descartado; críticos bloqueiam até conferir) | C | `ia-hibrida.test.ts`, teste pela tela | Qualidade da revisão depende do modelo | — |
| 6 | Fontes padrão (27 feeds conferidos), identificar feed pelo endereço do site, sugestões de novas fontes com aprovação, descompactação segura | C | `fontes-painel.test.ts`, `rede-real.test.ts` (as 27 fontes e uma pesquisa real completa), teste pela tela | Feeds de terceiros podem mudar de endereço; o teste de rede real aponta qual | Rodar `REDE_REAL=1` de tempos em tempos |
| 4 | Painel de produção: próximos vídeos e temas, adiantar/adiar, agendar tema, frequência semanal | C | `fontes-painel.test.ts`, teste pela tela | — | — |
| 13 | Importar `client_secret_….json` (Downloads ou escolher) e links diretos do Google Cloud | C | `fontes-painel.test.ts` | Não testado com arquivo real do Google | Testar com o projeto do usuário |
| 13 | Links (redes, produtos, afiliados), descrição automática com capítulos e miniaturas | C | `links-descricao-miniatura.test.ts`, `render-real.test.ts` (miniaturas reais), teste pela tela | Miniatura e descrição não testadas com envio real ao YouTube | Testar com conta real |
| 11 | Montagem automática das cenas no editor | C | `links-descricao-miniatura.test.ts` | Regras simples (sem análise do conteúdo das imagens) | — |
| 12 | Avaliação de qualidade com bloqueadores/avisos e exceções | C | `midia.test.ts` (falhas controladas) | — | — |
| 12 | Medições reais (silêncio, tela preta, capturas) | C | `render-real.test.ts` (FFmpeg 9.0.2 real) | — | — |
| 13 | OAuth oficial, escopos mínimos, desconectar/revogar | P | `packages/youtube` (Google simulado) | **Não testado com conta real** | Teste com projeto Google do usuário (pequena) |
| 13 | Envio retomável, privado por padrão, aprovação obrigatória, sem duplicidade | P | `index.test.ts`, `publicacao-fila.test.ts` | Idem | Enviar vídeo privado de teste |
| 13 | Playlist | N | — | Exigiria escopo mais amplo; não solicitado por padrão | Avaliar com escopo opcional (média) |
| 14 | Fila completa, prioridades, pausa global, bloqueio de publicação, recuperação | C | `publicacao-fila.test.ts` | — | — |
| 14 | Shorts derivados com frases inteiras | C | `publicacao-fila.test.ts` | Revisão de enquadramento/legendas pós-render depende do FFmpeg | — |
| 15 | Métricas autorizadas, comparação, limitações, relatório e sugestões | P | `publicacao-fila.test.ts` | Sem dados reais; impressões/CTR/receita indisponíveis | Validar com conta real |
| 16 | Revisão de segurança, achados corrigidos, testes de regressão | C | `docs/SEGURANCA.md`, `seguranca.test.ts` | Instalador sem assinatura | Certificado de código (média) |
| 17 | Fluxos de ponta a ponta e casos de falha | P | `fluxo-completo.test.ts` | Render real testado à parte; publicação limitada pelo YouTube | Repetir com conta real |
| 17 | Documentação para leigos, comandos, logs, versão, migrações | C | `docs/MANUAL.md`, `Instalar.cmd`, `Abrir Estudio.cmd` | `Abrir Estudio.cmd` executado e abriu o app; `Instalar.cmd` não executado (dependências já instaladas) | — |
| 17 | Instalador testado (instalar/desinstalar) | N | config em `electron-builder.yml` (mantém dados ao desinstalar) | Exige downloads de ferramentas e máquina de teste | Gerar e testar em VM (média) |

### Regras editoriais permanentes

| Regra | Status | Como é imposta |
| --- | --- | --- |
| Nada publicado sem revisão | C | Status "aprovado" só pelo fluxo de revisão; publicação exige roteiro aprovado |
| Não publicar com pendência crítica de verificação ou qualidade | C | Pendências bloqueiam aprovação; QC com bloqueador impede publicação |
| Não inventar fontes/citações/métricas | C | Fontes só de resultados reais ou do usuário; referências e URLs fora do dossiê sinalizadas; métricas só da API |
| Não copiar conteúdo de terceiros | P | Alerta crítico para trechos idênticos a fontes; heurístico |
| Proveniência e licença das mídias | C | Campos obrigatórios para o QC aprovar |
| Conteúdo sintético realista | C | Campo de divulgação na publicação e alerta para mídia gerada por IA |
| Privado primeiro; público só com autorização | C | Padrão privado; confirmação explícita |
| Controle de custos e fila | C | Tetos, autorização e fila com pausa global |

## Correções pequenas feitas nesta auditoria

Nenhuma correção nova foi necessária além das já registradas na Etapa 16. Durante a construção, os testes pegaram e corrigiram, entre outros: parâmetros SQL extras no dossiê, regra de números que cortava anos de 4 dígitos, conferência de VTT com BOM e um teste que acessava um domínio real.

## Backlog para as próximas versões

Prioridade na ordem pedida (segurança → pesquisa → roteiros → persistência → produção → YouTube → visual).

| Prioridade | Item | Tipo | Complexidade |
| --- | --- | --- | --- |
| 1 | Assinar o instalador e definir processo de atualização seguro | Necessidade | Média |
| 1 | Backup criptografado opcional e assistente de restauração | Necessidade | Média |
| 1 | Caminho do FFmpeg fixo por padrão (evitar PATH) | Necessidade | Pequena |
| 2 | Adaptador de busca web por API com chave (opcional, com teto) | Necessidade | Média |
| 2 | Resumo/tradução opcional de fontes estrangeiras com IA | Interessante | Média |
| 3 | Testar geração com Ollama real e ajustar instruções | Necessidade | Pequena |
| 3 | Marcar trechos do roteiro ligados a cada afirmação dentro do editor | Interessante | Média |
| 4 | Testes automatizados de interface (Playwright para Electron) | Necessidade | Média |
| 5 | Transições, prévia de áudio e arrastar clipes na linha do tempo | Interessante | Grande |
| 5 | Narração (TTS) local/online com tetos | Interessante | Grande |
| 6 | **Teste com conta real do YouTube** (privado) e ajustes | Necessidade | Pequena |
| 6 | Playlist com escopo opcional; revisão de campos da API vigente | Interessante | Média |
| 6 | Receita/RPM com escopo monetário opcional | Interessante | Média |
| 7 | Calendário mensal e arrastar para reagendar | Interessante | Média |

## Decisões que precisam da sua aprovação

1. ~~Autorizar a instalação do FFmpeg~~ (feito: FFmpeg 9.0.2 instalado e testado).
2. Configurar seu projeto Google/OAuth para testar as Etapas 13 e 15 com um vídeo privado.
3. Escolher se deseja um provedor de IA (Ollama local gratuito é o recomendado para começar).
4. Iniciar um repositório git na pasta (recomendado para acompanhar as mudanças).
