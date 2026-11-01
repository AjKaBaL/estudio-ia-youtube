import { useState } from 'react'
import { chamar, mensagemDeErro, useDados } from '../api'
import { useRetorno } from '../componentes/retorno'
import { Alerta, Cabecalho, Campo, Carregando, Dialogo, ErroCarregar, Etiqueta, Secao, Vazio, formatarData } from '../componentes/ui'
import { ROTULO_DIA_SEMANA, ROTULO_TIPO_VIDEO } from '@shared/dominio'
import {
  FREQUENCIAS_PESQUISA,
  HORIZONTES,
  PERIODOS_PESQUISA,
  POLITICAS_PERDIDA,
  ROTULO_FREQUENCIA,
  ROTULO_PERIODO,
  ROTULO_POLITICA,
  configEditorialSchema,
  type ConfigEditorial,
  type FormatoAgenda
} from '@shared/editorial'
import type { ConfigEditorialComAlertas, Projeto } from '@shared/tipos'
import { Servicos } from './Servicos'
import { FerramentasFfmpeg } from './Estudio'
import { PreferenciaVideo } from '../componentes/render'
import { ConfigMidiaAutomatica } from '../componentes/midiaAuto'

type Aba = 'projetos' | 'editorial' | 'servicos' | 'video' | 'midia' | 'dados' | 'eventos'

let abaPedida: Aba | null = null
/** Outra tela pede que as Configurações abram numa aba específica (ex.: o assistente). */
export function pedirAbaConfig(aba: Aba): void {
  abaPedida = aba
}

export function Configuracoes() {
  const [aba, setAba] = useState<Aba>(() => {
    const a = abaPedida ?? 'projetos'
    abaPedida = null
    return a
  })
  return (
    <>
      <Cabecalho titulo="Configurações" descricao="Primeira vez? O menu Primeiros passos explica cada configuração, passo a passo." />
      <div className="abas" role="tablist">
        {(
          [
            ['projetos', 'Projetos'],
            ['editorial', 'Pesquisa e agenda'],
            ['servicos', 'Serviços de IA e custos'],
            ['video', 'Vídeo e renderização'],
            ['midia', 'Mídia automática (voz e imagens)'],
            ['dados', 'Dados e backup'],
            ['eventos', 'Registro de eventos']
          ] as const
        ).map(([v, r]) => (
          <button key={v} role="tab" className="aba" aria-selected={aba === v} onClick={() => setAba(v)}>
            {r}
          </button>
        ))}
      </div>
      {aba === 'projetos' && <Projetos />}
      {aba === 'editorial' && <Editorial />}
      {aba === 'servicos' && <Servicos />}
      {aba === 'video' && <VideoERender />}
      {aba === 'midia' && <ConfigMidiaAutomatica />}
      {aba === 'dados' && <Dados />}
      {aba === 'eventos' && <Eventos />}
    </>
  )
}

function Projetos() {
  const { avisar, avisarErro, confirmar } = useRetorno()
  const lista = useDados(() => chamar('projetos:listar'), [])
  const [editando, setEditando] = useState<Projeto | 'novo' | null>(null)
  const [f, setF] = useState({ nome: '', descricao: '' })

  const abrir = (p: Projeto | 'novo'): void => {
    setF(p === 'novo' ? { nome: '', descricao: '' } : { nome: p.nome, descricao: p.descricao })
    setEditando(p)
  }

  async function salvar(): Promise<void> {
    try {
      if (editando === 'novo') await chamar('projetos:criar', f)
      else if (editando) await chamar('projetos:atualizar', { id: editando.id, ...f })
      avisar('Projeto salvo.')
      setEditando(null)
      lista.recarregar()
    } catch (e) {
      avisarErro(mensagemDeErro(e))
    }
  }

  return (
    <Secao
      titulo="Projetos e canais"
      acoes={
        <button className="botao primario pequeno" onClick={() => abrir('novo')}>
          Novo projeto
        </button>
      }
    >
      {lista.erro && <ErroCarregar mensagem={lista.erro} tentarNovamente={lista.recarregar} />}
      {lista.carregando && !lista.dados && <Carregando />}
      {lista.dados?.length === 0 && <Vazio titulo="Nenhum projeto" texto="Crie um projeto para o seu canal. Ele agrupa pautas, roteiros e agenda." />}
      <ul className="lista">
        {lista.dados?.map((p) => (
          <li key={p.id} className="lista-item">
            <div className="lista-principal">
              <div className="lista-titulo">{p.nome}</div>
              <div className="lista-meta">
                {p.totalRoteiros} roteiro(s) · {p.totalPautas} pauta(s){p.descricao && ` · ${p.descricao}`}
              </div>
            </div>
            <button className="botao pequeno fantasma" onClick={() => abrir(p)}>
              Editar
            </button>
            <button
              className="botao pequeno fantasma"
              onClick={async () => {
                const ok = await confirmar({ titulo: 'Excluir projeto?', texto: `"${p.nome}" será excluído. Só é possível excluir projetos sem roteiros e sem pautas.`, confirmar: 'Excluir', perigo: true })
                if (!ok) return
                try {
                  await chamar('projetos:excluir', { id: p.id })
                  avisar('Projeto excluído.')
                  lista.recarregar()
                } catch (e) {
                  avisarErro(mensagemDeErro(e))
                }
              }}
            >
              Excluir
            </button>
          </li>
        ))}
      </ul>
      <Dialogo
        aberto={editando !== null}
        aoFechar={() => setEditando(null)}
        titulo={editando === 'novo' ? 'Novo projeto' : 'Editar projeto'}
        acoes={
          <>
            <button className="botao fantasma" onClick={() => setEditando(null)}>
              Cancelar
            </button>
            <button className="botao primario" onClick={() => void salvar()} disabled={!f.nome.trim()}>
              Salvar
            </button>
          </>
        }
      >
        <div style={{ display: 'grid', gap: 12 }}>
          <Campo rotulo="Nome do projeto ou canal">
            <input className="entrada" value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} maxLength={120} autoFocus />
          </Campo>
          <Campo rotulo="Descrição">
            <textarea className="entrada" rows={3} value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} maxLength={1000} />
          </Campo>
        </div>
      </Dialogo>
    </Secao>
  )
}

function Editorial() {
  const dados = useDados(() => chamar('editorial:obter'), [])
  if (dados.erro) return <ErroCarregar mensagem={dados.erro} tentarNovamente={dados.recarregar} />
  if (!dados.dados) return <Carregando />
  return <EditorialCarregado key={JSON.stringify(dados.dados.config)} salvo={dados.dados} recarregar={dados.recarregar} />
}

function EditorialCarregado({ salvo, recarregar }: { salvo: ConfigEditorialComAlertas; recarregar: () => void }) {
  const { avisar, avisarErro, confirmar } = useRetorno()
  const [c, setC] = useState<ConfigEditorial>(() => structuredClone(salvo.config))
  const [alertas, setAlertas] = useState<string[]>(salvo.alertas)
  const dados = { dados: salvo, recarregar }

  const alterado = JSON.stringify(c) !== JSON.stringify(salvo.config)
  const validacao = configEditorialSchema.safeParse(c)
  const mudar = (fn: (x: ConfigEditorial) => void): void => {
    const n = structuredClone(c)
    fn(n)
    setC(n)
  }

  async function salvar(config: ConfigEditorial, mensagem: string): Promise<void> {
    try {
      const r = await chamar('editorial:salvar', config)
      setAlertas(r.alertas)
      avisar(mensagem)
      dados.recarregar()
    } catch (e) {
      avisarErro(mensagemDeErro(e))
    }
  }

  const num = (v: string, min = 0): number => Math.max(min, Math.floor(Number(v) || 0))

  return (
    <>
      {alertas.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          {alertas.map((a) => (
            <Alerta key={a}>{a}</Alerta>
          ))}
        </div>
      )}
      <Secao titulo="1. Frequência das buscas">
        <div className="form-grade">
          <Campo rotulo="Frequência">
            <select className="entrada" value={c.pesquisa.frequencia} onChange={(e) => mudar((x) => (x.pesquisa.frequencia = e.target.value as ConfigEditorial['pesquisa']['frequencia']))}>
              {FREQUENCIAS_PESQUISA.map((f) => (
                <option key={f} value={f}>
                  {ROTULO_FREQUENCIA[f]}
                </option>
              ))}
            </select>
          </Campo>
          {c.pesquisa.frequencia !== 'manual' && (
            <Campo rotulo="Horário" ajuda={c.pesquisa.frequencia === 'a_cada_12h' ? 'E também 12 horas depois.' : undefined}>
              <input type="time" className="entrada" value={c.pesquisa.horario} onChange={(e) => mudar((x) => (x.pesquisa.horario = e.target.value))} />
            </Campo>
          )}
          {c.pesquisa.frequencia === 'semanal' && (
            <Campo rotulo="Dia da semana">
              <select className="entrada" value={c.pesquisa.diaSemana} onChange={(e) => mudar((x) => (x.pesquisa.diaSemana = Number(e.target.value)))}>
                {ROTULO_DIA_SEMANA.map((d, i) => (
                  <option key={d} value={i}>
                    {d}
                  </option>
                ))}
              </select>
            </Campo>
          )}
          <Campo rotulo="Se o computador estiver desligado no horário">
            <select className="entrada" value={c.pesquisa.politicaPerdida} onChange={(e) => mudar((x) => (x.pesquisa.politicaPerdida = e.target.value as ConfigEditorial['pesquisa']['politicaPerdida']))}>
              {POLITICAS_PERDIDA.map((p) => (
                <option key={p} value={p}>
                  {ROTULO_POLITICA[p]}
                </option>
              ))}
            </select>
          </Campo>
        </div>
        <ExecutarAgora />
      </Secao>

      <Secao titulo="2. Período das informações procuradas">
        <div className="form-grade">
          <Campo rotulo="Período">
            <select className="entrada" value={c.pesquisa.periodo} onChange={(e) => mudar((x) => (x.pesquisa.periodo = e.target.value as ConfigEditorial['pesquisa']['periodo']))}>
              {PERIODOS_PESQUISA.map((p) => (
                <option key={p} value={p}>
                  {ROTULO_PERIODO[p]}
                </option>
              ))}
            </select>
          </Campo>
          {c.pesquisa.periodo === 'personalizado' && (
            <>
              <Campo rotulo="De">
                <input type="date" className="entrada" value={c.pesquisa.periodoDe ?? ''} onChange={(e) => mudar((x) => (x.pesquisa.periodoDe = e.target.value || null))} />
              </Campo>
              <Campo rotulo="Até">
                <input type="date" className="entrada" value={c.pesquisa.periodoAte ?? ''} onChange={(e) => mudar((x) => (x.pesquisa.periodoAte = e.target.value || null))} />
              </Campo>
            </>
          )}
        </div>
        <p className="secundario pequeno" style={{ marginTop: 8 }}>
          O intervalo usado aparecerá no relatório de cada pesquisa. O intervalo personalizado só vale quando o provedor permitir.
        </p>
      </Secao>

      <Secao titulo="3. Horizonte de planejamento">
        <div className="chips" role="group" aria-label="Horizonte">
          {HORIZONTES.map((h) => (
            <button key={h} className="chip" aria-pressed={c.horizonteDias === h} onClick={() => mudar((x) => (x.horizonteDias = h))}>
              Próximos {h} dias
            </button>
          ))}
        </div>
      </Secao>

      <Secao titulo="4. Retenção da biblioteca">
        <p>
          Todas as pesquisas e roteiros são preservados até você arquivar ou excluir manualmente. Uma pesquisa nova nunca apaga uma anterior. <Etiqueta>Fixo</Etiqueta>
        </p>
      </Secao>

      <Secao
        titulo="Agenda de publicação"
        acoes={
          <label className="checkbox">
            <input type="checkbox" checked={c.agenda.pausada} onChange={(e) => mudar((x) => (x.agenda.pausada = e.target.checked))} />
            Pausar toda a agenda
          </label>
        }
      >
        <div className="form-grade" style={{ marginBottom: 16 }}>
          <Campo rotulo="Fuso horário (IANA)" ajuda="Exemplo: America/Sao_Paulo">
            <input className="entrada" value={c.agenda.fuso} onChange={(e) => mudar((x) => (x.agenda.fuso = e.target.value.trim()))} />
          </Campo>
        </div>
        <div className="grade">
          {(['longo', 'short'] as const).map((tipo) => (
            <EditorFormato key={tipo} titulo={ROTULO_TIPO_VIDEO[tipo]} f={c.agenda.formatos[tipo]} mudar={(fn) => mudar((x) => fn(x.agenda.formatos[tipo]))} num={num} />
          ))}
        </div>
      </Secao>

      <Secao titulo="Antecedência e capacidade">
        <div className="form-grade">
          <Campo rotulo="Roteiro pronto (dias antes)">
            <input type="number" min={0} max={60} className="entrada" value={c.antecedencia.roteiroProntoDias} onChange={(e) => mudar((x) => (x.antecedencia.roteiroProntoDias = num(e.target.value)))} />
          </Campo>
          <Campo rotulo="Produção pronta (dias antes)">
            <input type="number" min={0} max={60} className="entrada" value={c.antecedencia.producaoProntaDias} onChange={(e) => mudar((x) => (x.antecedencia.producaoProntaDias = num(e.target.value)))} />
          </Campo>
          <Campo rotulo="Revisões possíveis por semana">
            <input type="number" min={0} max={100} className="entrada" value={c.capacidade.revisoesPorSemana} onChange={(e) => mudar((x) => (x.capacidade.revisoesPorSemana = num(e.target.value)))} />
          </Campo>
          <Campo rotulo="Orçamento mensal (R$)" ajuda="Deixe vazio para não usar.">
            <input
              type="number"
              min={0}
              step="0.01"
              className="entrada"
              value={c.capacidade.orcamentoMensal ?? ''}
              onChange={(e) => mudar((x) => (x.capacidade.orcamentoMensal = e.target.value === '' ? null : Math.max(0, Number(e.target.value))))}
            />
          </Campo>
          <Campo rotulo="Custo estimado por vídeo (R$)">
            <input
              type="number"
              min={0}
              step="0.01"
              className="entrada"
              value={c.capacidade.custoEstimadoPorVideo}
              onChange={(e) => mudar((x) => (x.capacidade.custoEstimadoPorVideo = Math.max(0, Number(e.target.value) || 0)))}
            />
          </Campo>
        </div>
      </Secao>

      <div className="acoes" style={{ position: 'sticky', bottom: 0, background: 'var(--fundo)', padding: '16px 0' }}>
        {!validacao.success && <span className="pequeno" style={{ color: 'var(--vermelho-suave)' }}>{validacao.error.issues[0]?.message}</span>}
        <button className="botao fantasma" disabled={!alterado} onClick={() => setC(structuredClone(dados.dados!.config))}>
          Descartar alterações
        </button>
        <button
          className="botao"
          onClick={async () => {
            const ok = await confirmar({ titulo: 'Restaurar padrões do canal?', texto: '1 vídeo longo (domingo 18h) e 3 Shorts (terça, quinta e sábado 18h) por semana, pesquisa diária às 08:00, fuso America/Sao_Paulo.', confirmar: 'Restaurar padrões' })
            if (ok) await salvar(dados.dados!.padrao, 'Padrões restaurados.')
          }}
        >
          Restaurar padrões
        </button>
        <button className="botao primario" disabled={!alterado || !validacao.success} onClick={() => validacao.success && void salvar(validacao.data, 'Configurações salvas.')}>
          Salvar alterações
        </button>
      </div>
    </>
  )
}

/** Executa já uma pesquisa com os termos monitorados. */
function ExecutarAgora() {
  const { avisar, avisarErro } = useRetorno()
  const opcoes = useDados(() => chamar('pesquisa:opcoes'), [])
  const projetos = useDados(() => chamar('projetos:listar'), [])
  const termos = opcoes.dados?.termosMonitorados ?? []
  const projetoId = projetos.dados?.[0]?.id
  return (
    <div className="acoes" style={{ marginTop: 12 }}>
      <button
        className="botao"
        disabled={!termos.length || !projetoId}
        onClick={async () => {
          try {
            const { id } = await chamar('pesquisa:iniciar', { projetoId: projetoId!, consulta: termos.join(', ') })
            avisar(`Pesquisa nº ${id} iniciada. Acompanhe em Pautas e pesquisas.`)
          } catch (e) {
            avisarErro(mensagemDeErro(e))
          }
        }}
      >
        Executar agora
      </button>
      <span className="secundario pequeno">
        {termos.length ? `Usa os termos monitorados: ${termos.join(', ')}.` : 'Defina os termos monitorados em Pautas e pesquisas › Fontes e opções.'} As buscas só rodam com o aplicativo aberto.
      </span>
    </div>
  )
}

function EditorFormato({ titulo, f, mudar, num }: { titulo: string; f: FormatoAgenda; mudar: (fn: (x: FormatoAgenda) => void) => void; num: (v: string, min?: number) => number }) {
  return (
    <div className="secao" style={{ background: 'var(--superficie-2)' }}>
      <div className="secao-titulo">
        <h3 style={{ margin: 0 }}>{titulo}</h3>
        <label className="checkbox">
          <input type="checkbox" checked={f.pausado} onChange={(e) => mudar((x) => (x.pausado = e.target.checked))} />
          Pausar
        </label>
      </div>
      <div className="form-grade">
        <Campo rotulo="Máximo por dia">
          <input type="number" min={0} max={10} className="entrada" value={f.maxPorDia} onChange={(e) => mudar((x) => (x.maxPorDia = num(e.target.value)))} />
        </Campo>
        <Campo rotulo="Limite semanal">
          <input type="number" min={0} max={70} className="entrada" value={f.limiteSemanal} onChange={(e) => mudar((x) => (x.limiteSemanal = num(e.target.value)))} />
        </Campo>
        <Campo rotulo="Limite mensal" ajuda="Vazio = sem limite mensal.">
          <input type="number" min={0} max={300} className="entrada" value={f.limiteMensal ?? ''} onChange={(e) => mudar((x) => (x.limiteMensal = e.target.value === '' ? null : num(e.target.value)))} />
        </Campo>
        <Campo rotulo="Duração de referência (segundos)">
          <div className="form-linha">
            <input type="number" min={5} className="entrada" style={{ width: 90 }} value={f.duracaoMinSeg} onChange={(e) => mudar((x) => (x.duracaoMinSeg = num(e.target.value, 5)))} aria-label="Duração mínima" />
            <span className="secundario">a</span>
            <input type="number" min={5} className="entrada" style={{ width: 90 }} value={f.duracaoMaxSeg} onChange={(e) => mudar((x) => (x.duracaoMaxSeg = num(e.target.value, 5)))} aria-label="Duração máxima" />
          </div>
        </Campo>
      </div>
      <h3 style={{ marginTop: 16 }}>Dias e horários permitidos</h3>
      {f.horarios.length === 0 && <p className="secundario pequeno">Nenhum horário: este formato não terá horários livres.</p>}
      {f.horarios.map((h, i) => (
        <div key={i} className="form-linha" style={{ marginBottom: 8 }}>
          <select className="entrada" style={{ width: 140 }} value={h.dia} onChange={(e) => mudar((x) => (x.horarios[i]!.dia = Number(e.target.value)))} aria-label="Dia">
            {ROTULO_DIA_SEMANA.map((d, j) => (
              <option key={d} value={j}>
                {d}
              </option>
            ))}
          </select>
          <input type="time" className="entrada" style={{ width: 120 }} value={h.hora} onChange={(e) => mudar((x) => (x.horarios[i]!.hora = e.target.value))} aria-label="Hora" />
          <button className="botao pequeno fantasma" onClick={() => mudar((x) => x.horarios.splice(i, 1))}>
            Remover
          </button>
        </div>
      ))}
      <button className="botao pequeno" onClick={() => mudar((x) => x.horarios.push({ dia: 1, hora: '18:00' }))}>
        Adicionar horário
      </button>
    </div>
  )
}

function Dados() {
  const { avisar, avisarErro } = useRetorno()
  const info = useDados(() => chamar('sistema:info'), [])
  const [ocupado, setOcupado] = useState(false)
  if (info.erro) return <ErroCarregar mensagem={info.erro} tentarNovamente={info.recarregar} />
  if (!info.dados) return <Carregando />
  const d = info.dados
  return (
    <>
      <SegundoPlano />
      <Secao titulo="Onde ficam seus dados">
        <p>
          Pasta: <code>{d.pastaDados}</code>
        </p>
        <p className="secundario">
          Estúdio IA YouTube, criado por AjKaBaL. Versão do aplicativo {d.versaoApp} · versão do banco {d.versaoBanco}. Senhas e chaves nunca são gravadas nesta pasta em texto simples.
        </p>
        <button
          className="botao"
          onClick={async () => {
            try {
              await chamar('sistema:abrirPastaDados')
            } catch (e) {
              avisarErro(mensagemDeErro(e))
            }
          }}
        >
          Abrir pasta
        </button>
      </Secao>
      <Secao
        titulo="Backups"
        acoes={
          <button
            className="botao primario pequeno"
            disabled={ocupado}
            onClick={async () => {
              setOcupado(true)
              try {
                const r = await chamar('sistema:backup')
                avisar(`Backup criado: ${r.arquivo}`)
                info.recarregar()
              } catch (e) {
                avisarErro(mensagemDeErro(e))
              } finally {
                setOcupado(false)
              }
            }}
          >
            Fazer backup agora
          </button>
        }
      >
        <p className="secundario pequeno">
          Um backup automático é criado antes de cada atualização do banco. Os 10 mais recentes são mantidos. Para restaurar: feche o aplicativo e substitua o arquivo dados.sqlite pela cópia desejada da pasta backups.
        </p>
        {d.backups.length === 0 ? (
          <Vazio compacto titulo="Nenhum backup ainda" />
        ) : (
          <ul className="lista">
            {d.backups.map((b) => (
              <li key={b.arquivo} className="lista-item">
                <div className="lista-principal">
                  <div className="lista-titulo">{b.arquivo}</div>
                  <div className="lista-meta">
                    {formatarData(b.criadoEm, true)} · {(b.tamanhoBytes / 1024).toFixed(0)} KB
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Secao>
    </>
  )
}

function Eventos() {
  const lista = useDados(() => chamar('sistema:eventos'), [])
  return (
    <Secao
      titulo="Registro de eventos"
      acoes={
        <button className="botao pequeno" onClick={lista.recarregar}>
          Atualizar
        </button>
      }
    >
      <p className="secundario pequeno">Erros e avisos do aplicativo, sem senhas, chaves ou caminhos pessoais.</p>
      {lista.erro && <ErroCarregar mensagem={lista.erro} tentarNovamente={lista.recarregar} />}
      {lista.dados?.length === 0 && <Vazio compacto titulo="Nenhum evento registrado" />}
      <ul className="lista">
        {lista.dados?.map((e) => (
          <li key={e.id} className="lista-item">
            <Etiqueta cor={e.nivel === 'erro' ? 'vermelha' : e.nivel === 'aviso' ? 'amarela' : 'cinza'}>{e.nivel}</Etiqueta>
            <div className="lista-principal">
              <div>{e.mensagem}</div>
              <div className="lista-meta">
                {formatarData(e.criadoEm, true)} · {e.categoria}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </Secao>
  )
}

function VideoERender() {
  const pref = useDados(() => chamar('render:preferencia'), [])
  return (
    <>
      <FerramentasFfmpeg />
      <Secao titulo="Resolução e qualidade padrão (até 4K)">
        <p className="secundario">
          Define a escolha inicial no editor de vídeo. Antes de cada renderização você ainda pode trocar a resolução, os quadros por segundo e a qualidade.
        </p>
        {pref.erro && <ErroCarregar mensagem={pref.erro} tentarNovamente={pref.recarregar} />}
        {pref.dados && <PreferenciaVideo inicial={pref.dados} />}
      </Secao>
    </>
  )
}

/** As tarefas automáticas só rodam com o app aberto: bandeja e iniciar com o Windows mantêm o app rodando. */
export function SegundoPlano() {
  const { avisar, avisarErro } = useRetorno()
  const sp = useDados(() => chamar('sistema:segundoPlano'), [])
  const definir = async (d: { bandeja: boolean; iniciarComWindows: boolean }, msg: string): Promise<void> => {
    try {
      await chamar('sistema:definirSegundoPlano', d)
      avisar(msg)
      sp.recarregar()
    } catch (e) {
      avisarErro(mensagemDeErro(e))
    }
  }
  if (!sp.dados) return null
  const s = sp.dados
  return (
    <Secao titulo="Funcionamento em segundo plano">
      <p className="secundario pequeno" style={{ marginTop: 0 }}>
        Pesquisas agendadas, geração e revisão só acontecem com o aplicativo aberto. Com estas opções ele fica rodando no ícone perto do relógio e abre sozinho, escondido, quando você entra no Windows.
      </p>
      {!s.disponivel && <Alerta>Disponível no aplicativo aberto normalmente (não no modo de teste).</Alerta>}
      {s.disponivel && (
        <>
          <div className="acoes">
            {!(s.bandeja && s.iniciarComWindows) && (
              <button className="botao primario" onClick={() => void definir({ bandeja: true, iniciarComWindows: true }, 'Segundo plano ligado: o Estúdio fica na bandeja e abre com o Windows.')}>
                Ligar segundo plano (1 clique)
              </button>
            )}
          </div>
          <label className="checkbox" style={{ marginTop: 8 }}>
            <input type="checkbox" checked={s.bandeja} onChange={(e) => void definir({ ...s, bandeja: e.target.checked }, e.target.checked ? 'Ao fechar, o Estúdio continua na bandeja.' : 'Ao fechar, o Estúdio será encerrado.')} />
            Ao fechar a janela, continuar rodando na bandeja (botão direito no ícone › Sair para encerrar)
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={s.iniciarComWindows} onChange={(e) => void definir({ ...s, iniciarComWindows: e.target.checked }, e.target.checked ? 'O Estúdio vai abrir escondido ao entrar no Windows.' : 'O Estúdio não abre mais com o Windows.')} />
            Abrir escondido ao entrar no Windows
          </label>
        </>
      )}
    </Secao>
  )
}
