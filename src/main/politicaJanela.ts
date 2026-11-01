import { pathToFileURL } from 'node:url'
import type { WebPreferences } from 'electron'

/**
 * Política de segurança da janela (sem dependência do Electron em tempo de execução, para poder ser testada).
 * A interface não tem Node, roda isolada e em sandbox; só a página do próprio app pode chamar a IPC.
 */

export function preferenciasSeguras(preload: string, empacotado: boolean): WebPreferences {
  return {
    preload,
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
    experimentalFeatures: false,
    webviewTag: false,
    navigateOnDragDrop: false,
    devTools: !empacotado,
    spellcheck: true
  }
}

/** Decide se uma URL é a própria página do aplicativo (única origem autorizada a chamar a IPC). */
export function criarVerificadorOrigem(indexHtml: string, urlDesenvolvimento: string | undefined): (url: string) => boolean {
  const arquivo = pathToFileURL(indexHtml).href
  const origemDev = urlDesenvolvimento ? new URL(urlDesenvolvimento) : null
  return (url: string): boolean => {
    try {
      const u = new URL(url)
      if (origemDev) return u.origin === origemDev.origin && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')
      return u.protocol === 'file:' && `${u.protocol}//${u.host}${u.pathname}` === arquivo
    } catch {
      return false
    }
  }
}

/** Política de conteúdo do aplicativo empacotado: sem scripts externos, sem eval, sem conexões de rede da interface. */
export const CSP_PRODUCAO =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: midia:; media-src 'self' midia: blob:; " +
  "font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
