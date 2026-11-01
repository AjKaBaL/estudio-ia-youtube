# Progresso por etapa

Registro do que foi implementado e verificado em cada etapa. Atualizado ao fim de cada bloco.

## Bloco 1 — Etapas 1 a 4 (concluído em 31/10/2026)

| Etapa | Situação | O que existe | Testes |
| --- | --- | --- | --- |
| 1. Arquitetura | Concluída | `docs/ARQUITETURA.md`; Electron seguro (isolamento, sandbox, preload mínimo, IPC com lista permitida + Zod + verificação de origem, CSP, navegação bloqueada, permissões negadas); pacote isolado `packages/youtube`; fuses no instalador | `ipc.test.ts` |
| 2. Interface | Concluída | Tema escuro estilo YouTube; navegação lateral com 10 telas; estados vazio/carregando/erro/sucesso; confirmação antes de excluir; funções futuras identificadas; layout responsivo (barra lateral compacta abaixo de 1100 px); atalhos `/` (busca) e `Ctrl+S` (salvar) | capturas de todas as telas |
| 3. Banco e biblioteca | Concluída | SQLite (`node:sqlite`) com migrações versionadas e backup antes de migrar; biblioteca com busca sem acentos, filtros, ordenação, duplicar, renomear, arquivar, restaurar, excluir; versões com resumo de diferenças; exportação TXT/MD/JSON; fontes e comentários por roteiro; configurações não secretas separadas (chaves com cara de segredo são recusadas) | `biblioteca.test.ts` |
| 4. Agenda | Concluída | Frequência de busca, período, horizonte, retenção; agenda padrão (1 longo dom 18h, 3 Shorts ter/qui/sáb 18h, America/Sao_Paulo); limites diário/semanal/mensal; pausa geral e por formato; anti-duplicidade; alertas de capacidade/orçamento; execuções perdidas com política (ignorar/executar ao abrir/reagendar) | `editorial.test.ts`, `agenda.test.ts` |

## Bloco 2 — Etapas 5 a 7 (concluído em 31/10/2026)

| Etapa | Situação | O que existe | Testes |
| --- | --- | --- | --- |
| 5. Pesquisa online | Concluída (fontes: RSS/Atom e páginas indicadas pelo usuário) | Interface de provedores com adaptadores independentes; provedor por API com chave aparece "não configurado"; rede segura (anti-SSRF no momento da conexão, redirecionamentos validados, limites de tamanho/tempo/tipo, sem compressão, TLS validado); robots.txt; consulta com E/OU/aspas; deduplicação e agrupamento por evento; pontuação explicável (estimativa); detecção de idioma e de prompt injection; progresso, cancelamento, erros por fonte, repetição com espera; pesquisas agendadas e recuperação após fechar o app | `pesquisa.test.ts` (22), `rede-real.test.ts` (opcional, com internet) |
| 6. Planejador | Concluída | Cartões de pauta a partir de resultados; pergunta central, resumo, público, tipo sugerido, potencial de narrativa, atualidade/janela, fontes preliminares, riscos, complexidade e custo; pontuação explicável com pesos configuráveis; aprovar/rejeitar/editar/combinar/notas/fila de pesquisa; detecção de temas semelhantes; lotes (semanal automático e manuais em paralelo) | `planejador.test.ts` |
| 7. Verificação | Concluída | Dossiê por pauta/roteiro; afirmações com natureza (fato/estimativa/opinião/previsão/hipótese); fontes com trecho, papel e posição; situação e confiança calculadas por regras; tema em rápida mudança; decisões (corrigir/remover/incerto); relatório com pendências exportável; roteiro só vai para revisão com dossiê sem pendências | `verificacao.test.ts`, `ipc.test.ts` |

Limitações conhecidas até aqui:
- A pesquisa só lê as fontes que o usuário adicionar; não existe busca na internet inteira sem um provedor com chave.
- Resumo/tradução de fontes em outro idioma depende de um provedor de IA (Etapa 10).

## Bloco 3 — Etapas 8 a 10 (concluído em 31/10/2026)

| Etapa | Situação | O que existe | Testes |
| --- | --- | --- | --- |
| 10. Serviços de IA e custos | Concluída para modelos de linguagem | Cofre de chaves com criptografia do Windows (DPAPI), fora do banco; adaptadores padronizados: **Simulado** (teste, marcado [SIMULADO]), **Ollama** (local, só 127.0.0.1) e **API compatível com OpenAI** (online, só https público); modos local/híbrido/online (padrão: somente local); teto mensal e por execução (padrão zero); custo não estimável exige autorização explícita; plano de envio mostra dados, destino, finalidade e custo, e a autorização vale só para aquele conteúdo (assinatura); uso registrado sem conteúdo; recursos caros desligáveis; tarefas com cancelar/tentar novamente/diagnóstico. Outras categorias (TTS, imagem, vídeo, transcrição, busca web) aparecem como "não disponível nesta versão" | `ia.test.ts` (inclui Ollama contra servidor local de teste) |
| 8. Gerador de roteiros | Concluída | Modo estruturado sem IA (padrão) e modo IA opcional; vídeo longo (abertura, blocos, narração, visual, texto na tela, conclusão, sugestões de título/descrição/capítulos/miniatura sem promessa de cliques) e Short (9:16, ideia única); fontes do dossiê numeradas no texto; variações como novas versões; conferência por regras: referências inexistentes removidas, números/datas fora do dossiê e atribuições sem fonte marcados; semelhança com roteiros anteriores; contagem de palavras e duração provável; estados rascunho / precisa de verificação / pronto para revisão; nunca aprova | `roteiros-revisao.test.ts` |
| 9. Revisão editorial | Concluída | Tela de revisão por cenas com dossiê, alertas factuais, repetição, semelhança, possível cópia de fonte, citação longa, exageros, linguagem artificial, título apelativo, duração e comparação de versões; revisão factual e editorial separadas; aprovar para produção só com as duas aprovações válidas e sem pendências críticas; pedir correções (volta a rascunho), editar, rejeitar/arquivar; marcar afirmação como verificada exige fonte; histórico auditável; alteração após aprovação invalida a aprovação e indica as seções alteradas | `roteiros-revisao.test.ts` |

Limitações conhecidas:
- Nenhum provedor real de IA foi testado (nenhum foi configurado pelo usuário). O fluxo foi testado com o adaptador simulado e com um servidor local que imita o Ollama.
- Os alertas de texto são heurísticos (listas de termos e comparação de trechos); não substituem a leitura humana.

## Bloco 4 — Etapas 11 e 12 (concluído com bloqueio em 31/10/2026)

| Etapa | Situação | O que existe | Testes |
| --- | --- | --- | --- |
| 11. Mídia e editor | **Parcial — renderização bloqueada** | Biblioteca de mídia: importação por caixa de diálogo, tipo conferido pela assinatura do arquivo (executáveis recusados), limites de tamanho, cópia para a pasta do app com SHA-256, duplicatas recusadas, origem/autor/URL/licença/situação (criado por você, gerado por IA, licenciado, domínio público a verificar, não verificado), alertas de licença, arquivos ausentes, protocolo `midia://` que só serve arquivos registrados. Editor: projeto a partir do roteiro (cenas por seção, legendas da narração), faixas de vídeo/trilha/narração/legendas/textos, cortar/mover/substituir/ajustar duração/reordenar cenas, volume e fades, 16:9 e 9:16, desfazer/refazer, salvamento automático com 30 cópias e restauração, pré-visualização simplificada. Renderização: comando FFmpeg montado como lista de argumentos (sem shell), presets 720p/1080p, legendas por arquivo SRT, progresso, cancelamento, checagem de espaço em disco e conferência do arquivo final | `midia.test.ts` |
| 12. Controle de qualidade | **Parcial — medições bloqueadas** | Avaliação por regras com bloqueadores e avisos: arquivo abre, duração, resolução/proporção, trilhas, silêncio total, tela preta, legendas no tempo e no quadro, narração cortada, cenas sem imagem, mídia ausente, origem/licença, fontes anexadas, roteiro aprovado, projeto alterado depois do render, miniatura pendente; capturas de quadros; aceitar só avisos com justificativa; relatório salvo no banco | `midia.test.ts` (falhas controladas) |

**Bloqueio (resolvido no mesmo dia):** inicialmente o FFmpeg não estava instalado. Ver "Desbloqueio do FFmpeg" no fim deste arquivo.

## Bloco 5 — Etapas 13 a 15 (concluído em 31/10/2026, sem teste com conta real)

| Etapa | Situação | O que existe | Testes |
| --- | --- | --- | --- |
| 13. YouTube | Implementada; **não testada com conta real** | Tudo em `packages/youtube` (ver `packages/youtube/REGRAS.md`): OAuth oficial com PKCE e retorno local em 127.0.0.1, escopos mínimos explicados na tela, desconectar com revogação, canais/playlists, envio retomável, miniatura, status. No app: credenciais e tokens no cofre; cliente HTTP restrito aos hosts oficiais; publicação com id de operação, rascunho → aprovação (obrigatória por padrão) → envio → processamento → concluída; privado por padrão; público só com confirmação explícita; pré-requisitos: roteiro aprovado, render concluído, QC aprovado, declaração "feito para crianças"; uma publicação ativa por render e bloqueio de reenvio do mesmo arquivo (hash); pausa/retomada; envio interrompido no fechamento do app fica "pausado" e retoma a mesma sessão | `packages/youtube/src/index.test.ts` (Google simulado), `publicacao-fila.test.ts` |
| 14. Fila completa e Shorts | Concluída | Fila por item da agenda com estado do roteiro, revisão, produção, QC e publicação, pendências e atraso; ordenar, pausar, priorizar, reagendar, cancelar; "Parar todas as tarefas automáticas" persistente; publicação bloqueada para roteiro em revisão ou QC reprovado; Shorts derivados de blocos (frases inteiras) ou afirmações verificadas, como roteiro próprio ligado ao longo | `publicacao-fila.test.ts` (semana fictícia 1 longo + 3 Shorts) |
| 15. Métricas e relatório | Implementada; **sem dados reais** | Coleta pela YouTube Analytics API (permissão opcional), painel por período e formato, comparação com a mediana do próprio formato, dias desde a publicação, custo de IA aproximado, fontes de tráfego sob demanda, limitações explícitas (impressões/CTR e receita indisponíveis); relatório semanal explicável e exportável; sugestões ficam pendentes até aprovação e não mudam nada automaticamente | `publicacao-fila.test.ts` |

Limitação principal: sem uma conta do YouTube e um projeto Google configurados pelo usuário, conexão, envio e métricas reais não puderam ser executados. Todo o fluxo foi testado contra servidores simulados.

## Bloco 6 — Etapas 16 a 18 (concluído em 31/10/2026)

| Etapa | Situação | O que existe | Testes |
| --- | --- | --- | --- |
| 16. Segurança | Concluída | Revisão completa em `docs/SEGURANCA.md`; corrigidos: URLs inventadas pela IA, mistura entre projetos, DevTools no app instalado, `secure_delete`, teste que acessava domínio real; dependências auditadas (alertas moderados só em ferramentas de build) | `seguranca.test.ts` |
| 17. Integração e documentação | Parcial | Fluxo de ponta a ponta e casos de falha pela IPC; manual para leigos (`docs/MANUAL.md`); `Instalar.cmd` e `Abrir Estudio.cmd`; desinstalação preserva dados. Não feito: teste do instalador em VM; passos de render/publicação reais (bloqueados) | `fluxo-completo.test.ts` |
| 18. Auditoria | Concluída | Matriz de requisitos, backlog priorizado e decisões pendentes em `docs/AUDITORIA.md` | — |

Verificação final: `npm run verificar` (typecheck + lint + 143 testes) e build passando; todas as telas abertas sem erros de interface.

## Desbloqueio do FFmpeg (31/10/2026)

- FFmpeg 9.0.2 instalado pelo `winget` (pacote oficial `Gyan.FFmpeg`, hash conferido pelo winget).
- Novo teste opcional `src/main/testes/render-real.test.ts`, que gera as mídias com o próprio FFmpeg, importa na biblioteca e usa o caminho real do app (`GerenciadorProducao` e `coletarDadosQualidade`):
  - renderização 16:9 720p concluída e conferida (H.264 1280×720, AAC estéreo, duração correta);
  - controle de qualidade real: sem silêncio nem tela preta, 3 capturas de quadro geradas, nenhum bloqueador técnico; os bloqueadores editoriais (roteiro não aprovado, sem fontes) continuam impedindo a publicação;
  - Short 9:16 720p com resolução 720×1280;
  - tela preta provocada é detectada pelo QC real;
  - cancelamento interrompe o FFmpeg e marca a renderização como cancelada.
- **Defeito encontrado e corrigido:** uma narração mono gerava vídeo mono. A saída agora é sempre estéreo (`-ac 2` em `src/main/midia/ffmpeg.ts`).
- Como rodar: `FFMPEG_REAL=1 npx vitest run render-real` (no PowerShell: `$env:FFMPEG_REAL='1'; npx vitest run render-real`).
- **Teste pela tela** (`src/main/testeTelaDev.ts`, só em desenvolvimento): o app abre numa pasta de dados de teste, prepara projeto, roteiro, mídias e linha do tempo e depois clica em **Renderizar**, acompanha a barra até "concluida", abre **Controle de qualidade** e clica em **Executar verificação**. Resultado: render 1080p concluído e todas as verificações técnicas OK (arquivo, duração, resolução, áudio, silêncio, tela preta, legendas, mídias e licenças), zero erros de interface.
  Como rodar (PowerShell): defina `ESTUDIO_PASTA_DADOS` (pasta de teste), `ESTUDIO_TESTE_RENDER` (pasta das capturas) e `ESTUDIO_TESTE_ARQUIVOS` (vídeo|imagem|áudio separados por `|`), depois `npm run build` e `npx electron .`. O resultado fica em `resultado.json`.
- O atalho `Abrir Estudio.cmd` foi executado: compilou e abriu a janela "Estúdio IA YouTube".
- Ainda não testado: vídeos longos de verdade (vários minutos).

## Renderização até 4K e Primeiros passos (31/10/2026)

**Vídeo até 4K**
- 8 resoluções: 720p, 1080p, 1440p (2K) e 2160p (4K), para vídeo longo (16:9) e Short (9:16, até 2160×3840).
- Opções por renderização: quadros por segundo (24, 25, 30, 60), qualidade (padrão, alta, máxima) e velocidade (rápida, equilibrada, lenta). Cada opção vem explicada na tela.
- O comando do FFmpeg usa teto de taxa de bits baseado nas taxas de referência do YouTube, com folga conforme a qualidade, quadro-chave a cada meio segundo e ampliação lanczos. As opções ficam guardadas em cada renderização (migração 14).
- **Recomendação por regras (sem IA)**:
  - O app lê com o FFprobe a resolução e os quadros por segundo das mídias (na importação ou na hora de renderizar).
  - Recomenda a maior resolução que a melhor mídia suporta, sem ampliar, nunca abaixo de 1080p em vídeo longo.
  - Shorts: recomenda 1080p.
  - Quadros por segundo: os da gravação (60, 24 ou 25), senão 30.
  - Mostra os motivos e avisos por opção (mídias que seriam ampliadas, tempo e tamanho do 4K), além do tamanho máximo estimado e do espaço livre. Bloqueia se faltar espaço.
- **Preferência padrão:** "automático pela qualidade das mídias" (recomendado) ou "sempre a mesma resolução", em Configurações › Vídeo e renderização e nos Primeiros passos.

**Primeiros passos** (assistente de configuração inicial)
- Abre sozinho na primeira vez e fica no menu lateral.
- 8 etapas: boas-vindas, projeto do canal, fontes de pesquisa, agenda, IA, vídeo, conta do YouTube (opcional) e backup.
- Cada etapa explica "o que é" e "por que importa" e permite fazer a configuração ali mesmo.
- A situação de cada etapa vem dos dados reais (projeto criado, fontes ativas, FFmpeg encontrado, backup existente). Só as etapas de leitura ficam marcadas como revisadas.
- "Continuar depois" adia a configuração. A Visão geral mostra o progresso até a conclusão.
- **Guias passo a passo** também nas telas normais:
  - Google Cloud/OAuth: em Publicações e nos Primeiros passos.
  - Feeds RSS: em Fontes e opções.
  - Ollama: em Serviços de IA.
  - FFmpeg: no Estúdio e em Configurações.

**Testes**
- `render-assistente.test.ts`: presets, taxas, comando 4K com opções, recomendação (vários cenários), preferência pela IPC e assistente.
- `render-real.test.ts` (FFmpeg real): mais um render **4K 3840×2160 a 60 quadros/s** concluído e conferido, com QC sem bloqueadores técnicos, e a leitura de resolução e quadros/s das mídias.
- Teste pela tela: render concluído com o novo painel e zero erros de interface. Capturas de todas as etapas do assistente sem erros.
- Total: 154 testes passando, mais 8 opcionais (rede real e FFmpeg real) executados com sucesso.

## Automação da publicação: links, descrição, miniaturas e montagem (31/10/2026)

**O que já existia e o que faltava:** o app já editava, renderizava, conferia a qualidade e enviava ao YouTube com aprovação. Faltavam:
- miniaturas: não havia como criar nem escolher;
- descrição: era só o tema mais as fontes;
- cadastro de links;
- montagem automática das cenas.

Tudo abaixo funciona por regras fixas, sem IA. A aprovação humana antes de enviar continua obrigatória.

**Links e redes** (nova tela no menu)
- Cadastro de redes sociais, produtos, links de afiliado, patrocínio, site e outros. Valem para um projeto ou para todos.
- "Incluir sempre" põe o link automaticamente em toda descrição; "Ativo" pausa um link sem apagá-lo.
- Endereços validados: só http/https públicos (migração 15).

**Descrição automática**
- Monta a descrição a partir do resumo do roteiro (tema ou primeiro parágrafo).
- Inclui capítulos tirados das cenas do editor, seguindo as regras do YouTube: começa em 00:00, mínimo 3, cada um com 10 s ou mais. Shorts não levam capítulos.
- Agrupa os links por tipo e acrescenta as fontes verificadas e até 3 hashtags sem acento.
- Aviso de afiliado incluído automaticamente. Com patrocínio, lembra de marcar "promoção paga".
- Limite de 5000 bytes: encurta primeiro as fontes, depois os links. Troca `<` e `>`.
- Ao preparar a publicação, a descrição já vem pronta com os links "incluir sempre". Em Publicações dá para escolher outros links e gerar de novo.

**Miniaturas (thumbs)**
- Criadas com o FFmpeg em 1280×720, JPG até 2 MB.
- 3 modelos: faixa escura, texto à esquerda e texto grande no centro.
- Opções: selo, 5 cores, 3 fontes do Windows e texto em maiúsculas.
- O tamanho da letra se ajusta à largura e o texto é quebrado em linhas.
- Origem da imagem:
  - Quadro do vídeo: 6 quadros candidatos. O sugerido é o de maior detalhe (maior JPG), o que evita quadros pretos ou lisos.
  - Imagem da biblioteca.
- O quadro vem da mídia original da cena, sem as legendas gravadas no vídeo final.
- Prévia antes de salvar. A miniatura salva vai para a biblioteca com a origem registrada e fica ligada à publicação.
- **Automática ao preparar a publicação** de vídeo longo: melhor quadro + início do título.
- Segurança: o texto vai para o FFmpeg por arquivo, com `expansion=none`, e a fonte é copiada para a pasta de trabalho. Nenhum texto do usuário entra no comando.

**Montagem automática** (botão no editor)
- As cenas vazias recebem as mídias marcadas com o nome da cena (campo "Cena" da biblioteca). Sem marcação, recebem a próxima mídia ainda não usada.
- Vídeos ocupam só a própria duração; o resto da cena recebe a mídia seguinte.
- Áudio marcado como "narração" vai para a faixa de narração. Áudio marcado como "trilha" vai para a trilha em volume de 15%, com entrada e saída suaves.
- Não mexe em cenas já montadas e pode ser desfeito com Ctrl+Z.

**Correções**
- O editor mostrava as mídias do primeiro projeto, não as do projeto do roteiro.
- Hashtags quase iguais ("ia" e "i.a.") apareciam repetidas.
- Arredondamento fazia a montagem pular uma cena.

**Testes**
- `links-descricao-miniatura.test.ts`: 15 testes de descrição, capítulos, hashtags, quebra de texto, filtro seguro, fonte, montagem automática e links na publicação.
- `render-real.test.ts` (FFmpeg real): quadros candidatos, prévias nos 3 modelos, miniatura 1280×720 salva e reaproveitada, e miniatura automática ao preparar pela IPC.
- Teste pela tela: renderizar, controle de qualidade, preparar publicação (com miniatura automática) e abrir o criador de miniaturas com prévia, sem erros de interface.
- Total: 167 testes, mais 10 opcionais (rede e FFmpeg reais) executados com sucesso.

## Administração da produção, fontes padrão e credenciais do YouTube (31/10/2026)

**Painel de produção** (nova tela inicial)
- Próximos vídeos: barra de etapas, próximo passo, adiantar/adiar (troca com o vizinho do mesmo formato ou usa horário livre), pausar.
- Próximos temas: pautas sem data, ordenadas por prioridade manual, aprovadas e nota; agendar no próximo horário livre (aprova o tema); descartar.
- Frequência: N por semana e horário por formato; dias distribuídos por regra fixa; conflito com o outro formato desloca 1 hora; 0 pausa.
- Migração 16: `pautas.prioridade`, `calendario_entradas.pauta_id`, `fontes_pesquisa.origem` e tabela `sugestoes_fontes`.

**Fontes de pesquisa**
- 27 feeds padrão conferidos em 31/10/2026 (10 brasileiros, 8 de IA, 7 de tecnologia e negócios, 2 agregadores) e 24 termos monitorados. Aplicados uma vez por projeto; o que o usuário remove não volta sozinho; "Restaurar fontes padrão".
- Identificar: cola o site e o app acha o feed (link anunciado, depois caminhos comuns); sem feed, vira página.
- Sugestões: depois de cada pesquisa, sites dos resultados que não são fontes são contados; com 2 ocorrências o app procura o feed (até 4 por pesquisa). Pendentes aguardam aprovação; recusadas não voltam; plataformas (YouTube, redes, GitHub...) nunca são sugeridas.
- Agregadores (Google Notícias): o domínio considerado é o do site original (`<source url>`).
- Correção: alguns servidores (ex.: Google DeepMind) compactam o conteúdo mesmo pedindo sem compressão; agora o app descompacta com o mesmo limite de 2 MB no resultado (proteção contra "bombas").

**YouTube**
- Passo a passo com botões que abrem a página exata do Google Cloud em cada etapa.
- Importação do `client_secret_….json`: achado em Downloads (últimos 30 dias, só nomes e datas são lidos) ou escolhido na caixa "Abrir". Aceita só o tipo "App para computador". O caminho nunca vem da tela. O arquivo não é apagado.

**Testes**
- `fontes-painel.test.ts`: 13 testes.
- `rede-real.test.ts` (opcional): as 27 fontes respondem pelo app; pesquisa real completa em 9,6 s com 27 fontes, 0 erros e 144 resultados, e sugestões geradas (ex.: estadao.com.br).
- Teste pela tela: painel (agendar tema), 27 fontes padrão na tela, 7 botões do Google Cloud, 0 erros de interface.
- Total: 180 testes, mais 13 opcionais.

## IA híbrida com várias IAs gratuitas e revisão interna (31/10/2026)

**Catálogo de IAs gratuitas** (`src/shared/catalogoIa.ts`): Ollama (PC), Groq, Google AI Studio (Gemini), Mistral, Cerebras, OpenRouter (só modelos “:free”), GitHub Models e Hugging Face. Endereços conferidos em 31/10/2026. Como os modelos gratuitos mudam muito, o app busca a lista atual com a chave e escolhe pelo nome (preferências por fornecedor; ignora modelos de áudio, imagem e embeddings). Cada item mostra limites e um aviso de privacidade.

**Roteador** (`src/main/ia/roteador.ts`), por regras fixas: ativo, com chave, com modelo, com o papel (escrever/revisar), fora de pausa, abaixo do limite diário do usuário; modo local só PC; híbrido/online inclui gratuitas se "Usar IAs gratuitas automaticamente" estiver ligado; pagas nunca na escolha automática; Simulado nunca. Ordem: prioridade e, no empate, o PC. Até 4 tentativas, passando para a próxima em erro ou resposta fora do formato. Pausa automática: 429 → tempo pedido ou 1 h; 401/403 → 24 h; 5xx/tempo/conexão → 10 min.

**Geração**: opção "Automático: o app escolhe a IA"; sem IA disponível, modo estruturado com aviso.

**Revisão interna** (`src/main/revisao/interna.ts`): regras fixas + IA revisora (outra que não a escritora, se houver). Pontos com trecho inexistente no roteiro são descartados. Críticos da IA bloqueiam a produção até serem conferidos; aprovar para produção sem revisão da versão atual roda as regras na hora. Roda sozinha após gerar (política).

**Migração 17**: pausa e último erro por provedor, tarefa e erro no uso, tabela `revisoes_internas`.

**Testes**: `ia-hibrida.test.ts` (7, com servidores Ollama falsos: limite 429, resposta inválida, reserva, revisora diferente, trecho inventado, bloqueio e conferência); `rede-real.test.ts` (chave inválida recusada pelo Groq real); teste pela tela (8 IAs no catálogo, painel de decisão, revisão interna na tela, 0 erros). Total: 187 testes + 14 opcionais.

**Não testado**: geração e revisão com chaves reais (o usuário ainda não cadastrou IAs) e com o Ollama (não instalado neste PC).

## Configuração de um clique (31/10/2026)

- `src/main/configRapida.ts` + canal `rapido:aplicar`: ações `tudo`, `projeto`, `pesquisa`, `agenda_leve|medio|intenso`, `ia_hibrido`, `ia_local`, `video`. Idempotentes; cada uma marca a etapa do assistente como feita. Nada publica, gasta ou envia dados.
- `src/main/instaladores.ts`: winget com lista fechada (Ollama.Ollama, Gyan.FFmpeg), sem texto do usuário no comando; abre o Ollama, baixa `qwen3:4b` pela API local e cadastra como IA do PC. FFmpeg instalado é configurado pelo atalho do winget.
- Assistente: botão "Configurar tudo com o recomendado"; cada etapa com botão de 1 clique e o ajuste manual recolhido.
- Mesmos botões em: Visão geral, Serviços de IA, FFmpeg (Estúdio e Configurações › Vídeo), frequência do Painel.
- Testes: `config-rapida.test.ts` (2); teste pela tela: assistente de 2 para 7 de 7 etapas com 1 clique, 0 erros. Total: 189 testes.
- Não testado: instalar Ollama e FFmpeg pelo botão (o FFmpeg já existe neste PC; o Ollama não foi instalado sem a autorização do usuário).

## Barras de progresso com porcentagem (31/10/2026)

- Componente único `componentes/progresso.tsx`: etapa, porcentagem, detalhe, tempo decorrido e tempo restante estimado (pela velocidade observada, vale para envios retomados). Sem porcentagem conhecida, barra em movimento com tempo decorrido. Respeita "reduzir movimento" do Windows.
- Onde aparece:
  - Instalar Ollama: winget 0–20% (lido da saída), abrir 20–25%, baixar o modelo 25–97% (MB baixados de MB total, somando as partes informadas pelo Ollama), cadastrar 97–100%. A barra nunca volta e reaparece se você sair e voltar à tela.
  - Instalar FFmpeg: porcentagem do instalador.
  - Renderização: porcentagem pelo tempo já codificado, com tempo restante.
  - Controle de qualidade (novo): leitura 2%, silêncios 5–50%, telas pretas 50–90%, capturas 90–98%, avaliação 99%.
  - Pesquisa: fontes 0–85%, classificar 88%, novas fontes 93%.
  - Envio ao YouTube: porcentagem e MB enviados.
  - Geração de roteiro e revisão interna: barra em movimento (a IA não informa porcentagem).
- Testes: `progresso.test.ts` (3: porcentagem do winget, download do modelo com Ollama falso, erros); `render-real.test.ts` confere as etapas e a porcentagem do controle de qualidade com FFmpeg real; teste pela tela confere a barra durante a renderização. Total: 192 testes.

## Produção automática de mídia, segundo plano e git (31/10/2026)

- **Git:** repositório criado (`main`), `.gitignore` exclui banco, cofre, client_secret, dados, backups e builds.
- **Voz** (`src/main/midia/voz.ts`): Windows/SAPI por script fixo (texto por arquivo, voz só da lista do sistema); Piper neural pt-BR com download conferido por SHA-256 (programa, modelo e configuração), descompactado pelo tar do Windows; texto pelo stdin. Fallback para a voz do Windows.
- **Busca** (`src/main/midia/imagens.ts`): Wikimedia Commons sem chave (filtra licenças: PD, CC0, CC BY; BY-SA opcional; NC/ND nunca), Pexels e Pixabay com chave (fotos e vídeos até 1920 px). Download pelas proteções da pesquisa, tipo conferido pelo conteúdo.
- **Geração** (`gerarImagem`): Pollinations, Hugging Face (FLUX.1 schnell) e Cloudflare Workers AI; prompt sem texto, logotipos ou pessoas reais identificáveis.
- **Coordenador** (`src/main/midia/automatica.ts`): narração por cena + retemporização (`retemporizarComNarracao`), imagens por cena (consultas da mais específica à mais ampla; termos em inglês para o Wikimedia se houver IA), geração quando a busca não acha, montagem automática, barra de progresso. Proveniência completa na biblioteca.
- **Créditos e divulgação:** créditos de mídias de terceiros na descrição (nunca cortados); avisos de conteúdo sintético na descrição e no controle de qualidade.
- **Segundo plano** (`src/main/segundoPlano.ts`): bandeja com menu (abrir, pausar/retomar tarefas, sair), fechar esconde, iniciar com o Windows escondido (`--segundo-plano`).
- **Testes:** `midia-automatica.test.ts` (8, incluindo voz real do Windows e produção da narração da edição inteira); `rede-real.test.ts` (Wikimedia real com download e produção completa voz + imagens + montagem: 2 cenas com narração e imagens CC0/PD); teste pela tela (diálogo do editor, aba Mídia automática com 2 vozes do Windows, 0 erros). Total: 200 testes + 16 opcionais.
- **Não testado:** Piper executado (bloqueado executar programa baixado durante o desenvolvimento), Pexels/Pixabay e geradores com chaves reais, bandeja e início com o Windows no app real.

## Piloto automático e barra de status (31/10/2026)

- **Barra de status** no topo: trabalhando / em espera (com tempo até a próxima pesquisa) / pausado; painel com atividades e porcentagem, próxima e última pesquisa, pendências; "Trabalhar agora" retoma e dispara a pesquisa (e um ciclo do piloto, se ligado).
- **Piloto automático** (`src/main/piloto.ts`, migração 18 `piloto_registros`): ciclo a cada 5 min pelo agendador; uma tarefa pesada de cada tipo por ciclo; avança cada vídeo uma etapa: pautas → tema → dossiê com IA (trechos exatos conferidos; prontas só pelas regras de verificação) → roteiro + revisão interna → **aprovação do roteiro** → edição → narração e imagens (uma vez) → renderização (preset recomendado) → controle de qualidade → rascunho da publicação com miniatura → **aprovação da publicação** → envio opcional (só aprovadas). Erro numa etapa: nova tentativa após 3 h. "Aguardando" repetido não é registrado de novo.
- **Etapas compartilhadas** (`src/main/producao/etapas.ts`): controle de qualidade e preparo da publicação usados pelos botões e pelo piloto.
- **Correção:** o controle de qualidade gerava sempre o aviso "miniatura e metadados ainda não associados", que exigia aceite manual em todo vídeo (a publicação vem depois); virou item informativo — título, descrição e miniatura são exigidos na aprovação da publicação.
- **Testes:** `piloto.test.ts` (IA falsa local: pauta, tema, dossiê só com trechos exatos, roteiro nunca aprovado sozinho, espera da aprovação sem repetir registro, narração com voz real do Windows, espera do FFmpeg; pausa geral); com FFmpeg real: renderização, controle de qualidade aprovado, rascunho da publicação e espera da aprovação. Teste pela tela: ligar o piloto. Total: 204 testes + 18 opcionais.

## Produção de ponta a ponta com 1 botão (31/10/2026)

Pedido explícito do usuário: a IA aprova; o usuário só prioriza temas e aperta 1 botão.
- **Revisão e aprovação pela IA** (`revisarEAprovar`): revisão interna → se houver ponto crítico, nova versão com a lista exata de problemas (`correcoes` no gerador) → nova revisão; até 2 correções; aprova pelas mesmas funções e travas da aprovação manual. Falhou: arquiva o roteiro, tira da agenda e põe a pauta na fila de pesquisa.
- **Dossiê**: afirmações não confirmadas pelas regras viram "remover" (registradas, fora do roteiro; não geram pendência eterna).
- **Qualidade**: avisos aceitos com justificativa registrada; bloqueadores viram erro visível.
- **Publicação**: aprovada como PRIVADA (feito para crianças: não, por padrão do canal; conteúdo sintético marcado se houver imagens geradas por IA) e enviada; confere se o YouTube está conectado antes.
- **Fluxo contínuo**: um ciclo que fez algo chama o próximo em 2 s; o fim da renderização também. Itens com "Produzir agora" (prioridade 100) vêm primeiro.
- **Telas**: "Produzir tudo" no topo (liga o piloto); "Produzir agora" nos temas; painel do piloto com "Precisa de você" só para erros e configurações; pendências de revisão/publicação somem do topo quando a IA aprova.
- **Mantido**: público só com o usuário; bloqueadores nunca aceitos; nada inventado (trechos conferidos, regras de verificação).
- **Testes**: `piloto.test.ts` (IA aprova; corrige 1 ponto crítico e aprova na versão 2; sem conseguir, arquiva e pesquisa de novo sem repetir em seguida; pausa); com FFmpeg real até a publicação aprovada como privada e o aviso de YouTube não conectado. Total: 206 testes + 18 opcionais.

## Imagens sempre automáticas e editor sincronizado com o piloto (31/10/2026)

- **Cartões gráficos** (`src/main/midia/cartoes.ts`): quando nem a busca livre nem a IA trazem imagem, o app cria com o FFmpeg um cartão (degradê, título da cena sem "Bloco N —" e a primeira frase da narração), 16:9 ou 9:16, sem chave e sem internet. Proveniência: "Cartão gráfico criado pelo aplicativo". Opção em Mídia automática (ligada por padrão).
- **Piloto**: segunda passada de mídia quando restar cena sem imagem (só com FFmpeg).
- **Correção no editor**: depois de "Gerar narração e imagens", a revisão de referência do salvamento automático não era atualizada e o editor acusava "O projeto foi salvo em outro lugar". Agora atualiza; e, se outra parte do app (o piloto) salvar uma versão nova, o editor carrega a mais nova sozinho (também conferido a cada 4 s quando não há alteração pendente).
- **Testes**: `cartoes.test.ts` (regras; cartão real 16:9 e 9:16; produção sem chave nem internet com todas as cenas preenchidas). Total: 207 testes + 20 opcionais.

## Vídeos mais dinâmicos: apresentador, movimento, vídeos e trilha (31/10/2026)

- **Apresentador animado** (personagem original do canal, desenhado por `scripts/apresentador.py`; PNGs em `recursos/apresentador`, embutidos em `src/main/midia/apresentadorArte.ts`): fica no canto, abre cada cena maior (zoom) e troca de pose conforme a frase da legenda — pergunta (com interrogação), ideia, dado/número, alerta, pensando, comemorando, falando —, com a boca abrindo e fechando e um balanço leve. Regras fixas em `src/shared/apresentador.ts`, sem IA.
- **Fotos em movimento**: 5 padrões de zoom/deslocamento alternados; fotos com proporção muito diferente da tela ganham **parallax** (fundo desfocado que se aproxima e a foto inteira à frente deslizando). Vídeos preenchem a tela sem faixas pretas. Transição suave na troca de cena.
- **Vídeos no conteúdo**: cenas alternadas buscam um vídeo com licença livre (Wikimedia Commons sem chave; Pexels/Pixabay com chave) e uma foto ou cartão completa o tempo.
- **Trilha sonora em todo vídeo** (`src/main/midia/trilha.ts`): composta pelo próprio app com o FFmpeg (acordes, baixo, batida leve e arpejo; 4 estilos), sem direitos de terceiros; entra a 15% sob a narração.
- **Títulos das cenas** na tela nos primeiros segundos.
- **Imagens estranhas**: a busca no Wikimedia agora descarta logotipos, mapas, diagramas, documentos, ícones, cartazes etc., exige título relacionado à busca, largura mínima de 1000 px e proporção de tela.
- Tudo ligado por padrão; cada item pode ser desligado em Configurações › Mídia automática › Acabamento do vídeo.
- **QC**: a detecção de tela preta passou a tolerar o apresentador no canto (`pic_th=0.8`).
- **Testes**: `apresentador.test.ts` (poses, plano, argumentos, render real com quadros conferidos) e `trilha.test.ts`. Total: 214 testes + 22 opcionais; teste pela tela aprovado.

## Piloto resolve tudo sozinho e publica no horário (31/10/2026)

- **Publicação automática** (pedido explícito do usuário): a IA aprova a publicação pelas mesmas travas fixas e o vídeo vai ao ar **sozinho no horário marcado** (sobe ao YouTube nas 2 horas anteriores, agendado; se o horário já passou, vai público na hora). Opção "Publicar sozinho no horário marcado" no piloto (desligada: envia como privado). Conteúdo sintético continua marcado.
- **Postar agora**: botão em Próximos vídeos para vídeo pronto (controle de qualidade aprovado e ainda não enviado), com confirmação; envia como público.
- **Controle de qualidade reprovado**: bloqueador nunca é aceito; o piloto corrige sozinho (refaz imagens/narração, corrige a linha do tempo) e renderiza de novo, até 3 vezes; depois troca o tema.
- **Dossiê sem afirmações suficientes**: o piloto pesquisa mais fontes e tenta de novo; se continuar faltando, troca o tema (a pauta fica descartada com o motivo e pode ser reativada). O piloto não escolhe mais temas de fonte única.
- **Linha do tempo**: sobreposições e buracos entre imagens são corrigidos sozinhos (na produção de mídia, antes de renderizar e na própria renderização). A montagem não repete a mesma mídia em duas cenas (causa do "clipes sobrepostos em 22,4 s").
- **Sem FFmpeg**: o piloto instala sozinho (instalador oficial do Windows).
- **Horário sem tema**: o piloto escolhe o melhor tema do formato.
- **"Precisa de você"** só aparece para o que nenhum programa resolve (conectar a conta do YouTube, etapa que você desligou). Erros de etapa aparecem como "Resolvendo".
- **Próximos vídeos** mostra a situação ao vivo de cada vídeo (Na fila, Produzindo com %, Corrigindo sozinho, Pronto, Publicando, Precisa de você), atualizada a cada 5 s.
- Correção: vídeo já enviado não fica mais "feito" em toda rodada (o horário passa a "publicado" e sai da fila do piloto).
- Migração 19 (`piloto_registros.precisa_usuario`).
- **Testes**: `linha-tempo.test.ts`; `piloto.test.ts` (fonte única → pesquisa e troca; QC reprovado → correção automática e troca após 3; pronto → espera o horário, Postar agora, YouTube desconectado é o único "precisa de você"). Total: 218 testes + 22 opcionais; teste pela tela aprovado.

## Vídeos mais longos e profundos, voz neural e apresentador solto (31/10/2026)

- **Roteiros longos de verdade**: o pedido à IA passou a exigir 6 a 8 cenas e 1100 a 1500 palavras (7 a 10 min), com contexto, explicação, exemplos e consequências; números, datas, nomes e citações continuam só das afirmações. Se a resposta vier curta, a IA **desenvolve cena por cena**; regra fixa: a versão desenvolvida é descartada se trouxer algum número que não esteja nas afirmações/fontes.
- **Dossiê mais rico**: a IA extrai de 5 a 10 afirmações diferentes, sem repetir as que já existem; vídeo longo exige 4 afirmações confirmadas (Short, 2). Faltando, o piloto pesquisa mais fontes e, se não der, troca o tema.
- **Roteiro longo raso já pronto** (menos de 600 palavras, ainda não publicado) é refeito uma vez, mais completo; a publicação preparada dele é cancelada.
- **Voz**: o padrão passou a ser a voz neural **Piper** (pt-BR "Faber"), instalada sozinha na primeira narração (download com SHA-256 conferido); a voz do Windows fica só como reserva (se o Piper não instalar ou falhar). Migração 20 troca a preferência salva de "Windows" para "Piper". Pausa curta entre frases.
- **Imagens para ler não se movem**: cartões gráficos (título e frase) ficam parados mesmo com "fotos em movimento".
- **Apresentador solto**: muda de lado a cada cena, entra deslizando pela lateral, tem um leve vaivém e, do lado esquerdo, usa o desenho espelhado (aponta para o conteúdo, com "IA" e "?" legíveis). As legendas se afastam das duas laterais.
- `scripts/apresentador.py` agora também gera as versões espelhadas e o `apresentadorArte.ts` (32 desenhos).

## Várias fontes por roteiro, links das matérias e fila destravada (01/11/2026)

- Causa da fila parada: toda pauta nascia de 1 notícia só (o agrupamento quase nunca juntava matérias) e a "pesquisa da pauta" não anexava o que achava à própria pauta. Cada tentativa virava erro e o piloto esperava 3 h.
- Novo `pesquisa/aprofundar.ts`: a mesma notícia em outros sites (pesquisas anteriores + Bing Notícias RSS com o endereço original), metadados e trecho curto de cada página (robots.txt respeitado), proveniência numa pesquisa da pauta. Agregadores (Google Notícias, MSN) não contam como site.
- Piloto: pesquisa extra uma vez antes do dossiê; sem duas fontes independentes, troca o tema na hora (sem esperar 3 h). Dossiê incompleto tenta mais uma rodada antes de trocar. Pautas repetidas não são criadas de novo.
- Descrição: o bloco Fontes junta as fontes do roteiro, do dossiê e da pauta, sem links de agregador.
- "Recomeçar a fila" (botão no painel do piloto, IPC `piloto:recomecarFila`).
- Dossiê: `corroboracoes()` acrescenta, para cada afirmação, a frase exata de outro site que diz o mesmo (mesmos números, ≥ 50% das palavras-chave). Antes, com 6 a 13 sites, a IA local citava uma notícia só e o tema era descartado.
- Roteiro reprovado: escreve outro na próxima rodada (sem esperar 3 h); na segunda reprovação, troca o tema.
- Pautas: seleção com Shift, "Selecionar todas" e "Apagar N" (`pautas:excluirVarias`, mantém as que estão em produção ou publicadas).
- Tema em andamento nunca é descartado por falta de base (pedido do usuário): pesquisa extra a cada 30 min, nova extração depois de cada busca, roteiro reescrito a cada 30 min após 2 reprovações; itens com horário vencido continuam no ciclo e vão ao ar quando prontos. Só o controle de qualidade (3 correções sem sucesso) ainda troca o tema.
