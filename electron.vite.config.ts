import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { CSP_PRODUCAO } from './src/main/politicaJanela'

// Política de segurança de conteúdo. Em desenvolvimento o Vite precisa de script inline
// (atualização ao vivo) e de websocket local; no aplicativo final nada disso é permitido.
const cspDesenvolvimento =
  "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: midia:; media-src 'self' midia:; " +
  "font-src 'self'; connect-src 'self' ws://localhost:*; object-src 'none'; base-uri 'none'; form-action 'none'"

function csp(): Plugin {
  return {
    name: 'estudio-csp',
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        const politica = ctx.server ? cspDesenvolvimento : CSP_PRODUCAO
        return html.replace(
          '<!-- CSP -->',
          `<meta http-equiv="Content-Security-Policy" content="${politica}" />`
        )
      }
    }
  }
}

export default defineConfig({
  main: {
    resolve: { alias: { '@shared': resolve('src/shared') } }
  },
  preload: {
    build: { rollupOptions: { output: { format: 'cjs' } } }
  },
  renderer: {
    root: 'src/renderer',
    resolve: { alias: { '@shared': resolve('src/shared') } },
    plugins: [react(), csp()]
  }
})
