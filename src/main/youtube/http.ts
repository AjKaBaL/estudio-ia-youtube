import https from 'node:https'
import { HOSTS_PERMITIDOS, type ClienteHttp, type Segredos } from '@estudio/youtube'
import type { Cofre } from '../ia/cofre'

/**
 * Cliente HTTP injetado no pacote do YouTube: só https, só hosts oficiais do Google,
 * certificado validado, limites de tempo e tamanho. Cabeçalhos nunca são registrados.
 */
export const clienteHttpGoogle: ClienteHttp = {
  requisitar(req) {
    return new Promise((resolve, reject) => {
      let u: URL
      try {
        u = new URL(req.url)
      } catch {
        return reject(new Error('Endereço inválido.'))
      }
      if (u.protocol !== 'https:' || !(HOSTS_PERMITIDOS as readonly string[]).includes(u.hostname)) {
        return reject(new Error('Destino não permitido para a integração com o YouTube.'))
      }
      const r = https.request(
        u,
        { method: req.metodo, headers: { 'User-Agent': 'EstudioIAYouTube/0.1', ...req.cabecalhos }, timeout: req.tempoLimiteMs ?? 60_000, signal: req.sinal, rejectUnauthorized: true },
        (res) => {
          const partes: Buffer[] = []
          let total = 0
          res.on('data', (p: Buffer) => {
            total += p.length
            if (total > 10 * 1024 * 1024) {
              res.destroy()
              reject(new Error('Resposta grande demais.'))
            } else partes.push(p)
          })
          res.on('end', () => {
            const cabecalhos: Record<string, string> = {}
            for (const [k, v] of Object.entries(res.headers)) if (typeof v === 'string') cabecalhos[k] = v
            resolve({ status: res.statusCode ?? 0, cabecalhos, corpo: Buffer.concat(partes).toString('utf8') })
          })
          res.on('error', () => reject(new Error('Conexão interrompida.')))
        }
      )
      r.on('timeout', () => r.destroy(new Error('Tempo esgotado na comunicação com o YouTube.')))
      r.on('error', (e) => reject(e.name === 'AbortError' ? new Error('Cancelado.') : new Error('Falha de rede ao falar com o YouTube.')))
      if (req.corpo !== undefined) r.write(req.corpo)
      r.end()
    })
  }
}

/** Segredos do YouTube no cofre criptografado do aplicativo. */
export function segredosDoCofre(cofre: Cofre): Segredos {
  return {
    obter: (k) => cofre.obter(k),
    guardar: (k, v) => cofre.guardar(k, v),
    remover: (k) => cofre.remover(k)
  }
}
