import { contextBridge, ipcRenderer } from 'electron'
import { canalPermitido } from '../shared/canais'

/**
 * Ponte mínima: a interface só consegue chamar operações da lista permitida.
 * Nenhuma API do Node ou do Electron é exposta diretamente.
 */
contextBridge.exposeInMainWorld('estudio', {
  invoke(canal: unknown, entrada?: unknown): Promise<unknown> {
    if (!canalPermitido(canal)) {
      return Promise.resolve({ ok: false, erro: { codigo: 'canal_negado', mensagem: 'Operação não permitida.' } })
    }
    return ipcRenderer.invoke('estudio:invoke', canal, entrada)
  }
})
