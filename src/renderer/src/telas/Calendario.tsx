import { useMemo, useState } from 'react'
import { chamar, mensagemDeErro, useDados } from '../api'
import { useRetorno } from '../componentes/retorno'
import { Alerta, Cabecalho, Campo, Carregando, Dialogo, ErroCarregar, Etiqueta } from '../componentes/ui'
import { useNavegacao } from '../navegacao'
import { ROTULO_DIA_CURTO, ROTULO_STATUS_ROTEIRO, ROTULO_TIPO_VIDEO, type TipoVideo } from '@shared/dominio'
import { filtroRoteirosSchema } from '@shared/schemas'
import { dataLocal, diaSemanaDeData, horaLocal, somarDias } from '@shared/tempo'
import type { Agendamento, HorarioLivre } from '@shared/tipos'

interface Novo {
  tipoVideo: TipoVideo
  data: string
  hora: string
}

export function Calendario() {
  const nav = useNavegacao()
  const { avisar, avisarErro, confirmar } = useRetorno()
  const editorial = useDados(() => chamar('editorial:obter'), [])
  const cfg = editorial.dados?.config
  const fuso = cfg?.agenda.fuso ?? 'America/Sao_Paulo'
  const hoje = dataLocal(new Date(), fuso)
  const dias = cfg?.horizonteDias ?? 14
  const fim = somarDias(hoje, dias - 1)
  const agenda = useDados(() => chamar('agenda:listar', { de: hoje, ate: fim }), [hoje, fim])
  const livres = useDados(() => chamar('agenda:horariosLivres'), [hoje, agenda.dados])
  const [novo, setNovo] = useState<Novo | null>(null)
  const [reagendar, setReagendar] = useState<Agendamento | null>(null)

  const porDia = useMemo(() => {
    const m = new Map<string, { itens: Agendamento[]; livres: HorarioLivre[] }>()
    for (let i = 0; i < dias; i++) m.set(somarDias(hoje, i), { itens: [], livres: [] })
    for (const a of agenda.dados ?? []) m.get(dataLocal(new Date(a.inicioUtc), fuso))?.itens.push(a)
    for (const l of livres.dados ?? []) m.get(l.data)?.livres.push(l)
    return m
  }, [agenda.dados, livres.dados, dias, hoje, fuso])

  const recarregar = (): void => {
    agenda.recarregar()
    livres.recarregar()
  }

  async function cancelar(a: Agendamento): Promise<void> {
    const ok = await confirmar({ titulo: 'Cancelar agendamento?', texto: `"${a.titulo}" sairá da agenda. O roteiro não é apagado.`, confirmar: 'Cancelar agendamento', perigo: true })
    if (!ok) return
    try {
      await chamar('agenda:cancelar', { id: a.id })
      avisar('Agendamento cancelado.')
      recarregar()
    } catch (e) {
      avisarErro(mensagemDeErro(e))
    }
  }

  // Semana começa na segunda: preenche o início da grade para alinhar os dias.
  const deslocamento = (diaSemanaDeData(hoje) + 6) % 7

  return (
    <>
      <Cabecalho
        titulo="Calendário de conteúdo"
        descricao={`Próximos ${dias} dias · fuso ${fuso}. Horários tracejados estão livres segundo as regras da agenda.`}
        acoes={
          <button className="botao" onClick={() => nav.irPara('config')}>
            Regras da agenda
          </button>
        }
      />
      {editorial.erro && <ErroCarregar mensagem={editorial.erro} tentarNovamente={editorial.recarregar} />}
      {agenda.erro && <ErroCarregar mensagem={agenda.erro} tentarNovamente={recarregar} />}
      {cfg && (cfg.agenda.pausada || editorial.dados!.alertas.length > 0) && (
        <div style={{ marginBottom: 16 }}>
          {cfg.agenda.pausada && <Alerta>A agenda está pausada: nenhum novo agendamento é aceito até reativar em Configurações.</Alerta>}
          {editorial.dados!.alertas.map((a) => (
            <Alerta key={a}>{a}</Alerta>
          ))}
        </div>
      )}
      {!agenda.dados && agenda.carregando ? (
        <Carregando />
      ) : (
        <div className="semana">
          {ROTULO_DIA_CURTO.slice(1)
            .concat(ROTULO_DIA_CURTO[0])
            .map((d) => (
              <div key={d} className="secundario pequeno" style={{ paddingLeft: 4 }}>
                {d}
              </div>
            ))}
          {Array.from({ length: deslocamento }, (_, i) => (
            <div key={`v${i}`} />
          ))}
          {[...porDia.entries()].map(([data, { itens, livres: l }]) => (
            <div key={data} className={`dia${data === hoje ? ' hoje' : ''}`}>
              <div className="dia-titulo">
                <span>{ROTULO_DIA_CURTO[diaSemanaDeData(data)]}</span>
                <span>{data.slice(8, 10)}/{data.slice(5, 7)}</span>
              </div>
              {itens.map((a) => (
                <div key={a.id} className={`evento ${a.tipoVideo}`}>
                  <div style={{ fontWeight: 500 }}>
                    {horaLocal(new Date(a.inicioUtc), fuso)} · {ROTULO_TIPO_VIDEO[a.tipoVideo]}
                  </div>
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.titulo}</div>
                  {a.statusRoteiro && <div className="secundario">{ROTULO_STATUS_ROTEIRO[a.statusRoteiro]}</div>}
                  <div className="acoes" style={{ marginTop: 4, gap: 4 }}>
                    {a.roteiroId && (
                      <button className="botao pequeno fantasma" onClick={() => nav.abrirRoteiro(a.roteiroId!)}>
                        Abrir
                      </button>
                    )}
                    <button className="botao pequeno fantasma" onClick={() => setReagendar(a)}>
                      Mover
                    </button>
                    <button className="botao pequeno fantasma" onClick={() => void cancelar(a)}>
                      Cancelar
                    </button>
                  </div>
                </div>
              ))}
              {l.map((h) => (
                <button
                  key={h.inicioUtc + h.tipoVideo}
                  className="evento livre"
                  style={{ width: '100%', textAlign: 'left', cursor: 'pointer' }}
                  onClick={() => setNovo({ tipoVideo: h.tipoVideo, data: h.data, hora: h.hora })}
                >
                  {h.hora} · {ROTULO_TIPO_VIDEO[h.tipoVideo]} livre
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
      {novo && (
        <DialogoAgendar
          inicial={novo}
          aoFechar={(ok) => {
            setNovo(null)
            if (ok) recarregar()
          }}
        />
      )}
      {reagendar && (
        <DialogoReagendar
          item={reagendar}
          fuso={fuso}
          aoFechar={(ok) => {
            setReagendar(null)
            if (ok) recarregar()
          }}
        />
      )}
    </>
  )
}

function DialogoAgendar({ inicial, aoFechar }: { inicial: Novo; aoFechar: (ok: boolean) => void }) {
  const { avisar, avisarErro } = useRetorno()
  const [f, setF] = useState({ ...inicial, roteiroId: '' as string, titulo: '' })
  const roteiros = useDados(() => chamar('roteiros:buscar', filtroRoteirosSchema.parse({ tipoVideo: f.tipoVideo, ordem: 'atualizado_desc' })), [f.tipoVideo])
  const projetos = useDados(() => chamar('projetos:listar'), [])
  const escolhido = roteiros.dados?.find((r) => String(r.id) === f.roteiroId)
  const titulo = escolhido?.titulo ?? f.titulo
  const projetoId = escolhido?.projetoId ?? projetos.dados?.[0]?.id

  async function salvar(): Promise<void> {
    if (!projetoId) return
    try {
      await chamar('agenda:agendar', { projetoId, roteiroId: escolhido?.id ?? null, titulo, tipoVideo: f.tipoVideo, data: f.data, hora: f.hora })
      avisar('Agendado.')
      aoFechar(true)
    } catch (e) {
      avisarErro(mensagemDeErro(e))
    }
  }

  return (
    <Dialogo
      aberto
      aoFechar={() => aoFechar(false)}
      titulo="Agendar conteúdo"
      acoes={
        <>
          <button className="botao fantasma" onClick={() => aoFechar(false)}>
            Cancelar
          </button>
          <button className="botao primario" onClick={() => void salvar()} disabled={!titulo.trim() || !projetoId}>
            Agendar
          </button>
        </>
      }
    >
      <p className="secundario pequeno">Agendar só reserva o horário no calendário. Nada é publicado no YouTube.</p>
      <div className="form-grade">
        <Campo rotulo="Formato">
          <select className="entrada" value={f.tipoVideo} onChange={(e) => setF({ ...f, tipoVideo: e.target.value as TipoVideo, roteiroId: '' })}>
            <option value="longo">Vídeo longo</option>
            <option value="short">Short</option>
          </select>
        </Campo>
        <Campo rotulo="Data">
          <input type="date" className="entrada" value={f.data} onChange={(e) => setF({ ...f, data: e.target.value })} />
        </Campo>
        <Campo rotulo="Hora">
          <input type="time" className="entrada" value={f.hora} onChange={(e) => setF({ ...f, hora: e.target.value })} />
        </Campo>
        <Campo rotulo="Roteiro">
          <select className="entrada" value={f.roteiroId} onChange={(e) => setF({ ...f, roteiroId: e.target.value })}>
            <option value="">Sem roteiro (reservar horário)</option>
            {roteiros.dados?.map((r) => (
              <option key={r.id} value={r.id}>
                {r.titulo} — {ROTULO_STATUS_ROTEIRO[r.status]}
              </option>
            ))}
          </select>
        </Campo>
        {!escolhido && (
          <Campo rotulo="Título da reserva">
            <input className="entrada" value={f.titulo} onChange={(e) => setF({ ...f, titulo: e.target.value })} maxLength={200} />
          </Campo>
        )}
      </div>
      {escolhido && (
        <p style={{ marginTop: 12 }}>
          <Etiqueta>{escolhido.titulo}</Etiqueta>
        </p>
      )}
    </Dialogo>
  )
}

function DialogoReagendar({ item, fuso, aoFechar }: { item: Agendamento; fuso: string; aoFechar: (ok: boolean) => void }) {
  const { avisar, avisarErro } = useRetorno()
  const inicio = new Date(item.inicioUtc)
  const [data, setData] = useState(dataLocal(inicio, fuso))
  const [hora, setHora] = useState(horaLocal(inicio, fuso))
  return (
    <Dialogo
      aberto
      aoFechar={() => aoFechar(false)}
      titulo={`Mover “${item.titulo}”`}
      acoes={
        <>
          <button className="botao fantasma" onClick={() => aoFechar(false)}>
            Cancelar
          </button>
          <button
            className="botao primario"
            onClick={async () => {
              try {
                await chamar('agenda:reagendar', { id: item.id, data, hora })
                avisar('Reagendado.')
                aoFechar(true)
              } catch (e) {
                avisarErro(mensagemDeErro(e))
              }
            }}
          >
            Mover
          </button>
        </>
      }
    >
      <div className="form-grade">
        <Campo rotulo="Nova data">
          <input type="date" className="entrada" value={data} onChange={(e) => setData(e.target.value)} />
        </Campo>
        <Campo rotulo="Nova hora">
          <input type="time" className="entrada" value={hora} onChange={(e) => setHora(e.target.value)} />
        </Campo>
      </div>
    </Dialogo>
  )
}
