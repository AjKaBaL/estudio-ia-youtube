import { useEffect, useState } from 'react'
import { chamar, mensagemDeErro, useDados } from '../api'
import { Icone } from '../componentes/Icone'
import { useRetorno } from '../componentes/retorno'
import { Alerta, Campo, Carregando, Dialogo, ErroCarregar, Etiqueta, Secao, Vazio, formatarData } from '../componentes/ui'
import { ROTULO_STATUS_PESQUISA, ROTULO_TIPO_FONTE } from '@shared/dominio'
import { filtroRoteirosSchema } from '@shared/schemas'
import type { ExecucaoDetalhe, FonteIdentificada, ProgressoPesquisa, ResultadoPesquisa } from '@shared/tipos'
import { GuiaRss } from '../componentes/guias'
import { BarraProgresso } from '../componentes/progresso'
import { FONTES_PADRAO, TERMOS_PADRAO } from '@shared/fontesPadrao'

/** Aba "Pesquisar": executar, acompanhar e cancelar. */
export function PainelPesquisar({ projetoId, aoConcluir }: { projetoId: number; aoConcluir: (execucaoId: number) => void }) {
  const { avisarErro } = useRetorno()
  const painel = useDados(() => chamar('pesquisa:painel', { projetoId }), [projetoId])
  const [consulta, setConsulta] = useState('')
  const [progresso, setProgresso] = useState<ProgressoPesquisa | null>(null)

  // Acompanha a execução em andamento (inclusive uma agendada iniciada pelo app).
  const emAndamento = progresso ?? painel.dados?.emAndamento ?? null
  const idAndamento = emAndamento?.execucaoId ?? null
  useEffect(() => {
    if (idAndamento === null) return
    const t = setInterval(async () => {
      try {
        const p = await chamar('pesquisa:progresso', { id: idAndamento })
        if (p) setProgresso(p)
        else {
          setProgresso(null)
          clearInterval(t)
          painel.recarregar()
          aoConcluir(idAndamento)
        }
      } catch {
        clearInterval(t)
      }
    }, 800)
    return () => clearInterval(t)
  }, [idAndamento, painel, aoConcluir])

  async function iniciar(): Promise<void> {
    try {
      const { id } = await chamar('pesquisa:iniciar', { projetoId, consulta })
      setProgresso({ execucaoId: id, etapa: 'Iniciando', fontesFeitas: 0, fontesTotal: 0, resultados: 0 })
    } catch (e) {
      avisarErro(mensagemDeErro(e))
    }
  }

  const d = painel.dados
  const algumConfigurado = d?.provedores.some((p) => p.configurado && !p.exigeChave) ?? false
  return (
    <>
      <Secao titulo="Nova pesquisa">
        <form
          className="form-linha"
          onSubmit={(e) => {
            e.preventDefault()
            void iniciar()
          }}
        >
          <div className="busca" style={{ maxWidth: 'none' }}>
            <Icone nome="buscar" tamanho={20} />
            <input value={consulta} onChange={(e) => setConsulta(e.target.value)} placeholder='Ex.: "inteligência artificial" varejo, chips quânticos' aria-label="Consulta" maxLength={300} />
          </div>
          <button className="botao primario" type="submit" disabled={!consulta.trim() || emAndamento !== null || !algumConfigurado}>
            Pesquisar
          </button>
        </form>
        <p className="secundario pequeno" style={{ marginTop: 8 }}>
          Vírgula separa alternativas (OU); palavras juntas precisam aparecer todas (E); aspas exigem a expressão exata.
          {d && ` Período: ${d.intervaloAtual.rotulo} (${formatarData(d.intervaloAtual.de)} a ${formatarData(d.intervaloAtual.ate)}).`}
          {d?.ultimaExecucao && ` Última execução: ${formatarData(d.ultimaExecucao, true)}.`}
        </p>
        {d && !algumConfigurado && <Alerta>Adicione pelo menos um feed RSS ou uma página na aba “Fontes e opções” para pesquisar.</Alerta>}
        {emAndamento && (
          <div className="alerta info" style={{ marginTop: 12, alignItems: 'center' }} role="status" aria-live="polite">
            <div style={{ flex: 1, minWidth: 0 }}>
              <BarraProgresso
                percentual={percentualPesquisa(emAndamento)}
                etapa={emAndamento.etapa}
                detalhe={`${emAndamento.fontesFeitas} de ${emAndamento.fontesTotal || '?'} fonte(s) · ${emAndamento.resultados} resultado(s)`}
              />
            </div>
            <button
              className="botao pequeno"
              onClick={async () => {
                try {
                  await chamar('pesquisa:cancelar', { id: emAndamento.execucaoId })
                } catch (e) {
                  avisarErro(mensagemDeErro(e))
                }
              }}
            >
              Cancelar
            </button>
          </div>
        )}
      </Secao>
      <Secao titulo="Provedores de pesquisa">
        {painel.erro && <ErroCarregar mensagem={painel.erro} tentarNovamente={painel.recarregar} />}
        <ul className="lista">
          {d?.provedores.map((p) => (
            <li key={p.id} className="lista-item">
              <div className="lista-principal">
                <div className="lista-titulo">{p.nome}</div>
                <div className="lista-meta">{p.descricao}</div>
                <div className="lista-meta">{p.mensagem}</div>
              </div>
              <Etiqueta cor={p.configurado ? 'verde' : 'cinza'}>{p.configurado ? 'Configurado' : 'Não configurado'}</Etiqueta>
            </li>
          ))}
        </ul>
        <p className="secundario pequeno" style={{ marginTop: 8 }}>
          Não existe pesquisa gratuita e ilimitada na internet inteira: este aplicativo lê apenas as fontes que você indicar. As notas são estimativas para ordenar resultados.
        </p>
      </Secao>
    </>
  )
}

/** Aba "Histórico": todas as pesquisas são preservadas. */
export function HistoricoPesquisas({ projetoId, abrirId, aoCriarPauta }: { projetoId: number; abrirId: number | null; aoCriarPauta: (pautaId: number) => void }) {
  const lista = useDados(() => chamar('pesquisa:execucoes', { projetoId }), [projetoId, abrirId])
  const [aberta, setAberta] = useState<number | null>(abrirId)
  if (aberta !== null) return <DetalheExecucao id={aberta} projetoId={projetoId} voltar={() => setAberta(null)} aoCriarPauta={aoCriarPauta} />
  return (
    <Secao titulo="Pesquisas anteriores">
      {lista.erro && <ErroCarregar mensagem={lista.erro} tentarNovamente={lista.recarregar} />}
      {lista.carregando && !lista.dados && <Carregando />}
      {lista.dados?.length === 0 && <Vazio titulo="Nenhuma pesquisa ainda" texto="As pesquisas manuais e agendadas ficam guardadas aqui." />}
      <ul className="lista">
        {lista.dados?.map((e) => (
          <li key={e.id} className="lista-item clicavel" onClick={() => setAberta(e.id)}>
            <div className="lista-principal">
              <div className="lista-titulo">{e.consulta}</div>
              <div className="lista-meta">
                <span>{formatarData(e.iniciadaEm ?? e.criadoEm, true)}</span>
                <span>· {e.origem === 'agendada' ? 'agendada' : 'manual'}</span>
                <span>· {e.totalResultados} resultado(s)</span>
                <span>· {e.fontesConsultadas} fonte(s){e.fontesComErro ? `, ${e.fontesComErro} com erro` : ''}</span>
              </div>
            </div>
            <Etiqueta cor={e.status === 'concluida' ? 'verde' : e.status === 'erro' ? 'vermelha' : e.status === 'cancelada' ? 'cinza' : 'amarela'}>{ROTULO_STATUS_PESQUISA[e.status]}</Etiqueta>
          </li>
        ))}
      </ul>
    </Secao>
  )
}

function DetalheExecucao({ id, projetoId, voltar, aoCriarPauta }: { id: number; projetoId: number; voltar: () => void; aoCriarPauta: (pautaId: number) => void }) {
  const { avisarErro } = useRetorno()
  const ex = useDados(() => chamar('pesquisa:execucao', { id }), [id])
  const [selecionados, setSelecionados] = useState<number[]>([])
  const [mostrarDuplicatas, setMostrarDuplicatas] = useState(false)
  const [vincular, setVincular] = useState<ResultadoPesquisa | null>(null)
  if (ex.erro) return <ErroCarregar mensagem={ex.erro} tentarNovamente={ex.recarregar} />
  if (!ex.dados) return <Carregando />
  const e: ExecucaoDetalhe = ex.dados
  const visiveis = e.resultados.filter((r) => mostrarDuplicatas || r.duplicadoDe === null)
  const duplicatas = e.resultados.length - e.resultados.filter((r) => r.duplicadoDe === null).length
  const tamanhoGrupo = (g: number | null): number => (g === null ? 0 : e.resultados.filter((r) => r.grupo === g && r.duplicadoDe === null).length)

  return (
    <>
      <Secao
        titulo={`Relatório: “${e.consulta}”`}
        acoes={
          <button className="botao pequeno" onClick={voltar}>
            Voltar
          </button>
        }
      >
        <div className="lista-meta" style={{ fontSize: 13 }}>
          <Etiqueta cor={e.status === 'concluida' ? 'verde' : e.status === 'erro' ? 'vermelha' : 'cinza'}>{ROTULO_STATUS_PESQUISA[e.status]}</Etiqueta>
          <span>Período pesquisado: {formatarData(e.intervaloDe)} a {formatarData(e.intervaloAte)}</span>
          <span>· executada em {formatarData(e.iniciadaEm, true)}</span>
          <span>· {e.origem}</span>
          <span>· {e.totalResultados} resultado(s), {duplicatas} duplicata(s)</span>
        </div>
        {e.mensagemErro && <Alerta tipo={e.status === 'erro' ? 'erro' : 'aviso'}>{e.mensagemErro}</Alerta>}
      </Secao>
      <Secao
        titulo="Resultados"
        acoes={
          <div className="acoes">
            {duplicatas > 0 && (
              <label className="checkbox">
                <input type="checkbox" checked={mostrarDuplicatas} onChange={(x) => setMostrarDuplicatas(x.target.checked)} />
                Mostrar duplicatas
              </label>
            )}
            <button
              className="botao primario pequeno"
              disabled={!selecionados.length}
              onClick={async () => {
                try {
                  const p = await chamar('pautas:deResultados', { projetoId, resultadoIds: selecionados })
                  aoCriarPauta(p.id)
                } catch (err) {
                  avisarErro(mensagemDeErro(err))
                }
              }}
            >
              Criar pauta com {selecionados.length || 'os'} selecionado(s)
            </button>
          </div>
        }
      >
        {visiveis.length === 0 && <Vazio compacto titulo="Nenhum resultado" texto="Tente outros termos, um período maior ou mais fontes." />}
        <ul className="lista">
          {visiveis.map((r) => (
            <li key={r.id} className="lista-item" style={{ alignItems: 'flex-start' }}>
              <input
                type="checkbox"
                aria-label={`Selecionar ${r.titulo}`}
                checked={selecionados.includes(r.id)}
                onChange={() => setSelecionados((s) => (s.includes(r.id) ? s.filter((x) => x !== r.id) : [...s, r.id]))}
                style={{ width: 16, height: 16, marginTop: 6, accentColor: 'var(--azul)' }}
              />
              <div style={{ width: 44, textAlign: 'center' }} title="Pontuação estimada (0–100)">
                <div style={{ fontSize: 18, fontWeight: 700 }}>{r.pontuacao}</div>
                <div className="secundario" style={{ fontSize: 10 }}>estimativa</div>
              </div>
              <div className="lista-principal">
                <a className="lista-titulo" href={r.url} target="_blank" rel="noreferrer noopener" style={{ display: 'block', whiteSpace: 'normal' }}>
                  {r.titulo}
                </a>
                <div className="lista-meta">
                  <span>{r.dominio}</span>
                  <span>· {ROTULO_TIPO_FONTE[r.tipoFonte]}</span>
                  {r.autor && <span>· {r.autor}</span>}
                  <span>· publicado {r.publicadaEm ? formatarData(r.publicadaEm) : 'sem data'}</span>
                  <span>· acesso {formatarData(r.acessadaEm, true)}</span>
                  <span>· via {r.fonteNome}</span>
                  {r.idioma !== 'pt' && r.idioma !== 'desconhecido' && <Etiqueta>{r.idioma.toUpperCase()}</Etiqueta>}
                  {r.duplicadoDe !== null && <Etiqueta>Duplicata</Etiqueta>}
                  {r.duplicadoDe === null && tamanhoGrupo(r.grupo) > 1 && <Etiqueta cor="azul">Mesmo evento: {tamanhoGrupo(r.grupo)} fontes</Etiqueta>}
                  {r.alertaInjecao && <Etiqueta cor="vermelha">Texto com instruções suspeitas</Etiqueta>}
                </div>
                {r.trecho && <p className="secundario" style={{ margin: '6px 0' }}>{r.trecho}</p>}
                <details>
                  <summary className="secundario pequeno" style={{ cursor: 'pointer' }}>
                    Por que esta nota?
                  </summary>
                  <ul className="secundario pequeno">
                    {r.explicacao.map((x) => (
                      <li key={x}>{x}</li>
                    ))}
                  </ul>
                </details>
              </div>
              <button className="botao pequeno" onClick={() => setVincular(r)}>
                Usar em roteiro
              </button>
            </li>
          ))}
        </ul>
      </Secao>
      <Secao titulo="Registro por fonte">
        <ul className="lista">
          {e.registros.map((g) => (
            <li key={g.id} className="lista-item">
              <Etiqueta cor={g.nivel === 'erro' ? 'vermelha' : g.nivel === 'aviso' ? 'amarela' : 'cinza'}>{g.nivel}</Etiqueta>
              <div className="lista-principal">
                <div>{g.mensagem}</div>
                <div className="lista-meta">{g.fonte}</div>
              </div>
            </li>
          ))}
        </ul>
      </Secao>
      {vincular && <DialogoVincular resultado={vincular} aoFechar={() => setVincular(null)} />}
    </>
  )
}

function DialogoVincular({ resultado, aoFechar }: { resultado: ResultadoPesquisa; aoFechar: () => void }) {
  const { avisar, avisarErro } = useRetorno()
  const roteiros = useDados(() => chamar('roteiros:buscar', filtroRoteirosSchema.parse({})), [])
  const [escolhido, setEscolhido] = useState('')
  return (
    <Dialogo
      aberto
      aoFechar={aoFechar}
      titulo="Vincular como fonte de um roteiro"
      acoes={
        <>
          <button className="botao fantasma" onClick={aoFechar}>
            Cancelar
          </button>
          <button
            className="botao primario"
            disabled={!escolhido}
            onClick={async () => {
              try {
                await chamar('pesquisa:resultadoParaRoteiro', { resultadoId: resultado.id, roteiroId: Number(escolhido) })
                avisar('Fonte vinculada ao roteiro.')
                aoFechar()
              } catch (e) {
                avisarErro(mensagemDeErro(e))
              }
            }}
          >
            Vincular
          </button>
        </>
      }
    >
      <p className="secundario">{resultado.titulo}</p>
      <Campo rotulo="Roteiro">
        <select className="entrada" value={escolhido} onChange={(e) => setEscolhido(e.target.value)}>
          <option value="">Escolha…</option>
          {roteiros.dados?.map((r) => (
            <option key={r.id} value={r.id}>
              {r.titulo}
            </option>
          ))}
        </select>
      </Campo>
    </Dialogo>
  )
}

/** Aba "Fontes e opções": feeds, páginas, domínios e termos. */
export function FontesEOpcoes({ projetoId }: { projetoId: number }) {
  const { avisar, avisarErro, confirmar } = useRetorno()
  const fontes = useDados(() => chamar('pesquisa:fontes', { projetoId }), [projetoId])
  const regras = useDados(() => chamar('pesquisa:regras', { projetoId }), [projetoId])
  const opcoes = useDados(() => chamar('pesquisa:opcoes'), [])
  const [dominio, setDominio] = useState({ dominio: '', regra: 'confiavel' as 'confiavel' | 'bloqueado' })
  const [termos, setTermos] = useState<string | null>(null)
  const [nicho, setNicho] = useState<string | null>(null)

  const executarSeguro = async (fn: () => Promise<void>): Promise<void> => {
    try {
      await fn()
    } catch (e) {
      avisarErro(mensagemDeErro(e))
    }
  }
  const lista = (t: string): string[] => t.split(/[,\n]/).map((x) => x.trim()).filter(Boolean)

  return (
    <>
      <SugestoesFontes projetoId={projetoId} aoAprovar={fontes.recarregar} />
      <Secao
        titulo="Feeds RSS e páginas"
        acoes={
          <button
            className="botao pequeno"
            onClick={() =>
              void executarSeguro(async () => {
                const r = await chamar('pesquisa:restaurarFontesPadrao', { projetoId })
                avisar(r.adicionadas ? `${r.adicionadas} fonte(s) padrão adicionada(s).` : 'Todas as fontes padrão já estão na lista.')
                fontes.recarregar()
              })
            }
          >
            Restaurar fontes padrão
          </button>
        }
      >
        <p className="secundario pequeno" style={{ marginTop: 0 }}>
          O aplicativo já vem com {FONTES_PADRAO.length} fontes conferidas de tecnologia, IA e negócios (brasileiras e internacionais). Desative as que não quiser ou remova; para incluir outra, cole o endereço do site abaixo e o aplicativo encontra o feed sozinho.
          {fontes.dados && ` Ativas agora: ${fontes.dados.filter((f) => f.ativo).length} de ${fontes.dados.length}.`}
        </p>
        <NovaFonte projetoId={projetoId} aoAdicionar={fontes.recarregar} />
        <GuiaRss />
        {fontes.erro && <ErroCarregar mensagem={fontes.erro} tentarNovamente={fontes.recarregar} />}
        {fontes.dados?.length === 0 && <Vazio compacto titulo="Nenhuma fonte" texto="Clique em Restaurar fontes padrão ou cole o endereço de um site acima." />}
        <ul className="lista" style={{ marginTop: 12 }}>
          {fontes.dados?.map((f) => (
            <li key={f.id} className="lista-item" style={{ opacity: f.ativo ? 1 : 0.6 }}>
              <Etiqueta>{f.tipo === 'rss' ? 'RSS' : 'Página'}</Etiqueta>
              <div className="lista-principal">
                <div className="lista-titulo">
                  {f.nome} {f.origem === 'padrao' && <Etiqueta cor="azul">Padrão</Etiqueta>} {f.origem === 'sugestao' && <Etiqueta cor="verde">Sugestão aprovada</Etiqueta>}
                </div>
                <div className="lista-meta">
                  <span>{f.url}</span>
                  {f.ultimaExecucao && <span>· última leitura {formatarData(f.ultimaExecucao, true)}: {f.ultimoStatus}</span>}
                </div>
              </div>
              <label className="checkbox pequeno">
                <input type="checkbox" checked={f.ativo} onChange={(e) => void executarSeguro(async () => { await chamar('pesquisa:ativarFonte', { id: f.id, ativo: e.target.checked }); fontes.recarregar() })} />
                Ativa
              </label>
              <button
                className="botao pequeno fantasma"
                onClick={() =>
                  void executarSeguro(async () => {
                    if (!(await confirmar({ titulo: 'Remover fonte?', texto: `"${f.nome}" deixará de ser consultada. Resultados de pesquisas anteriores continuam guardados.${f.origem === 'padrao' ? ' Fontes padrão podem voltar com “Restaurar fontes padrão”.' : ''}`, confirmar: 'Remover' }))) return
                    await chamar('pesquisa:removerFonte', { id: f.id })
                    fontes.recarregar()
                  })
                }
              >
                Remover
              </button>
            </li>
          ))}
        </ul>
      </Secao>

      <Secao titulo="Domínios confiáveis e bloqueados">
        <ul className="lista">
          {regras.dados?.map((r) => (
            <li key={r.id} className="lista-item">
              <Etiqueta cor={r.regra === 'confiavel' ? 'verde' : 'vermelha'}>{r.regra === 'confiavel' ? 'Confiável' : 'Bloqueado'}</Etiqueta>
              <div className="lista-principal">{r.dominio}</div>
              <button className="botao pequeno fantasma" onClick={() => void executarSeguro(async () => { await chamar('pesquisa:removerRegra', { id: r.id }); regras.recarregar() })}>
                Remover
              </button>
            </li>
          ))}
        </ul>
        <form
          className="form-linha"
          style={{ marginTop: 12 }}
          onSubmit={(e) => {
            e.preventDefault()
            void executarSeguro(async () => {
              await chamar('pesquisa:definirRegra', { projetoId, ...dominio })
              setDominio({ ...dominio, dominio: '' })
              regras.recarregar()
            })
          }}
        >
          <Campo rotulo="Domínio">
            <input className="entrada" value={dominio.dominio} onChange={(e) => setDominio({ ...dominio, dominio: e.target.value })} placeholder="exemplo.com.br" />
          </Campo>
          <Campo rotulo="Regra">
            <select className="entrada" value={dominio.regra} onChange={(e) => setDominio({ ...dominio, regra: e.target.value as 'confiavel' | 'bloqueado' })}>
              <option value="confiavel">Confiável</option>
              <option value="bloqueado">Bloqueado</option>
            </select>
          </Campo>
          <button className="botao" type="submit" disabled={!dominio.dominio.trim()}>
            Salvar regra
          </button>
        </form>
      </Secao>

      {opcoes.dados && (
        <Secao titulo="Opções">
          <div className="form-grade">
            <Campo rotulo="Termos monitorados (pesquisas agendadas)" ajuda="Um por linha ou separados por vírgula. Já vem com termos de IA, tecnologia e startups.">
              <textarea className="entrada" rows={4} value={termos ?? opcoes.dados.termosMonitorados.join('\n')} onChange={(e) => setTermos(e.target.value)} />
            </Campo>
            <Campo rotulo="Termos do nicho do canal" ajuda="Usados para estimar a relação com o nicho.">
              <textarea className="entrada" rows={4} value={nicho ?? opcoes.dados.nicho.join('\n')} onChange={(e) => setNicho(e.target.value)} />
            </Campo>
          </div>
          <div className="acoes" style={{ marginTop: 12 }}>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={opcoes.dados.somenteConfiaveis}
                onChange={(e) => void executarSeguro(async () => { await chamar('pesquisa:salvarOpcoes', { ...opcoes.dados!, somenteConfiaveis: e.target.checked }); opcoes.recarregar() })}
              />
              Usar somente domínios confiáveis
            </label>
            <span style={{ flex: 1 }} />
            <button className="botao" onClick={() => setTermos(TERMOS_PADRAO.join('\n'))}>
              Usar termos padrão
            </button>
            <button
              className="botao primario"
              disabled={termos === null && nicho === null}
              onClick={() =>
                void executarSeguro(async () => {
                  await chamar('pesquisa:salvarOpcoes', {
                    ...opcoes.dados!,
                    termosMonitorados: termos === null ? opcoes.dados!.termosMonitorados : lista(termos),
                    nicho: nicho === null ? opcoes.dados!.nicho : lista(nicho)
                  })
                  setTermos(null)
                  setNicho(null)
                  avisar('Opções salvas.')
                  opcoes.recarregar()
                })
              }
            >
              Salvar termos
            </button>
          </div>
        </Secao>
      )}
    </>
  )
}

/** Cole o endereço do site (ou do feed): o aplicativo identifica o feed e mostra antes de adicionar. */
function NovaFonte({ projetoId, aoAdicionar }: { projetoId: number; aoAdicionar: () => void }) {
  const { avisar, avisarErro } = useRetorno()
  const [endereco, setEndereco] = useState('')
  const [achada, setAchada] = useState<FonteIdentificada | null>(null)
  const [procurando, setProcurando] = useState(false)
  const identificar = async (): Promise<void> => {
    setProcurando(true)
    setAchada(null)
    try {
      setAchada(await chamar('pesquisa:identificarFonte', { url: endereco }))
    } catch (e) {
      avisarErro(mensagemDeErro(e))
    } finally {
      setProcurando(false)
    }
  }
  const adicionar = async (): Promise<void> => {
    if (!achada) return
    try {
      await chamar('pesquisa:adicionarFonte', { projetoId, tipo: achada.tipo, nome: achada.nome.slice(0, 120) || 'Fonte', url: achada.url })
      avisar('Fonte adicionada.')
      setAchada(null)
      setEndereco('')
      aoAdicionar()
    } catch (e) {
      avisarErro(mensagemDeErro(e))
    }
  }
  return (
    <div className="cartao-suave">
      <form
        className="form-linha"
        onSubmit={(e) => {
          e.preventDefault()
          void identificar()
        }}
      >
        <div style={{ flex: 1, minWidth: 260 }}>
          <Campo rotulo="Adicionar fonte: endereço do site ou do feed">
            <input className="entrada" value={endereco} onChange={(e) => setEndereco(e.target.value)} placeholder="ex.: tecnoblog.net ou https://site.com/feed/" maxLength={2000} />
          </Campo>
        </div>
        <button className="botao primario" type="submit" disabled={endereco.trim().length < 3 || procurando}>
          {procurando ? 'Procurando o feed…' : 'Identificar'}
        </button>
      </form>
      {achada && (
        <div className="lista-item" style={{ marginTop: 10 }}>
          <Etiqueta cor={achada.tipo === 'rss' ? 'verde' : 'amarela'}>{achada.tipo === 'rss' ? 'Feed RSS' : 'Página'}</Etiqueta>
          <div className="lista-principal">
            <input className="entrada" value={achada.nome} onChange={(e) => setAchada({ ...achada, nome: e.target.value })} maxLength={120} aria-label="Nome da fonte" />
            <div className="lista-meta">
              <span>{achada.url}</span>
            </div>
            <div className="secundario pequeno">{achada.detalhe}</div>
          </div>
          <button className="botao primario pequeno" onClick={() => void adicionar()} disabled={!achada.nome.trim()}>
            Adicionar
          </button>
          <button className="botao pequeno fantasma" onClick={() => setAchada(null)}>
            Cancelar
          </button>
        </div>
      )}
    </div>
  )
}

/** Sites que apareceram nos resultados e têm feed: entram só com a aprovação do usuário. */
export function SugestoesFontes({ projetoId, aoAprovar }: { projetoId: number; aoAprovar?: () => void }) {
  const { avisar, avisarErro } = useRetorno()
  const lista = useDados(() => chamar('pesquisa:sugestoesFontes', { projetoId }), [projetoId])
  if (!lista.dados?.length) return null
  const agir = async (canal: 'pesquisa:aprovarSugestao' | 'pesquisa:recusarSugestao', id: number, msg: string): Promise<void> => {
    try {
      await chamar(canal, { id })
      avisar(msg)
      lista.recarregar()
      aoAprovar?.()
    } catch (e) {
      avisarErro(mensagemDeErro(e))
    }
  }
  return (
    <Secao titulo={`Novas fontes sugeridas (${lista.dados.length})`}>
      <p className="secundario pequeno" style={{ marginTop: 0 }}>
        Estes sites apareceram várias vezes nos resultados das suas pesquisas e têm feed público. Aprove para incluir nas próximas pesquisas ou recuse para não ver de novo. Confira se o site é confiável antes de aprovar.
      </p>
      <ul className="lista">
        {lista.dados.map((s) => (
          <li key={s.id} className="lista-item">
            <Etiqueta cor="azul">{s.ocorrencias}×</Etiqueta>
            <div className="lista-principal">
              <div className="lista-titulo">
                {s.nome} <span className="secundario pequeno">({s.dominio})</span>
              </div>
              <div className="lista-meta">
                <span>Feed: {s.url}</span>
              </div>
              {s.exemploTitulo && (
                <div className="secundario pequeno">
                  Exemplo visto:{' '}
                  <a href={s.exemploUrl} target="_blank" rel="noreferrer">
                    {s.exemploTitulo}
                  </a>
                </div>
              )}
            </div>
            <button className="botao primario pequeno" onClick={() => void agir('pesquisa:aprovarSugestao', s.id, 'Fonte aprovada e adicionada.')}>
              Aprovar
            </button>
            <button className="botao pequeno fantasma" onClick={() => void agir('pesquisa:recusarSugestao', s.id, 'Sugestão recusada.')}>
              Recusar
            </button>
          </li>
        ))}
      </ul>
    </Secao>
  )
}

/** Faixas da barra da pesquisa: fontes 0–85%, classificar 85–90%, novas fontes 90–98%. */
function percentualPesquisa(p: ProgressoPesquisa): number {
  if (/conclu/i.test(p.etapa)) return 100
  if (/novas fontes/i.test(p.etapa)) return 93
  if (/classificando/i.test(p.etapa)) return 88
  return p.fontesTotal ? (p.fontesFeitas / p.fontesTotal) * 85 : 0
}
