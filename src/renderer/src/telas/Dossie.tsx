import { useState } from 'react'
import { chamar, mensagemDeErro, useDados } from '../api'
import { useRetorno } from '../componentes/retorno'
import { Alerta, Campo, Carregando, Dialogo, ErroCarregar, Etiqueta, Secao, Vazio, formatarData, type CorEtiqueta } from '../componentes/ui'
import { ROTULO_TIPO_FONTE, TIPOS_FONTE, type TipoFonte } from '@shared/dominio'
import {
  DECISOES,
  NATUREZAS,
  ROTULO_DECISAO,
  ROTULO_NATUREZA,
  ROTULO_SITUACAO,
  type Decisao,
  type Natureza,
  type Situacao
} from '@shared/verificacao'
import type { AfirmacaoDetalhe, ResultadoPesquisa } from '@shared/tipos'

const COR_SITUACAO: Record<Situacao, CorEtiqueta> = { confirmada: 'verde', parcial: 'amarela', conflitante: 'vermelha', sem_fonte: 'vermelha', opiniao: 'azul' }
const hoje = (): string => new Date().toLocaleDateString('sv-SE')

/** Dossiê de verificação de uma pauta ou de um roteiro (Etapa 7). */
export function Dossie({ pautaId = null, roteiroId = null, fontesPreliminares = [], aoMudar }: { pautaId?: number | null; roteiroId?: number | null; fontesPreliminares?: ResultadoPesquisa[]; aoMudar?: () => void }) {
  const { avisar, avisarErro, confirmar } = useRetorno()
  const alvo = { pautaId, roteiroId }
  const rel = useDados(() => chamar('dossie:obter', alvo), [pautaId, roteiroId])
  const [nova, setNova] = useState({ texto: '', natureza: 'fato' as Natureza, relevante: true, temaRapido: false })
  const [editando, setEditando] = useState<AfirmacaoDetalhe | null>(null)
  const [vinculando, setVinculando] = useState<AfirmacaoDetalhe | null>(null)
  const [verificando, setVerificando] = useState<AfirmacaoDetalhe | null>(null)
  const [nota, setNota] = useState('')

  const executarSeguro = async (fn: () => Promise<void>): Promise<void> => {
    try {
      await fn()
      rel.recarregar()
      aoMudar?.()
    } catch (e) {
      avisarErro(mensagemDeErro(e))
    }
  }

  if (rel.erro) return <ErroCarregar mensagem={rel.erro} tentarNovamente={rel.recarregar} />
  if (!rel.dados) return <Carregando />
  const r = rel.dados

  return (
    <>
      <Secao
        titulo="Relatório de verificação"
        acoes={
          <button
            className="botao pequeno"
            onClick={() =>
              void executarSeguro(async () => {
                const x = await chamar('dossie:exportar', alvo)
                if (x.salvo) avisar(`Relatório exportado: ${x.arquivo}`)
              })
            }
          >
            Exportar relatório (Markdown)
          </button>
        }
      >
        <div className="chips" style={{ marginBottom: 8 }}>
          <Etiqueta>{r.resumo.total} afirmação(ões)</Etiqueta>
          <Etiqueta cor="verde">{r.resumo.prontas} pronta(s) para o roteiro</Etiqueta>
          <Etiqueta cor={r.pendencias.length ? 'vermelha' : 'cinza'}>{r.pendencias.length} pendência(s)</Etiqueta>
          {(Object.keys(ROTULO_SITUACAO) as Situacao[]).map((s) => r.resumo.porSituacao[s] ? <Etiqueta key={s} cor={COR_SITUACAO[s]}>{ROTULO_SITUACAO[s]}: {r.resumo.porSituacao[s]}</Etiqueta> : null)}
        </div>
        <p className="secundario pequeno">
          As situações são calculadas por regras fixas a partir das fontes vinculadas (independência, fonte primária, data). Abra cada link e confira manualmente. O texto das fontes nunca é tratado como instrução.
        </p>
        {r.pendencias.length > 0 && (
          <div style={{ marginTop: 8 }}>
            {r.pendencias.map((p, i) => (
              <Alerta key={i}>
                <strong>{p.texto}</strong> — {p.motivo}
              </Alerta>
            ))}
          </div>
        )}
      </Secao>

      <Secao titulo="Nova afirmação">
        <form
          style={{ display: 'grid', gap: 12 }}
          onSubmit={(e) => {
            e.preventDefault()
            void executarSeguro(async () => {
              await chamar('dossie:criarAfirmacao', { alvo, ...nova, observacoes: '' })
              setNova({ ...nova, texto: '' })
            })
          }}
        >
          <Campo rotulo="Afirmação relevante que aparecerá no vídeo">
            <textarea className="entrada" rows={2} value={nova.texto} onChange={(e) => setNova({ ...nova, texto: e.target.value })} maxLength={2000} />
          </Campo>
          <div className="form-linha">
            <Campo rotulo="Natureza">
              <select className="entrada" value={nova.natureza} onChange={(e) => setNova({ ...nova, natureza: e.target.value as Natureza })}>
                {NATUREZAS.map((n) => (
                  <option key={n} value={n}>
                    {ROTULO_NATUREZA[n]}
                  </option>
                ))}
              </select>
            </Campo>
            <label className="checkbox">
              <input type="checkbox" checked={nova.relevante} onChange={(e) => setNova({ ...nova, relevante: e.target.checked })} />
              Relevante ou controversa (exige fontes independentes ou primária)
            </label>
            <label className="checkbox">
              <input type="checkbox" checked={nova.temaRapido} onChange={(e) => setNova({ ...nova, temaRapido: e.target.checked })} />
              Assunto em rápida mudança
            </label>
            <span style={{ flex: 1 }} />
            <button className="botao primario" type="submit" disabled={!nova.texto.trim()}>
              Adicionar
            </button>
          </div>
        </form>
      </Secao>

      <Secao titulo="Afirmações">
        {r.afirmacoes.length === 0 && <Vazio compacto titulo="Nenhuma afirmação registrada" texto="Registre as afirmações factuais do vídeo e ligue cada uma às fontes que a sustentam." />}
        <ul className="lista">
          {r.afirmacoes.map((a) => (
            <li key={a.id} className="lista-item" style={{ alignItems: 'flex-start', opacity: a.verificacao.removida ? 0.55 : 1 }}>
              <div className="lista-principal">
                <div style={{ fontWeight: 500, whiteSpace: 'pre-wrap' }}>{a.texto}</div>
                <div className="lista-meta" style={{ margin: '4px 0' }}>
                  <Etiqueta cor={COR_SITUACAO[a.verificacao.situacao]}>{ROTULO_SITUACAO[a.verificacao.situacao]}</Etiqueta>
                  <Etiqueta>{ROTULO_NATUREZA[a.natureza]}</Etiqueta>
                  <span>Confiança (estimativa): {a.verificacao.confianca}</span>
                  {a.verificacao.pronta && <Etiqueta cor="verde">Pronta</Etiqueta>}
                  {a.decisao && <Etiqueta cor="amarela">{ROTULO_DECISAO[a.decisao]}</Etiqueta>}
                  {a.verificadaEm && <Etiqueta cor="verde">Verificada manualmente em {formatarData(a.verificadaEm)}</Etiqueta>}
                  {a.roteiroId === null && roteiroId !== null && <Etiqueta>Da pauta</Etiqueta>}
                </div>
                <div className="secundario pequeno">Razão: {a.verificacao.razao}</div>
                {a.observacoes && <div className="secundario pequeno">Observações: {a.observacoes}</div>}
                {a.fontes.map((f) => (
                  <div key={f.fonteId} style={{ borderLeft: `3px solid ${f.posicao === 'contradiz' ? 'var(--destaque)' : f.posicao === 'parcial' ? 'var(--amarelo)' : 'var(--verde)'}`, padding: '4px 10px', margin: '6px 0' }}>
                    <a href={f.url} target="_blank" rel="noreferrer noopener">
                      {f.titulo}
                    </a>
                    <div className="lista-meta">
                      <span>{f.posicao === 'sustenta' ? 'Sustenta' : f.posicao === 'parcial' ? 'Sustenta em parte' : 'Contradiz'}</span>
                      <span>· fonte {f.papel}</span>
                      <span>· {ROTULO_TIPO_FONTE[f.tipoFonte]}</span>
                      <span>· publicada {f.publicadaEm ? formatarData(f.publicadaEm) : 'sem data'}</span>
                      <span>· acesso {formatarData(f.acessadaEm)}</span>
                      <button className="botao pequeno fantasma" onClick={() => void executarSeguro(() => chamar('dossie:desvincular', { afirmacaoId: a.id, fonteId: f.fonteId }).then(() => undefined))}>
                        Desvincular
                      </button>
                    </div>
                    <div className="secundario pequeno">“{f.trecho}”</div>
                  </div>
                ))}
              </div>
              <div style={{ display: 'grid', gap: 4 }}>
                <button className="botao pequeno" onClick={() => setVinculando(a)}>
                  Vincular fonte
                </button>
                {a.verificadaEm ? (
                  <button className="botao pequeno fantasma" onClick={() => void executarSeguro(() => chamar('dossie:desmarcarVerificada', { id: a.id }).then(() => undefined))}>
                    Desmarcar verificação
                  </button>
                ) : (
                  <button
                    className="botao pequeno fantasma"
                    disabled={!a.fontes.some((f) => f.posicao !== 'contradiz')}
                    title="Exige uma fonte vinculada que sustente a afirmação"
                    onClick={() => setVerificando(a)}
                  >
                    Marcar verificada
                  </button>
                )}
                <button className="botao pequeno fantasma" onClick={() => setEditando(a)}>
                  Editar
                </button>
                <button
                  className="botao pequeno fantasma"
                  onClick={() =>
                    void executarSeguro(async () => {
                      if (!(await confirmar({ titulo: 'Excluir afirmação?', texto: 'A afirmação e seus vínculos serão excluídos. As fontes continuam registradas no projeto.', confirmar: 'Excluir', perigo: true }))) return
                      await chamar('dossie:excluirAfirmacao', { id: a.id })
                    })
                  }
                >
                  Excluir
                </button>
              </div>
            </li>
          ))}
        </ul>
      </Secao>
      <Dialogo
        aberto={verificando !== null}
        aoFechar={() => setVerificando(null)}
        titulo="Marcar afirmação como verificada"
        acoes={
          <>
            <button className="botao fantasma" onClick={() => setVerificando(null)}>
              Cancelar
            </button>
            <button
              className="botao primario"
              onClick={() =>
                void executarSeguro(async () => {
                  await chamar('dossie:marcarVerificada', { id: verificando!.id, nota })
                  setVerificando(null)
                  setNota('')
                })
              }
            >
              Confirmar verificação
            </button>
          </>
        }
      >
        <p className="secundario pequeno">“{verificando?.texto}”. A verificação fica registrada com data e com as fontes já vinculadas.</p>
        <Campo rotulo="Como você conferiu (opcional)">
          <input className="entrada" value={nota} onChange={(e) => setNota(e.target.value)} maxLength={500} placeholder="Ex.: conferido no documento original, página 3" />
        </Campo>
      </Dialogo>
      {editando && <EditarAfirmacao a={editando} aoFechar={(ok) => { setEditando(null); if (ok) { rel.recarregar(); aoMudar?.() } }} />}
      {vinculando && <VincularFonte a={vinculando} preliminares={fontesPreliminares} aoFechar={(ok) => { setVinculando(null); if (ok) { rel.recarregar(); aoMudar?.() } }} />}
    </>
  )
}

function EditarAfirmacao({ a, aoFechar }: { a: AfirmacaoDetalhe; aoFechar: (ok: boolean) => void }) {
  const { avisarErro } = useRetorno()
  const [f, setF] = useState({ texto: a.texto, natureza: a.natureza, relevante: a.relevante, temaRapido: a.temaRapido, decisao: a.decisao, observacoes: a.observacoes })
  return (
    <Dialogo
      aberto
      aoFechar={() => aoFechar(false)}
      titulo="Editar afirmação"
      acoes={
        <>
          <button className="botao fantasma" onClick={() => aoFechar(false)}>
            Cancelar
          </button>
          <button
            className="botao primario"
            disabled={!f.texto.trim()}
            onClick={async () => {
              try {
                await chamar('dossie:atualizarAfirmacao', { id: a.id, ...f })
                aoFechar(true)
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
      <div style={{ display: 'grid', gap: 12 }}>
        <Campo rotulo="Afirmação">
          <textarea className="entrada" rows={3} value={f.texto} onChange={(e) => setF({ ...f, texto: e.target.value })} maxLength={2000} />
        </Campo>
        <div className="form-grade">
          <Campo rotulo="Natureza">
            <select className="entrada" value={f.natureza} onChange={(e) => setF({ ...f, natureza: e.target.value as Natureza })}>
              {NATUREZAS.map((n) => (
                <option key={n} value={n}>
                  {ROTULO_NATUREZA[n]}
                </option>
              ))}
            </select>
          </Campo>
          <Campo rotulo="Se não for possível confirmar" ajuda="A decisão fica registrada no relatório.">
            <select className="entrada" value={f.decisao ?? ''} onChange={(e) => setF({ ...f, decisao: (e.target.value || null) as Decisao | null })}>
              <option value="">Nenhuma decisão</option>
              {DECISOES.map((d) => (
                <option key={d} value={d}>
                  {ROTULO_DECISAO[d]}
                </option>
              ))}
            </select>
          </Campo>
        </div>
        <label className="checkbox">
          <input type="checkbox" checked={f.relevante} onChange={(e) => setF({ ...f, relevante: e.target.checked })} />
          Relevante ou controversa
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={f.temaRapido} onChange={(e) => setF({ ...f, temaRapido: e.target.checked })} />
          Assunto em rápida mudança
        </label>
        <Campo rotulo="Observações (fontes primárias/secundárias, conflitos)">
          <textarea className="entrada" rows={3} value={f.observacoes} onChange={(e) => setF({ ...f, observacoes: e.target.value })} maxLength={2000} />
        </Campo>
      </div>
    </Dialogo>
  )
}

function VincularFonte({ a, preliminares, aoFechar }: { a: AfirmacaoDetalhe; preliminares: ResultadoPesquisa[]; aoFechar: (ok: boolean) => void }) {
  const { avisarErro } = useRetorno()
  const [origem, setOrigem] = useState<'resultado' | 'nova'>(preliminares.length ? 'resultado' : 'nova')
  const [resultadoId, setResultadoId] = useState(preliminares[0]?.id ?? 0)
  const [v, setV] = useState({ trecho: '', papel: 'secundaria' as 'primaria' | 'secundaria', posicao: 'sustenta' as 'sustenta' | 'parcial' | 'contradiz' })
  const [nova, setNova] = useState({ titulo: '', url: '', autor: '', tipoFonte: 'outro' as TipoFonte, publicadaEm: '', acessadaEm: hoje() })
  const valido = v.trecho.trim() && (origem === 'resultado' ? resultadoId > 0 : nova.titulo.trim() && nova.url.trim() && nova.acessadaEm)

  async function salvar(): Promise<void> {
    try {
      if (origem === 'resultado') await chamar('dossie:vincularResultado', { afirmacaoId: a.id, resultadoId, ...v })
      else await chamar('dossie:vincularNovaFonte', { afirmacaoId: a.id, ...v, ...nova, publicadaEm: nova.publicadaEm || null })
      aoFechar(true)
    } catch (e) {
      avisarErro(mensagemDeErro(e))
    }
  }

  return (
    <Dialogo
      aberto
      largo
      aoFechar={() => aoFechar(false)}
      titulo="Vincular fonte à afirmação"
      acoes={
        <>
          <button className="botao fantasma" onClick={() => aoFechar(false)}>
            Cancelar
          </button>
          <button className="botao primario" disabled={!valido} onClick={() => void salvar()}>
            Vincular
          </button>
        </>
      }
    >
      <p className="secundario pequeno">“{a.texto}”</p>
      <div className="chips" style={{ margin: '8px 0 12px' }}>
        <button className="chip" aria-pressed={origem === 'resultado'} disabled={!preliminares.length} onClick={() => setOrigem('resultado')}>
          Resultado de pesquisa
        </button>
        <button className="chip" aria-pressed={origem === 'nova'} onClick={() => setOrigem('nova')}>
          Fonte informada por mim
        </button>
      </div>
      {origem === 'resultado' ? (
        <Campo rotulo="Fonte preliminar">
          <select className="entrada" value={resultadoId} onChange={(e) => setResultadoId(Number(e.target.value))}>
            {preliminares.map((r) => (
              <option key={r.id} value={r.id}>
                {r.titulo} — {r.dominio}
              </option>
            ))}
          </select>
        </Campo>
      ) : (
        <div className="form-grade">
          <Campo rotulo="Título">
            <input className="entrada" value={nova.titulo} onChange={(e) => setNova({ ...nova, titulo: e.target.value })} maxLength={300} />
          </Campo>
          <Campo rotulo="Endereço (URL) que você conferiu">
            <input className="entrada" value={nova.url} onChange={(e) => setNova({ ...nova, url: e.target.value })} placeholder="https://" maxLength={2000} />
          </Campo>
          <Campo rotulo="Autor">
            <input className="entrada" value={nova.autor} onChange={(e) => setNova({ ...nova, autor: e.target.value })} maxLength={200} />
          </Campo>
          <Campo rotulo="Tipo">
            <select className="entrada" value={nova.tipoFonte} onChange={(e) => setNova({ ...nova, tipoFonte: e.target.value as TipoFonte })}>
              {TIPOS_FONTE.map((t) => (
                <option key={t} value={t}>
                  {ROTULO_TIPO_FONTE[t]}
                </option>
              ))}
            </select>
          </Campo>
          <Campo rotulo="Publicada em">
            <input type="date" className="entrada" value={nova.publicadaEm} onChange={(e) => setNova({ ...nova, publicadaEm: e.target.value })} />
          </Campo>
          <Campo rotulo="Acessada em">
            <input type="date" className="entrada" value={nova.acessadaEm} onChange={(e) => setNova({ ...nova, acessadaEm: e.target.value })} />
          </Campo>
        </div>
      )}
      <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
        <Campo rotulo="Trecho ou resumo que sustenta (ou contradiz) a afirmação">
          <textarea className="entrada" rows={3} value={v.trecho} onChange={(e) => setV({ ...v, trecho: e.target.value })} maxLength={1500} />
        </Campo>
        <div className="form-grade">
          <Campo rotulo="Relação com a afirmação">
            <select className="entrada" value={v.posicao} onChange={(e) => setV({ ...v, posicao: e.target.value as typeof v.posicao })}>
              <option value="sustenta">Sustenta</option>
              <option value="parcial">Sustenta em parte</option>
              <option value="contradiz">Contradiz</option>
            </select>
          </Campo>
          <Campo rotulo="Tipo de fonte" ajuda="Primária: documento original, comunicado oficial, estudo, documentação.">
            <select className="entrada" value={v.papel} onChange={(e) => setV({ ...v, papel: e.target.value as typeof v.papel })}>
              <option value="primaria">Primária</option>
              <option value="secundaria">Secundária</option>
            </select>
          </Campo>
        </div>
      </div>
    </Dialogo>
  )
}
