import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { Dialogo } from './ui'

/** Avisos rápidos (sucesso/erro) e confirmações antes de ações importantes. */

interface AvisoItem {
  id: number
  texto: string
  erro: boolean
}

interface PedidoConfirmacao {
  titulo: string
  texto: ReactNode
  confirmar: string
  perigo?: boolean
}

interface Retorno {
  avisar: (texto: string) => void
  avisarErro: (texto: string) => void
  confirmar: (p: PedidoConfirmacao) => Promise<boolean>
}

const Contexto = createContext<Retorno | null>(null)

export function useRetorno(): Retorno {
  const c = useContext(Contexto)
  if (!c) throw new Error('useRetorno fora do provedor')
  return c
}

export function ProvedorRetorno({ children }: { children: ReactNode }) {
  const [avisos, setAvisos] = useState<AvisoItem[]>([])
  const [pedido, setPedido] = useState<PedidoConfirmacao | null>(null)
  const resolver = useRef<((v: boolean) => void) | null>(null)
  const proximo = useRef(1)

  const adicionar = useCallback((texto: string, erro: boolean) => {
    const id = proximo.current++
    setAvisos((a) => [...a.slice(-2), { id, texto, erro }])
    setTimeout(() => setAvisos((a) => a.filter((x) => x.id !== id)), erro ? 8000 : 4000)
  }, [])

  const confirmar = useCallback((p: PedidoConfirmacao) => {
    setPedido(p)
    return new Promise<boolean>((r) => {
      resolver.current = r
    })
  }, [])

  const responder = (v: boolean): void => {
    resolver.current?.(v)
    resolver.current = null
    setPedido(null)
  }

  const valor: Retorno = {
    avisar: useCallback((t: string) => adicionar(t, false), [adicionar]),
    avisarErro: useCallback((t: string) => adicionar(t, true), [adicionar]),
    confirmar
  }

  return (
    <Contexto.Provider value={valor}>
      {children}
      <Dialogo
        aberto={pedido !== null}
        aoFechar={() => responder(false)}
        titulo={pedido?.titulo ?? ''}
        acoes={
          <>
            <button className="botao fantasma" onClick={() => responder(false)} autoFocus>
              Cancelar
            </button>
            <button className={`botao ${pedido?.perigo ? 'perigo' : 'primario'}`} onClick={() => responder(true)}>
              {pedido?.confirmar}
            </button>
          </>
        }
      >
        <div className="secundario">{pedido?.texto}</div>
      </Dialogo>
      <div className="avisos" aria-live="polite">
        {avisos.map((a) => (
          <div key={a.id} className={`aviso${a.erro ? ' erro' : ''}`} role={a.erro ? 'alert' : 'status'}>
            {a.texto}
          </div>
        ))}
      </div>
    </Contexto.Provider>
  )
}
