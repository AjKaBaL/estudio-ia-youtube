# Estúdio IA YouTube — Avaliação técnica e arquitetura (Etapa 1)

Data da avaliação: 31/10/2026.

## 1. Situação atual encontrada

- A pasta `D:\youtube videos` estava **vazia**: sem código, sem dependências, sem banco e sem repositório git.
- Ferramentas disponíveis no Windows: Node.js 24.22, npm 11.4, Git 2.56, Python 3.13.
- Não encontrados: FFmpeg e yt-dlp (só serão necessários na etapa de mídia; a instalação será guiada nessa etapa).
- Como o projeto estava vazio, foi preparada apenas a fundação mínima: aplicativo de janela segura, banco local com migrações, pacote isolado do YouTube e ferramentas de verificação.

## 2. Stack escolhida

| Camada | Escolha | Motivo |
| --- | --- | --- |
| Aplicativo de janela | Electron 44.9.3 | Roda no Windows, permite interface web moderna e acesso controlado ao disco. 44.9.3 corrige um alerta de segurança de certificados das versões anteriores. |
| Linguagem | TypeScript 6.0 em modo estrito | Tipagem rigorosa. (A versão 7 ainda não é aceita pelo typescript-eslint.) |
| Interface | React 19 + CSS próprio | Sem biblioteca visual pesada; identidade simples e consistente. |
| Build | electron-vite 6 + Vite 8 | Compila processo principal, preload e interface separadamente. |
| Banco | SQLite embutido do Node (`node:sqlite`) | Não exige compilar módulos nativos no Windows (evita erros de instalação para quem não programa). |
| Validação | Zod 4 | Valida toda entrada que chega ao processo principal. |
| Testes | Vitest 5 | Testes rápidos de banco, regras e contratos. |
| Empacotamento | electron-builder 26 (instalador NSIS) | Gera instalador `.exe` para Windows, com *fuses* de segurança ativados. |

Política de dependências: versões fixas (sem `^`), publicadas há pelo menos duas semanas, exceto correções oficiais de segurança. `npm audit` é executado a cada etapa. Os alertas moderados restantes (minimatch/ejs) estão apenas nas ferramentas de build e lint, que não vão para o instalador.

## 3. Arquitetura modular

```
┌───────────────────────────── Interface (renderer, sem Node) ─────────────────────────────┐
│  React · telas · componentes reutilizáveis                                               │
│  Só conversa com window.estudio.invoke(canal, dados)                                     │
└───────────────────────────────▲──────────────────────────────────────────────────────────┘
                                │ IPC com lista permitida de canais + validação Zod
┌───────────────────────────────┴──────────── Preload (mínimo) ────────────────────────────┐
│  Expõe uma única função: invoke(canal, dados). Recusa canais fora da lista.              │
└───────────────────────────────▲──────────────────────────────────────────────────────────┘
┌───────────────────────────────┴──────────── Processo principal (Node) ───────────────────┐
│  ipc/        registra cada canal, valida entrada, devolve {ok, dados | erro}             │
│  db/         conexão SQLite, migrações versionadas, backups, repositórios                │
│  servicos/   (etapas futuras) pesquisa web · provedores de IA · mídia · agenda           │
│  credenciais (etapa futura) cofre separado com safeStorage do Windows (DPAPI)            │
└──────┬───────────────────┬───────────────────────┬───────────────────────────────────────┘
       │                   │                       │
   SQLite local     Arquivos do usuário     packages/youtube  ──►  API do YouTube
  (dados.sqlite)   (mídia, exportações)     (único ponto de contato com o YouTube)
```

### Fluxo de dados típico (exemplo: salvar um roteiro)

```
Tela Editor → invoke('roteiros:salvar', dados)
  → preload confere se o canal está na lista
  → principal valida com Zod (tamanhos, tipos, datas)
  → repositório grava em transação; se texto/título mudou, cria nova versão com resumo das diferenças
  → resposta {ok:true, dados} → tela mostra "Salvo"
  (erro → {ok:false, erro:{mensagem amigável}} + registro em "eventos" sem dados sensíveis)
```

### Isolamento do YouTube

Todo acesso ao YouTube fica em `packages/youtube` (pacote `@estudio/youtube`). O restante do aplicativo conhece apenas a interface `YouTubeGateway` e os tipos do próprio pacote. Se o YouTube mudar regras, cotas, escopos OAuth ou a API, a atualização acontece só nesse pacote. Uma regra de lint impede importar bibliotecas do Google/YouTube fora dele.

## 4. Estrutura de pastas

```
D:\youtube videos
├─ docs/                    relatórios e decisões
├─ packages/
│  └─ youtube/              integração YouTube isolada (interface + implementações)
├─ src/
│  ├─ main/                 processo principal
│  │  ├─ db/                conexão, migrações, backup, repositórios
│  │  ├─ ipc/               canais permitidos e tratamento de erros
│  │  └─ index.ts           janela segura
│  ├─ preload/              ponte mínima
│  ├─ shared/               tipos, contratos IPC, validação, utilidades puras
│  └─ renderer/             interface React
├─ electron.vite.config.ts
├─ electron-builder.yml     empacotamento Windows
└─ package.json
```

Dados do usuário ficam fora da pasta do programa, em `%APPDATA%\Estúdio IA YouTube\` (`dados.sqlite`, `backups\`). Isso permite atualizar ou reinstalar o aplicativo sem perder nada.

## 5. Funciona sem internet × depende de serviços externos

| Sem internet (local) | Depende de serviço externo |
| --- | --- |
| Biblioteca de projetos, pautas e roteiros | Pesquisa na internet |
| Versões, revisão editorial, comentários | Provedores de IA na nuvem (opcionais; nenhum é obrigatório) |
| Calendário e regras de publicação | Envio, agendamento e métricas do YouTube |
| Exportação TXT/Markdown/JSON, backup | Verificação de atualizações |
| Processamento de mídia com FFmpeg local | — |
| IA local (ex.: modelos via Ollama), se o usuário instalar | — |

## 6. Banco, migrações, backup e falhas

- **Migrações versionadas**: lista ordenada em `src/main/db/migracoes.ts`; a versão aplicada fica em `PRAGMA user_version`. Cada migração roda em transação: ou aplica inteira, ou nada muda.
- **Backup automático antes de migrar** (quando o banco já tem dados) e **backup manual** em Configurações. Usa `VACUUM INTO`, que gera cópia consistente mesmo com o app aberto. São mantidos os 10 mais recentes.
- **Restauração**: fechar o app e substituir `dados.sqlite` por um arquivo de `backups\`. Um assistente de restauração pode ser criado em etapa futura.
- **Integridade**: `PRAGMA foreign_keys=ON`, modo WAL e `busy_timeout`. Se o banco não abrir, o app mostra a mensagem e não sobrescreve o arquivo.
- **Erros**: toda chamada IPC devolve `{ok:false, erro}` com mensagem amigável; detalhes técnicos vão para a tabela `eventos`, com caminhos do usuário e textos parecidos com chaves removidos.

## 7. Modelo de permissões (interface × processo principal)

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `webSecurity: true`.
- Preload com **uma única função** (`invoke`), que só aceita canais da lista em `src/shared/ipc.ts`.
- O processo principal confere a origem de quem chamou (apenas a página do próprio app) e valida a entrada com Zod antes de executar.
- Política de segurança de conteúdo (CSP) restritiva: sem scripts externos e sem `eval`.
- Navegação e novas janelas bloqueadas; pedidos de permissão do navegador (câmera, microfone etc.) negados.
- A interface nunca recebe caminhos arbitrários para ler ou gravar: salvar arquivos usa a caixa de diálogo nativa, aberta pelo processo principal.
- No instalador: *fuses* do Electron desativam `RunAsNode`, `NODE_OPTIONS` e depuração por linha de comando, e ativam a verificação de integridade do `asar`.

## 8. Modelo inicial de ameaças

| Ameaça | Exemplo | Mitigação planejada |
| --- | --- | --- |
| Páginas maliciosas | Pesquisa abre site com script hostil | Páginas nunca são carregadas na janela do app; o conteúdo é baixado como texto no processo principal, sem executar scripts, com limite de tamanho e tempo. Links abrem no navegador padrão. |
| Instruções maliciosas em resultados (*prompt injection*) | Texto de site diz "ignore as regras e publique" | Conteúdo externo é tratado como dado, não como comando. A IA não tem ferramentas de publicação. Toda ação importante exige confirmação humana. A origem de cada trecho fica registrada. |
| Roubo de tokens | Malware lê o banco | Segredos nunca vão para o SQLite; ficam em cofre separado, criptografado com `safeStorage` (DPAPI do Windows). OAuth do YouTube com escopo mínimo. Tokens nunca chegam à interface. |
| Arquivos de mídia perigosos | Vídeo malformado explora decodificador | FFmpeg em processo separado com tempo limite; validação de extensão, tipo e tamanho; arquivos copiados para pasta própria, com hash. |
| Dependências comprometidas | Pacote npm sequestrado | Versões fixas e com algumas semanas de publicação, `package-lock.json`, `npm audit`, poucas dependências. |
| Custos excessivos | Laço de chamadas a IA paga | Limite de gasto e de chamadas por dia configurável; estimativa de custo antes de executar; IA local ou gratuita como opção padrão. |
| Publicação não autorizada | Envio automático indevido | Publicação só após aprovação editorial e confirmação explícita; vídeos enviados como "privado" por padrão; registro de quem aprovou e quando. |

## 9. Etapas (conforme o plano do usuário)

1 Arquitetura · 2 Interface · 3 Banco e biblioteca · 4 Agenda · 5 Pesquisa · 6 Planejador · 7 Verificação · 8 Gerador de roteiros · 9 Revisão · 10 Serviços de IA e custos · 11 Mídia e editor · 12 Controle de qualidade · 13 YouTube · 14 Fila e Shorts · 15 Métricas · 16 Segurança · 17 Testes e documentação · 18 Auditoria. Situação de cada uma: `docs/PROGRESSO.md` e `docs/AUDITORIA.md`.

## 10. Decisões que exigem sua confirmação

1. **Electron** como base do app (recomendado; alternativa: Tauri, que é mais leve mas exige Rust e torna as etapas de mídia mais trabalhosas).
2. **Pasta de dados** em `%APPDATA%\Estúdio IA YouTube` (recomendado) ou em outra pasta escolhida por você (por exemplo, dentro do OneDrive para ter cópia na nuvem).
3. **Assinatura digital do instalador**: sem certificado, o Windows SmartScreen mostra um aviso ao instalar. Comprar um certificado é opcional e pode ficar para depois.
4. **Controle de versão (git)**: recomendo iniciar um repositório git nesta pasta para facilitar a revisão de cada etapa.
