import { useEffect, useRef, useState } from 'react'
import { chamar, mensagemDeErro } from '../api'
import { useRetorno } from './retorno'
import { BarraProgresso, formatarTempo } from './progresso'
import { useNavegacao } from '../navegacao'
import { formatarData } from './ui'
import type { EstadoAtividade } from '@shared/tipos'
import { ROTULO_STATUS_PESQUISA, type StatusPesquisa } from '@shared/dominio'

/**
 * Indicador fixo no topo: mostra se o aplicativo está trabalhando, em espera ou pausado,
 * o que está fazendo agora (com porcentagem) e quando é a próxima tarefa automática.
 * "Trabalhar agora" retoma as tarefas (se pausadas) e dispara a pesquisa de novidades na hora.
 */
export function StatusTrabalho() {
  const nav = useNavegacao()
  const { avisar, avisarErro } = useRetorno()
  const [estado, setEstado] = useState<EstadoAtividade | null>(null)
  const [aberto, setAberto] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [agora, setAgora] = useState(() => Date.now())
  const caixa = useRef<HTMLDivElement>(null)

  // Consulta leve a cada 2 s (mais rápida enquanto há trabalho em andamento).
  useEffect(() => {
    let vivo = true
    const consultar = (): void => {
      chamar('atividade:estado').then(
        (e) => {
          if (!vivo) return
          setEstado(e)
          setAgora(Date.now())
        },
        () => undefined
      )
    }
    consultar()
    const t = setInterval(consultar, estado?.modo === 'trabalhando' ? 1000 : 2500)
    return () => {
      vivo = false
      clearInterval(t)
    }
  }, [estado?.modo])

  // Fecha o painel ao clicar fora.
  useEffect(() => {
    if (!aberto) return
    const fora = (e: MouseEvent): void => {
      if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false)
    }
    document.addEventListener('mousedown', fora)
    return () => document.removeEventListener('mousedown', fora)
  }, [aberto])

  if (!estado) return null
  const trabalhar = async (): Promise<void> => {
    setOcupado(true)
    try {
      const r = await chamar('atividade:trabalharAgora')
      setEstado(r.estado)
      avisar(r.mensagem)
    } catch (e) {
      avisarErro(mensagemDeErro(e))
    } finally {
      setOcupado(false)
    }
  }
  const pausar = async (pausada: boolean): Promise<void> => {
    try {
      await chamar('fila:definirPausaGlobal', { pausada })
      setEstado(await chamar('atividade:estado'))
      avisar(pausada ? 'Tarefas automáticas pausadas.' : 'Tarefas automáticas retomadas.')
    } catch (e) {
      avisarErro(mensagemDeErro(e))
    }
  }
  const principal = estado.atividades[0]
  const faltam = estado.proximaPesquisa ? (new Date(estado.proximaPesquisa).getTime() - agora) / 1000 : null
  const resumo =
    estado.modo === 'pausado'
      ? 'Pausado: nada roda sozinho'
      : estado.modo === 'trabalhando'
        ? `${principal!.titulo}${principal!.percentual !== null ? ` · ${principal!.percentual}%` : ''}${estado.atividades.length > 1 ? ` · +${estado.atividades.length - 1}` : ''}`
        : faltam !== null
          ? `Em espera${estado.pilotoLigado ? ' · piloto ligado' : ''} · próxima pesquisa em ${formatarTempo(Math.max(0, faltam))}`
          : `Em espera${estado.pilotoLigado ? ' · piloto ligado' : ''}`
  const ir = (tela: Parameters<typeof nav.irPara>[0]): void => {
    setAberto(false)
    nav.irPara(tela)
  }
  return (
    <div className="status-trabalho" ref={caixa}>
      <button className={`status-chip ${estado.modo}`} onClick={() => setAberto((a) => !a)} aria-expanded={aberto} aria-label={`Situação: ${resumo}. Clique para detalhes.`} title="Ver o que o aplicativo está fazendo">
        <span className="status-ponto" aria-hidden />
        <span className="status-texto">{resumo}</span>
      </button>
      {estado.modo === 'pausado' ? (
        <button className="botao primario pequeno" disabled={ocupado} onClick={() => void trabalhar()}>
          {ocupado ? 'Iniciando…' : 'Retomar e produzir tudo'}
        </button>
      ) : (
        <button className="botao primario pequeno" disabled={ocupado} onClick={() => void trabalhar()} title="Liga o piloto automático, pesquisa novidades e produz tudo sozinho, do tema ao envio privado">
          {ocupado ? 'Iniciando…' : estado.pilotoLigado ? 'Trabalhar agora' : 'Produzir tudo'}
        </button>
      )}
      {aberto && (
        <div className="status-painel" role="dialog" aria-label="O que o aplicativo está fazendo">
          <div className="status-painel-topo">
            <strong>{estado.modo === 'trabalhando' ? 'Trabalhando agora' : estado.modo === 'pausado' ? 'Tarefas automáticas pausadas' : 'Em espera'}</strong>
            {estado.modo !== 'pausado' ? (
              <button className="botao pequeno fantasma" onClick={() => void pausar(true)}>
                Pausar tudo
              </button>
            ) : (
              <button className="botao pequeno fantasma" onClick={() => void pausar(false)}>
                Só retomar
              </button>
            )}
          </div>
          {estado.atividades.length === 0 && <p className="secundario pequeno">Nada em andamento neste momento.</p>}
          {estado.atividades.map((a, i) => (
            <BarraProgresso key={i} percentual={a.percentual} etapa={a.titulo} detalhe={a.detalhe} />
          ))}
          <ul className="status-lista pequeno">
            <li>
              <span className="secundario">Piloto automático:</span> {estado.pilotoLigado ? 'ligado (avança os vídeos a cada 5 min)' : 'desligado'}{' '}
              <button className="link-botao" onClick={() => ir('painel')}>
                {estado.pilotoLigado ? 'ver' : 'ligar'}
              </button>
            </li>
            <li>
              <span className="secundario">Pesquisa automática:</span> {estado.frequencia}
              {estado.proximaPesquisa && ` · próxima ${formatarData(estado.proximaPesquisa, true)}`}
            </li>
            {estado.ultimaPesquisa && (
              <li>
                <span className="secundario">Última pesquisa:</span> {formatarData(estado.ultimaPesquisa.quando, true)} · {ROTULO_STATUS_PESQUISA[estado.ultimaPesquisa.status as StatusPesquisa] ?? estado.ultimaPesquisa.status} · {estado.ultimaPesquisa.resultados} resultado(s){' '}
                <button className="link-botao" onClick={() => ir('pautas')}>
                  ver
                </button>
              </li>
            )}
          </ul>
          {(estado.pendentes.revisar > 0 || estado.pendentes.pautasSemRoteiro > 0 || estado.pendentes.publicacoes > 0) && (
            <>
              <strong className="pequeno">Esperando por você</strong>
              <ul className="status-lista pequeno">
                {estado.pendentes.pautasSemRoteiro > 0 && (
                  <li>
                    <button className="link-botao" onClick={() => ir('painel')}>
                      {estado.pendentes.pautasSemRoteiro} pauta(s) aprovada(s) sem roteiro
                    </button>
                  </li>
                )}
                {estado.pendentes.revisar > 0 && (
                  <li>
                    <button className="link-botao" onClick={() => ir('revisao')}>
                      {estado.pendentes.revisar} roteiro(s) para revisar
                    </button>
                  </li>
                )}
                {estado.pendentes.publicacoes > 0 && (
                  <li>
                    <button className="link-botao" onClick={() => ir('publicacoes')}>
                      {estado.pendentes.publicacoes} publicação(ões) aguardando aprovação
                    </button>
                  </li>
                )}
              </ul>
            </>
          )}
          {estado.avisos.map((a) => (
            <p key={a} className="pequeno" style={{ color: 'var(--amarelo)', margin: '4px 0' }}>
              ⚠ {a}
            </p>
          ))}
          <p className="secundario pequeno" style={{ marginBottom: 0 }}>
            As tarefas automáticas só rodam com o aplicativo aberto (ou na bandeja). <button className="link-botao" onClick={() => ir('fila')}>Ver todas as tarefas</button>
          </p>
        </div>
      )}
    </div>
  )
}
