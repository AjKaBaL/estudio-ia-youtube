import { useState } from 'react'
import { chamar, mensagemDeErro, useDados } from '../api'
import { Icone } from '../componentes/Icone'
import { useRetorno } from '../componentes/retorno'
import { Alerta, Cabecalho, Campo, Carregando, Dialogo, ErroCarregar, Etiqueta, Secao, Vazio, formatarData, type CorEtiqueta } from '../componentes/ui'
import { ROTULO_STATUS_PAUTA, ROTULO_TIPO_FONTE, ROTULO_TIPO_VIDEO, STATUS_PAUTA, type StatusPauta, type TipoVideo } from '@shared/dominio'
import { ROTULO_FATOR, type PesosPlanejador } from '@shared/planejador'
import type { Pauta, PautaDetalhe } from '@shared/tipos'
import { Dossie } from './Dossie'
import { Lotes } from './Lotes'
import { NovoRoteiro } from './NovoRoteiro'
import { DialogoGeracao } from './Geracao'
import { FontesEOpcoes, HistoricoPesquisas, PainelPesquisar } from './Pesquisa'

export const COR_PAUTA: Record<StatusPauta, CorEtiqueta> = { ideia: 'cinza', aprovada: 'verde', descartada: 'vermelha' }
const COR_RISCO = { alto: 'vermelha', medio: 'amarela', baixo: 'cinza' } as const

type AbaPautas = 'pautas' | 'lotes' | 'pesquisar' | 'historico' | 'fontes'

let pedido: { aba?: AbaPautas; pauta?: number } = {}
/** Outra tela (ex.: o painel) pede que Pautas abra numa aba ou direto numa pauta. */
export function pedirPautas(p: { aba?: AbaPautas; pauta?: number }): void {
  pedido = p
}

export function Pautas() {
  const projetos = useDados(() => chamar('projetos:listar'), [])
  const [inicial] = useState(() => {
    const p = pedido
    pedido = {}
    return p
  })
  const [aba, setAba] = useState<AbaPautas>(inicial.aba ?? 'pautas')
  const [abrirExecucao, setAbrirExecucao] = useState<number | null>(null)
  const [pautaAberta, setPautaAberta] = useState<number | null>(inicial.pauta ?? null)
  const projetoId = projetos.dados?.[0]?.id ?? null

  if (pautaAberta !== null) return <DetalhePauta id={pautaAberta} voltar={() => setPautaAberta(null)} abrir={setPautaAberta} />

  return (
    <>
      <Cabecalho titulo="Pautas e pesquisas" descricao="Ideias de vídeo, pesquisas online, fontes e lotes de seleção." />
      {projetos.dados?.length === 0 && <Alerta>Crie um projeto em Configurações para registrar pautas e pesquisar.</Alerta>}
      <div className="abas" role="tablist">
        {(
          [
            ['pautas', 'Pautas'],
            ['lotes', 'Lotes'],
            ['pesquisar', 'Pesquisar'],
            ['historico', 'Histórico de pesquisas'],
            ['fontes', 'Fontes e opções']
          ] as const
        ).map(([v, r]) => (
          <button key={v} role="tab" className="aba" aria-selected={aba === v} onClick={() => setAba(v)}>
            {r}
          </button>
        ))}
      </div>
      {aba === 'pautas' && projetoId && <ListaPautas projetoId={projetoId} abrir={setPautaAberta} />}
      {aba === 'lotes' && projetoId && <Lotes projetoId={projetoId} abrirPauta={setPautaAberta} />}
      {aba === 'pesquisar' && projetoId && (
        <PainelPesquisar
          projetoId={projetoId}
          aoConcluir={(id) => {
            setAbrirExecucao(id)
            setAba('historico')
          }}
        />
      )}
      {aba === 'historico' && projetoId && <HistoricoPesquisas key={abrirExecucao ?? 0} projetoId={projetoId} abrirId={abrirExecucao} aoCriarPauta={setPautaAberta} />}
      {aba === 'fontes' && projetoId && <FontesEOpcoes projetoId={projetoId} />}
    </>
  )
}

function ListaPautas({ projetoId, abrir }: { projetoId: number; abrir: (id: number) => void }) {
  const { avisar, avisarErro, confirmar } = useRetorno()
  const [texto, setTexto] = useState('')
  const [status, setStatus] = useState<StatusPauta | null>(null)
  const [mostrarCombinadas, setMostrarCombinadas] = useState(false)
  const lista = useDados(() => chamar('pautas:listar', { texto, status, incluirCombinadas: mostrarCombinadas }), [texto, status, mostrarCombinadas])
  const [nova, setNova] = useState(false)
  const [selecionadas, setSelecionadas] = useState<number[]>([])
  const [combinar, setCombinar] = useState<string | null>(null)
  const [pesos, setPesos] = useState(false)
  const [ultimo, setUltimo] = useState<number | null>(null)
  const visiveis = (lista.dados ?? []).filter((p) => p.combinadaEm === null).map((p) => p.id)
  // Shift + clique marca (ou desmarca) todo o intervalo desde o último clique, como no Explorador do Windows.
  const alternar = (id: number, shift: boolean): void => {
    setSelecionadas((s) => {
      const marcar = !s.includes(id)
      const de = ultimo === null ? -1 : visiveis.indexOf(ultimo)
      const ate = visiveis.indexOf(id)
      const faixa = shift && de >= 0 && ate >= 0 ? visiveis.slice(Math.min(de, ate), Math.max(de, ate) + 1) : [id]
      return marcar ? [...new Set([...s, ...faixa])] : s.filter((x) => !faixa.includes(x))
    })
    setUltimo(id)
  }
  const todasMarcadas = visiveis.length > 0 && visiveis.every((id) => selecionadas.includes(id))
  const apagar = async (): Promise<void> => {
    const n = selecionadas.length
    const ok = await confirmar({
      titulo: `Apagar ${n} pauta(s)?`,
      texto: 'As pautas selecionadas serão excluídas. As que estão em produção na agenda ou ligadas a um vídeo publicado ficam. Roteiros e pesquisas continuam guardados.',
      confirmar: 'Apagar',
      perigo: true
    })
    if (!ok) return
    try {
      const r = await chamar('pautas:excluirVarias', { ids: selecionadas })
      setSelecionadas([])
      lista.recarregar()
      avisar(`${r.excluidas} pauta(s) apagada(s).${r.mantidas ? ` ${r.mantidas} mantida(s) por estarem em produção ou publicadas.` : ''}`)
    } catch (err) {
      avisarErro(mensagemDeErro(err))
    }
  }

  return (
    <>
      <div className="filtros">
        <div className="busca">
          <Icone nome="buscar" tamanho={20} />
          <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar pautas" aria-label="Buscar pautas" />
        </div>
        <div className="chips" role="group" aria-label="Filtrar por status">
          <button className="chip" aria-pressed={status === null} onClick={() => setStatus(null)}>
            Todas
          </button>
          {STATUS_PAUTA.map((s) => (
            <button key={s} className="chip" aria-pressed={status === s} onClick={() => setStatus(s)}>
              {ROTULO_STATUS_PAUTA[s]}
            </button>
          ))}
        </div>
        <label className="checkbox pequeno">
          <input type="checkbox" checked={mostrarCombinadas} onChange={(e) => setMostrarCombinadas(e.target.checked)} />
          Mostrar combinadas
        </label>
        <span style={{ flex: 1 }} />
        <button className="botao fantasma" onClick={() => setPesos(true)}>
          Critérios da pontuação
        </button>
        <label className="checkbox pequeno" title="Dica: clique numa pauta e depois Shift + clique em outra para marcar todas entre elas">
          <input type="checkbox" checked={todasMarcadas} onChange={() => setSelecionadas(todasMarcadas ? [] : visiveis)} />
          Selecionar todas
        </label>
        {selecionadas.length >= 1 && (
          <button className="botao perigo" onClick={() => void apagar()}>
            Apagar {selecionadas.length}
          </button>
        )}
        {selecionadas.length >= 2 && selecionadas.length <= 10 && (
          <button className="botao" onClick={() => setCombinar('')}>
            Combinar {selecionadas.length}
          </button>
        )}
        <button className="botao primario" onClick={() => setNova(true)}>
          <Icone nome="mais" tamanho={18} /> Nova pauta
        </button>
      </div>
      <Secao>
        {lista.erro && <ErroCarregar mensagem={lista.erro} tentarNovamente={lista.recarregar} />}
        {lista.carregando && !lista.dados && <Carregando />}
        {lista.dados?.length === 0 && (
          <Vazio titulo="Nenhuma pauta" texto={texto || status ? 'Nada encontrado com esses filtros.' : 'Crie uma pauta manualmente ou a partir de resultados de pesquisa (aba Histórico).'} />
        )}
        <ul className="lista">
          {lista.dados?.map((p) => (
            <li key={p.id} className="lista-item clicavel" onClick={() => abrir(p.id)}>
              <input
                type="checkbox"
                aria-label={`Selecionar ${p.titulo}`}
                checked={selecionadas.includes(p.id)}
                onClick={(e) => {
                  e.stopPropagation()
                  alternar(p.id, e.shiftKey)
                }}
                onChange={() => undefined}
                disabled={p.combinadaEm !== null}
                style={{ width: 16, height: 16, accentColor: 'var(--azul)' }}
              />
              <Nota valor={p.pontuacao} />
              <div className="lista-principal">
                <div className="lista-titulo">{p.titulo}</div>
                <div className="lista-meta">
                  {p.tipoSugerido && <span>{ROTULO_TIPO_VIDEO[p.tipoSugerido]}</span>}
                  {p.perguntaCentral && <span>· {p.perguntaCentral}</span>}
                  {p.palavrasChave.slice(0, 4).map((k) => (
                    <span key={k}>#{k}</span>
                  ))}
                  <span>· {formatarData(p.atualizadoEm)}</span>
                  {p.riscosAltos > 0 && <Etiqueta cor="vermelha">{p.riscosAltos} risco(s) alto(s)</Etiqueta>}
                  {p.naFilaPesquisa && <Etiqueta cor="azul">Na fila de pesquisa</Etiqueta>}
                  {p.combinadaEm !== null && <Etiqueta>Combinada</Etiqueta>}
                </div>
              </div>
              <Etiqueta cor={COR_PAUTA[p.status]}>{ROTULO_STATUS_PAUTA[p.status]}</Etiqueta>
            </li>
          ))}
        </ul>
      </Secao>
      {nova && (
        <NovaPauta
          projetoId={projetoId}
          aoFechar={(id) => {
            setNova(false)
            if (id) abrir(id)
          }}
        />
      )}
      <Dialogo
        aberto={combinar !== null}
        aoFechar={() => setCombinar(null)}
        titulo={`Combinar ${selecionadas.length} pautas`}
        acoes={
          <>
            <button className="botao fantasma" onClick={() => setCombinar(null)}>
              Cancelar
            </button>
            <button
              className="botao primario"
              disabled={!combinar?.trim()}
              onClick={async () => {
                try {
                  const c = await chamar('pautas:combinar', { ids: selecionadas, titulo: combinar ?? '' })
                  setCombinar(null)
                  setSelecionadas([])
                  avisar('Pautas combinadas. As originais foram preservadas.')
                  abrir(c.id)
                } catch (e) {
                  avisarErro(mensagemDeErro(e))
                }
              }}
            >
              Combinar
            </button>
          </>
        }
      >
        <p className="secundario">Uma nova pauta reunirá fontes, notas e palavras-chave. As pautas originais não são alteradas; ficam marcadas como “combinadas”.</p>
        <Campo rotulo="Título da nova pauta">
          <input className="entrada" value={combinar ?? ''} onChange={(e) => setCombinar(e.target.value)} maxLength={200} autoFocus />
        </Campo>
      </Dialogo>
      {pesos && <DialogoPesos aoFechar={() => { setPesos(false); lista.recarregar() }} />}
    </>
  )
}

function Nota({ valor }: { valor: number }) {
  return (
    <div style={{ width: 44, textAlign: 'center' }} title="Pontuação estimada por critérios configuráveis (0–100)">
      <div style={{ fontSize: 18, fontWeight: 700 }}>{valor}</div>
      <div className="secundario" style={{ fontSize: 10 }}>estimativa</div>
    </div>
  )
}

function NovaPauta({ projetoId, aoFechar }: { projetoId: number; aoFechar: (id: number | null) => void }) {
  const { avisarErro } = useRetorno()
  const [titulo, setTitulo] = useState('')
  const [pergunta, setPergunta] = useState('')
  return (
    <Dialogo
      aberto
      aoFechar={() => aoFechar(null)}
      titulo="Nova pauta"
      acoes={
        <>
          <button className="botao fantasma" onClick={() => aoFechar(null)}>
            Cancelar
          </button>
          <button
            className="botao primario"
            disabled={!titulo.trim()}
            onClick={async () => {
              try {
                const p = await chamar('pautas:criar', { projetoId, titulo, perguntaCentral: pergunta })
                aoFechar(p.id)
              } catch (e) {
                avisarErro(mensagemDeErro(e))
              }
            }}
          >
            Criar e abrir
          </button>
        </>
      }
    >
      <div style={{ display: 'grid', gap: 12 }}>
        <Campo rotulo="Título de trabalho">
          <input className="entrada" value={titulo} onChange={(e) => setTitulo(e.target.value)} maxLength={200} autoFocus />
        </Campo>
        <Campo rotulo="Pergunta central que o vídeo responde">
          <input className="entrada" value={pergunta} onChange={(e) => setPergunta(e.target.value)} maxLength={500} />
        </Campo>
      </div>
    </Dialogo>
  )
}

function DialogoPesos({ aoFechar }: { aoFechar: () => void }) {
  const { avisar, avisarErro } = useRetorno()
  const dados = useDados(() => chamar('planejador:pesos'), [])
  const [p, setP] = useState<PesosPlanejador | null>(null)
  const atual = p ?? dados.dados?.pesos ?? null
  const rotulos: Record<keyof PesosPlanejador, string> = {
    ...ROTULO_FATOR,
    penalidadeRiscoAlto: 'Penalidade por risco alto (pontos)',
    penalidadeRiscoMedio: 'Penalidade por risco médio (pontos)',
    penalidadeSemelhanca: 'Penalidade por tema semelhante (pontos)'
  }
  return (
    <Dialogo
      aberto
      aoFechar={aoFechar}
      titulo="Critérios da pontuação"
      acoes={
        <>
          <button className="botao fantasma" onClick={() => dados.dados && setP(dados.dados.padrao)}>
            Restaurar padrão
          </button>
          <button
            className="botao primario"
            disabled={!atual}
            onClick={async () => {
              try {
                await chamar('planejador:salvarPesos', atual!)
                avisar('Critérios salvos.')
                aoFechar()
              } catch (e) {
                avisarErro(mensagemDeErro(e))
              }
            }}
          >
            Salvar
          </button>
        </>
      }
    >
      <p className="secundario pequeno">Pesos de 0 a 10. A pontuação organiza critérios editoriais; não prevê visualizações.</p>
      {atual && (
        <div className="form-grade">
          {(Object.keys(rotulos) as (keyof PesosPlanejador)[]).map((k) => (
            <Campo key={k} rotulo={rotulos[k]}>
              <input type="number" className="entrada" min={0} max={k.startsWith('penalidade') ? 50 : 10} step={0.5} value={atual[k]} onChange={(e) => setP({ ...atual, [k]: Math.max(0, Number(e.target.value) || 0) })} />
            </Campo>
          ))}
        </div>
      )}
    </Dialogo>
  )
}

// ------------------------------------------------------------------ detalhe

type AbaDetalhe = 'cartao' | 'fontes' | 'dossie'

function DetalhePauta({ id, voltar, abrir }: { id: number; voltar: () => void; abrir: (id: number) => void }) {
  const dados = useDados(() => chamar('pautas:obter', { id }), [id])
  if (dados.erro) return <ErroCarregar mensagem={dados.erro} tentarNovamente={dados.recarregar} />
  if (!dados.dados || dados.dados.id !== id) return <Carregando />
  return <DetalheCarregado key={`${id}-${dados.dados.atualizadoEm}`} inicial={dados.dados} voltar={voltar} abrir={abrir} recarregar={dados.recarregar} />
}

function DetalheCarregado({ inicial, voltar, abrir, recarregar }: { inicial: PautaDetalhe; voltar: () => void; abrir: (id: number) => void; recarregar: () => void }) {
  const { avisar, avisarErro, confirmar } = useRetorno()
  const [p, setP] = useState(inicial)
  const [aba, setAba] = useState<AbaDetalhe>('cartao')
  const [f, setF] = useState({
    titulo: inicial.titulo,
    perguntaCentral: inicial.perguntaCentral,
    resumo: inicial.resumo,
    publico: inicial.publico,
    tema: inicial.tema,
    notas: inicial.notas,
    palavras: inicial.palavrasChave.join(', '),
    tipoSugerido: inicial.tipoSugerido,
    potencialNarrativa: inicial.potencialNarrativa
  })
  const [roteiro, setRoteiro] = useState(false)
  const [gerar, setGerar] = useState(false)
  const alterado =
    f.titulo !== p.titulo || f.perguntaCentral !== p.perguntaCentral || f.resumo !== p.resumo || f.publico !== p.publico || f.tema !== p.tema ||
    f.notas !== p.notas || f.palavras !== p.palavrasChave.join(', ') || f.tipoSugerido !== p.tipoSugerido || f.potencialNarrativa !== p.potencialNarrativa

  const executarSeguro = async (fn: () => Promise<void>): Promise<void> => {
    try {
      await fn()
    } catch (e) {
      avisarErro(mensagemDeErro(e))
    }
  }
  const salvar = (): Promise<void> =>
    executarSeguro(async () => {
      const r = await chamar('pautas:atualizar', {
        id: p.id,
        status: p.status,
        titulo: f.titulo,
        perguntaCentral: f.perguntaCentral,
        resumo: f.resumo,
        publico: f.publico,
        tema: f.tema,
        notas: f.notas,
        palavrasChave: f.palavras.split(',').map((x) => x.trim()).filter(Boolean),
        tipoSugerido: f.tipoSugerido,
        potencialNarrativa: f.potencialNarrativa
      })
      setP(r)
      avisar('Pauta salva.')
    })
  const a = p.avaliacao

  return (
    <>
      <header className="cabecalho">
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', minWidth: 0 }}>
          <button className="botao botao-icone fantasma" onClick={voltar} aria-label="Voltar">
            <Icone nome="voltar" />
          </button>
          <div style={{ minWidth: 0 }}>
            <h1>{p.titulo}</h1>
            <p>
              <Etiqueta cor={COR_PAUTA[p.status]}>{ROTULO_STATUS_PAUTA[p.status]}</Etiqueta> · criada {formatarData(p.criadoEm)} · origem: {p.origem}
              {p.combinadaEm !== null && (
                <>
                  {' '}
                  ·{' '}
                  <button className="botao pequeno fantasma" onClick={() => abrir(p.combinadaEm!)}>
                    Combinada na pauta nº {p.combinadaEm}
                  </button>
                </>
              )}
            </p>
          </div>
        </div>
        <div className="acoes">
          {p.status !== 'aprovada' && (
            <button className="botao" onClick={() => void executarSeguro(async () => setP(await chamar('pautas:alterarStatus', { id: p.id, status: 'aprovada' })))}>
              Aprovar
            </button>
          )}
          {p.status !== 'descartada' && (
            <button className="botao" onClick={() => void executarSeguro(async () => setP(await chamar('pautas:alterarStatus', { id: p.id, status: 'descartada' })))}>
              Rejeitar
            </button>
          )}
          <button
            className="botao"
            disabled={p.naFilaPesquisa}
            onClick={() =>
              void executarSeguro(async () => {
                setP(await chamar('pautas:filaPesquisa', { id: p.id }))
                avisar('Pauta colocada na fila de pesquisa.')
              })
            }
          >
            {p.naFilaPesquisa ? 'Na fila de pesquisa' : 'Pesquisar mais'}
          </button>
          <button className="botao" onClick={() => setRoteiro(true)}>
            Roteiro em branco
          </button>
          <button className="botao" disabled={p.status !== 'aprovada'} title={p.status !== 'aprovada' ? 'Aprove a pauta para gerar' : undefined} onClick={() => setGerar(true)}>
            Gerar roteiro
          </button>
          <button className="botao primario" disabled={!alterado} onClick={() => void salvar()}>
            Salvar
          </button>
        </div>
      </header>
      <div className="abas" role="tablist">
        {(
          [
            ['cartao', 'Cartão da pauta'],
            ['fontes', `Fontes preliminares (${p.fontes.length})`],
            ['dossie', 'Dossiê de verificação']
          ] as const
        ).map(([v, r]) => (
          <button key={v} role="tab" className="aba" aria-selected={aba === v} onClick={() => setAba(v)}>
            {r}
          </button>
        ))}
      </div>

      {aba === 'cartao' && (
        <div className="editor">
          <div>
            <Secao titulo="Ideia">
              <div style={{ display: 'grid', gap: 12 }}>
                <Campo rotulo="Título de trabalho">
                  <input className="entrada" value={f.titulo} onChange={(e) => setF({ ...f, titulo: e.target.value })} maxLength={200} />
                </Campo>
                <Campo rotulo="Pergunta central que o vídeo responde">
                  <input className="entrada" value={f.perguntaCentral} onChange={(e) => setF({ ...f, perguntaCentral: e.target.value })} maxLength={500} />
                </Campo>
                <Campo rotulo="Resumo da ideia e por que seria interessante">
                  <textarea className="entrada" rows={5} value={f.resumo} onChange={(e) => setF({ ...f, resumo: e.target.value })} maxLength={5000} />
                </Campo>
                <div className="form-grade">
                  <Campo rotulo="Público-alvo provável">
                    <input className="entrada" value={f.publico} onChange={(e) => setF({ ...f, publico: e.target.value })} maxLength={300} />
                  </Campo>
                  <Campo rotulo="Tema">
                    <input className="entrada" value={f.tema} onChange={(e) => setF({ ...f, tema: e.target.value })} maxLength={200} />
                  </Campo>
                  <Campo rotulo="Tipo" ajuda={`Sugestão automática: ${ROTULO_TIPO_VIDEO[a.tipoSugerido.tipo]} — ${a.tipoSugerido.motivo}`}>
                    <select className="entrada" value={f.tipoSugerido ?? ''} onChange={(e) => setF({ ...f, tipoSugerido: (e.target.value || null) as TipoVideo | null })}>
                      <option value="">Automático</option>
                      <option value="longo">Vídeo longo</option>
                      <option value="short">Short</option>
                    </select>
                  </Campo>
                  <Campo rotulo="Potencial de narrativa (sua nota)">
                    <select className="entrada" value={f.potencialNarrativa ?? ''} onChange={(e) => setF({ ...f, potencialNarrativa: e.target.value ? Number(e.target.value) : null })}>
                      <option value="">Não avaliado</option>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <option key={n} value={n}>
                          {n} de 5
                        </option>
                      ))}
                    </select>
                  </Campo>
                </div>
                <Campo rotulo="Palavras-chave" ajuda="Separe por vírgulas. Usadas em “Pesquisar mais”.">
                  <input className="entrada" value={f.palavras} onChange={(e) => setF({ ...f, palavras: e.target.value })} />
                </Campo>
                <Campo rotulo="Notas">
                  <textarea className="entrada" rows={3} value={f.notas} onChange={(e) => setF({ ...f, notas: e.target.value })} maxLength={5000} />
                </Campo>
              </div>
            </Secao>
          </div>
          <aside>
            <Secao titulo={`Pontuação: ${a.pontuacao.total}`}>
              <p className="secundario pequeno">{a.pontuacao.aviso}</p>
              <ul className="lista">
                {a.pontuacao.fatores.map((x) => (
                  <li key={x.chave} className="lista-item" style={{ padding: '6px 0' }}>
                    <div className="lista-principal">
                      <div style={{ fontSize: 13 }}>{x.rotulo}</div>
                      <div className="lista-meta">{x.explicacao} · peso {x.peso}</div>
                    </div>
                    <strong>+{x.contribuicao.toFixed(1)}</strong>
                  </li>
                ))}
                {a.pontuacao.penalidades.map((x, i) => (
                  <li key={i} className="lista-item" style={{ padding: '6px 0' }}>
                    <div className="lista-principal lista-meta">{x.motivo}</div>
                    <strong style={{ color: 'var(--vermelho-suave)' }}>−{x.pontos}</strong>
                  </li>
                ))}
              </ul>
            </Secao>
            <Secao titulo="Avaliação">
              <div style={{ display: 'grid', gap: 8, fontSize: 13 }}>
                <div>
                  <strong>Atualidade:</strong> {a.atualidade.rotulo}. <span className="secundario">{a.atualidade.janela}</span>
                </div>
                <div>
                  <strong>Complexidade:</strong> {a.complexidade.rotulo} <span className="secundario">({a.complexidade.motivo})</span>
                </div>
                <div>
                  <strong>Custo de produção:</strong> {a.custo.rotulo}. <span className="secundario">{a.custo.motivo}</span>
                </div>
              </div>
              <h3 style={{ marginTop: 12 }}>Riscos</h3>
              {a.riscos.length === 0 ? (
                <p className="secundario pequeno">Nenhum risco identificado pelas regras automáticas (isso não garante ausência de problemas).</p>
              ) : (
                a.riscos.map((r) => (
                  <div key={r.codigo} style={{ display: 'flex', gap: 8, marginBottom: 6, fontSize: 13 }}>
                    <Etiqueta cor={COR_RISCO[r.nivel]}>{r.nivel}</Etiqueta>
                    <span>{r.mensagem}</span>
                  </div>
                ))
              )}
              {a.recomendacao && <Alerta tipo="info">{a.recomendacao}</Alerta>}
              {a.semelhantes.length > 0 && (
                <>
                  <h3 style={{ marginTop: 12 }}>Conteúdos parecidos</h3>
                  <ul className="secundario pequeno">
                    {a.semelhantes.map((s) => (
                      <li key={`${s.tipo}${s.id}`}>
                        {s.tipo === 'roteiro' ? 'Roteiro' : 'Pauta'}: {s.titulo} ({Math.round(s.similaridade * 100)}%)
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Secao>
            <Secao>
              <button
                className="botao perigo"
                onClick={() =>
                  void executarSeguro(async () => {
                    const ok = await confirmar({ titulo: 'Excluir pauta?', texto: `"${p.titulo}" será excluída. Roteiros e pesquisas ligados a ela continuam guardados.`, confirmar: 'Excluir', perigo: true })
                    if (!ok) return
                    await chamar('pautas:excluir', { id: p.id })
                    avisar('Pauta excluída.')
                    voltar()
                  })
                }
              >
                Excluir pauta
              </button>
            </Secao>
          </aside>
        </div>
      )}

      {aba === 'fontes' && (
        <Secao titulo="Fontes preliminares">
          <p className="secundario pequeno">Resultados de pesquisa ligados a esta pauta. Para adicionar, use “Criar pauta” ou “Adicionar à pauta” no histórico de pesquisas.</p>
          {p.fontes.length === 0 && <Vazio compacto titulo="Nenhuma fonte preliminar" />}
          <ul className="lista">
            {p.fontes.map((r) => (
              <li key={r.id} className="lista-item">
                <div className="lista-principal">
                  <a className="lista-titulo" href={r.url} target="_blank" rel="noreferrer noopener" style={{ display: 'block' }}>
                    {r.titulo}
                  </a>
                  <div className="lista-meta">
                    <span>{r.dominio}</span>
                    <span>· {ROTULO_TIPO_FONTE[r.tipoFonte]}</span>
                    <span>· publicado {r.publicadaEm ? formatarData(r.publicadaEm) : 'sem data'}</span>
                    <span>· acesso {formatarData(r.acessadaEm)}</span>
                  </div>
                </div>
                <button
                  className="botao pequeno fantasma"
                  onClick={() => void executarSeguro(async () => setP(await chamar('pautas:removerResultado', { pautaId: p.id, resultadoId: r.id })))}
                >
                  Desvincular
                </button>
              </li>
            ))}
          </ul>
        </Secao>
      )}

      {aba === 'dossie' && <Dossie pautaId={p.id} fontesPreliminares={p.fontes} aoMudar={recarregar} />}

      <NovoRoteiro aberto={roteiro} aoFechar={() => setRoteiro(false)} pautaId={p.id} tituloInicial={p.titulo} />
      {gerar && <DialogoGeracao pautaId={p.id} tipoInicial={a.tipoSugerido.tipo} aoFechar={() => setGerar(false)} />}
    </>
  )
}

export type { Pauta }
