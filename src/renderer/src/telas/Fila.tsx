import { useMemo, useState } from 'react'
import { chamar, mensagemDeErro, useDados } from '../api'
import { useRetorno } from '../componentes/retorno'
import { Alerta, Cabecalho, Carregando, ErroCarregar, Etiqueta, Secao, Vazio, formatarData, type CorEtiqueta } from '../componentes/ui'
import { useNavegacao } from '../navegacao'
import { ROTULO_STATUS_TAREFA, ROTULO_TIPO_VIDEO, type StatusTarefa } from '@shared/dominio'

const COR: Record<StatusTarefa, CorEtiqueta> = {
  pendente: 'azul',
  em_andamento: 'amarela',
  concluida: 'verde',
  erro: 'vermelha',
  perdida: 'vermelha',
  ignorada: 'cinza',
  cancelada: 'cinza'
}

export function Fila() {
  const { avisar, avisarErro, confirmar } = useRetorno()
  const [aba, setAba] = useState<'producao' | 'tarefas'>('producao')
  const pausa = useDados(() => chamar('fila:pausaGlobal'), [])
  return (
    <>
      <Cabecalho
        titulo="Fila de produção"
        descricao="Agenda, roteiro, revisão, edição, qualidade e publicação de cada conteúdo."
        acoes={
          pausa.dados && (
            <button
              className={`botao ${pausa.dados.pausada ? 'primario' : 'perigo'}`}
              onClick={async () => {
                const pausar = !pausa.dados!.pausada
                if (pausar && !(await confirmar({ titulo: 'Parar todas as tarefas automáticas?', texto: 'Pesquisas agendadas deixam de rodar (a em andamento é cancelada) até você retomar. Vale também depois de reiniciar o aplicativo.', confirmar: 'Parar tudo', perigo: true }))) return
                try {
                  await chamar('fila:definirPausaGlobal', { pausada: pausar })
                  avisar(pausar ? 'Tarefas automáticas paradas.' : 'Tarefas automáticas retomadas.')
                  pausa.recarregar()
                } catch (e) {
                  avisarErro(mensagemDeErro(e))
                }
              }}
            >
              {pausa.dados.pausada ? 'Retomar tarefas automáticas' : 'Parar todas as tarefas automáticas'}
            </button>
          )
        }
      />
      <div style={{ marginBottom: 16 }}>
        {pausa.dados?.pausada && <Alerta tipo="erro">Tarefas automáticas PARADAS. Nada é executado por agendamento até você retomar.</Alerta>}
        <Alerta tipo="info">Tarefas automáticas só rodam com o aplicativo aberto. Nenhum vídeo é publicado automaticamente: o envio sempre passa pela sua aprovação.</Alerta>
      </div>
      <div className="abas" role="tablist">
        <button role="tab" className="aba" aria-selected={aba === 'producao'} onClick={() => setAba('producao')}>
          Conteúdos agendados
        </button>
        <button role="tab" className="aba" aria-selected={aba === 'tarefas'} onClick={() => setAba('tarefas')}>
          Tarefas automáticas
        </button>
      </div>
      {aba === 'producao' ? <Producao /> : <Tarefas />}
    </>
  )
}

function Producao() {
  const nav = useNavegacao()
  const { avisarErro } = useRetorno()
  const itens = useDados(() => chamar('fila:itens'), [])
  const [ordem, setOrdem] = useState<'prioridade' | 'data' | 'pendencias'>('prioridade')
  const lista = useMemo(() => {
    const l = [...(itens.dados ?? [])]
    if (ordem === 'data') l.sort((a, b) => a.inicioUtc.localeCompare(b.inicioUtc))
    if (ordem === 'pendencias') l.sort((a, b) => b.pendencias.length - a.pendencias.length)
    return l
  }, [itens.dados, ordem])
  const acao = async (fn: () => Promise<unknown>): Promise<void> => {
    try {
      await fn()
      itens.recarregar()
    } catch (e) {
      avisarErro(mensagemDeErro(e))
    }
  }
  return (
    <Secao
      acoes={
        <div className="chips">
          {(['prioridade', 'data', 'pendencias'] as const).map((o) => (
            <button key={o} className="chip" aria-pressed={ordem === o} onClick={() => setOrdem(o)}>
              {o === 'prioridade' ? 'Prioridade' : o === 'data' ? 'Data' : 'Mais pendências'}
            </button>
          ))}
        </div>
      }
    >
      {itens.erro && <ErroCarregar mensagem={itens.erro} tentarNovamente={itens.recarregar} />}
      {itens.carregando && !itens.dados && <Carregando />}
      {lista.length === 0 && itens.dados && <Vazio titulo="Nada agendado" texto="Agende conteúdos no Calendário." icone="fila" />}
      <ul className="lista">
        {lista.map((i) => (
          <li key={i.id} className="lista-item" style={{ alignItems: 'flex-start', opacity: i.pausado ? 0.6 : 1 }}>
            <div className="lista-principal">
              <div className="lista-titulo">
                {i.titulo} {i.atrasado && <Etiqueta cor="vermelha">Atrasado</Etiqueta>} {i.pausado && <Etiqueta>Pausado</Etiqueta>}
              </div>
              <div className="lista-meta">
                <span>{ROTULO_TIPO_VIDEO[i.tipoVideo]}</span>
                <span>· {formatarData(i.inicioUtc, true)}</span>
                <span>· prioridade {i.prioridade}</span>
              </div>
              <div className="lista-meta">
                <span>Revisão: {i.revisao}</span>
                <span>· Produção: {i.producao}</span>
                <span>· Qualidade: {i.qualidade}</span>
                <span>· Publicação: {i.publicacao}</span>
              </div>
              {i.bloqueiaPublicacao && <div className="pequeno" style={{ color: 'var(--vermelho-suave)' }}>Publicação bloqueada até o roteiro estar aprovado e o controle de qualidade aprovado.</div>}
              {i.pendencias.length > 0 && (
                <ul className="secundario pequeno" style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                  {i.pendencias.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              )}
            </div>
            <div style={{ display: 'grid', gap: 4 }}>
              <button className="botao pequeno fantasma" onClick={() => void acao(() => chamar('fila:priorizar', { id: i.id, delta: 1 }))}>
                Priorizar ↑
              </button>
              <button className="botao pequeno fantasma" onClick={() => void acao(() => chamar('fila:priorizar', { id: i.id, delta: -1 }))}>
                Baixar ↓
              </button>
              <button className="botao pequeno fantasma" onClick={() => void acao(() => chamar('fila:pausarItem', { id: i.id, pausado: !i.pausado }))}>
                {i.pausado ? 'Retomar' : 'Pausar'}
              </button>
              {i.roteiroId && (
                <button className="botao pequeno fantasma" onClick={() => nav.abrirRoteiro(i.roteiroId!)}>
                  Abrir roteiro
                </button>
              )}
              <button className="botao pequeno fantasma" onClick={() => nav.irPara('calendario')}>
                Reagendar/cancelar
              </button>
            </div>
          </li>
        ))}
      </ul>
    </Secao>
  )
}

function Tarefas() {
  const { avisar, avisarErro } = useRetorno()
  const lista = useDados(() => chamar('tarefas:listar'), [])
  const agir = async (canal: 'tarefas:repetir' | 'tarefas:ignorar' | 'tarefas:cancelar', id: number, msg: string): Promise<void> => {
    try {
      await chamar(canal, { id })
      avisar(msg)
      lista.recarregar()
    } catch (e) {
      avisarErro(mensagemDeErro(e))
    }
  }
  return (
    <Secao acoes={<button className="botao pequeno" onClick={lista.recarregar}>Atualizar</button>}>
      {lista.erro && <ErroCarregar mensagem={lista.erro} tentarNovamente={lista.recarregar} />}
      {lista.carregando && !lista.dados && <Carregando />}
      {lista.dados?.length === 0 && <Vazio titulo="Nenhuma tarefa" texto="Pesquisas agendadas e gerações aparecem aqui." icone="fila" />}
      {lista.dados && lista.dados.length > 0 && (
        <div className="tabela-wrap">
          <table>
            <thead>
              <tr>
                <th>Tarefa</th>
                <th>Horário</th>
                <th>Estado</th>
                <th>Diagnóstico</th>
                <th>
                  <span className="sr">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {lista.dados.map((t) => (
                <tr key={t.id}>
                  <td className="td-titulo">{t.descricao}</td>
                  <td>{formatarData(t.agendadaPara ?? t.criadoEm, true)}</td>
                  <td>
                    <Etiqueta cor={COR[t.status]}>{ROTULO_STATUS_TAREFA[t.status]}</Etiqueta>
                  </td>
                  <td className="secundario pequeno">{t.diagnostico ?? '—'}</td>
                  <td>
                    <div className="acoes" style={{ flexWrap: 'nowrap' }}>
                      {['erro', 'perdida', 'cancelada', 'ignorada'].includes(t.status) && t.tipo !== 'geracao_roteiro' && (
                        <button className="botao pequeno" onClick={() => void agir('tarefas:repetir', t.id, 'Tarefa recolocada na fila.')}>
                          Tentar novamente
                        </button>
                      )}
                      {t.status === 'pendente' && (
                        <button className="botao pequeno fantasma" onClick={() => void agir('tarefas:cancelar', t.id, 'Tarefa cancelada.')}>
                          Cancelar
                        </button>
                      )}
                      {['perdida', 'erro'].includes(t.status) && (
                        <button className="botao pequeno fantasma" onClick={() => void agir('tarefas:ignorar', t.id, 'Tarefa marcada como ignorada.')}>
                          Ignorar
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Secao>
  )
}
