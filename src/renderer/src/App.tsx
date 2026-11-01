import { useEffect, useMemo, useRef, useState } from 'react'
import { chamar } from './api'
import { Icone } from './componentes/Icone'
import { useRetorno } from './componentes/retorno'
import { ContextoNavegacao, NAVEGACAO, type IdTela, type Navegacao } from './navegacao'
import { Biblioteca } from './telas/Biblioteca'
import { Calendario } from './telas/Calendario'
import { Configuracoes } from './telas/Configuracoes'
import { EditorRoteiro } from './telas/EditorRoteiro'
import { Estudio } from './telas/Estudio'
import { Fila } from './telas/Fila'
import { Metricas } from './telas/Metricas'
import { Publicacoes } from './telas/Publicacoes'
import { Pautas } from './telas/Pautas'
import { Revisao } from './telas/Revisao'
import { Painel } from './telas/Painel'
import { VisaoGeral } from './telas/VisaoGeral'
import { PrimeirosPassos } from './telas/PrimeirosPassos'
import { StatusTrabalho } from './componentes/statusTrabalho'
import { Links } from './telas/Links'

const TELAS_VALIDAS = new Set<string>(NAVEGACAO.flat().map((i) => i.id))

export function App() {
  const [tela, setTela] = useState<IdTela>('painel')
  const [roteiroAberto, setRoteiroAberto] = useState<number | null>(null)
  const restaurado = useRef(false)

  // Recupera a última tela usada.
  useEffect(() => {
    // Na primeira vez (ou enquanto a configuração não for concluída nem adiada), abre os Primeiros passos.
    Promise.all([chamar('ui:obterEstado'), chamar('assistente:estado').catch(() => null)])
      .then(([e, a]) => {
        if (a && !a.concluido && !a.dispensado) setTela('inicio')
        else if (e && TELAS_VALIDAS.has(e.tela)) setTela(e.tela as IdTela)
      })
      .catch(() => undefined)
      .finally(() => {
        restaurado.current = true
      })
  }, [])

  useEffect(() => {
    if (restaurado.current) chamar('ui:salvarEstado', { tela }).catch(() => undefined)
  }, [tela])

  const { confirmar } = useRetorno()
  const pendente = useRef<(() => boolean) | null>(null)

  const nav = useMemo<Navegacao>(() => {
    const podeSair = async (): Promise<boolean> => {
      if (!pendente.current?.()) return true
      const ok = await confirmar({
        titulo: 'Sair sem salvar?',
        texto: 'Há alterações não salvas neste roteiro. Se sair agora, elas serão perdidas.',
        confirmar: 'Sair sem salvar',
        perigo: true
      })
      if (ok) pendente.current = null
      return ok
    }
    return {
      tela,
      roteiroAberto,
      irPara: (t) => {
        void podeSair().then((ok) => {
          if (!ok) return
          setRoteiroAberto(null)
          setTela(t)
        })
      },
      abrirRoteiro: (id) => setRoteiroAberto(id),
      fecharRoteiro: () => {
        void podeSair().then((ok) => ok && setRoteiroAberto(null))
      },
      definirAlteracoesPendentes: (fn) => {
        pendente.current = fn
      }
    }
  }, [tela, roteiroAberto, confirmar])

  return (
    <ContextoNavegacao.Provider value={nav}>
      <div className="app">
        <header className="topo">
          <div className="marca" aria-label="Estúdio IA">
            <span className="marca-icone">IA</span>
            <span>Estúdio</span>
          </div>
          <div className="topo-espaco" />
          <StatusTrabalho />
        </header>
        <div className="corpo">
          <nav className="lateral" aria-label="Navegação principal">
            {NAVEGACAO.map((grupo, i) => (
              <div key={i}>
                {i > 0 && <hr className="nav-separador" />}
                {grupo.map((item) => (
                  <button
                    key={item.id}
                    className="nav-item"
                    data-tela={item.id}
                    aria-current={tela === item.id ? 'page' : undefined}
                    onClick={() => nav.irPara(item.id)}
                    title={item.futuro ? `${item.rotulo} (função futura)` : item.rotulo}
                  >
                    <Icone nome={item.icone} />
                    <span>{item.rotulo}</span>
                    {item.futuro && <span className="nav-futuro">Futuro</span>}
                  </button>
                ))}
              </div>
            ))}
          </nav>
          <main className="conteudo">
            <div className="conteudo-interno">{roteiroAberto !== null ? <EditorRoteiro id={roteiroAberto} /> : <Tela id={tela} />}</div>
          </main>
        </div>
      </div>
    </ContextoNavegacao.Provider>
  )
}

function Tela({ id }: { id: IdTela }) {
  switch (id) {
    case 'painel':
      return <Painel />
    case 'visao':
      return <VisaoGeral />
    case 'pautas':
      return <Pautas />
    case 'biblioteca':
      return <Biblioteca />
    case 'revisao':
      return <Revisao />
    case 'calendario':
      return <Calendario />
    case 'fila':
      return <Fila />
    case 'config':
      return <Configuracoes />
    case 'estudio':
      return <Estudio />
    case 'publicacoes':
      return <Publicacoes />
    case 'metricas':
      return <Metricas />
    case 'inicio':
      return <PrimeirosPassos />
    case 'links':
      return <Links />
  }
}
