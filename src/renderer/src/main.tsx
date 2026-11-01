import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { ProvedorRetorno } from './componentes/retorno'
import './estilos.css'

// Registra erros de interface (usado pela verificação visual de desenvolvimento).
const erros: string[] = []
;(window as unknown as { __errosCaptura: string[] }).__errosCaptura = erros
window.addEventListener('error', (e) => erros.push(String(e.message)))
window.addEventListener('unhandledrejection', (e) => erros.push(String(e.reason)))

createRoot(document.getElementById('raiz')!).render(
  <StrictMode>
    <ProvedorRetorno>
      <App />
    </ProvedorRetorno>
  </StrictMode>
)
