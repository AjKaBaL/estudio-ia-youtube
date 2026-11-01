import { useState } from 'react'
import { chamar, mensagemDeErro, useDados } from '../api'
import { useRetorno } from '../componentes/retorno'
import { Alerta, Campo, Carregando, Dialogo, ErroCarregar, Etiqueta, Secao, Vazio, formatarData } from '../componentes/ui'
import { ROTULO_STATUS_PAUTA, ROTULO_TIPO_VIDEO } from '@shared/dominio'

/** Lotes de pesquisa: por exemplo, pesquisar todos os dias e escolher na lista semanal. */
export function Lotes({ projetoId, abrirPauta }: { projetoId: number; abrirPauta: (id: number) => void }) {
  const { avisar, avisarErro } = useRetorno()
  const lista = useDados(() => chamar('lotes:listar', { projetoId }), [projetoId])
  const [aberto, setAberto] = useState<number | null>(null)
  const [novo, setNovo] = useState(false)

  if (aberto !== null) return <DetalheLote id={aberto} voltar={() => { setAberto(null); lista.recarregar() }} abrirPauta={abrirPauta} />

  return (
    <>
      <div className="filtros">
        <p className="secundario" style={{ margin: 0, flex: 1 }}>
          Mantenha vários lotes em paralelo. O lote semanal reúne as pautas da semana com a meta da agenda (padrão: 1 vídeo longo e 3 Shorts).
        </p>
        <button className="botao" onClick={() => setNovo(true)}>
          Novo lote
        </button>
        <button
          className="botao primario"
          onClick={async () => {
            try {
              const l = await chamar('lotes:gerarSemanal', { projetoId })
              avisar(`Lote “${l.nome}” criado com ${l.totalPautas} pauta(s).`)
              setAberto(l.id)
            } catch (e) {
              avisarErro(mensagemDeErro(e))
            }
          }}
        >
          Gerar lote da semana
        </button>
      </div>
      <Secao>
        {lista.erro && <ErroCarregar mensagem={lista.erro} tentarNovamente={lista.recarregar} />}
        {lista.carregando && !lista.dados && <Carregando />}
        {lista.dados?.length === 0 && <Vazio titulo="Nenhum lote" texto="Gere o lote da semana para escolher as pautas a produzir." />}
        <ul className="lista">
          {lista.dados?.map((l) => (
            <li key={l.id} className="lista-item clicavel" onClick={() => setAberto(l.id)}>
              <div className="lista-principal">
                <div className="lista-titulo">{l.nome}</div>
                <div className="lista-meta">
                  {formatarData(l.inicio)} a {formatarData(l.fim)} · {l.totalPautas} pauta(s) · {l.selecionadas} selecionada(s) · meta {l.metaLongos} longo(s) e {l.metaShorts} Short(s)
                </div>
              </div>
              <Etiqueta cor={l.status === 'aberto' ? 'azul' : 'cinza'}>{l.status === 'aberto' ? 'Aberto' : 'Fechado'}</Etiqueta>
            </li>
          ))}
        </ul>
      </Secao>
      {novo && <NovoLote projetoId={projetoId} aoFechar={(id) => { setNovo(false); if (id) setAberto(id) }} />}
    </>
  )
}

function NovoLote({ projetoId, aoFechar }: { projetoId: number; aoFechar: (id: number | null) => void }) {
  const { avisarErro } = useRetorno()
  const hoje = new Date().toLocaleDateString('sv-SE')
  const [f, setF] = useState({ nome: '', inicio: hoje, fim: hoje, metaLongos: 1, metaShorts: 3 })
  return (
    <Dialogo
      aberto
      aoFechar={() => aoFechar(null)}
      titulo="Novo lote"
      acoes={
        <>
          <button className="botao fantasma" onClick={() => aoFechar(null)}>
            Cancelar
          </button>
          <button
            className="botao primario"
            disabled={!f.nome.trim()}
            onClick={async () => {
              try {
                aoFechar((await chamar('lotes:criar', { projetoId, ...f })).id)
              } catch (e) {
                avisarErro(mensagemDeErro(e))
              }
            }}
          >
            Criar
          </button>
        </>
      }
    >
      <div className="form-grade">
        <Campo rotulo="Nome">
          <input className="entrada" value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} maxLength={120} autoFocus />
        </Campo>
        <Campo rotulo="Início">
          <input type="date" className="entrada" value={f.inicio} onChange={(e) => setF({ ...f, inicio: e.target.value })} />
        </Campo>
        <Campo rotulo="Fim">
          <input type="date" className="entrada" value={f.fim} onChange={(e) => setF({ ...f, fim: e.target.value })} />
        </Campo>
        <Campo rotulo="Meta de vídeos longos">
          <input type="number" min={0} className="entrada" value={f.metaLongos} onChange={(e) => setF({ ...f, metaLongos: Math.max(0, Number(e.target.value) || 0) })} />
        </Campo>
        <Campo rotulo="Meta de Shorts">
          <input type="number" min={0} className="entrada" value={f.metaShorts} onChange={(e) => setF({ ...f, metaShorts: Math.max(0, Number(e.target.value) || 0) })} />
        </Campo>
      </div>
    </Dialogo>
  )
}

function DetalheLote({ id, voltar, abrirPauta }: { id: number; voltar: () => void; abrirPauta: (id: number) => void }) {
  const { avisarErro, confirmar } = useRetorno()
  const lote = useDados(() => chamar('lotes:obter', { id }), [id])
  const pautas = useDados(() => chamar('pautas:listar', { texto: '', status: null }), [])
  const [adicionar, setAdicionar] = useState('')
  const executarSeguro = async (fn: () => Promise<unknown>): Promise<void> => {
    try {
      await fn()
      lote.recarregar()
    } catch (e) {
      avisarErro(mensagemDeErro(e))
    }
  }
  if (lote.erro) return <ErroCarregar mensagem={lote.erro} tentarNovamente={lote.recarregar} />
  if (!lote.dados) return <Carregando />
  const l = lote.dados
  const fechado = l.status === 'fechado'
  const foraDoLote = (pautas.dados ?? []).filter((p) => !l.pautas.some((x) => x.id === p.id))

  return (
    <>
      <Secao
        titulo={l.nome}
        acoes={
          <div className="acoes">
            <button className="botao pequeno" onClick={voltar}>
              Voltar
            </button>
            <button className="botao pequeno" onClick={() => void executarSeguro(() => chamar('lotes:fechar', { id, fechado: !fechado }))}>
              {fechado ? 'Reabrir' : 'Fechar lote'}
            </button>
            <button
              className="botao pequeno fantasma"
              onClick={() =>
                void executarSeguro(async () => {
                  if (!(await confirmar({ titulo: 'Excluir lote?', texto: 'Só o lote é excluído; as pautas continuam guardadas.', confirmar: 'Excluir', perigo: true }))) return
                  await chamar('lotes:excluir', { id })
                  voltar()
                })
              }
            >
              Excluir
            </button>
          </div>
        }
      >
        <p className="secundario">
          {formatarData(l.inicio)} a {formatarData(l.fim)} · selecionados: {l.selecaoLongos} de {l.metaLongos} vídeo(s) longo(s) e {l.selecaoShorts} de {l.metaShorts} Short(s)
        </p>
        {l.alertas.map((a) => (
          <Alerta key={a}>{a}</Alerta>
        ))}
      </Secao>
      <Secao titulo="Pautas do lote (por pontuação estimada)">
        {l.pautas.length === 0 && <Vazio compacto titulo="Lote vazio" />}
        <ul className="lista">
          {l.pautas.map((p) => (
            <li key={p.id} className="lista-item">
              <input
                type="checkbox"
                aria-label={`Selecionar ${p.titulo}`}
                checked={p.selecionada}
                disabled={fechado}
                onChange={(e) => void executarSeguro(() => chamar('lotes:selecionar', { loteId: id, pautaId: p.id, selecionada: e.target.checked }))}
                style={{ width: 16, height: 16, accentColor: 'var(--azul)' }}
              />
              <strong style={{ width: 32, textAlign: 'center' }}>{p.pontuacao}</strong>
              <div className="lista-principal" style={{ cursor: 'pointer' }} onClick={() => abrirPauta(p.id)}>
                <div className="lista-titulo">{p.titulo}</div>
                <div className="lista-meta">
                  {ROTULO_TIPO_VIDEO[p.tipoEfetivo]} · {ROTULO_STATUS_PAUTA[p.status]}
                  {p.riscosAltos > 0 && <Etiqueta cor="vermelha">{p.riscosAltos} risco(s) alto(s)</Etiqueta>}
                </div>
              </div>
              {!fechado && (
                <button className="botao pequeno fantasma" onClick={() => void executarSeguro(() => chamar('lotes:removerPauta', { loteId: id, pautaId: p.id }))}>
                  Tirar do lote
                </button>
              )}
            </li>
          ))}
        </ul>
        {!fechado && foraDoLote.length > 0 && (
          <div className="form-linha" style={{ marginTop: 12 }}>
            <Campo rotulo="Adicionar pauta">
              <select className="entrada" value={adicionar} onChange={(e) => setAdicionar(e.target.value)}>
                <option value="">Escolha…</option>
                {foraDoLote.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.titulo}
                  </option>
                ))}
              </select>
            </Campo>
            <button className="botao" disabled={!adicionar} onClick={() => void executarSeguro(async () => { await chamar('lotes:adicionarPauta', { loteId: id, pautaId: Number(adicionar) }); setAdicionar('') })}>
              Adicionar
            </button>
          </div>
        )}
      </Secao>
    </>
  )
}
