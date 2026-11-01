import { session, shell, type BrowserWindow } from 'electron'

export { criarVerificadorOrigem, preferenciasSeguras } from './politicaJanela'

export function protegerJanela(janela: BrowserWindow, origemConfiavel: (url: string) => boolean): void {
  const wc = janela.webContents
  // Nenhuma navegação para fora da página do app. Links http(s) abrem no navegador padrão.
  wc.on('will-navigate', (evento, url) => {
    if (!origemConfiavel(url)) evento.preventDefault()
  })
  wc.on('will-redirect', (evento, url) => {
    if (!origemConfiavel(url)) evento.preventDefault()
  })
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  wc.on('will-attach-webview', (evento) => evento.preventDefault())
}

/** Nega todos os pedidos de permissão do navegador (câmera, microfone, notificações, localização...). */
export function negarPermissoes(): void {
  session.defaultSession.setPermissionRequestHandler((_wc, _permissao, callback) => callback(false))
  session.defaultSession.setPermissionCheckHandler(() => false)
}
