import { useState } from 'react'
import { chamar, mensagemDeErro, useDados } from '../api'
import { useRetorno } from '../componentes/retorno'
import { Campo, Dialogo } from '../componentes/ui'
import { useNavegacao } from '../navegacao'
import { ROTULO_TIPO_VIDEO, TIPOS_VIDEO, type TipoVideo } from '@shared/dominio'

/** Diálogo de criação de roteiro, usado na Visão geral e na Biblioteca. */
export function NovoRoteiro({ aberto, aoFechar, pautaId = null, tituloInicial = '' }: { aberto: boolean; aoFechar: () => void; pautaId?: number | null; tituloInicial?: string }) {
  const nav = useNavegacao()
  const { avisarErro } = useRetorno()
  const projetos = useDados(() => (aberto ? chamar('projetos:listar') : Promise.resolve([])), [aberto])
  const [titulo, setTitulo] = useState(tituloInicial)
  const [tipo, setTipo] = useState<TipoVideo>('longo')
  const [projetoId, setProjetoId] = useState<number | null>(null)
  const [enviando, setEnviando] = useState(false)
  const projeto = projetoId ?? projetos.dados?.[0]?.id ?? null

  async function criar(): Promise<void> {
    if (!projeto) return
    setEnviando(true)
    try {
      const r = await chamar('roteiros:criar', { projetoId: projeto, titulo, tipoVideo: tipo, pautaId })
      aoFechar()
      setTitulo('')
      nav.abrirRoteiro(r.id)
    } catch (e) {
      avisarErro(mensagemDeErro(e))
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Dialogo
      aberto={aberto}
      aoFechar={aoFechar}
      titulo="Novo roteiro"
      acoes={
        <>
          <button className="botao fantasma" onClick={aoFechar}>
            Cancelar
          </button>
          <button className="botao primario" onClick={criar} disabled={!titulo.trim() || !projeto || enviando}>
            Criar e abrir
          </button>
        </>
      }
    >
      {projetos.dados && projetos.dados.length === 0 ? (
        <p className="secundario">Crie um projeto em Configurações antes de criar roteiros.</p>
      ) : (
        <form
          className="form-grade"
          onSubmit={(e) => {
            e.preventDefault()
            void criar()
          }}
        >
          <Campo rotulo="Título de trabalho">
            <input className="entrada" value={titulo} onChange={(e) => setTitulo(e.target.value)} maxLength={200} autoFocus />
          </Campo>
          <Campo rotulo="Formato">
            <select className="entrada" value={tipo} onChange={(e) => setTipo(e.target.value as TipoVideo)}>
              {TIPOS_VIDEO.map((t) => (
                <option key={t} value={t}>
                  {ROTULO_TIPO_VIDEO[t]}
                </option>
              ))}
            </select>
          </Campo>
          {(projetos.dados?.length ?? 0) > 1 && (
            <Campo rotulo="Projeto">
              <select className="entrada" value={projeto ?? ''} onChange={(e) => setProjetoId(Number(e.target.value))}>
                {projetos.dados?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome}
                  </option>
                ))}
              </select>
            </Campo>
          )}
        </form>
      )}
    </Dialogo>
  )
}
