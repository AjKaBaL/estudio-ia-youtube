import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { pastaQuadros } from './midia/miniaturas'
import { join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, safeStorage, shell } from 'electron'
import { pathToFileURL } from 'node:url'
import { GerenciadorProducao, recuperarRenderizacoes } from './midia/producao'
import { localizarFerramentas } from './midia/ffmpeg'
import { lerConfig } from './repositorios/configuracoes'
import { um } from './db/conexao'
import { Cofre } from './ia/cofre'
import { criarYouTubeGateway } from '@estudio/youtube'
import { clienteHttpGoogle, segredosDoCofre } from './youtube/http'
import { GerenciadorEnvio, recuperarEnvios } from './youtube/publicacao'
import { iniciarAgendador } from './agendador'
import type { Contexto } from './contexto'
import { criarBackup } from './db/backup'
import { abrirBanco } from './db/conexao'
import { registrarEvento } from './db/eventos'
import { migracoesPendentes, migrar, versaoAtual } from './db/migracoes'
import { despachar } from './ipc/despachar'
import { GerenciadorPesquisas, recuperarInterrompidas } from './pesquisa/executor'
import { aplicarPadroesPesquisa } from './repositorios/pesquisa'
import { talvezRodarPiloto } from './piloto'
import { configurarSegundoPlano, definirSegundoPlano, iniciouEmSegundoPlano, lerSegundoPlano, mostrarJanelaExistente } from './segundoPlano'
import { criarVerificadorOrigem, negarPermissoes, preferenciasSeguras, protegerJanela } from './seguranca'

const CANAL_IPC = 'estudio:invoke'

// Pasta de dados alternativa só para testes de desenvolvimento; o app instalado sempre usa %APPDATA%.
if (!app.isPackaged && process.env.ESTUDIO_PASTA_DADOS) {
  app.setPath('userData', process.env.ESTUDIO_PASTA_DADOS)
}

// Protocolo próprio para pré-visualizar mídia da biblioteca (só arquivos registrados no banco).
protocol.registerSchemesAsPrivileged([{ scheme: 'midia', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }])

// Identidade própria no Windows (barra de tarefas, ícone e atalhos fixados), não a do Electron.
const ID_APP_WINDOWS = 'AjKaBaL.EstudioIAYouTube'
if (process.platform === 'win32') app.setAppUserModelId(ID_APP_WINDOWS)

if (!app.requestSingleInstanceLock()) {
  app.quit()
}

let janela: BrowserWindow | null = null

function iniciarContexto(): Contexto {
  const pastaDados = app.getPath('userData')
  const pastaBackups = join(pastaDados, 'backups')
  mkdirSync(pastaDados, { recursive: true })
  const caminhoBanco = join(pastaDados, 'dados.sqlite')
  const existia = existsSync(caminhoBanco)
  const db = abrirBanco(caminhoBanco)
  if (existia && versaoAtual(db) > 0 && migracoesPendentes(db).length > 0) {
    criarBackup(db, pastaBackups, 'antes-migracao')
  }
  const aplicadas = migrar(db)
  if (aplicadas.length) registrarEvento(db, 'info', 'banco', `Migrações aplicadas: ${aplicadas.join(', ')}.`)
  const interrompidas = recuperarInterrompidas(db)
  // Fontes de pesquisa e termos padrão: uma vez por projeto (não voltam se o usuário remover).
  const padroes = aplicarPadroesPesquisa(db)
  if (padroes.fontes || padroes.termos) registrarEvento(db, 'info', 'pesquisa', `Fontes padrão adicionadas: ${padroes.fontes}; termos padrão: ${padroes.termos ? 'sim' : 'não'}.`)
  recuperarRenderizacoes(db)
  recuperarEnvios(db)
  const pastaRender = join(pastaDados, 'renderizacoes')
  let cacheFerramentas: ReturnType<typeof localizarFerramentas> | undefined
  const ferramentas = (): ReturnType<typeof localizarFerramentas> => {
    const configurado = lerConfig<string>(db, 'midia.ffmpeg')
    if (cacheFerramentas === undefined || configurado !== cacheFerramentas?.ffmpeg) cacheFerramentas = localizarFerramentas(configurado)
    return cacheFerramentas
  }
  if (interrompidas) registrarEvento(db, 'aviso', 'pesquisa', `${interrompidas} pesquisa(s) interrompida(s) pelo fechamento do aplicativo.`)

  const cofre = new Cofre(join(pastaDados, 'credenciais.bin'), {
    disponivel: () => safeStorage.isEncryptionAvailable(),
    cifrar: (t) => safeStorage.encryptString(t),
    decifrar: (d) => safeStorage.decryptString(d)
  })
  const youtube = criarYouTubeGateway({ http: clienteHttpGoogle, segredos: segredosDoCofre(cofre) })
  return {
    db,
    versaoApp: app.getVersion(),
    pastaDados,
    pastaBackups,
    youtube,
    pesquisas: new GerenciadorPesquisas(db),
    pastaMidia: join(pastaDados, 'midia'),
    pastaRender,
    producao: new GerenciadorProducao(db, pastaRender, ferramentas),
    ferramentas,
    cofre,
    envios: new GerenciadorEnvio(db, cofre, () => youtube),
    abrirNavegador: async (url) => {
      // Só o endereço oficial de autorização do Google é aberto no navegador padrão.
      if (!url.startsWith('https://accounts.google.com/')) throw new Error('Endereço de autorização inesperado.')
      await shell.openExternal(url)
    },
    plataforma: {
      async salvarTexto(nomeSugerido, conteudo, filtro) {
        const r = await dialog.showSaveDialog({
          defaultPath: join(app.getPath('documents'), nomeSugerido),
          filters: [{ name: filtro.nome, extensions: [filtro.extensao] }]
        })
        if (r.canceled || !r.filePath) return null
        writeFileSync(r.filePath, conteudo, 'utf8')
        return r.filePath
      },
      async abrirPasta(caminho) {
        const erro = await shell.openPath(caminho)
        if (erro) throw new Error(erro)
      },
      async escolherArquivos(filtro, varios) {
        // Só em desenvolvimento: o teste da tela informa os arquivos no lugar da caixa de diálogo.
        if (!app.isPackaged && process.env.ESTUDIO_TESTE_ARQUIVOS) return process.env.ESTUDIO_TESTE_ARQUIVOS.split('|')
        const r = await dialog.showOpenDialog({ properties: varios ? ['openFile', 'multiSelections'] : ['openFile'], filters: [{ name: filtro.nome, extensions: filtro.extensoes }] })
        return r.canceled ? [] : r.filePaths
      },
      mostrarNoExplorador(caminho) {
        shell.showItemInFolder(caminho)
      },
      pastaDownloads: app.getPath('downloads'),
      segundoPlano: { ler: () => lerSegundoPlano(db), definir: (p) => definirSegundoPlano(db, p) }
    }
  }
}

/**
 * Windows: a janela diz como reabrir o app. Sem isso, fixar na barra de tarefas ou no Iniciar cria um atalho para o
 * Electron "puro" (abre uma janela vazia, sem o app). Também remove um atalho assim, se já existir no menu Iniciar.
 */
function identificarNoWindows(j: BrowserWindow): void {
  if (process.platform !== 'win32' || app.isPackaged) return
  const raiz = app.getAppPath()
  const abrir = join(raiz, 'Abrir Estudio.cmd')
  if (!existsSync(abrir)) return
  j.setAppDetails({
    appId: ID_APP_WINDOWS,
    appIconPath: join(raiz, 'recursos', 'icone.ico'),
    appIconIndex: 0,
    relaunchCommand: `"${process.env.ComSpec ?? 'C:\\Windows\\System32\\cmd.exe'}" /c "${abrir}"`,
    relaunchDisplayName: 'Estúdio IA YouTube'
  })
  const errado = join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'electron.lnk')
  try {
    if (existsSync(errado) && shell.readShortcutLink(errado).target.toLowerCase() === process.execPath.toLowerCase()) rmSync(errado)
  } catch {
    // atalho ilegível: deixa como está
  }
}

function criarJanela(ctx: Contexto): void {
  const indexHtml = join(__dirname, '../renderer/index.html')
  const urlDev = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined
  const origemConfiavel = criarVerificadorOrigem(indexHtml, urlDev)

  janela = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#0f0f0f',
    title: 'Estúdio IA YouTube',
    autoHideMenuBar: true,
    webPreferences: preferenciasSeguras(join(__dirname, '../preload/index.js'), app.isPackaged)
  })
  protegerJanela(janela, origemConfiavel)
  identificarNoWindows(janela)

  ipcMain.handle(CANAL_IPC, async (evento, canal: unknown, entrada: unknown) => {
    const url = evento.senderFrame?.url ?? ''
    if (!origemConfiavel(url)) {
      registrarEvento(ctx.db, 'aviso', 'ipc', 'Chamada recusada: origem não confiável.')
      return { ok: false, erro: { codigo: 'origem_negada', mensagem: 'Operação não permitida.' } }
    }
    return despachar(canal, entrada, ctx)
  })

  // Aberto pelo Windows em segundo plano: começa escondido (fica na bandeja).
  janela.once('ready-to-show', () => {
    if (!iniciouEmSegundoPlano()) janela?.show()
  })
  janela.on('closed', () => {
    janela = null
  })
  if (urlDev) void janela.loadURL(urlDev)
  else void janela.loadFile(indexHtml)

  if (!app.isPackaged && process.env.ESTUDIO_CAPTURA_DIR) {
    void import('./capturaDev').then((m) => m.capturarTelas(janela!, process.env.ESTUDIO_CAPTURA_DIR!))
  } else if (!app.isPackaged && process.env.ESTUDIO_TESTE_RENDER) {
    void import('./testeTelaDev').then((m) => m.testarRenderPelaTela(janela!, process.env.ESTUDIO_TESTE_RENDER!))
  }
}

app.on('second-instance', () => mostrarJanelaExistente(janela))

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  negarPermissoes()
  let ctx: Contexto
  try {
    ctx = iniciarContexto()
  } catch (e) {
    // Nunca sobrescreve o banco: apenas informa e encerra.
    dialog.showErrorBox(
      'Não foi possível abrir os dados',
      `${e instanceof Error ? e.message : String(e)}\n\nSeus arquivos não foram alterados. Pasta: ${app.getPath('userData')}`
    )
    app.quit()
    return
  }
  // midia://recurso/<id>, midia://captura/<relatorio>/<arquivo> e midia://quadro/<render>/q-N.jpg: caminhos sempre vindos do banco.
  protocol.handle('midia', (req) => {
    try {
      const u = new URL(req.url)
      const partes = u.pathname.split('/').filter(Boolean)
      let caminho: string | undefined
      if (u.hostname === 'recurso' && /^\d+$/.test(partes[0] ?? '')) {
        caminho = um<{ caminho: string }>(ctx.db, 'SELECT caminho FROM recursos_midia WHERE id = :id', { id: Number(partes[0]) })?.caminho
      } else if (u.hostname === 'quadro' && /^\d+$/.test(partes[0] ?? '') && /^q-\d\.jpg$/.test(partes[1] ?? '')) {
        const arquivo = um<{ a: string }>(ctx.db, 'SELECT arquivo AS a FROM renderizacoes WHERE id = :id', { id: Number(partes[0]) })?.a
        if (arquivo) caminho = join(pastaQuadros(arquivo), partes[1]!)
      } else if (u.hostname === 'captura' && /^\d+$/.test(partes[0] ?? '') && /^quadro-\d+\.jpg$/.test(partes[1] ?? '')) {
        const pasta = um<{ p: string | null }>(ctx.db, 'SELECT pasta_capturas AS p FROM relatorios_qualidade WHERE id = :id', { id: Number(partes[0]) })?.p
        if (pasta) caminho = join(pasta, partes[1]!)
      }
      if (!caminho) return new Response('Não encontrado', { status: 404 })
      return net.fetch(pathToFileURL(caminho).href, { headers: req.headers })
    } catch {
      return new Response('Erro', { status: 400 })
    }
  })
  // O piloto automático (se ligado) avança as etapas dos vídeos a cada 5 minutos.
  const pararAgendador = iniciarAgendador(ctx.db, ctx.pesquisas, () => talvezRodarPiloto(ctx))
  criarJanela(ctx)
  configurarSegundoPlano(ctx.db, () => janela)
  app.on('before-quit', () => {
    pararAgendador()
    ctx.db.close()
  })
})

// Com a bandeja ligada a janela só é escondida; se ela for realmente fechada (ex.: "Sair"), o app encerra.
app.on('window-all-closed', () => app.quit())
