import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { chamar, mensagemDeErro, useDados } from '../api'
import { Icone } from '../componentes/Icone'
import { useRetorno } from '../componentes/retorno'
import { Alerta, Campo, Carregando, Dialogo, ErroCarregar, Etiqueta, Secao, Vazio, formatarBytes, formatarData, formatarSegundos } from '../componentes/ui'
import {
  FAIXAS,
  ROTULO_FAIXA,
  adicionarClip,
  ajustarClip,
  cortarClip,
  duracaoTotal,
  montarAutomaticamente,
  moverClip,
  problemasEstado,
  removerClip,
  reordenarCena,
  substituirRecurso,
  type Clip,
  type EstadoEdicao,
  type Faixa
} from '@shared/edicao'
import { PRESETS_RENDER, QUALIDADES_RENDER, RESOLUCAO_INFO, custoRelativo, estimarBytesRender, presetsDoFormato, type OpcoesRender, type PresetRender } from '@shared/midia'
import { OpcoesAvancadas } from '../componentes/render'
import { BarraProgresso, useProgressoRemoto } from '../componentes/progresso'
import { ProduzirMidias } from '../componentes/midiaAuto'
import type { DadosRecomendacao, ProjetoEdicao, RecursoMidia, RelatorioQualidade, Renderizacao } from '@shared/tipos'

/** " · 30 q/s · Alta" a partir do JSON guardado (renderizações antigas não têm opções). */
function descreverOpcoes(json: string): string {
  try {
    const o = JSON.parse(json) as Partial<OpcoesRender>
    if (!o.fps || !o.qualidade) return ''
    return ` · ${o.fps} q/s · ${QUALIDADES_RENDER[o.qualidade]?.rotulo.split(' (')[0] ?? o.qualidade}`
  } catch {
    return ''
  }
}

const CATEGORIAS_DA_FAIXA: Record<Faixa, RecursoMidia['categoria'][]> = { video: ['video', 'imagem'], audio: ['audio', 'video'], narracao: ['audio'], legendas: [], textos: [] }

export function EditorVideo({ id, voltar }: { id: number; voltar: () => void }) {
  const dados = useDados(() => chamar('edicao:obter', { id }), [id])
  if (dados.erro) return <ErroCarregar mensagem={dados.erro} tentarNovamente={dados.recarregar} />
  if (!dados.dados || dados.dados.id !== id) return <Carregando />
  return <EditorCarregado key={id} inicial={dados.dados} voltar={voltar} />
}

function EditorCarregado({ inicial, voltar }: { inicial: ProjetoEdicao; voltar: () => void }) {
  const { avisar, avisarErro, confirmar } = useRetorno()
  const [estado, setEstado] = useState<EstadoEdicao>(inicial.estado)
  const [desfazer, setDesfazer] = useState<EstadoEdicao[]>([])
  const [refazer, setRefazer] = useState<EstadoEdicao[]>([])
  const [selecionado, setSelecionado] = useState<string | null>(null)
  const [t, setT] = useState(0)
  const [tocando, setTocando] = useState(false)
  const [escala, setEscala] = useState(40)
  const [salvo, setSalvo] = useState<{ revisao: number; em: string | null; pendente: boolean; erro: string | null }>({ revisao: inicial.revisao, em: inicial.atualizadoEm, pendente: false, erro: null })
  const [adicionar, setAdicionar] = useState<Faixa | null>(null)
  // Mídias do projeto (canal) do roteiro deste vídeo.
  const midia = useDados(() => chamar('roteiros:obter', { id: inicial.roteiroId }).then((r) => chamar('midia:listar', { projetoId: r.projetoId, roteiroId: null })), [inicial.roteiroId])
  const recursos = useMemo(() => new Map((midia.dados ?? []).map((m) => [m.id, m])), [midia.dados])
  const total = Math.max(1, duracaoTotal(estado))
  const clip = estado.clips.find((c) => c.id === selecionado) ?? null

  // Toda alteração passa por aqui: guarda o estado anterior para desfazer.
  const aplicar = useCallback((fn: (e: EstadoEdicao) => EstadoEdicao) => {
    setEstado((atual) => {
      let novo: EstadoEdicao
      try {
        novo = fn(atual)
      } catch (e) {
        avisarErro(mensagemDeErro(e))
        return atual
      }
      if (novo === atual) return atual
      setDesfazer((d) => [...d.slice(-99), atual])
      setRefazer([])
      setSalvo((s) => ({ ...s, pendente: true }))
      return novo
    })
  }, [avisarErro])

  const voltarEstado = useCallback((direcao: 'desfazer' | 'refazer') => {
    const origem = direcao === 'desfazer' ? desfazer : refazer
    const alvo = origem.at(-1)
    if (!alvo) return
    if (direcao === 'desfazer') {
      setDesfazer(origem.slice(0, -1))
      setRefazer((r) => [...r, estado])
    } else {
      setRefazer(origem.slice(0, -1))
      setDesfazer((d) => [...d, estado])
    }
    setEstado(alvo)
    setSalvo((s) => ({ ...s, pendente: true }))
  }, [desfazer, refazer, estado])

  // Salvamento automático (1,5 s depois da última alteração).
  const revisaoRef = useRef(inicial.revisao)
  useEffect(() => {
    if (!salvo.pendente) return
    const tm = setTimeout(async () => {
      try {
        const r = await chamar('edicao:salvar', { id: inicial.id, revisaoBase: revisaoRef.current, estado })
        revisaoRef.current = r.revisao
        setSalvo({ revisao: r.revisao, em: r.salvoEm, pendente: false, erro: null })
      } catch (e) {
        const m = mensagemDeErro(e)
        if (/salvo em outro lugar/i.test(m)) {
          // Outra parte do app (ex.: o piloto automático) salvou uma versão mais nova: carrega a mais nova.
          const novo = await chamar('edicao:obter', { id: inicial.id })
          revisaoRef.current = novo.revisao
          setEstado(novo.estado)
          setSalvo({ revisao: novo.revisao, em: novo.atualizadoEm, pendente: false, erro: null })
          avisar('Este projeto foi atualizado pelo piloto automático: carreguei a versão mais nova.')
        } else setSalvo((s) => ({ ...s, erro: m }))
      }
    }, 1500)
    return () => clearTimeout(tm)
  }, [estado, salvo.pendente, inicial.id, avisar])

  // Enquanto o editor está aberto sem alterações pendentes, acompanha as mudanças feitas pelo piloto.
  useEffect(() => {
    if (salvo.pendente) return
    const t = setInterval(async () => {
      try {
        const novo = await chamar('edicao:obter', { id: inicial.id })
        if (novo.revisao > revisaoRef.current) {
          revisaoRef.current = novo.revisao
          setEstado(novo.estado)
          setSalvo({ revisao: novo.revisao, em: novo.atualizadoEm, pendente: false, erro: null })
          midia.recarregar()
        }
      } catch {
        // sem conexão com o processo principal: tenta de novo no próximo intervalo
      }
    }, 4000)
    return () => clearInterval(t)
  }, [salvo.pendente, inicial.id, midia])

  // Atalhos: Ctrl+Z desfaz, Ctrl+Y ou Ctrl+Shift+Z refaz, espaço toca/pausa.
  useEffect(() => {
    const tecla = (e: KeyboardEvent): void => {
      const alvo = e.target as HTMLElement
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(alvo.tagName)) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        voltarEstado(e.shiftKey ? 'refazer' : 'desfazer')
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        voltarEstado('refazer')
      } else if (e.key === ' ') {
        e.preventDefault()
        setTocando((x) => !x)
      }
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [voltarEstado])

  // Reprodução da pré-visualização.
  useEffect(() => {
    if (!tocando) return
    let ultimo = performance.now()
    let quadro = 0
    const passo = (agora: number): void => {
      setT((x) => {
        const n = x + (agora - ultimo) / 1000
        if (n >= total) {
          setTocando(false)
          return total
        }
        return n
      })
      ultimo = agora
      quadro = requestAnimationFrame(passo)
    }
    quadro = requestAnimationFrame(passo)
    return () => cancelAnimationFrame(quadro)
  }, [tocando, total])

  const problemas = problemasEstado(estado, new Set(recursos.keys()))
  const noTempo = (f: Faixa): Clip | undefined => estado.clips.find((c) => c.faixa === f && t >= c.inicio && t < c.inicio + c.duracao)
  const visual = noTempo('video')
  const recursoVisual = visual?.recursoId ? recursos.get(visual.recursoId) : undefined
  const proporcao = estado.formato === '16:9' ? 16 / 9 : 9 / 16

  return (
    <>
      <header className="cabecalho">
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', minWidth: 0 }}>
          <button className="botao botao-icone fantasma" onClick={voltar} aria-label="Voltar">
            <Icone nome="voltar" />
          </button>
          <div>
            <h1>{inicial.nome}</h1>
            <p>
              {estado.formato} · {total.toFixed(1)} s ·{' '}
              {salvo.erro ? <span style={{ color: 'var(--vermelho-suave)' }}>Erro ao salvar: {salvo.erro}</span> : salvo.pendente ? 'Salvando…' : `Salvo automaticamente ${formatarData(salvo.em, true)} (revisão ${salvo.revisao})`}
            </p>
          </div>
        </div>
        <div className="acoes">
          <button
            className="botao primario"
            disabled={!midia.dados}
            title="Coloca as mídias da biblioteca nas cenas vazias, a narração e a trilha"
            onClick={async () => {
              const r = montarAutomaticamente(
                estado,
                (midia.dados ?? []).filter((m) => m.arquivoExiste).map((m) => ({ id: m.id, categoria: m.categoria, cena: m.cena, nome: m.nomeOriginal, duracaoSeg: m.duracaoSeg }))
              )
              const ok = await confirmar({
                titulo: 'Montar automaticamente?',
                texto: `${r.relatorio.join(' ')} Cenas que você já montou não mudam, e dá para desfazer (Ctrl+Z).`,
                confirmar: r.estado === estado ? 'Entendi' : 'Aplicar'
              })
              if (ok && r.estado !== estado) {
                aplicar(() => r.estado)
                avisar('Montagem automática aplicada.')
              }
            }}
          >
            Montar automaticamente
          </button>
          <ProduzirMidias
            edicaoId={inicial.id}
            antes={() => !salvo.pendente}
            depois={async (relatorio) => {
              // A produção salvou uma nova revisão no banco: traz o estado novo (Ctrl+Z desfaz) e atualiza a biblioteca.
              const novo = await chamar('edicao:obter', { id: inicial.id })
              revisaoRef.current = novo.revisao
              setSalvo((s) => ({ ...s, revisao: novo.revisao, em: novo.atualizadoEm, erro: null }))
              aplicar(() => novo.estado)
              midia.recarregar()
              avisar(relatorio[0] ?? 'Mídias produzidas.')
            }}
          />
          <button className="botao" disabled={!desfazer.length} onClick={() => voltarEstado('desfazer')} title="Ctrl+Z">
            Desfazer
          </button>
          <button className="botao" disabled={!refazer.length} onClick={() => voltarEstado('refazer')} title="Ctrl+Y">
            Refazer
          </button>
        </div>
      </header>

      <div className="estudio">
        <div>
          <Secao>
            <div className="preview-moldura" style={{ aspectRatio: String(proporcao), width: estado.formato === '9:16' ? 'min(100%, 30vh)' : '100%' }}>
              {recursoVisual?.categoria === 'imagem' && <img src={`midia://recurso/${recursoVisual.id}`} alt="" />}
              {recursoVisual?.categoria === 'video' && <VideoSincronizado src={`midia://recurso/${recursoVisual.id}`} tempo={visual!.corteInicio + t - visual!.inicio} tocando={tocando} />}
              {noTempo('textos') && <div className="preview-texto">{noTempo('textos')!.texto}</div>}
              {noTempo('legendas') && <div className="preview-legenda">{noTempo('legendas')!.texto}</div>}
            </div>
            <div className="form-linha" style={{ marginTop: 8, alignItems: 'center' }}>
              <button className="botao pequeno" onClick={() => setTocando((x) => !x)} title="Espaço">
                {tocando ? 'Pausar' : 'Reproduzir'}
              </button>
              <input type="range" min={0} max={total} step={0.05} value={t} onChange={(e) => setT(Number(e.target.value))} style={{ flex: 1, accentColor: 'var(--destaque)' }} aria-label="Posição" />
              <span className="secundario pequeno">
                {t.toFixed(1)} / {total.toFixed(1)} s
              </span>
            </div>
            <p className="secundario pequeno">Pré-visualização simplificada (imagens, vídeo e textos, sem mistura de áudio). O resultado final vem da renderização.</p>
          </Secao>

          <Secao
            titulo="Linha do tempo"
            acoes={
              <div className="acoes">
                <label className="secundario pequeno">
                  Zoom <input type="range" min={10} max={160} value={escala} onChange={(e) => setEscala(Number(e.target.value))} />
                </label>
              </div>
            }
          >
            <div className="linha-tempo">
              <div className="regua" style={{ width: total * escala + 40 }} onClick={(e) => setT(Math.max(0, (e.clientX - e.currentTarget.getBoundingClientRect().left) / escala))}>
                {Array.from({ length: Math.ceil(total / 5) + 1 }, (_, i) => (
                  <span key={i} style={{ position: 'absolute', left: i * 5 * escala }}>
                    {i * 5}s
                  </span>
                ))}
              </div>
              {FAIXAS.map((f) => (
                <div key={f} className="faixa-linha">
                  <div className="faixa-rotulo">{ROTULO_FAIXA[f]}</div>
                  <div className="faixa-area" style={{ width: total * escala + 40 }}>
                    {estado.clips
                      .filter((c) => c.faixa === f)
                      .map((c) => (
                        <div
                          key={c.id}
                          className={`clip ${f}`}
                          role="button"
                          tabIndex={0}
                          aria-selected={c.id === selecionado}
                          style={{ left: c.inicio * escala, width: Math.max(4, c.duracao * escala) }}
                          onClick={() => setSelecionado(c.id)}
                          onKeyDown={(e) => e.key === 'Enter' && setSelecionado(c.id)}
                          title={c.texto || (c.recursoId ? recursos.get(c.recursoId)?.nomeOriginal : '')}
                        >
                          {c.texto || (c.recursoId ? recursos.get(c.recursoId)?.nomeOriginal ?? 'mídia ausente' : '')}
                        </div>
                      ))}
                  </div>
                </div>
              ))}
              <div className="cursor-tempo" style={{ left: 110 + t * escala }} />
            </div>
            <div className="acoes" style={{ marginTop: 8 }}>
              {FAIXAS.map((f) => (
                <button key={f} className="botao pequeno" onClick={() => (f === 'legendas' || f === 'textos' ? aplicar((e) => adicionarClip(e, { faixa: f, recursoId: null, inicio: t, duracao: 3, corteInicio: 0, volume: 1, fadeIn: 0, fadeOut: 0, texto: f === 'textos' ? 'Texto na tela' : 'Legenda', cena: null })) : setAdicionar(f))}>
                  + {ROTULO_FAIXA[f]}
                </button>
              ))}
            </div>
            {problemas.map((p) => (
              <Alerta key={p}>{p}</Alerta>
            ))}
          </Secao>

          <Renderizacoes edicaoId={inicial.id} formato={estado.formato} pendente={salvo.pendente} />
        </div>

        <aside>
          <Secao titulo={clip ? `Clipe: ${ROTULO_FAIXA[clip.faixa]}` : 'Clipe'}>
            {!clip ? (
              <p className="secundario pequeno">Selecione um clipe na linha do tempo.</p>
            ) : (
              <div style={{ display: 'grid', gap: 10 }}>
                <div className="form-grade" style={{ gridTemplateColumns: '1fr 1fr' }}>
                  <Campo rotulo="Início (s)">
                    <input type="number" step={0.1} min={0} className="entrada" value={clip.inicio} onChange={(e) => aplicar((s) => ajustarClip(s, clip.id, { inicio: Math.max(0, Number(e.target.value) || 0) }))} />
                  </Campo>
                  <Campo rotulo="Duração (s)">
                    <input type="number" step={0.1} min={0.1} className="entrada" value={clip.duracao} onChange={(e) => aplicar((s) => ajustarClip(s, clip.id, { duracao: Math.max(0.1, Number(e.target.value) || 0.1) }))} />
                  </Campo>
                  {clip.recursoId !== null && (
                    <Campo rotulo="Corte no início (s)">
                      <input type="number" step={0.1} min={0} className="entrada" value={clip.corteInicio} onChange={(e) => aplicar((s) => ajustarClip(s, clip.id, { corteInicio: Math.max(0, Number(e.target.value) || 0) }))} />
                    </Campo>
                  )}
                  {(clip.faixa === 'audio' || clip.faixa === 'narracao') && (
                    <>
                      <Campo rotulo="Volume (0–2)">
                        <input type="number" step={0.1} min={0} max={2} className="entrada" value={clip.volume} onChange={(e) => aplicar((s) => ajustarClip(s, clip.id, { volume: Math.min(2, Math.max(0, Number(e.target.value) || 0)) }))} />
                      </Campo>
                      <Campo rotulo="Fade de entrada (s)">
                        <input type="number" step={0.1} min={0} className="entrada" value={clip.fadeIn} onChange={(e) => aplicar((s) => ajustarClip(s, clip.id, { fadeIn: Math.max(0, Number(e.target.value) || 0) }))} />
                      </Campo>
                      <Campo rotulo="Fade de saída (s)">
                        <input type="number" step={0.1} min={0} className="entrada" value={clip.fadeOut} onChange={(e) => aplicar((s) => ajustarClip(s, clip.id, { fadeOut: Math.max(0, Number(e.target.value) || 0) }))} />
                      </Campo>
                    </>
                  )}
                </div>
                {(clip.faixa === 'legendas' || clip.faixa === 'textos') && (
                  <Campo rotulo="Texto">
                    <textarea className="entrada" rows={3} value={clip.texto} maxLength={500} onChange={(e) => aplicar((s) => ajustarClip(s, clip.id, { texto: e.target.value }))} />
                  </Campo>
                )}
                {CATEGORIAS_DA_FAIXA[clip.faixa].length > 0 && (
                  <Campo rotulo="Mídia (substituir)">
                    <select className="entrada" value={clip.recursoId ?? ''} onChange={(e) => e.target.value && aplicar((s) => substituirRecurso(s, clip.id, Number(e.target.value)))}>
                      <option value="">Escolha…</option>
                      {(midia.dados ?? [])
                        .filter((m) => CATEGORIAS_DA_FAIXA[clip.faixa].includes(m.categoria))
                        .map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.nomeOriginal}
                          </option>
                        ))}
                    </select>
                  </Campo>
                )}
                {clip.recursoId && recursos.get(clip.recursoId)?.alertas.map((a) => <div key={a} className="pequeno" style={{ color: '#ffd45e' }}>{a}</div>)}
                <div className="acoes">
                  <button className="botao pequeno" onClick={() => aplicar((s) => moverClip(s, clip.id, -0.5))}>
                    ◀ 0,5 s
                  </button>
                  <button className="botao pequeno" onClick={() => aplicar((s) => moverClip(s, clip.id, 0.5))}>
                    0,5 s ▶
                  </button>
                  <button className="botao pequeno" onClick={() => aplicar((s) => cortarClip(s, clip.id, t))}>
                    Cortar no cursor
                  </button>
                  <button
                    className="botao pequeno perigo"
                    onClick={() => {
                      aplicar((s) => removerClip(s, clip.id))
                      setSelecionado(null)
                    }}
                  >
                    Remover
                  </button>
                </div>
              </div>
            )}
          </Secao>
          <Secao titulo="Cenas do roteiro">
            <ul className="lista">
              {estado.cenas.map((c) => (
                <li key={c.indice} className="lista-item" style={{ padding: '6px 4px' }}>
                  <div className="lista-principal pequeno">{c.titulo}</div>
                  <button className="botao pequeno fantasma" aria-label="Subir cena" onClick={() => aplicar((s) => reordenarCena(s, c.indice, -1))}>
                    ↑
                  </button>
                  <button className="botao pequeno fantasma" aria-label="Descer cena" onClick={() => aplicar((s) => reordenarCena(s, c.indice, 1))}>
                    ↓
                  </button>
                </li>
              ))}
            </ul>
          </Secao>
          <Copias edicaoId={inicial.id} />
        </aside>
      </div>
      {adicionar && (
        <DialogoAdicionar
          faixa={adicionar}
          midia={midia.dados ?? []}
          aoFechar={(r) => {
            setAdicionar(null)
            if (r) aplicar((s) => adicionarClip(s, { faixa: adicionar, recursoId: r.id, inicio: t, duracao: r.categoria === 'imagem' ? 4 : 6, corteInicio: 0, volume: 1, fadeIn: 0, fadeOut: 0, texto: '', cena: null }))
          }}
        />
      )}
    </>
  )
}

function VideoSincronizado({ src, tempo, tocando }: { src: string; tempo: number; tocando: boolean }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const v = ref.current
    if (v && Math.abs(v.currentTime - tempo) > (tocando ? 0.4 : 0.05)) v.currentTime = Math.max(0, tempo)
  }, [tempo, tocando])
  useEffect(() => {
    const v = ref.current
    if (!v) return
    if (tocando) void v.play().catch(() => undefined)
    else v.pause()
  }, [tocando])
  return <video ref={ref} src={src} muted playsInline />
}

function DialogoAdicionar({ faixa, midia, aoFechar }: { faixa: Faixa; midia: RecursoMidia[]; aoFechar: (r: RecursoMidia | null) => void }) {
  const opcoes = midia.filter((m) => CATEGORIAS_DA_FAIXA[faixa].includes(m.categoria) && m.arquivoExiste)
  const [escolhido, setEscolhido] = useState<number | null>(opcoes[0]?.id ?? null)
  return (
    <Dialogo
      aberto
      aoFechar={() => aoFechar(null)}
      titulo={`Adicionar em ${ROTULO_FAIXA[faixa]}`}
      acoes={
        <>
          <button className="botao fantasma" onClick={() => aoFechar(null)}>
            Cancelar
          </button>
          <button className="botao primario" disabled={escolhido === null} onClick={() => aoFechar(opcoes.find((o) => o.id === escolhido) ?? null)}>
            Adicionar no cursor
          </button>
        </>
      }
    >
      {opcoes.length === 0 ? (
        <Vazio compacto titulo="Nenhuma mídia compatível" texto="Importe arquivos na aba Biblioteca de mídia." />
      ) : (
        <Campo rotulo="Mídia">
          <select className="entrada" value={escolhido ?? ''} onChange={(e) => setEscolhido(Number(e.target.value))}>
            {opcoes.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nomeOriginal} {m.alertas.length ? '(licença pendente)' : ''}
              </option>
            ))}
          </select>
        </Campo>
      )}
    </Dialogo>
  )
}

function Copias({ edicaoId }: { edicaoId: number }) {
  const { avisar, avisarErro, confirmar } = useRetorno()
  const lista = useDados(() => chamar('edicao:snapshots', { id: edicaoId }), [edicaoId])
  return (
    <Secao titulo="Cópias de segurança" acoes={<button className="botao pequeno" onClick={lista.recarregar}>Atualizar</button>}>
      <p className="secundario pequeno">Cada salvamento automático guarda uma cópia (as 30 mais recentes).</p>
      <ul className="lista">
        {lista.dados?.slice(0, 8).map((s) => (
          <li key={s.id} className="lista-item" style={{ padding: '4px' }}>
            <div className="lista-principal pequeno">
              Revisão {s.revisao} · {formatarData(s.criadoEm, true)} · {s.clips} clipes
            </div>
            <button
              className="botao pequeno fantasma"
              onClick={async () => {
                if (!(await confirmar({ titulo: 'Restaurar esta cópia?', texto: 'Ela vira a revisão atual; a situação de agora continua guardada nas cópias. A tela será recarregada.', confirmar: 'Restaurar' }))) return
                try {
                  await chamar('edicao:restaurar', { id: edicaoId, snapshotId: s.id })
                  avisar('Cópia restaurada. Reabra o projeto para ver.')
                } catch (e) {
                  avisarErro(mensagemDeErro(e))
                }
              }}
            >
              Restaurar
            </button>
          </li>
        ))}
      </ul>
    </Secao>
  )
}

function Renderizacoes({ edicaoId, formato, pendente }: { edicaoId: number; formato: '16:9' | '9:16'; pendente: boolean }) {
  const ferramentas = useDados(() => chamar('producao:ferramentas'), [])
  const rec = useDados(() => chamar('producao:recomendacao', { edicaoId }), [edicaoId, formato])
  if (rec.erro) return <ErroCarregar mensagem={rec.erro} tentarNovamente={rec.recarregar} />
  if (!rec.dados) return <Carregando texto="Analisando as mídias do projeto…" />
  return <RenderizacoesCarregado key={`${edicaoId}-${formato}`} edicaoId={edicaoId} formato={formato} pendente={pendente} rec={rec.dados} temFfmpeg={Boolean(ferramentas.dados?.encontrado)} />
}

function RenderizacoesCarregado({ edicaoId, formato, pendente, rec, temFfmpeg }: { edicaoId: number; formato: '16:9' | '9:16'; pendente: boolean; rec: DadosRecomendacao; temFfmpeg: boolean }) {
  const { avisar, avisarErro } = useRetorno()
  const lista = useDados(() => chamar('producao:renderizacoes', { edicaoId }), [edicaoId])
  const presets = presetsDoFormato(formato)
  const [preset, setPreset] = useState<PresetRender>(rec.sugerido.preset)
  const [opcoes, setOpcoes] = useState<OpcoesRender>(rec.sugerido.opcoes)
  const [avancado, setAvancado] = useState(false)
  const [qualidade, setQualidade] = useState<Renderizacao | null>(null)
  const emAndamento = lista.dados?.some((r) => r.status === 'em_andamento')
  useEffect(() => {
    if (!emAndamento) return
    const t = setInterval(lista.recarregar, 1000)
    return () => clearInterval(t)
  }, [emAndamento, lista.recarregar])

  const r = rec.recomendacao
  const ehRecomendado = preset === r.preset && opcoes.fps === r.opcoes.fps && opcoes.qualidade === r.opcoes.qualidade && opcoes.velocidade === r.opcoes.velocidade
  const bytes = estimarBytesRender(preset, opcoes, rec.duracaoSeg)
  const faltaEspaco = rec.livreBytes !== null && rec.livreBytes < bytes * 1.5

  if (qualidade) return <PainelQualidade render={qualidade} voltar={() => setQualidade(null)} />
  return (
    <Secao titulo="Exportar / renderizar">
      {!temFfmpeg && <Alerta>FFmpeg não encontrado: a renderização não está disponível. Veja Estúdio › Ferramentas ou Primeiros passos › Vídeo.</Alerta>}

      <div className="cartao-recomendacao">
        <div className="secao-titulo">
          <strong>
            Recomendado para este projeto: {PRESETS_RENDER[r.preset].rotulo} · {r.opcoes.fps} quadros/s
          </strong>
          <button
            className="botao pequeno"
            disabled={ehRecomendado}
            onClick={() => {
              setPreset(r.preset)
              setOpcoes(r.opcoes)
            }}
          >
            {ehRecomendado ? 'Em uso' : 'Usar recomendação'}
          </button>
        </div>
        <ul className="secundario pequeno">
          {r.motivos.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
        {rec.preferencia.modo === 'fixo' && <p className="secundario pequeno">Sua preferência está em resolução fixa (Configurações › Vídeo e renderização); por isso a escolha inicial segue a preferência.</p>}
      </div>

      <p className="rotulo-grupo">Resolução</p>
      <div className="opcoes-escolha" role="radiogroup" aria-label="Resolução">
        {presets.map((p) => {
          const avisos = r.avisos[p] ?? []
          return (
            <label key={p} className={`opcao${preset === p ? ' selecionada' : ''}`}>
              <input type="radio" name="resolucao" checked={preset === p} onChange={() => setPreset(p)} />
              <div>
                <div className="opcao-titulo">
                  {RESOLUCAO_INFO[PRESETS_RENDER[p].resolucao].nome} {p === r.preset && <Etiqueta cor="verde">Recomendado</Etiqueta>}
                </div>
                <div className="lista-meta">
                  {PRESETS_RENDER[p].largura}×{PRESETS_RENDER[p].altura} · até {formatarBytes(estimarBytesRender(p, opcoes, rec.duracaoSeg))} · tempo ≈ {custoRelativo(p, opcoes)}× o do 1080p
                </div>
                {avisos.map((a) => (
                  <div key={a} className="opcao-aviso">
                    {a}
                  </div>
                ))}
              </div>
            </label>
          )
        })}
      </div>

      <button className="botao fantasma pequeno" style={{ marginTop: 12 }} onClick={() => setAvancado(!avancado)} aria-expanded={avancado}>
        {avancado ? 'Ocultar opções avançadas' : 'Opções avançadas (quadros por segundo, qualidade, velocidade)'}
      </button>
      {avancado && <OpcoesAvancadas opcoes={opcoes} mudar={setOpcoes} fpsRecomendado={r.opcoes.fps} />}

      <div className="resumo-render">
        <span>
          Duração {formatarSegundos(rec.duracaoSeg)} · arquivo de até <strong>{formatarBytes(bytes)}</strong>
          {rec.livreBytes !== null && <> · espaço livre {formatarBytes(rec.livreBytes)}</>}
        </span>
        {!ehRecomendado && <Etiqueta cor="amarela">Escolha personalizada</Etiqueta>}
      </div>
      {faltaEspaco && <Alerta tipo="erro">Espaço em disco insuficiente para esta escolha. Libere espaço ou escolha uma resolução menor.</Alerta>}
      <div className="form-linha" style={{ marginTop: 12 }}>
        <button
          className="botao primario"
          disabled={!temFfmpeg || emAndamento || pendente || faltaEspaco}
          title={pendente ? 'Aguarde o salvamento automático' : undefined}
          onClick={async () => {
            try {
              await chamar('producao:renderizar', { edicaoId, preset, opcoes })
              avisar('Renderização iniciada.')
              lista.recarregar()
            } catch (e) {
              avisarErro(mensagemDeErro(e))
            }
          }}
        >
          Renderizar
        </button>
      </div>
      <p className="secundario pequeno">A duração da renderização depende do computador; não há garantia de rapidez. Em 4K pode levar muitas vezes a duração do vídeo.</p>
      <ul className="lista">
        {lista.dados?.map((r) => (
          <li key={r.id} className="lista-item">
            <div className="lista-principal">
              <div>
                {PRESETS_RENDER[r.preset as PresetRender]?.rotulo ?? r.preset}
                {descreverOpcoes(r.opcoes)} · revisão {r.revisao} · {formatarData(r.criadoEm, true)}
              </div>
              {r.status === 'em_andamento' && (
                <BarraProgresso percentual={r.progresso * 100} etapa="Renderizando o vídeo" detalhe={r.progresso > 0 ? '' : 'Preparando as mídias…'} inicio={r.iniciadaEm} />
              )}
              {r.mensagem && <div className="lista-meta">{r.mensagem}</div>}
            </div>
            <Etiqueta cor={r.status === 'concluida' ? 'verde' : r.status === 'erro' ? 'vermelha' : r.status === 'em_andamento' ? 'amarela' : 'cinza'}>{r.status === 'em_andamento' ? `${Math.round(r.progresso * 100)}%` : r.status}</Etiqueta>
            {r.status === 'em_andamento' && (
              <button className="botao pequeno" onClick={() => void chamar('producao:cancelar', { id: r.id }).then(lista.recarregar)}>
                Cancelar
              </button>
            )}
            {r.status === 'concluida' && (
              <>
                <button className="botao pequeno fantasma" onClick={() => void chamar('producao:mostrarArquivo', { id: r.id })}>
                  Mostrar arquivo
                </button>
                <button className="botao pequeno" onClick={() => setQualidade(r)}>
                  Controle de qualidade
                </button>
                <button
                  className="botao pequeno"
                  onClick={async () => {
                    try {
                      await chamar('publicacoes:preparar', { renderizacaoId: r.id })
                      avisar('Rascunho de publicação pronto em Publicações.')
                    } catch (e) {
                      avisarErro(mensagemDeErro(e))
                    }
                  }}
                >
                  Preparar publicação
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
    </Secao>
  )
}

function PainelQualidade({ render, voltar }: { render: Renderizacao; voltar: () => void }) {
  const { avisarErro } = useRetorno()
  const relatorios = useDados(() => chamar('qualidade:relatorios', { id: render.id }), [render.id])
  const [executando, setExecutando] = useState(false)
  const [aceitar, setAceitar] = useState<{ rel: RelatorioQualidade; codigo: string; texto: string } | null>(null)
  const prog = useProgressoRemoto(() => chamar('qualidade:progresso', { id: render.id }), executando)
  const rel = relatorios.dados?.[0]
  return (
    <Secao
      titulo={`Controle de qualidade — renderização nº ${render.id}`}
      acoes={
        <div className="acoes">
          <button className="botao pequeno" onClick={voltar}>
            Voltar
          </button>
          <button
            className="botao pequeno primario"
            disabled={executando}
            onClick={async () => {
              setExecutando(true)
              try {
                await chamar('qualidade:executar', { id: render.id })
                relatorios.recarregar()
              } catch (e) {
                avisarErro(mensagemDeErro(e))
              } finally {
                setExecutando(false)
              }
            }}
          >
            {executando ? 'Verificando…' : 'Executar verificação'}
          </button>
        </div>
      }
    >
      <p className="secundario pequeno">As verificações automáticas reduzem erros, mas não garantem a ausência de todos. Bloqueadores impedem a publicação; avisos podem ser aceitos com justificativa.</p>
      {executando && <BarraProgresso percentual={prog?.percentual ?? 0} etapa={prog?.etapa ?? 'Preparando a verificação'} inicio={prog?.iniciadoEm} />}
      {!rel && !executando && <Vazio compacto titulo="Nenhuma verificação ainda" />}
      {rel && (
        <>
          <p>
            <Etiqueta cor={rel.aprovado ? 'verde' : 'vermelha'}>{rel.aprovado ? 'Aprovado para publicação' : 'Não aprovado'}</Etiqueta> · {rel.bloqueadores} bloqueador(es) · {rel.avisos} aviso(s) · {formatarData(rel.criadoEm, true)}
          </p>
          <ul className="lista">
            {rel.itens.map((i) => {
              const excecao = rel.excecoes.find((e) => e.codigo === i.codigo)
              return (
                <li key={i.codigo} className="lista-item">
                  <Etiqueta cor={i.nivel === 'bloqueador' ? 'vermelha' : i.nivel === 'aviso' ? (excecao ? 'cinza' : 'amarela') : 'verde'}>{i.nivel === 'ok' ? 'OK' : i.nivel}</Etiqueta>
                  <div className="lista-principal">
                    <div>{i.mensagem}</div>
                    {excecao && <div className="lista-meta">Exceção aceita em {formatarData(excecao.aceitaEm, true)}: {excecao.justificativa}</div>}
                  </div>
                  {i.nivel === 'aviso' && !excecao && (
                    <button className="botao pequeno fantasma" onClick={() => setAceitar({ rel, codigo: i.codigo, texto: '' })}>
                      Aceitar aviso
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
          {rel.capturas.length > 0 && (
            <>
              <h3>Quadros para inspeção visual</h3>
              <div className="capturas">
                {rel.capturas.map((c) => (
                  <img key={c} src={`midia://captura/${rel.id}/${c}`} alt={c} />
                ))}
              </div>
            </>
          )}
        </>
      )}
      <Dialogo
        aberto={aceitar !== null}
        aoFechar={() => setAceitar(null)}
        titulo="Aceitar aviso"
        acoes={
          <>
            <button className="botao fantasma" onClick={() => setAceitar(null)}>
              Cancelar
            </button>
            <button
              className="botao primario"
              disabled={!aceitar?.texto.trim()}
              onClick={async () => {
                try {
                  await chamar('qualidade:aceitar', { relatorioId: aceitar!.rel.id, codigo: aceitar!.codigo, justificativa: aceitar!.texto })
                  setAceitar(null)
                  relatorios.recarregar()
                } catch (e) {
                  avisarErro(mensagemDeErro(e))
                }
              }}
            >
              Aceitar e registrar
            </button>
          </>
        }
      >
        <Campo rotulo="Justificativa (fica registrada)">
          <textarea className="entrada" rows={3} value={aceitar?.texto ?? ''} onChange={(e) => setAceitar(aceitar && { ...aceitar, texto: e.target.value })} maxLength={500} autoFocus />
        </Campo>
      </Dialogo>
    </Secao>
  )
}
