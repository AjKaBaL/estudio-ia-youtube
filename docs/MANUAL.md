# Manual do Estúdio IA YouTube

Guia para quem não é programador. Versão do aplicativo: 0.1.0.

## 1. Requisitos

- Windows 10 ou 11 (64 bits).
- [Node.js](https://nodejs.org) versão 24 ou mais nova (já instalado neste computador).
- Espaço em disco: cerca de 1 GB para o programa e as ferramentas, mais o espaço dos seus vídeos (um vídeo de 10 minutos em 1080p pode ocupar de 300 MB a 1 GB, e a renderização precisa de espaço livre parecido).
- Opcional: FFmpeg (para renderizar vídeos), Ollama (IA local gratuita), conta do YouTube com projeto Google (para publicar).

## 2. Instalar e abrir

1. Na pasta do projeto, dê dois cliques em **Instalar.cmd** (só na primeira vez; leva alguns minutos e usa a internet).
2. Para usar, dê dois cliques no atalho **Estúdio IA YouTube** (Área de Trabalho ou menu Iniciar). O **Instalar.cmd** cria o atalho; para criar de novo, use **Criar atalho.cmd**. O atalho abre pelo **Abrir Estudio.cmd**, que continua funcionando direto.

Pelo terminal, os mesmos passos são:

```bash
npm ci
```

```bash
npm run build
```

```bash
npx electron .
```

Outros comandos úteis: `npm run verificar` (checagem de tipos, lint e testes) e `npm run empacotar` (gera o instalador em `dist/`; exige baixar ferramentas de empacotamento).

**Desinstalar:** se você usar o instalador, a desinstalação **não apaga seus dados**. Eles ficam em `%APPDATA%\Estúdio IA YouTube`. Para apagar tudo, feche o aplicativo e exclua essa pasta manualmente, depois de fazer um backup se quiser guardar algo.

## 3. Primeiros passos

**Configuração rápida (1 clique):** no topo de Primeiros passos (e na Visão geral), **Configurar tudo com o recomendado** cria o projeto “Meu canal”, aplica as 27 fontes e os termos, a agenda leve (1 longo + 3 Shorts por semana, pesquisa diária às 08:00), a IA híbrida com revisão interna, a resolução automática até 4K e faz o primeiro backup. Cada etapa também tem o seu botão de 1 clique: ritmos prontos (Leve, Médio, Intenso), **Ligar IA híbrida**, **Instalar Ollama + modelo leve** (pelo instalador oficial do Windows, cerca de 2,5 GB), **Instalar FFmpeg** e, no YouTube, **Importar arquivo baixado**. Os mesmos botões aparecem em Configurações › Serviços de IA, no FFmpeg e na frequência do Painel. O que depende de conta (chaves das IAs gratuitas e o Google/YouTube) continua com você: o app não cria contas.

Na primeira vez, o aplicativo abre o assistente **Primeiros passos** (também no menu lateral). Ele explica e configura, etapa por etapa, tudo o que está abaixo. Você pode clicar em **Continuar depois** e voltar quando quiser.


1. **Configurações › Projetos:** crie o projeto do seu canal.
2. **Pautas e pesquisas › Fontes e opções:** adicione feeds RSS de sites confiáveis (endereços que você conhece), domínios confiáveis/bloqueados e os termos monitorados.
3. **Pesquisar:** escreva a consulta. Vírgula significa "ou"; aspas, expressão exata. O relatório mostra o período pesquisado, as fontes, as datas, as duplicatas e por que cada resultado recebeu aquela nota (é uma estimativa).
4. No **Histórico**, marque resultados e clique em **Criar pauta**. Preencha a pergunta central, avalie e **Aprove**.
5. **Dossiê de verificação:** registre as afirmações do vídeo e ligue cada uma à fonte que a sustenta (com o trecho). O aplicativo calcula se ela está confirmada, parcial, conflitante, sem fonte ou se é opinião.
6. **Gerar roteiro:** o modo estruturado (sem IA, sem custo) monta as cenas com as afirmações verificadas. Edite o texto com suas palavras.
7. **Revisão editorial:** aprove a revisão factual e a editorial e depois **Aprovar para produção**. Se o texto mudar depois, a aprovação é invalidada automaticamente.
8. **Calendário:** reserve o horário. **Fila de produção:** acompanhe o que falta em cada conteúdo.
9. **Estúdio:** importe mídia (registre origem e licença!), crie o projeto de edição, renderize e rode o **Controle de qualidade**.
10. **Publicações:** prepare, aprove e envie (privado por padrão).

## 4. Vídeo: resolução até 4K

Em **Configurações › Vídeo e renderização** (ou nos Primeiros passos):

- **Automático pela qualidade das mídias (recomendado):**
  - Antes de cada renderização, o app lê a resolução e os quadros por segundo das mídias e sugere a melhor opção sem ampliar além delas.
  - Vídeos longos vão de 1080p até 4K. Shorts ficam em 1080×1920.
- **Sempre a mesma resolução:** útil se você grava sempre no mesmo equipamento.
- **No editor, em Exportar / renderizar:**
  - Escolha entre 720p, 1080p, 1440p (2K) e 4K e veja o motivo da recomendação, o tamanho máximo do arquivo e o espaço livre.
  - Em **Opções avançadas**, ajuste os quadros por segundo (24/25/30/60), a qualidade e a velocidade.
- **Tamanho máximo aproximado** (qualidade alta, 30 q/s): 10 min em 1080p ocupam até cerca de 0,9 GB; em 4K, até cerca de 4,5 GB.
- **Tempo:** 4K costuma levar de 4 a 8 vezes mais que 1080p. Ampliar mídias pequenas para 4K não cria detalhe novo.

### Acabamento do vídeo

Em **Configurações › Mídia automática › Acabamento do vídeo** (tudo ligado por padrão):

- **Apresentador animado**: muda de lado a cada cena e entra pela lateral, com poses que acompanham o texto: interrogação nas perguntas, lâmpada nas ideias, gráfico nos números, alerta nos riscos.
- **Voz neural Piper** por padrão (o app instala sozinho na primeira narração); a voz do Windows fica de reserva.
- **Fotos em movimento** (zoom, deslocamento e parallax) e **transições** entre cenas.
- **Vídeos intercalados** com as fotos (Wikimedia Commons sem chave; com chave do Pexels ou Pixabay a variedade é bem maior).
- **Títulos das cenas** e **trilha sonora** original composta pelo app (sem direitos de terceiros).

## 5. Publicação: links, descrição e miniatura

- **Links e redes** (menu lateral): cadastre uma vez suas redes sociais, seu site, os produtos que você cita, links de afiliado e patrocinadores. Marque **Incluir sempre** nos que devem aparecer em toda descrição.
- **Montar automaticamente** (no editor): na Biblioteca de mídia, preencha o campo **Cena** com o título da cena (ex.: Abertura), com “narração” para a locução ou com “trilha” para a música. O botão coloca tudo na linha do tempo. Cenas que você já montou não mudam, e dá para desfazer com Ctrl+Z.
- **Preparar publicação** (depois do controle de qualidade): cria o rascunho com título, descrição completa e miniatura automática.
  - A descrição traz resumo, capítulos, links, fontes e hashtags.
  - A miniatura usa o melhor quadro do vídeo e o início do título.
- **Descrição automática** (em Publicações): escolha os links do vídeo e clique em **Gerar descrição**. Revise o texto e clique em **Salvar dados**.
  - Com link de afiliado, o aviso de comissão entra sozinho.
  - Com patrocínio, marque “Inclui promoção paga” no YouTube Studio.
- **Miniatura** (em Publicações › Criar miniatura): escolha um dos 6 quadros do vídeo (o sugerido vem marcado) ou uma imagem da biblioteca. Depois defina:
  - o texto, com poucas palavras;
  - o selo, o modelo, a cor e a fonte.

  Confira a prévia e clique em **Usar esta miniatura**. O YouTube exige conta verificada para miniaturas personalizadas, e em Shorts ele pode não exibir a miniatura escolhida.
- Nada é enviado sem a sua aprovação. Vídeos vão primeiro como privados.

**Narração e imagens automáticas** (editor › **Gerar narração e imagens**; ajustes em Configurações › **Mídia automática**):
- **Voz:** a do Windows (Microsoft Maria) já funciona. A voz neural **Piper** (pt-BR, offline, mais natural) instala em 1 clique (~85 MB, com conferência de assinatura). Ouça um exemplo antes. Cada cena passa a durar o tempo real da fala.
- **Imagens com licença livre:** Wikimedia Commons sem chave (só domínio público, CC0 e CC BY); Pexels e Pixabay com chave gratuita (fotos e vídeos). Autor, licença e endereço ficam na biblioteca, e os créditos obrigatórios entram sozinhos na descrição.
- **Imagens por IA:** quando a busca não acha nada, gera com Pollinations, Hugging Face (FLUX.1 schnell) ou Cloudflare Workers AI (chaves gratuitas). O pedido proíbe texto, logotipos e pessoas reais identificáveis. O controle de qualidade e a descrição lembram de marcar “Conteúdo alterado ou sintético” se a imagem parecer real.
- Tudo pode ser desfeito com Ctrl+Z.

**Segundo plano** (Configurações › Dados e backup, ou última etapa dos Primeiros passos): **Ligar segundo plano** faz o Estúdio continuar no ícone perto do relógio ao fechar a janela e abrir escondido ao entrar no Windows, para as tarefas automáticas rodarem. Para encerrar: botão direito no ícone › Sair.

**Produzir tudo (1 botão)** — no topo de qualquer tela. Liga o **piloto automático**, pesquisa novidades e produz sozinho, uma etapa emendando na outra:
1. pautas das melhores notícias e temas nos horários livres da agenda;
2. dossiê com IA: só entram afirmações com trecho **exato** de notícia real; as não confirmadas pelas regras ficam fora do roteiro;
3. roteiro com IA → **revisão pela IA** (outra IA confere se nada foi inventado) → se houver ponto crítico, a IA corrige e revisa de novo (até 2 vezes) → aprova pelas mesmas travas da aprovação manual. Se não conseguir, arquiva o roteiro e pesquisa mais;
4. narração e imagens, renderização e controle de qualidade (avisos aceitos com justificativa registrada; bloqueadores nunca);
5. publicação com título, descrição e miniatura, aprovada como **privada** e enviada ao YouTube.

Tornar o vídeo **público** continua sendo decisão sua (regra do canal). No Painel, em **Próximos temas**, ficam só os vídeos ainda não criados: **Produzir agora** (entra em produção já), Adiantar/Adiar e Descartar. O painel do piloto mostra a etapa de cada vídeo e, em **Precisa de você**, só o que ele não consegue resolver (por exemplo, conectar o YouTube ou instalar o FFmpeg).

## 6. Intervalos de pesquisa e cadência

**Painel de produção** (primeiro item do menu, abre ao iniciar): é a tela do administrador.
- **Próximos vídeos:** o que já tem data, com uma barra de 6 etapas (roteiro, revisão, edição, render, qualidade, publicação) e o próximo passo. **Adiantar/Adiar** troca a data com o vídeo vizinho do mesmo formato, ou usa um horário livre.
- **Próximos temas:** pautas ainda sem data, na ordem em que devem virar vídeo. **Adiantar/Adiar** muda a ordem; **Agendar** coloca no próximo horário livre (e aprova o tema); **Descartar** tira da lista sem apagar.
- **Frequência de publicação:** escolha quantos vídeos longos e Shorts por semana e o horário; o aplicativo distribui os dias. Vídeos já agendados não mudam de data.

**Fontes de pesquisa** (Pautas e pesquisas › Fontes e opções): o aplicativo já vem com 27 feeds conferidos (Tecnoblog, Canaltech, Exame, OpenAI, Google DeepMind, MIT Technology Review, TechCrunch e outros) e com termos monitorados de IA, tecnologia e startups. Você pode desativar, remover ou **Restaurar fontes padrão**. Para incluir outra, cole o endereço do site e clique em **Identificar**: o aplicativo encontra o feed. Sites que aparecem várias vezes nos resultados e têm feed viram **Novas fontes sugeridas**, que só entram com o seu **Aprovar**; **Recusar** não mostra de novo.

Em **Configurações › Pesquisa e agenda**:
- **Frequência das buscas:** padrão uma vez por dia às 08:00 (fuso America/Sao_Paulo). Pode ser manual, a cada 12 h, dias úteis ou semanal. **Executar agora** roda na hora.
- **Período procurado:** 24 h, 7 dias (padrão), 30 ou 90 dias, ou personalizado.
- **Horizonte de planejamento:** 7, 14 (padrão) ou 30 dias.
- **Agenda padrão:** 1 vídeo longo por semana (domingo, 18h) e 3 Shorts (terça, quinta e sábado, 18h). Limites diários, semanais e mensais, pausa geral ou por formato e antecedência para roteiro e produção são editáveis. O aplicativo alerta quando a meta passa da capacidade de revisão ou do orçamento.
- **Computador desligado no horário:** escolha entre ignorar, executar ao abrir ou fazer no próximo horário. As tarefas só rodam com o aplicativo aberto.
- **Parar todas as tarefas automáticas:** botão vermelho na Fila de produção.

## 7. Serviços opcionais e chaves

**IA híbrida com várias IAs gratuitas** (Configurações › Serviços de IA e custos):
1. Escolha o modo **Híbrido** e marque **Usar IAs gratuitas automaticamente**. Salve a política.
2. Em **IAs gratuitas: adicionar**, para cada fornecedor (Groq, Google AI Studio/Gemini, Mistral, Cerebras, OpenRouter, GitHub Models, Hugging Face): clique em **Criar chave**, crie a chave no site, cole no aplicativo e clique em **Conectar**. O aplicativo testa, escolhe um modelo atual e coloca a IA na fila. Para o PC, instale o Ollama, baixe um modelo e clique em **Detectar no PC**.
3. **Como o aplicativo decide agora** mostra, para “Escrever roteiros” e “Revisão interna”, a ordem em que as IAs serão tentadas e por que alguma ficou de fora.
- Regras da escolha: só IAs ativas, com chave, com modelo e com o papel da tarefa; fora de pausa e abaixo do seu limite diário; no híbrido, o PC e as gratuitas (pagas nunca são escolhidas sozinhas). Ordem: a prioridade (1 = primeira; setas ↑ ↓) e, no empate, o PC.
- Se uma IA falhar, a próxima assume. Limite do fornecedor (erro 429) pausa a IA pelo tempo pedido (ou 1 hora); chave recusada pausa 24 horas; instabilidade, 10 minutos. **Reativar agora** tira da pausa.
- Na geração de roteiro, escolha **Automático: o app escolhe a IA**. Sem nenhuma IA disponível, o roteiro é montado no modo estruturado (sem IA), com um aviso.

**Revisão interna:** depois de gerar (se ligada), o aplicativo revisa o roteiro sozinho com as regras fixas e com uma segunda IA, diferente da que escreveu, que compara o texto com as afirmações verificadas. Pontos da IA que citam trechos inexistentes no roteiro são descartados. Pontos críticos da IA bloqueiam a aprovação para produção até você clicar em **Conferido** (com uma nota). O resultado aparece em Revisão editorial › Revisão interna; **Revisar de novo** roda outra vez. A aprovação final continua sendo sua.

Em **Configurações › Serviços de IA e custos**:
- O padrão é **somente local** e **teto de gasto zero**. A biblioteca e o modo estruturado funcionam sem nenhuma IA.
- **Simulado:** para testar o fluxo, sem custo e sem IA real (os textos aparecem marcados com [SIMULADO]).
- **Ollama (local e gratuito):** instale o Ollama, baixe um modelo e informe o endereço `http://127.0.0.1:11434` e o nome do modelo.
- **API online (compatível com OpenAI):** informe o endereço `https://...`, o modelo e os preços por milhão de tokens. Sem preço informado, o custo não pode ser estimado e cada uso pede sua autorização.
- **Como proteger as chaves:** use o botão **Chave**. Ela é criptografada pelo Windows e guardada fora do banco, não aparece de novo na tela e não vai para backups nem registros. Não cole chaves em notas, roteiros ou configurações comuns. Para revogar, use **Remover chave** e, se necessário, revogue também no site do fornecedor.
- Antes de qualquer envio online, o aplicativo mostra **o que será enviado, para onde, para quê e o custo estimado**. Nada sai sem a sua autorização.

## 8. Conectar o YouTube (OAuth)

São duas coisas diferentes: **autorizar a sua conta** e **o Google aprovar/verificar o seu projeto de API**.

1. No [Google Cloud Console](https://console.cloud.google.com), crie um projeto, ative a **YouTube Data API v3** (e a **YouTube Analytics API**, se quiser métricas) e configure a tela de consentimento OAuth. No passo a passo do aplicativo, cada etapa tem um botão **Abrir esta página** que leva direto à tela certa.
2. Crie uma credencial **ID do cliente OAuth** do tipo **App para computador** e clique em **Baixar JSON**.
3. Em **Publicações**, clique em **Importar arquivo baixado**: o aplicativo acha o `client_secret_….json` na pasta Downloads (ou você escolhe o arquivo) e guarda o ID e a chave no cofre criptografado. Depois, apague o arquivo da pasta Downloads. Também é possível digitar à mão. Em seguida, clique em **Conectar conta**: o navegador abrirá a página oficial do Google.
4. Permissões pedidas: ver o canal (somente leitura) e enviar vídeos. Métricas só se você marcar a opção.

Limites importantes: projetos não verificados podem ter vídeos restritos a **privado** e cota menor; cada operação consome cota (veja a documentação oficial *Determine quota cost*). O aplicativo não tenta contornar essas regras. **Desconectar e revogar** apaga os tokens deste computador.

## 9. Aprovações e publicação (automáticas)

- Com o piloto automático ligado, a IA revisa, corrige e aprova os roteiros e as publicações pelas mesmas travas fixas da aprovação manual. Você não precisa aprovar nada.
- O vídeo pronto vai ao ar **sozinho no horário marcado**. Para publicar antes, use **Postar agora** em Painel de produção › Próximos vídeos.
- Para voltar a enviar como privado, desligue "Publicar sozinho no horário marcado" em Piloto automático › Etapas que o piloto faz sozinho.
- O que falhar (controle de qualidade, dossiê sem fontes), o piloto corrige ou troca o tema sozinho. "Precisa de você" só aparece para o que nenhum programa faz por você, como conectar a conta do YouTube.
- **Várias fontes por vídeo:** antes do dossiê, o piloto faz uma **pesquisa extra** do tema: procura a mesma notícia em outros sites (resultados de pesquisas anteriores e uma busca de notícias por palavras-chave), lê só o título, a data e um trecho curto de cada matéria (respeitando o robots.txt) e anexa tudo à pauta. Se ainda houver uma fonte só, ele continua procurando a cada 30 minutos. O mesmo assunto não vira pauta repetida a cada pesquisa.
- **Links das matérias na descrição:** o bloco **Fontes** traz o endereço de cada matéria em que o vídeo se baseia (as do dossiê e as da pauta). Links do Google Notícias, que não levam à matéria, ficam de fora. Os créditos das imagens continuam num bloco separado.
- **Fatos confirmados por dois sites:** quando a IA liga um fato a uma notícia só, o app procura nas outras notícias (de outros sites) uma frase que diga o mesmo, com os mesmos números, e a guarda como segunda fonte, copiada exatamente.
- **Tema que começou não é abandonado:** se faltar uma segunda fonte ou fatos confirmados, o piloto alterna nova pesquisa de matérias (a cada 30 minutos) e nova extração de fatos até o roteiro ficar pronto. O painel mostra o horário da próxima busca. Se passar do horário marcado, o vídeo vai ao ar assim que ficar pronto.
- **Roteiro reprovado na revisão:** vai para o arquivo e o piloto escreve outro na rodada seguinte; depois da segunda reprovação, tenta de novo a cada 30 minutos.
- **Apagar várias pautas:** em Pautas e pesquisas, marque as pautas (clique numa e Shift + clique em outra marca todas entre elas, ou use **Selecionar todas**) e clique em **Apagar**. As que estão em produção ou ligadas a vídeo publicado ficam.
- **Recomeçar a fila** (no painel do piloto): cancela os vídeos ainda não publicados, arquiva os roteiros deles e descarta as pautas em espera; depois pesquisa de novo e monta roteiros novos. O que já foi ao ar não muda e nada é apagado (roteiros ficam no arquivo e pautas podem ser reativadas).

## 10. Backup e restauração

- **Backup:** Configurações › Dados e backup › **Fazer backup agora**. Também é feito um backup automático antes de cada atualização do banco. Os 10 mais recentes ficam em `%APPDATA%\Estúdio IA YouTube\backups`.
- Os backups contêm seus roteiros e pesquisas (não contêm chaves). Guarde cópias num local seguro.
- **Restaurar:** feche o aplicativo; na pasta `%APPDATA%\Estúdio IA YouTube`, renomeie `dados.sqlite` (por segurança) e copie o backup escolhido com o nome `dados.sqlite`. Abra o aplicativo de novo.
- Exportação individual: no roteiro, **Exportar TXT, MD ou JSON** (o JSON inclui todas as versões).

## 11. Problemas comuns

| Sintoma | O que fazer |
| --- | --- |
| "Instalar.cmd" falha | Confirme que o Node.js 24+ está instalado (`node --version`) e que há internet. |
| Pesquisa termina com erro | Abra o relatório › **Registro por fonte**. Verifique a internet e se o endereço do feed está correto. Sites que proíbem leitura automática (robots.txt) são respeitados. |
| "FFmpeg não encontrado" | Instale com `winget install --id Gyan.FFmpeg -e`, reabra o app ou escolha o `ffmpeg.exe` em Estúdio › Ferramentas. |
| "Espaço em disco insuficiente" | Libere espaço ou use um preset 720p. |
| Envio para o YouTube parou | Abra a publicação e clique em **Retomar envio**: ele continua de onde parou. |
| Erro de cota do YouTube | Aguarde a renovação diária da cota (Google Cloud Console). |
| "Autorização expirada" | Em Publicações, desconecte e conecte de novo. |
| Algo deu errado sem explicação | Configurações › **Registro de eventos** (sem senhas, chaves ou caminhos pessoais). |
| O aplicativo não abre e mostra erro de banco | Seus arquivos não foram alterados; restaure um backup (seção 10). |

## 12. O que exige internet, API, cota ou pagamento

| Função | Internet | Conta/API | Cota | Pode ter custo |
| --- | --- | --- | --- | --- |
| Biblioteca, versões, dossiê, revisão, agenda, backup | Não | Não | Não | Não |
| Modo estruturado de roteiro | Não | Não | Não | Não |
| Pesquisa em feeds/páginas | Sim | Não | Não | Não |
| IA local (Ollama) | Não (depois de instalada) | Não | Não | Não |
| IA online | Sim | Sim (chave) | Do fornecedor | **Sim** |
| Renderização (FFmpeg) | Não | Não | Não | Não |
| Publicação e métricas no YouTube | Sim | Sim (OAuth) | **Sim** (cota da API) | Não (pela API) |

## 13. Limitações conhecidas e riscos a resolver

- A renderização e o controle de qualidade foram testados com o FFmpeg 9.0.2 real em vídeos curtos de teste (16:9 e 9:16, inclusive clicando em Renderizar na tela do Estúdio, em 1080p). Vídeos longos ainda não foram renderizados: faça um vídeo de teste antes de uso real.
- **Integração com o YouTube não foi testada com conta real**, apenas com servidores simulados. Teste primeiro com um vídeo privado.
- **Nenhum provedor real de IA foi testado** (apenas o simulado e um Ollama simulado).
- A pesquisa de novidades lê as fontes que você cadastrar. A pesquisa extra de cada tema usa também a busca de notícias do Bing em RSS (gratuita, sem chave); os termos de uso desse RSS falam em uso pessoal, então confira se servem para o seu canal.
- Narração (TTS), geração de imagem/vídeo e transcrição não estão disponíveis nesta versão.
- Impressões, CTR, receita e RPM não são coletados (indisponíveis na API pública ou dependentes de monetização).
- O instalador não é assinado digitalmente (o Windows mostrará um aviso).
- Os alertas automáticos (cópia, exagero, injeção, pontuações) são heurísticos e não substituem a revisão humana.
