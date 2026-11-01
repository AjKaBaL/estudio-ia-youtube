# Pacote @estudio/youtube

Este pacote é o **único** lugar do aplicativo que conversa com o YouTube.

## Por quê
As regras de acesso do YouTube (cotas da API, escopos OAuth, políticas de envio e auditoria) mudam com frequência.
Concentrar a integração aqui faz com que uma mudança de regra exija alterar só este pacote.

## Regras deste pacote
- O aplicativo usa apenas `criarYouTubeGateway({ http, segredos })` e a interface `YouTubeGateway`.
- O aplicativo injeta o cliente HTTP (com bloqueio de hosts fora de `HOSTS_PERMITIDOS`) e o cofre criptografado.
- Nenhum tipo da API do Google sai deste pacote; tudo é convertido para os tipos de `src/tipos.ts`.
- Tokens, chave do cliente e endereços de sessão de envio ficam só no cofre; nunca no banco, em logs ou na interface.
- Uma regra de lint impede importar `googleapis`/`google-auth-library` fora daqui.
- Ao atualizar regras, altere `VERSAO_REGRAS` em `src/versao.ts` e descreva a mudança abaixo.

## O que está implementado (API oficial)
- OAuth 2.0 para apps instalados: PKCE (S256), `state` aleatório, retorno em servidor local temporário preso a `127.0.0.1` (uma resposta, 5 min).
- Escopos mínimos: `youtube.readonly` (canal/playlists) e `youtube.upload` (envio). Opcional: `yt-analytics.readonly` (métricas).
- Desconectar: revoga no Google (quando possível) e apaga os tokens locais.
- Envio retomável (`uploadType=resumable`) em partes de 8 MiB; retomada com `Content-Range: bytes */total`.
- Privacidade: `private` por padrão; agendamento (`publishAt`) só com `private`; declaração "feito para crianças" obrigatória; campo de conteúdo sintético.
- Miniatura (`thumbnails.set`), status do vídeo (`videos.list`), métricas por vídeo e fontes de tráfego (YouTube Analytics v2).
- Erros classificados: cota, autorização, verificação/auditoria do projeto, política, validação, rede.

## Pontos que dependem do usuário ou do Google
- Criar o projeto no Google Cloud, ativar a YouTube Data API v3 (e a YouTube Analytics API, se quiser métricas) e criar uma credencial OAuth do tipo "App para computador".
- Projetos não verificados/auditados podem ter vídeos enviados restritos a privado e cota reduzida. O app não tenta contornar isso.
- Custos de cota de cada operação estão na documentação oficial "Determine quota cost"; o app não fixa números.
- Revise na documentação vigente se os campos `status.containsSyntheticMedia` e `status.selfDeclaredMadeForKids` continuam com o mesmo nome antes do uso real.

## Histórico de regras
- 2026-10-31 — versão inicial: status "não configurado".
- 2026-10-31 — integração oficial: OAuth com PKCE, envio retomável, miniatura, status, métricas (Analytics v2).
