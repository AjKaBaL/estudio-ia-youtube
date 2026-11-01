import { useEffect, useRef, useState } from 'react'
import { chamar, mensagemDeErro, useDados } from '../api'
import { Icone } from '../componentes/Icone'
import { useRetorno } from '../componentes/retorno'
import { Cabecalho, Campo, Carregando, ErroCarregar, Etiqueta, Secao, Vazio, formatarData } from '../componentes/ui'
import { COR_STATUS_ROTEIRO, useNavegacao } from '../navegacao'
import { ROTULO_STATUS_ROTEIRO, ROTULO_TIPO_VIDEO, STATUS_ROTEIRO, TIPOS_VIDEO } from '@shared/dominio'
import { filtroRoteirosSchema, type FiltroRoteiros } from '@shared/schemas'
import type { RoteiroResumo } from '@shared/tipos'
import { NovoRoteiro } from './NovoRoteiro'

const ROTULO_ORDEM: Record<FiltroRoteiros['ordem'], string> = {
  atualizado_desc: 'Atualizados recentemente',
  criado_desc: 'Criados recentemente',
  titulo_asc: 'Título (A–Z)',
  prevista_asc: 'Data prevista',
  status_asc: 'Status'
}
const FILTRO_INICIAL = filtroRoteirosSchema.parse({})

export function Biblioteca() {
  const nav = useNavegacao()
  const { avisar, avisarErro, confirmar } = useRetorno()
  const [filtro, setFiltro] = useState<FiltroRoteiros>(FILTRO_INICIAL)
  const [texto, setTexto] = useState('')
  const [novo, setNovo] = useState(false)
  const busca = useRef<HTMLInputElement>(null)
  const restaurado = useRef(false)

  // Recupera os filtros usados por último.
  useEffect(() => {
    chamar('ui:obterEstado')
      .then((e) => {
        const r = filtroRoteirosSchema.safeParse(e?.filtroRoteiros ?? {})
        if (r.success) {
          setFiltro(r.data)
          setTexto(r.data.texto)
        }
      })
      .catch(() => undefined)
      .finally(() => {
        restaurado.current = true
      })
  }, [])

  // Busca enquanto digita, com pequena espera.
  useEffect(() => {
    const t = setTimeout(() => setFiltro((f) => (f.texto === texto ? f : { ...f, texto })), 250)
    return () => clearTimeout(t)
  }, [texto])

  useEffect(() => {
    if (restaurado.current) chamar('ui:salvarEstado', { tela: 'biblioteca', filtroRoteiros: filtro }).catch(() => undefined)
  }, [filtro])

  // Atalho "/" para focar a busca.
  useEffect(() => {
    const tecla = (e: KeyboardEvent): void => {
      const alvo = e.target as HTMLElement
      if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(alvo.tagName)) {
        e.preventDefault()
        busca.current?.focus()
      }
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [])

  const lista = useDados(() => chamar('roteiros:buscar', filtro), [filtro])
  const mudar = <K extends keyof FiltroRoteiros>(k: K, v: FiltroRoteiros[K]): void => setFiltro((f) => ({ ...f, [k]: v }))
  const filtrosAtivos =
    filtro.status !== null || filtro.tipoVideo !== null || filtro.palavraChave !== '' || filtro.dataDe !== null || filtro.dataAte !== null || filtro.situacao !== 'ativos'

  async function acao(r: RoteiroResumo, tipo: 'duplicar' | 'arquivar' | 'restaurar' | 'excluir'): Promise<void> {
    try {
      if (tipo === 'excluir') {
        const ok = await confirmar({
          titulo: 'Excluir roteiro definitivamente?',
          texto: `"${r.titulo}" e todas as suas ${r.versaoAtual} versões, fontes vinculadas e comentários serão apagados. Esta ação não pode ser desfeita. Se quiser apenas tirar da lista, use Arquivar.`,
          confirmar: 'Excluir',
          perigo: true
        })
        if (!ok) return
        await chamar('roteiros:excluir', { id: r.id })
        avisar('Roteiro excluído.')
      } else if (tipo === 'duplicar') {
        const c = await chamar('roteiros:duplicar', { id: r.id })
        avisar(`Criado "${c.titulo}".`)
      } else {
        await chamar(tipo === 'arquivar' ? 'roteiros:arquivar' : 'roteiros:restaurar', { id: r.id })
        avisar(tipo === 'arquivar' ? 'Roteiro arquivado.' : 'Roteiro restaurado.')
      }
      lista.recarregar()
    } catch (e) {
      avisarErro(mensagemDeErro(e))
    }
  }

  return (
    <>
      <Cabecalho
        titulo="Biblioteca de roteiros"
        descricao="Todos os roteiros ficam guardados aqui, com versões e fontes."
        acoes={
          <button className="botao primario" onClick={() => setNovo(true)}>
            <Icone nome="mais" tamanho={18} /> Novo roteiro
          </button>
        }
      />
      <div className="filtros">
        <div className="busca" style={{ minWidth: 260 }}>
          <Icone nome="buscar" tamanho={20} />
          <input
            ref={busca}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Buscar título, tema, texto ou palavra-chave"
            title="Atalho: tecla /"
            aria-label="Buscar roteiros"
          />
        </div>
        <Campo rotulo="Status">
          <select className="entrada" value={filtro.status ?? ''} onChange={(e) => mudar('status', (e.target.value || null) as FiltroRoteiros['status'])}>
            <option value="">Todos</option>
            {STATUS_ROTEIRO.map((s) => (
              <option key={s} value={s}>
                {ROTULO_STATUS_ROTEIRO[s]}
              </option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="Formato">
          <select className="entrada" value={filtro.tipoVideo ?? ''} onChange={(e) => mudar('tipoVideo', (e.target.value || null) as FiltroRoteiros['tipoVideo'])}>
            <option value="">Todos</option>
            {TIPOS_VIDEO.map((t) => (
              <option key={t} value={t}>
                {ROTULO_TIPO_VIDEO[t]}
              </option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="Palavra-chave exata">
          <input className="entrada" value={filtro.palavraChave} onChange={(e) => mudar('palavraChave', e.target.value)} maxLength={60} />
        </Campo>
        <Campo rotulo="Data">
          <select className="entrada" value={filtro.campoData} onChange={(e) => mudar('campoData', e.target.value as FiltroRoteiros['campoData'])}>
            <option value="atualizado">Atualização</option>
            <option value="criado">Criação</option>
            <option value="prevista">Prevista</option>
          </select>
        </Campo>
        <Campo rotulo="De">
          <input type="date" className="entrada" value={filtro.dataDe ?? ''} onChange={(e) => mudar('dataDe', e.target.value || null)} />
        </Campo>
        <Campo rotulo="Até">
          <input type="date" className="entrada" value={filtro.dataAte ?? ''} onChange={(e) => mudar('dataAte', e.target.value || null)} />
        </Campo>
        <Campo rotulo="Mostrar">
          <select className="entrada" value={filtro.situacao} onChange={(e) => mudar('situacao', e.target.value as FiltroRoteiros['situacao'])}>
            <option value="ativos">Ativos</option>
            <option value="arquivados">Arquivados</option>
            <option value="todos">Todos</option>
          </select>
        </Campo>
        <Campo rotulo="Ordenar por">
          <select className="entrada" value={filtro.ordem} onChange={(e) => mudar('ordem', e.target.value as FiltroRoteiros['ordem'])}>
            {Object.entries(ROTULO_ORDEM).map(([v, r]) => (
              <option key={v} value={v}>
                {r}
              </option>
            ))}
          </select>
        </Campo>
        {(filtrosAtivos || texto) && (
          <button
            className="botao fantasma"
            onClick={() => {
              setTexto('')
              setFiltro(FILTRO_INICIAL)
            }}
          >
            Limpar filtros
          </button>
        )}
      </div>

      <Secao>
        {lista.erro && <ErroCarregar mensagem={lista.erro} tentarNovamente={lista.recarregar} />}
        {lista.carregando && !lista.dados && <Carregando />}
        {lista.dados && lista.dados.length === 0 && (
          <Vazio
            titulo={filtrosAtivos || texto ? 'Nenhum roteiro encontrado' : 'A biblioteca está vazia'}
            texto={filtrosAtivos || texto ? 'Tente outros termos ou limpe os filtros.' : 'Crie seu primeiro roteiro para começar.'}
          />
        )}
        {lista.dados && lista.dados.length > 0 && (
          <div className="tabela-wrap">
            <table>
              <thead>
                <tr>
                  <th>Título</th>
                  <th>Formato</th>
                  <th>Status</th>
                  <th>Prevista</th>
                  <th>Atualizado</th>
                  <th>Versão</th>
                  <th>
                    <span className="sr">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {lista.dados.map((r) => (
                  <tr key={r.id} className="clicavel" onClick={() => nav.abrirRoteiro(r.id)}>
                    <td className="td-titulo">
                      {r.titulo}
                      <div className="lista-meta">
                        {r.tema && <span>{r.tema}</span>}
                        {r.palavrasChave.slice(0, 4).map((p) => (
                          <span key={p}>#{p}</span>
                        ))}
                        {r.arquivadoEm && <Etiqueta>Arquivado</Etiqueta>}
                      </div>
                    </td>
                    <td>{ROTULO_TIPO_VIDEO[r.tipoVideo]}</td>
                    <td>
                      <Etiqueta cor={COR_STATUS_ROTEIRO[r.status]}>{ROTULO_STATUS_ROTEIRO[r.status]}</Etiqueta>
                    </td>
                    <td>{formatarData(r.dataPrevista)}</td>
                    <td>{formatarData(r.atualizadoEm)}</td>
                    <td>v{r.versaoAtual}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div className="acoes" style={{ flexWrap: 'nowrap' }}>
                        <button className="botao pequeno fantasma" onClick={() => void acao(r, 'duplicar')}>
                          Duplicar
                        </button>
                        {r.arquivadoEm ? (
                          <button className="botao pequeno fantasma" onClick={() => void acao(r, 'restaurar')}>
                            Restaurar
                          </button>
                        ) : (
                          <button className="botao pequeno fantasma" onClick={() => void acao(r, 'arquivar')}>
                            Arquivar
                          </button>
                        )}
                        <button className="botao pequeno fantasma" onClick={() => void acao(r, 'excluir')}>
                          Excluir
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="secundario pequeno" style={{ marginTop: 12 }}>
              {lista.dados.length} roteiro(s){lista.dados.length === filtro.limite ? ` — mostrando os primeiros ${filtro.limite}; refine a busca para ver outros.` : '.'}
            </p>
          </div>
        )}
      </Secao>
      <NovoRoteiro aberto={novo} aoFechar={() => setNovo(false)} />
    </>
  )
}
