import { useMemo, useState } from 'react'
import { chamar, mensagemDeErro, useDados } from '../api'
import { Icone } from '../componentes/Icone'
import { useRetorno } from '../componentes/retorno'
import { Alerta, Cabecalho, Campo, Carregando, Dialogo, ErroCarregar, Etiqueta, Secao, Vazio, formatarData, formatarDuracao } from '../componentes/ui'
import { COR_STATUS_ROTEIRO, useNavegacao } from '../navegacao'
import { ROTULO_STATUS_ROTEIRO, ROTULO_TIPO_VIDEO } from '@shared/dominio'
import { diffLinhas } from '@shared/diff'
import { filtroRoteirosSchema } from '@shared/schemas'
import type { PainelRevisao, RevisaoInterna, RoteiroResumo } from '@shared/tipos'
import { BarraProgresso } from '../componentes/progresso'
import { Dossie } from './Dossie'

const ROTULO_ACAO = { aprovado: 'Aprovado', correcoes: 'Correções pedidas', rejeitado: 'Rejeitado', invalidada: 'Aprovação invalidada' } as const
const ROTULO_TIPO = { factual: 'Factual', editorial: 'Editorial', producao: 'Produção' } as const

export function Revisao() {
  const [aberto, setAberto] = useState<number | null>(null)
  const buscar = (status: RoteiroResumo['status']) => chamar('roteiros:buscar', filtroRoteirosSchema.parse({ status, ordem: 'atualizado_desc' }))
  const lista = useDados(async () => [...(await buscar('em_revisao')), ...(await buscar('pronto_revisao')), ...(await buscar('precisa_verificacao'))], [aberto])
  if (aberto !== null) return <PainelRoteiro id={aberto} voltar={() => setAberto(null)} />
  return (
    <>
      <Cabecalho titulo="Revisão editorial" descricao="Nenhum roteiro vai para produção sem passar pela revisão factual e pela editorial." />
      <Secao>
        {lista.erro && <ErroCarregar mensagem={lista.erro} tentarNovamente={lista.recarregar} />}
        {lista.carregando && !lista.dados && <Carregando />}
        {lista.dados?.length === 0 && <Vazio titulo="Nada aguardando revisão" texto="Roteiros gerados ou marcados como “pronto para revisão” aparecem aqui." icone="revisao" />}
        <ul className="lista">
          {lista.dados?.map((r) => (
            <li key={r.id} className="lista-item clicavel" onClick={() => setAberto(r.id)}>
              <div className="lista-principal">
                <div className="lista-titulo">{r.titulo}</div>
                <div className="lista-meta">
                  {ROTULO_TIPO_VIDEO[r.tipoVideo]} · versão {r.versaoAtual} · atualizado {formatarData(r.atualizadoEm)}
                </div>
              </div>
              <Etiqueta cor={COR_STATUS_ROTEIRO[r.status]}>{ROTULO_STATUS_ROTEIRO[r.status]}</Etiqueta>
            </li>
          ))}
        </ul>
      </Secao>
    </>
  )
}

type Aba = 'roteiro' | 'verificacao' | 'versoes' | 'historico'

function PainelRoteiro({ id, voltar }: { id: number; voltar: () => void }) {
  const nav = useNavegacao()
  const { avisar, avisarErro, confirmar } = useRetorno()
  const painel = useDados(() => chamar('revisao:painel', { id }), [id])
  const [aba, setAba] = useState<Aba>('roteiro')
  const [comentario, setComentario] = useState('')
  const [correcao, setCorrecao] = useState<{ tipo: 'factual' | 'editorial'; texto: string } | null>(null)
  const executarSeguro = async (fn: () => Promise<unknown>, msg?: string): Promise<void> => {
    try {
      await fn()
      if (msg) avisar(msg)
      setComentario('')
      painel.recarregar()
    } catch (e) {
      avisarErro(mensagemDeErro(e))
    }
  }
  if (painel.erro) return <ErroCarregar mensagem={painel.erro} tentarNovamente={painel.recarregar} />
  if (!painel.dados) return <Carregando />
  const p: PainelRevisao = painel.dados
  const r = p.roteiro
  const criticos = p.alertasTexto.filter((a) => a.gravidade === 'critico')
  const avisos = p.alertasTexto.filter((a) => a.gravidade === 'aviso')

  return (
    <>
      <header className="cabecalho">
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', minWidth: 0 }}>
          <button className="botao botao-icone fantasma" onClick={voltar} aria-label="Voltar">
            <Icone nome="voltar" />
          </button>
          <div>
            <h1>{r.titulo}</h1>
            <p>
              <Etiqueta cor={COR_STATUS_ROTEIRO[r.status]}>{ROTULO_STATUS_ROTEIRO[r.status]}</Etiqueta> · {ROTULO_TIPO_VIDEO[r.tipoVideo]} · versão {r.versaoAtual} · duração estimada {formatarDuracao(p.duracaoSeg)}
            </p>
          </div>
        </div>
        <div className="acoes">
          <button className="botao" onClick={() => nav.abrirRoteiro(r.id)}>
            Editar manualmente
          </button>
        </div>
      </header>

      <div className="editor">
        <div>
          <div className="abas" role="tablist">
            {(
              [
                ['roteiro', 'Roteiro por cenas'],
                ['verificacao', `Dossiê (${p.dossie.pendencias.length} pendência(s))`],
                ['versoes', 'Comparar versões'],
                ['historico', `Histórico (${p.historico.length + r.comentarios.length})`]
              ] as const
            ).map(([v, t]) => (
              <button key={v} role="tab" className="aba" aria-selected={aba === v} onClick={() => setAba(v)}>
                {t}
              </button>
            ))}
          </div>
          {aba === 'roteiro' && <Cenas texto={r.conteudo} alteradas={p.secoesAlteradasDesdeAprovacao} />}
          {aba === 'verificacao' && <Dossie roteiroId={r.id} aoMudar={painel.recarregar} />}
          {aba === 'versoes' && <CompararVersoes roteiroId={r.id} versaoAtual={r.versaoAtual} />}
          {aba === 'historico' && (
            <Secao titulo="Histórico auditável">
              <ul className="lista">
                {p.historico.map((h) => (
                  <li key={`a${h.id}`} className="lista-item" style={{ alignItems: 'flex-start' }}>
                    <Etiqueta cor={h.acao === 'aprovado' ? (h.invalidadaEm ? 'cinza' : 'verde') : h.acao === 'invalidada' ? 'amarela' : 'vermelha'}>{ROTULO_TIPO[h.tipo]}</Etiqueta>
                    <div className="lista-principal">
                      <div>
                        {ROTULO_ACAO[h.acao]} — versão {h.versao}
                        {h.invalidadaEm && ' (invalidada)'}
                      </div>
                      {h.comentario && <div className="secundario pequeno">{h.comentario}</div>}
                      {h.invalidadaMotivo && <div className="secundario pequeno">{h.invalidadaMotivo}</div>}
                      <div className="lista-meta">{formatarData(h.criadoEm, true)}</div>
                    </div>
                  </li>
                ))}
                {r.comentarios.map((c) => (
                  <li key={`c${c.id}`} className="lista-item">
                    <Etiqueta>Comentário</Etiqueta>
                    <div className="lista-principal">
                      <div style={{ whiteSpace: 'pre-wrap' }}>{c.texto}</div>
                      <div className="lista-meta">
                        {formatarData(c.criadoEm, true)} · versão {c.versaoNumero}
                        {c.resolvidoEm && ' · resolvido'}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </Secao>
          )}
        </div>

        <aside>
          <PainelRevisaoInterna p={p} aoMudar={painel.recarregar} />
          <Secao titulo="Revisão factual">
            {p.aprovacaoFactual ? <Etiqueta cor="verde">Aprovada em {formatarData(p.aprovacaoFactual.criadoEm, true)}</Etiqueta> : <Etiqueta>Não aprovada nesta versão</Etiqueta>}
            {p.pendenciasFactuais.length > 0 && (
              <div style={{ marginTop: 8 }}>
                {p.pendenciasFactuais.slice(0, 6).map((x, i) => (
                  <Alerta key={i} tipo="erro">
                    {x}
                  </Alerta>
                ))}
                {p.pendenciasFactuais.length > 6 && <p className="secundario pequeno">… e mais {p.pendenciasFactuais.length - 6}.</p>}
              </div>
            )}
            <div className="acoes" style={{ marginTop: 8 }}>
              <button className="botao pequeno" disabled={p.pendenciasFactuais.length > 0} onClick={() => void executarSeguro(() => chamar('revisao:aprovarFactual', { id: r.id, comentario }), 'Revisão factual aprovada.')}>
                Aprovar factual
              </button>
              <button className="botao pequeno fantasma" onClick={() => setCorrecao({ tipo: 'factual', texto: '' })}>
                Pedir correções
              </button>
            </div>
          </Secao>

          <Secao titulo="Revisão editorial">
            {p.aprovacaoEditorial ? <Etiqueta cor="verde">Aprovada em {formatarData(p.aprovacaoEditorial.criadoEm, true)}</Etiqueta> : <Etiqueta>Não aprovada nesta versão</Etiqueta>}
            {criticos.map((a, i) => (
              <Alerta key={`c${i}`} tipo="erro">
                {a.mensagem}
                {a.trecho && <div className="pequeno">“{a.trecho}”</div>}
              </Alerta>
            ))}
            {avisos.map((a, i) => (
              <Alerta key={`a${i}`}>
                {a.mensagem}
                {a.trecho && <div className="pequeno">“{a.trecho}”</div>}
              </Alerta>
            ))}
            {p.alertasTexto.length === 0 && <p className="secundario pequeno">Nenhum alerta automático (isso não garante ausência de problemas).</p>}
            <p className="secundario pequeno">A aprovação editorial não apaga pendências factuais.</p>
            <div className="acoes" style={{ marginTop: 8 }}>
              <button className="botao pequeno" onClick={() => void executarSeguro(() => chamar('revisao:aprovarEditorial', { id: r.id, comentario }), 'Revisão editorial aprovada.')}>
                Aprovar editorial
              </button>
              <button className="botao pequeno fantasma" onClick={() => setCorrecao({ tipo: 'editorial', texto: '' })}>
                Pedir correções
              </button>
            </div>
          </Secao>

          <Secao titulo="Decisão">
            <Campo rotulo="Comentário (registrado no histórico)">
              <textarea className="entrada" rows={2} value={comentario} onChange={(e) => setComentario(e.target.value)} maxLength={5000} />
            </Campo>
            {!p.podeAprovarProducao && (
              <ul className="secundario pequeno">
                {p.motivosBloqueio.slice(0, 5).map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            )}
            <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
              <button className="botao primario" disabled={!p.podeAprovarProducao} onClick={() => void executarSeguro(() => chamar('revisao:aprovarProducao', { id: r.id, comentario }), 'Aprovado para produção.')}>
                Aprovar para produção
              </button>
              <button
                className="botao perigo"
                onClick={() =>
                  void executarSeguro(async () => {
                    if (!(await confirmar({ titulo: 'Rejeitar e arquivar?', texto: 'O roteiro será arquivado e a decisão registrada. Nada é apagado; você pode restaurá-lo na biblioteca.', confirmar: 'Rejeitar', perigo: true }))) return
                    await chamar('revisao:rejeitar', { id: r.id, comentario })
                    voltar()
                  }, 'Roteiro rejeitado e arquivado.')
                }
              >
                Rejeitar e arquivar
              </button>
            </div>
          </Secao>
        </aside>
      </div>

      <Dialogo
        aberto={correcao !== null}
        aoFechar={() => setCorrecao(null)}
        titulo={`Pedir correções (${correcao?.tipo === 'factual' ? 'factual' : 'editorial'})`}
        acoes={
          <>
            <button className="botao fantasma" onClick={() => setCorrecao(null)}>
              Cancelar
            </button>
            <button
              className="botao primario"
              disabled={!correcao?.texto.trim()}
              onClick={() =>
                void executarSeguro(async () => {
                  await chamar('revisao:solicitarCorrecoes', { id: r.id, tipo: correcao!.tipo, comentario: correcao!.texto })
                  setCorrecao(null)
                }, 'Correções registradas; o roteiro voltou para rascunho.')
              }
            >
              Registrar
            </button>
          </>
        }
      >
        <Campo rotulo="O que precisa ser corrigido">
          <textarea className="entrada" rows={4} value={correcao?.texto ?? ''} onChange={(e) => setCorrecao(correcao && { ...correcao, texto: e.target.value })} maxLength={5000} autoFocus />
        </Campo>
      </Dialogo>
    </>
  )
}

function Cenas({ texto, alteradas }: { texto: string; alteradas: string[] }) {
  const cenas = useMemo(() => {
    const partes: { titulo: string; corpo: string }[] = []
    let atual = { titulo: 'Início', corpo: '' }
    for (const l of texto.split(/\r?\n/)) {
      if (l.startsWith('## ')) {
        if (atual.corpo.trim() || atual.titulo !== 'Início') partes.push(atual)
        atual = { titulo: l.slice(3), corpo: '' }
      } else atual.corpo += `${l}\n`
    }
    partes.push(atual)
    return partes
  }, [texto])
  return (
    <>
      {cenas.map((c, i) => (
        <Secao key={i} titulo={c.titulo} acoes={alteradas.includes(c.titulo) ? <Etiqueta cor="amarela">Alterada desde a última aprovação</Etiqueta> : undefined}>
          <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>{c.corpo.trim() || <span className="secundario">(vazio)</span>}</div>
        </Secao>
      ))}
    </>
  )
}

function CompararVersoes({ roteiroId, versaoAtual }: { roteiroId: number; versaoAtual: number }) {
  const [a, setA] = useState(Math.max(1, versaoAtual - 1))
  const va = useDados(() => chamar('roteiros:versao', { roteiroId, numero: a }), [roteiroId, a])
  const vb = useDados(() => chamar('roteiros:versao', { roteiroId, numero: versaoAtual }), [roteiroId, versaoAtual])
  const alertas = useDados(() => chamar('roteiros:alertasVersao', { roteiroId, numero: versaoAtual }), [roteiroId, versaoAtual])
  const diff = useMemo(() => (va.dados && vb.dados ? diffLinhas(va.dados.conteudo, vb.dados.conteudo) : []), [va.dados, vb.dados])
  return (
    <Secao titulo="Comparação entre versões">
      <div className="form-linha" style={{ marginBottom: 12 }}>
        <Campo rotulo="Comparar a versão">
          <select className="entrada" value={a} onChange={(e) => setA(Number(e.target.value))}>
            {Array.from({ length: versaoAtual }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </Campo>
        <span className="secundario">com a versão atual ({versaoAtual})</span>
      </div>
      {alertas.dados && alertas.dados.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <h3>Alertas registrados na geração desta versão</h3>
          {alertas.dados.map((x, i) => (
            <Alerta key={i}>{x.mensagem}</Alerta>
          ))}
        </div>
      )}
      <div className="diff">
        {diff.map((l, i) => (
          <span key={i} className={l.tipo === 'adicionada' ? 'add' : l.tipo === 'removida' ? 'rem' : undefined}>
            {l.tipo === 'adicionada' ? '+ ' : l.tipo === 'removida' ? '− ' : '  '}
            {l.texto}
            {'\n'}
          </span>
        ))}
      </div>
    </Secao>
  )
}

const COR_RESULTADO: Record<RevisaoInterna['resultado'], 'verde' | 'amarela' | 'vermelha'> = { aprovada: 'verde', com_alertas: 'amarela', reprovada: 'vermelha' }
const ROTULO_RESULTADO: Record<RevisaoInterna['resultado'], string> = { aprovada: 'Sem problemas', com_alertas: 'Com alertas', reprovada: 'Com pontos críticos' }

/** Revisão interna do app: regras fixas + IA revisora. Pontos críticos da IA precisam ser conferidos por você. */
function PainelRevisaoInterna({ p, aoMudar }: { p: PainelRevisao; aoMudar: () => void }) {
  const { avisar, avisarErro } = useRetorno()
  const [rodando, setRodando] = useState(false)
  const [notas, setNotas] = useState<Record<number, string>>({})
  const ri = p.revisaoInterna
  const rodar = async (): Promise<void> => {
    setRodando(true)
    try {
      const r = await chamar('revisao:interna', { id: p.roteiro.id })
      avisar(`Revisão interna concluída: ${ROTULO_RESULTADO[r.resultado].toLowerCase()}.`)
      aoMudar()
    } catch (e) {
      avisarErro(mensagemDeErro(e))
    } finally {
      setRodando(false)
    }
  }
  const conferir = async (indice: number): Promise<void> => {
    try {
      await chamar('revisao:conferirInterna', { revisaoId: ri!.id, indice, nota: notas[indice] ?? '' })
      aoMudar()
    } catch (e) {
      avisarErro(mensagemDeErro(e))
    }
  }
  return (
    <Secao
      titulo="Revisão interna"
      acoes={
        <>
          <button className="botao pequeno fantasma" onClick={aoMudar}>
            Atualizar
          </button>
          <button className="botao pequeno" disabled={rodando} onClick={() => void rodar()}>
            {rodando ? 'Revisando…' : ri ? 'Revisar de novo' : 'Revisar agora'}
          </button>
        </>
      }
    >
      {rodando && <BarraProgresso percentual={null} etapa="Revisando: regras fixas e IA revisora" detalhe="Pode levar até alguns minutos com IA." />}
      {!ri ? (
        <p className="secundario pequeno">
          Ainda não feita nesta versão. Ela roda sozinha depois de gerar o roteiro (se ligada em Serviços de IA) e, no mínimo com as regras fixas, ao aprovar para produção.
        </p>
      ) : (
        <>
          <p style={{ margin: '0 0 6px' }}>
            <Etiqueta cor={COR_RESULTADO[ri.resultado]}>{ROTULO_RESULTADO[ri.resultado]}</Etiqueta> <span className="secundario pequeno">por {ri.revisor} · {formatarData(ri.criadoEm, true)}{ri.nota !== null && ` · nota ${ri.nota}/10`}</span>
          </p>
          {ri.resumo && <p className="secundario pequeno">{ri.resumo}</p>}
          {ri.itens.length === 0 && <p className="secundario pequeno">Nenhum ponto encontrado.</p>}
          <ul className="lista">
            {ri.itens.map((i, k) => (
              <li key={k} className="lista-item" style={{ alignItems: 'flex-start', opacity: i.conferido ? 0.6 : 1 }}>
                <div className="lista-principal">
                  <div className="pequeno">
                    <Etiqueta cor={i.gravidade === 'critico' ? 'vermelha' : 'amarela'}>{i.gravidade === 'critico' ? 'Crítico' : 'Aviso'}</Etiqueta> <Etiqueta>{i.origem === 'ia' ? 'IA revisora' : 'Regras'}</Etiqueta> {i.problema}
                  </div>
                  {i.trecho && <div className="secundario pequeno">Trecho: “{i.trecho}”</div>}
                  {i.sugestao && <div className="secundario pequeno">Sugestão: {i.sugestao}</div>}
                  {i.conferido && <div className="secundario pequeno">Conferido{i.nota ? `: ${i.nota}` : ''}</div>}
                  {i.origem === 'ia' && i.gravidade === 'critico' && !i.conferido && (
                    <div className="acoes" style={{ marginTop: 4 }}>
                      <input className="entrada" style={{ flex: 1, minWidth: 120 }} placeholder="Nota (ex.: corrigido no roteiro)" value={notas[k] ?? ''} onChange={(e) => setNotas({ ...notas, [k]: e.target.value })} maxLength={500} />
                      <button className="botao pequeno" onClick={() => void conferir(k)}>
                        Conferido
                      </button>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {ri.observacoes.length > 0 && (
            <details className="pequeno secundario">
              <summary>Detalhes da execução</summary>
              <ul style={{ paddingLeft: 18 }}>
                {ri.observacoes.map((o, k) => (
                  <li key={k}>{o}</li>
                ))}
              </ul>
            </details>
          )}
          <p className="secundario pequeno" style={{ marginBottom: 0 }}>
            Pontos das regras se resolvem corrigindo o roteiro ou o dossiê (depois, “Revisar de novo”). A IA revisora só aponta: quem decide é você.
          </p>
        </>
      )}
    </Secao>
  )
}
