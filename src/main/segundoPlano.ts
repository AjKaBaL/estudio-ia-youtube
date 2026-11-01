import { app, Menu, nativeImage, Tray, type BrowserWindow } from 'electron'
import type { Banco } from './db/conexao'
import { gravarConfig, lerConfig } from './repositorios/configuracoes'
import { automacaoPausada, definirPausaGlobal } from './producao/fila'

/**
 * Funcionamento em segundo plano (as tarefas automáticas só rodam com o app aberto):
 * - bandeja: fechar a janela só a esconde; o app continua no ícone perto do relógio;
 * - iniciar com o Windows: abre escondido ao entrar no Windows (argumento --segundo-plano).
 * As duas opções são do usuário e podem ser desligadas a qualquer momento.
 */

export interface PreferenciaSegundoPlano {
  bandeja: boolean
  iniciarComWindows: boolean
}

const CHAVE = 'sistema.segundoPlano'
const ARG = '--segundo-plano'
/** Ícone 32×32 gerado pelo próprio projeto (quadrado vermelho com "play"). */
const ICONE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAACXBIWXMAAAABAAAAAQBPJcTWAAAAoUlEQVR4nO3XXQqEMAwE4BmYG+3e/wR6piwiBf9ebLOZl86LiNR8GK2EMEfHk8AnKooSK2+AKCreajWEqotfEYI5mgDMFrxNLAC/8LYglv2YANHQ6oSnoaHVDbGlE6JhwBHSgVAaoCG2vIAoFdABEczRX+5qawGdLyFdnyGdGxFdWzGdPyPmFe8DJEcTgNkC7LNa9XR0Gs1QjHgcTq8XqvIDebclwNHHB+EAAAAASUVORK5CYII='

let tray: Tray | null = null
let saindo = false
let avisou = false

export const iniciouEmSegundoPlano = (): boolean => process.argv.includes(ARG)
export const marcarSaida = (): void => {
  saindo = true
}

function argsInicio(): string[] {
  return app.isPackaged ? [ARG] : [app.getAppPath(), ARG]
}

export function lerSegundoPlano(db: Banco): PreferenciaSegundoPlano {
  const salvo = lerConfig<Partial<PreferenciaSegundoPlano>>(db, CHAVE) ?? {}
  const login = process.platform === 'win32' ? app.getLoginItemSettings({ path: process.execPath, args: argsInicio() }).openAtLogin : false
  return { bandeja: salvo.bandeja ?? true, iniciarComWindows: login }
}

export function definirSegundoPlano(db: Banco, p: PreferenciaSegundoPlano): PreferenciaSegundoPlano {
  gravarConfig(db, CHAVE, { bandeja: p.bandeja })
  if (process.platform === 'win32') app.setLoginItemSettings({ openAtLogin: p.iniciarComWindows, path: process.execPath, args: argsInicio() })
  return lerSegundoPlano(db)
}

/** Liga a bandeja e intercepta o fechamento da janela (esconde em vez de sair, se a opção estiver ligada). */
export function configurarSegundoPlano(db: Banco, janela: () => BrowserWindow | null): void {
  const mostrar = (): void => {
    const j = janela()
    if (!j) return
    if (j.isMinimized()) j.restore()
    j.show()
    j.focus()
  }
  const montarMenu = (): void => {
    if (!tray) return
    const pausada = automacaoPausada(db)
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Abrir o Estúdio', click: mostrar },
        { label: pausada ? 'Retomar tarefas automáticas' : 'Pausar tarefas automáticas', click: () => (definirPausaGlobal(db, !pausada), montarMenu()) },
        { type: 'separator' },
        { label: 'Sair', click: () => (marcarSaida(), app.quit()) }
      ])
    )
  }
  tray = new Tray(nativeImage.createFromDataURL(ICONE))
  tray.setToolTip('Estúdio IA YouTube — tarefas automáticas ativas')
  tray.on('double-click', mostrar)
  tray.on('click', mostrar)
  montarMenu()
  app.on('before-quit', marcarSaida)
  const j = janela()
  j?.on('close', (e) => {
    if (saindo || !lerSegundoPlano(db).bandeja) return
    e.preventDefault()
    j.hide()
    montarMenu()
    if (!avisou && process.platform === 'win32') {
      avisou = true
      tray?.displayBalloon({ title: 'O Estúdio continua rodando', content: 'As tarefas automáticas seguem na bandeja (perto do relógio). Para fechar de vez, clique com o botão direito no ícone › Sair.' })
    }
  })
}

export function mostrarJanelaExistente(janela: BrowserWindow | null): void {
  if (!janela) return
  if (janela.isMinimized()) janela.restore()
  janela.show()
  janela.focus()
}
