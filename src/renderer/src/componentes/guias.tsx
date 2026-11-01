import { Ajuda } from './ui'

/**
 * Guias passo a passo usados no assistente de primeiros passos e nas telas de configuração.
 * Texto para quem não é programador; nenhum endereço ou valor aqui é preenchido automaticamente.
 */

export function GuiaGoogleCloud({ aberto }: { aberto?: boolean }) {
  return (
    <Ajuda titulo="Passo a passo: criar o projeto no Google Cloud (cerca de 15 minutos)" aberto={aberto}>
      <p className="secundario">
        O Google exige que cada aplicativo que envia vídeos tenha um “projeto” próprio. Você cria esse projeto uma única vez, na sua conta Google, e cola aqui duas informações. O aplicativo nunca vê a sua senha do Google.
      </p>
      <p className="secundario">
        Cada passo tem um botão <strong>Abrir esta página</strong> que leva direto à tela certa do Google Cloud (no seu navegador, já com a sua conta). No passo 6, baixe o arquivo <code>.json</code> e use <strong>Importar arquivo baixado</strong>: o aplicativo preenche o ID e a chave sozinho.
      </p>
      <ol>
        <li>
          Abra <strong>console.cloud.google.com</strong> no navegador e entre com a <strong>mesma conta Google do seu canal</strong>. Se for o primeiro acesso, aceite os termos do Google Cloud (não é preciso cadastrar cartão para isto). <a className="botao pequeno link-passo" href="https://console.cloud.google.com/" target="_blank" rel="noreferrer">Abrir o Google Cloud ↗</a>
        </li>
        <li>
          No topo da página, clique no seletor de projetos › <strong>Novo projeto</strong>. Dê um nome (por exemplo “Estudio IA YouTube”) e clique em <strong>Criar</strong>. Depois confira, no mesmo seletor, se o projeto novo está selecionado. <a className="botao pequeno link-passo" href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noreferrer">Criar projeto ↗</a>
        </li>
        <li>
          Menu ☰ › <strong>APIs e serviços</strong> › <strong>Biblioteca</strong>. Procure <strong>YouTube Data API v3</strong>, abra e clique em <strong>Ativar</strong>. Se quiser métricas no aplicativo, ative também a <strong>YouTube Analytics API</strong>. <a className="botao pequeno link-passo" href="https://console.cloud.google.com/apis/library/youtube.googleapis.com" target="_blank" rel="noreferrer">Ativar YouTube Data API v3 ↗</a> <a className="botao pequeno link-passo" href="https://console.cloud.google.com/apis/library/youtubeanalytics.googleapis.com" target="_blank" rel="noreferrer">Ativar YouTube Analytics API ↗</a>
        </li>
        <li>
          Configure a <strong>tela de consentimento OAuth</strong> (em contas novas ela aparece como <strong>Google Auth Platform</strong> / “Plataforma de autenticação do Google”): clique em <strong>Começar</strong>, informe o nome do app e o seu e-mail de suporte, escolha o público <strong>Externo</strong>, informe o seu e-mail de contato, aceite a política e clique em <strong>Criar</strong>. <a className="botao pequeno link-passo" href="https://console.cloud.google.com/auth/overview" target="_blank" rel="noreferrer">Abrir tela de consentimento ↗</a>
        </li>
        <li>
          Em <strong>Público</strong> (Audience) › <strong>Usuários de teste</strong> › <strong>Adicionar usuários</strong>, inclua o e-mail da conta Google do canal e salve. Enquanto o projeto estiver “Em teste”, só os usuários dessa lista conseguem autorizar, e o Google pode pedir para reconectar depois de alguns dias. <a className="botao pequeno link-passo" href="https://console.cloud.google.com/auth/audience" target="_blank" rel="noreferrer">Abrir Público / usuários de teste ↗</a>
        </li>
        <li>
          Em <strong>Clientes</strong> (ou <strong>Credenciais</strong> › <strong>Criar credenciais</strong>) › <strong>ID do cliente OAuth</strong>. Em “Tipo de aplicativo”, escolha <strong>App para computador</strong> (Desktop app), dê um nome e clique em <strong>Criar</strong>. Na janela que aparece, clique em <strong>Baixar JSON</strong> (o arquivo vai para a pasta Downloads com o nome <code>client_secret_….json</code>). <a className="botao pequeno link-passo" href="https://console.cloud.google.com/auth/clients/create" target="_blank" rel="noreferrer">Criar ID do cliente OAuth ↗</a>
        </li>
        <li>
          Volte a este aplicativo e clique em <strong>Importar arquivo baixado</strong> (o aplicativo procura o arquivo em Downloads sozinho). Se preferir, copie o <strong>ID do cliente</strong> (termina em <code>.apps.googleusercontent.com</code>) e a <strong>Chave secreta do cliente</strong> e cole nos campos deste aplicativo. Clique em <strong>Guardar credenciais do projeto</strong>: elas vão para o cofre criptografado do Windows, não para o banco de dados.
        </li>
        <li>
          Clique em <strong>Conectar conta</strong>. O navegador abrirá a página oficial do Google: escolha a conta do canal. Como o projeto é seu e está em teste, o Google mostra “O Google não verificou este app”; isso é esperado. Clique em <strong>Avançado</strong> e continue para o seu app, confira as permissões e clique em <strong>Continuar</strong>. O aplicativo detecta a autorização sozinho.
        </li>
      </ol>
      <p>
        <strong>Limites importantes:</strong>
      </p>
      <ul className="secundario">
        <li>Projetos que ainda não passaram pela auditoria da API do YouTube podem ter os vídeos enviados travados como <strong>privados</strong>. Você pode torná-los públicos manualmente no YouTube Studio, ou pedir a auditoria ao Google.</li>
        <li>Cada projeto tem uma cota diária da API (por padrão 10.000 unidades). Enviar um vídeo é uma das operações que mais consomem cota. Consulte “Determine quota cost” na documentação oficial.</li>
        <li>Nunca compartilhe a chave secreta do cliente. Se ela vazar, apague o cliente no Google Cloud e crie outro.</li>
        <li>Não crie contas ou projetos extras para contornar limites: isso viola as regras do Google.</li>
      </ul>
    </Ajuda>
  )
}

export function GuiaRss({ aberto }: { aberto?: boolean }) {
  return (
    <Ajuda titulo="O que é um feed RSS e como encontrar o endereço" aberto={aberto}>
      <p className="secundario">
        Um feed RSS é uma lista automática das publicações mais recentes de um site. O aplicativo lê só os feeds e as páginas que você cadastrar: ele não procura na internet inteira. Por isso, a qualidade das pautas depende das fontes que você escolher.
      </p>
      <ol>
        <li>Abra o site que você confia (blog oficial de uma empresa, órgão público, revista científica, portal de tecnologia).</li>
        <li>
          Procure um ícone laranja de RSS ou um link “Feed”, “RSS” ou “Assinar”. Copie o endereço desse link (clique com o botão direito › <strong>Copiar endereço do link</strong>).
        </li>
        <li>
          Se não achar, tente acrescentar <code>/feed</code> ou <code>/rss</code> ao endereço do site (muitos sites em WordPress funcionam com <code>/feed/</code>). Exemplo testado: <code>https://github.blog/feed/</code>.
        </li>
        <li>
          Canais do YouTube também têm feed: <code>https://www.youtube.com/feeds/videos.xml?channel_id=</code> seguido do ID do canal.
        </li>
        <li>Cole o endereço aqui, dê um nome fácil de reconhecer e clique em Adicionar. Use “Página” para um endereço que não é feed (o app lê o texto da página, respeitando as regras do site).</li>
      </ol>
      <p className="secundario pequeno">
        Dicas: prefira fontes primárias (quem anunciou a novidade) e de reputação conhecida. Comece com 5 a 15 fontes. Fontes que proíbem leitura automática (robots.txt) são respeitadas e aparecem com erro no registro.
      </p>
    </Ajuda>
  )
}

export function GuiaOllama({ aberto }: { aberto?: boolean }) {
  return (
    <Ajuda titulo="Como instalar IA local e gratuita (Ollama)" aberto={aberto}>
      <p className="secundario">
        Opcional. Sem nenhuma IA, o aplicativo continua funcionando: o modo estruturado monta o roteiro a partir das afirmações que você verificou. A IA local ajuda a reescrever com mais naturalidade, sem enviar nada para fora do computador e sem custo.
      </p>
      <ol>
        <li>
          Clique em <strong>Configurar o Ollama (1 clique)</strong>: o aplicativo instala pelo instalador oficial do Windows, abre o programa, baixa um modelo leve e o cadastra. Sem PowerShell e sem comandos.
        </li>
        <li>
          O modelo baixado é o <strong>qwen3:4b</strong> (cerca de 2,5 GB), bom em português e leve para PCs com 16 GB de memória. Se você já tiver outro modelo no Ollama, o aplicativo usa o que já existe.
        </li>
        <li>
          Pronto: a IA do PC aparece em <strong>IAs cadastradas</strong> e entra sozinha na escolha automática (modo híbrido ou somente local). A barra mostra cada etapa e quanto falta do download.
        </li>
      </ol>
      <p className="secundario pequeno">
        IA online (paga) também é possível: você informa o endereço, o modelo e os preços, e guarda a chave no cofre. Antes de cada envio, o aplicativo mostra o que será enviado, para onde e o custo estimado. Com o teto de gasto em zero (padrão), nada pago é usado.
      </p>
    </Ajuda>
  )
}

export function GuiaFfmpeg({ aberto }: { aberto?: boolean }) {
  return (
    <Ajuda titulo="Como instalar o FFmpeg (necessário para gerar o vídeo final)" aberto={aberto}>
      <ol>
        <li>
          Clique em <strong>Instalar FFmpeg (1 clique)</strong>: o aplicativo instala pelo instalador oficial do Windows e configura sozinho. Sem PowerShell e sem comandos.
        </li>
        <li>
          Se o botão não aparecer (Windows sem o instalador oficial), baixe o FFmpeg pelo site e use <strong>Escolher ffmpeg.exe</strong>.
        </li>
        <li>Ao terminar, o FFmpeg aparece como “Encontrado”, sem precisar reabrir o aplicativo.</li>
      </ol>
      <p className="secundario pequeno">O FFmpeg é instalado por você, separado do aplicativo (licença do projeto FFmpeg). Sem ele, o editor funciona, mas não gera o arquivo final nem roda o controle de qualidade do vídeo.</p>
    </Ajuda>
  )
}
