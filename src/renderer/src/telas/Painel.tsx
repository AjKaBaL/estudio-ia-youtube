import { useEffect, useState } from 'react'
import { chamar, mensagemDeErro, useDados } from '../api'
import { useRetorno } from '../componentes/retorno'
import { Alerta, Cabecalho, Campo, Carregando, ErroCarregar, Etiqueta, Secao, Vazio, formatarData } from '../componentes/ui'
import { useNavegacao } from '../navegacao'
import { ROTULO_STATUS_PAUTA, ROTULO_TIPO_VIDEO, type TipoVideo } from '@shared/dominio'
import { FREQUENCIA_MAXIMA } from '@shared/editorial'
import type { FrequenciaFormato, ItemFila, PainelAdmin } from '@shared/tipos'
import { COR_PAUTA, pedirPautas } from './Pautas'
import { BotaoRapido } from '../componentes/rapido'
import { PilotoAutomatico } from '../componentes/piloto'
import { PRESETS_AGENDA } from '@shared/configRapida'

/**
 * Painel do administrador: o que vem por aí (vídeos agendados e próximos temas), em que etapa cada um
 * está e quantos vídeos sair por semana. O app produz; aqui você decide a ordem e o ritmo.
 */

const ETAPAS = ['Roteiro', 'Revisão', 'Edição', 'Render', 'Qualidade', 'Publicação'] as const
const DIAS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']
const NOMES_DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']

/** Quantas etapas do vídeo já estão prontas, na ordem do fluxo. */
export function etapasProntas(i: ItemFila): boolean[] {
  return [
    i.roteiroId !== null,
    i.statusRoteiro === 'aprovado' || i.statusRoteiro === 'publicado',
    i.producao !== 'não iniciada',
    i.producao === 'renderizado',
    i.qualidade === 'aprovado',
    ['aprovada', 'enviando', 'processando', 'concluida'].includes(i.publicacao)
  ]
}

export function Painel() {
  const nav = useNavegacao()
  const { avisar, avisarErro } = useRetorno()
  const painel = useDados(() => chamar('painel:dados'), [])
  // Situação ao vivo de cada vídeo (renderizando, enviando, pronto…), sem precisar recarregar.
  const { recarregar } = painel
  useEffect(() => {
    const t = setInterval(recarregar, 5000)
    return () => clearInterval(t)
  }, [recarregar])
  const agir = async (fn: () => Promise<unknown>, msg?: string): Promise<void> => {
    try {
      await fn()
      if (msg) avisar(msg)
      painel.recarregar()
    } catch (e) {
      avisarErro(mensagemDeErro(e))
    }
  }
  const p = painel.dados
  return (
    <>
      <Cabecalho
        titulo="Painel de produção"
        descricao="O que vem por aí: próximos vídeos, próximos temas e o ritmo do canal. O aplicativo produz; você decide a ordem, o que adiantar e a frequência."
        acoes={
          <>
            <button className="botao" onClick={() => nav.irPara('fila')}>
              Fila completa
            </button>
            <button className="botao" onClick={() => nav.irPara('calendario')}>
              Calendário
            </button>
          </>
        }
      />
      {painel.erro && <ErroCarregar mensagem={painel.erro} tentarNovamente={painel.recarregar} />}
      {!p && !painel.erro && <Carregando />}
      {p && (
        <>
          <div style={{ display: 'grid', gap: 8, marginBottom: 16 }}>
            {p.pausaGlobal && <Alerta tipo="erro">As tarefas automáticas estão PARADAS (Fila de produção). Nada roda por agendamento até você retomar.</Alerta>}
            {p.agendaPausada && <Alerta>A agenda está pausada em Configurações › Editorial: não há horários livres para novos vídeos.</Alerta>}
            {p.sugestoesFontes > 0 && (
              <Alerta tipo="info">
                {p.sugestoesFontes} nova(s) fonte(s) de pesquisa sugerida(s) aguardam a sua aprovação.{' '}
                <button
                  className="botao pequeno"
                  onClick={() => {
                    pedirPautas({ aba: 'fontes' })
                    nav.irPara('pautas')
                  }}
                >
                  Ver sugestões
                </button>
              </Alerta>
            )}
          </div>
          <PilotoAutomatico />
          <Indicadores p={p} />
          <div className="painel-grade">
            <ProximosVideos p={p} agir={agir} />
            <ProximosTemas p={p} agir={agir} />
          </div>
          <Frequencia p={p} aoSalvar={painel.recarregar} />
        </>
      )}
    </>
  )
}

function Indicadores({ p }: { p: PainelAdmin }) {
  const [semana] = useState(() => Date.now() + 7 * 86_400_000)
  const nestaSemana = p.videos.filter((v) => new Date(v.inicioUtc).getTime() < semana).length
  const atrasados = p.videos.filter((v) => v.atrasado).length
  return (
    <div className="painel-indicadores">
      <div className="indicador">
        <span className="secundario pequeno">Vídeos agendados</span>
        <strong>{p.videos.length}</strong>
        <span className="secundario pequeno">{nestaSemana} nos próximos 7 dias</span>
      </div>
      <div className="indicador">
        <span className="secundario pequeno">Temas na espera</span>
        <strong>{p.temas.length}</strong>
        <span className="secundario pequeno">{p.temas.filter((t) => t.status === 'aprovada').length} aprovado(s)</span>
      </div>
      <div className="indicador">
        <span className="secundario pequeno">Horários livres ({p.horizonteDias} dias)</span>
        <strong>{p.livres.longo + p.livres.short}</strong>
        <span className="secundario pequeno">
          {p.livres.longo} longo(s) · {p.livres.short} Short(s)
        </span>
      </div>
      <div className="indicador">
        <span className="secundario pequeno">Atrasados</span>
        <strong style={{ color: atrasados ? 'var(--vermelho-suave)' : undefined }}>{atrasados}</strong>
        <span className="secundario pequeno">{p.fontesAtivas} fonte(s) de pesquisa ativas</span>
      </div>
    </div>
  )
}

type Agir = (fn: () => Promise<unknown>, msg?: string) => Promise<void>

const FASE: Record<NonNullable<ItemFila['situacao']>['fase'], { cor: 'verde' | 'azul' | 'amarela' | 'cinza' | 'vermelha'; rotulo: string }> = {
  na_fila: { cor: 'cinza', rotulo: 'Na fila' },
  produzindo: { cor: 'azul', rotulo: 'Produzindo' },
  corrigindo: { cor: 'azul', rotulo: 'Corrigindo sozinho' },
  pronto: { cor: 'verde', rotulo: 'Pronto' },
  publicando: { cor: 'azul', rotulo: 'Publicando' },
  publicado: { cor: 'verde', rotulo: 'Publicado' },
  precisa_voce: { cor: 'amarela', rotulo: 'Precisa de você' }
}

function ProximosVideos({ p, agir }: { p: PainelAdmin; agir: Agir }) {
  const nav = useNavegacao()
  const { confirmar } = useRetorno()
  return (
    <Secao titulo="Próximos vídeos">
      <p className="secundario pequeno" style={{ marginTop: 0 }}>
        Em ordem de publicação. O piloto produz, revisa, aprova e publica cada vídeo sozinho no horário marcado. <strong>Postar agora</strong> publica na hora um vídeo pronto; <strong>Adiantar/Adiar</strong> troca a data com o vídeo vizinho.
      </p>
      {p.videos.length === 0 && <Vazio compacto titulo="Nada agendado" texto="Agende um dos próximos temas (ao lado) ou use o Calendário." />}
      <ul className="lista">
        {p.videos.map((v) => {
          const etapas = etapasProntas(v)
          const feitas = etapas.filter(Boolean).length
          return (
            <li key={v.id} className="lista-item" style={{ alignItems: 'flex-start', opacity: v.pausado ? 0.6 : 1 }}>
              <div className="lista-principal">
                <div className="lista-titulo">
                  {v.titulo} {v.atrasado && <Etiqueta cor="vermelha">Atrasado</Etiqueta>} {v.pausado && <Etiqueta>Pausado</Etiqueta>}
                </div>
                <div className="lista-meta">
                  <Etiqueta cor={v.tipoVideo === 'short' ? 'azul' : 'cinza'}>{ROTULO_TIPO_VIDEO[v.tipoVideo]}</Etiqueta>
                  <span>{formatarData(v.inicioUtc, true)}</span>
                  <span>
                    · {feitas}/{ETAPAS.length} etapas
                  </span>
                </div>
                <div className="etapas-video" title={ETAPAS.map((e, k) => `${e}: ${etapas[k] ? 'pronto' : 'pendente'}`).join(' · ')}>
                  {ETAPAS.map((e, k) => (
                    <span key={e} className={etapas[k] ? 'feita' : v.bloqueiaPublicacao && k === 5 ? 'bloqueada' : ''} />
                  ))}
                </div>
                {v.situacao && (
                  <div className="pequeno" style={{ marginTop: 6, display: 'flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap' }}>
                    <Etiqueta cor={FASE[v.situacao.fase].cor}>
                      {FASE[v.situacao.fase].rotulo}
                      {v.situacao.percentual !== null ? ` ${v.situacao.percentual}%` : ''}
                    </Etiqueta>
                    <span className="secundario">{v.situacao.texto}</span>
                  </div>
                )}
              </div>
              <div style={{ display: 'grid', gap: 4 }}>
                {v.situacao?.podePostar && (
                  <button
                    className="botao pequeno primario"
                    onClick={async () => {
                      if (!(await confirmar({ titulo: 'Postar agora?', texto: `“${v.titulo}” será enviado ao YouTube como PÚBLICO e vai ao ar assim que o YouTube processar.`, confirmar: 'Postar agora' }))) return
                      await agir(async () => (await chamar('piloto:postarAgora', { id: v.id })).mensagem, 'Enviando ao YouTube como público.')
                    }}
                  >
                    Postar agora
                  </button>
                )}
                <button className="botao pequeno fantasma" onClick={() => void agir(() => chamar('painel:moverVideo', { id: v.id, direcao: 'adiantar' }), 'Vídeo adiantado.')}>
                  Adiantar ↑
                </button>
                <button className="botao pequeno fantasma" onClick={() => void agir(() => chamar('painel:moverVideo', { id: v.id, direcao: 'adiar' }), 'Vídeo adiado.')}>
                  Adiar ↓
                </button>
                <button className="botao pequeno fantasma" onClick={() => void agir(() => chamar('fila:pausarItem', { id: v.id, pausado: !v.pausado }), v.pausado ? 'Retomado.' : 'Pausado.')}>
                  {v.pausado ? 'Retomar' : 'Pausar'}
                </button>
                {v.roteiroId && (
                  <button className="botao pequeno fantasma" onClick={() => nav.abrirRoteiro(v.roteiroId!)}>
                    Abrir roteiro
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </Secao>
  )
}

function ProximosTemas({ p, agir }: { p: PainelAdmin; agir: Agir }) {
  const nav = useNavegacao()
  const { confirmar, avisar } = useRetorno()
  const avisoProducao = (m: string): void => avisar(m)
  const abrir = (id: number): void => {
    pedirPautas({ pauta: id })
    nav.irPara('pautas')
  }
  return (
    <Secao
      titulo="Próximos temas"
      acoes={
        <button
          className="botao pequeno"
          onClick={() => {
            pedirPautas({ aba: 'pesquisar' })
            nav.irPara('pautas')
          }}
        >
          Pesquisar novos temas
        </button>
      }
    >
      <p className="secundario pequeno" style={{ marginTop: 0 }}>
        Vídeos que ainda não foram criados, na ordem em que o piloto vai produzir (sua prioridade, depois aprovados e a nota). <strong>Produzir agora</strong> põe o tema em produção já; <strong>Adiantar/Adiar</strong> muda a ordem; <strong>Descartar</strong> tira da lista.
      </p>
      {p.temas.length === 0 && <Vazio compacto titulo="Nenhum tema na espera" texto="Rode uma pesquisa e crie pautas a partir dos resultados." />}
      <ol className="lista" style={{ paddingLeft: 0 }}>
        {p.temas.map((t, i) => (
          <li key={t.id} className="lista-item" style={{ alignItems: 'flex-start' }}>
            <Etiqueta cor="cinza">{i + 1}º</Etiqueta>
            <div className="lista-principal">
              <button className="link-botao lista-titulo" onClick={() => abrir(t.id)} style={{ textAlign: 'left' }}>
                {t.titulo}
              </button>
              <div className="lista-meta">
                <Etiqueta cor={COR_PAUTA[t.status]}>{ROTULO_STATUS_PAUTA[t.status]}</Etiqueta>
                <span>{ROTULO_TIPO_VIDEO[t.tipoVideo]}</span>
                <span>· nota {t.pontuacao}</span>
                {t.prioridade !== 0 && <span>· prioridade {t.prioridade > 0 ? `+${t.prioridade}` : t.prioridade}</span>}
                {t.riscosAltos > 0 && <Etiqueta cor="vermelha">{t.riscosAltos} risco(s) alto(s)</Etiqueta>}
                {t.roteiroId && <Etiqueta cor="verde">Tem roteiro</Etiqueta>}
              </div>
            </div>
            <div style={{ display: 'grid', gap: 4 }}>
              <button
                className="botao pequeno primario"
                title="Agenda no próximo horário livre e o piloto automático produz já, com prioridade"
                onClick={() => void agir(async () => avisoProducao((await chamar('painel:produzirAgora', { id: t.id })).mensagem))}
              >
                Produzir agora
              </button>
              <button className="botao pequeno fantasma" onClick={() => void agir(() => chamar('painel:agendarTema', { id: t.id, tipoVideo: null }), 'Tema agendado no próximo horário livre.')}>
                Só agendar
              </button>
              <button className="botao pequeno fantasma" onClick={() => void agir(() => chamar('painel:priorizarTema', { id: t.id, delta: 1 }))}>
                Adiantar ↑
              </button>
              <button className="botao pequeno fantasma" onClick={() => void agir(() => chamar('painel:priorizarTema', { id: t.id, delta: -1 }))}>
                Adiar ↓
              </button>
              <button
                className="botao pequeno fantasma"
                onClick={() =>
                  void agir(async () => {
                    if (!(await confirmar({ titulo: 'Descartar este tema?', texto: `“${t.titulo}” sai da lista de próximos temas. A pauta continua guardada e pode ser reativada em Pautas.`, confirmar: 'Descartar' }))) return
                    await chamar('pautas:alterarStatus', { id: t.id, status: 'descartada' })
                  })
                }
              >
                Descartar
              </button>
            </div>
          </li>
        ))}
      </ol>
    </Secao>
  )
}

function Frequencia({ p, aoSalvar }: { p: PainelAdmin; aoSalvar: () => void }) {
  return (
    <Secao titulo="Frequência de publicação">
      <p className="secundario pequeno" style={{ marginTop: 0 }}>
        Quantos vídeos por semana e em que horário. O aplicativo distribui os dias da semana por regra fixa (ex.: 3 Shorts = terça, quinta e sábado). Vídeos já agendados não mudam de data; os detalhes (limites por dia e por mês, antecedência) ficam em Configurações › Editorial.
      </p>
      <div className="acoes" style={{ marginBottom: 12 }}>
        <span className="secundario pequeno">Ritmo pronto (1 clique):</span>
        {(Object.keys(PRESETS_AGENDA) as (keyof typeof PRESETS_AGENDA)[]).map((k) => (
          <BotaoRapido key={k} acao={`agenda_${k}`} aoConcluir={aoSalvar}>
            {PRESETS_AGENDA[k].rotulo}: {PRESETS_AGENDA[k].longo} + {PRESETS_AGENDA[k].short}
          </BotaoRapido>
        ))}
      </div>
      {(['longo', 'short'] as const).map((t) => (
        <LinhaFrequencia key={`${t}-${p.frequencia[t].porSemana}-${p.frequencia[t].hora}`} tipo={t} f={p.frequencia[t]} aoSalvar={aoSalvar} />
      ))}
    </Secao>
  )
}

function LinhaFrequencia({ tipo, f, aoSalvar }: { tipo: TipoVideo; f: FrequenciaFormato; aoSalvar: () => void }) {
  const { avisar, avisarErro } = useRetorno()
  const [n, setN] = useState(f.porSemana)
  const [hora, setHora] = useState(f.hora)
  const mudou = n !== f.porSemana || hora !== f.hora
  return (
    <div className="frequencia">
      <div style={{ minWidth: 140 }}>
        <strong>{tipo === 'longo' ? 'Vídeos longos' : 'Shorts'}</strong>
        <div className="secundario pequeno">{f.pausado ? 'Pausado' : `${f.porSemana} por semana`}</div>
      </div>
      <Campo rotulo="Por semana">
        <select className="entrada" value={n} onChange={(e) => setN(Number(e.target.value))}>
          {Array.from({ length: FREQUENCIA_MAXIMA + 1 }, (_, i) => (
            <option key={i} value={i}>
              {i === 0 ? '0 (pausar)' : i}
            </option>
          ))}
        </select>
      </Campo>
      <Campo rotulo="Horário">
        <input type="time" className="entrada" value={hora} onChange={(e) => setHora(e.target.value)} />
      </Campo>
      <div>
        <span className="secundario pequeno">Dias atuais</span>
        <div className="dias-semana" aria-label={`Dias: ${f.dias.map((d) => NOMES_DIAS[d]).join(', ') || 'nenhum'}`}>
          {DIAS.map((d, i) => (
            <span key={i} className={f.dias.includes(i) && !f.pausado ? 'ativo' : ''} title={NOMES_DIAS[i]}>
              {d}
            </span>
          ))}
        </div>
      </div>
      <button
        className="botao primario"
        disabled={!mudou || !/^\d{2}:\d{2}$/.test(hora)}
        onClick={async () => {
          try {
            await chamar('painel:frequencia', { tipo, porSemana: n, hora })
            avisar(n === 0 ? `${tipo === 'longo' ? 'Vídeos longos' : 'Shorts'} pausados.` : `Frequência salva: ${n} por semana às ${hora}.`)
            aoSalvar()
          } catch (e) {
            avisarErro(mensagemDeErro(e))
          }
        }}
      >
        Aplicar
      </button>
    </div>
  )
}
