import { useState } from 'react'
import { chamar, useDados } from '../api'
import { Icone } from '../componentes/Icone'
import { Alerta, Cabecalho, Carregando, ErroCarregar, Etiqueta, Secao, Vazio, formatarData } from '../componentes/ui'
import { COR_STATUS_ROTEIRO, useNavegacao } from '../navegacao'
import { ROTULO_STATUS_PESQUISA, ROTULO_STATUS_ROTEIRO, ROTULO_TIPO_VIDEO } from '@shared/dominio'
import type { RoteiroResumo } from '@shared/tipos'
import { NovoRoteiro } from './NovoRoteiro'
import { BotaoRapido } from '../componentes/rapido'

export function VisaoGeral() {
  const nav = useNavegacao()
  const { dados, erro, carregando, recarregar } = useDados(() => chamar('visaoGeral:obter'), [])
  const [novo, setNovo] = useState(false)
  const assistente = useDados(() => chamar('assistente:estado'), [])
  const a = assistente.dados

  return (
    <>
      <Cabecalho
        titulo="Visão geral"
        acoes={
          <>
            <button className="botao" onClick={() => nav.irPara('pautas')}>
              <Icone nome="pauta" tamanho={18} /> Nova pesquisa
            </button>
            <button className="botao primario" onClick={() => setNovo(true)} disabled={dados ? !dados.temProjetos : true}>
              <Icone nome="mais" tamanho={18} /> Novo roteiro
            </button>
            <button className="botao" onClick={() => nav.irPara('biblioteca')}>
              Abrir biblioteca
            </button>
          </>
        }
      />
      {carregando && !dados && <Carregando />}
      {erro && <ErroCarregar mensagem={erro} tentarNovamente={recarregar} />}
      {a && !a.concluido && (
        <Secao
          titulo="Configuração inicial"
          acoes={
            <>
              <BotaoRapido acao="tudo" primario aoConcluir={() => (assistente.recarregar(), recarregar())}>
                Configurar tudo com o recomendado (1 clique)
              </BotaoRapido>
              <button className="botao" onClick={() => nav.irPara('inicio')}>
                {a.concluidas === 0 ? 'Configuração guiada' : 'Continuar configuração'}
              </button>
            </>
          }
        >
          <p className="secundario">
            {a.concluidas} de {a.obrigatorias} etapas essenciais concluídas. O guia explica, passo a passo, o projeto do canal, as fontes de pesquisa, a agenda, a IA, o vídeo (até 4K), a conta do YouTube e o backup.
          </p>
          <div className="progresso-geral" style={{ margin: '8px 0 0' }}>
            <div style={{ width: `${Math.round((a.concluidas / a.obrigatorias) * 100)}%` }} />
          </div>
        </Secao>
      )}
      {dados && (
        <>
          {!dados.temProjetos && a?.concluido && (
            <Secao>
              <Vazio
                titulo="Comece criando o projeto do seu canal"
                texto="Projetos agrupam pautas, roteiros e agenda. Você pode ter mais de um."
                acao={
                  <button className="botao primario" onClick={() => nav.irPara('inicio')}>
                    Abrir Primeiros passos
                  </button>
                }
              />
            </Secao>
          )}
          {(dados.alertasAgenda.length > 0 || dados.tarefasPerdidas > 0) && (
            <div style={{ marginBottom: 16 }}>
              {dados.tarefasPerdidas > 0 && (
                <Alerta>
                  {dados.tarefasPerdidas} pesquisa(s) agendada(s) foram perdidas porque o aplicativo estava fechado.{' '}
                  <button className="botao pequeno fantasma" onClick={() => nav.irPara('fila')}>
                    Ver na fila
                  </button>
                </Alerta>
              )}
              {dados.alertasAgenda.map((a) => (
                <Alerta key={a}>{a}</Alerta>
              ))}
            </div>
          )}
          <div className="grade">
            <Secao titulo="Próximos conteúdos programados">
              {dados.proximos.length === 0 ? (
                <Vazio compacto titulo="Nada agendado" texto="Use o Calendário para reservar horários de publicação." />
              ) : (
                <ul className="lista">
                  {dados.proximos.map((a) => (
                    <li key={a.id} className={`lista-item${a.roteiroId ? ' clicavel' : ''}`} onClick={() => a.roteiroId && nav.abrirRoteiro(a.roteiroId)}>
                      <div className="lista-principal">
                        <div className="lista-titulo">{a.titulo}</div>
                        <div className="lista-meta">
                          <span>{formatarData(a.inicioUtc, true)}</span>
                          <span>{ROTULO_TIPO_VIDEO[a.tipoVideo]}</span>
                        </div>
                      </div>
                      {a.statusRoteiro && <Etiqueta cor={COR_STATUS_ROTEIRO[a.statusRoteiro]}>{ROTULO_STATUS_ROTEIRO[a.statusRoteiro]}</Etiqueta>}
                    </li>
                  ))}
                </ul>
              )}
            </Secao>
            <Secao titulo="Roteiros aguardando revisão">
              <ListaRoteiros itens={dados.aguardandoRevisao} vazio="Nenhum roteiro em revisão." />
            </Secao>
            <Secao titulo="Pesquisas em andamento ou com erro">
              {dados.pesquisas.length === 0 ? (
                <Vazio compacto titulo="Nenhuma pesquisa pendente" texto="Pesquisas manuais e agendadas com erro ou em andamento aparecem aqui." />
              ) : (
                <ul className="lista">
                  {dados.pesquisas.map((p) => (
                    <li key={p.id} className="lista-item">
                      <div className="lista-principal">
                        <div className="lista-titulo">{p.consulta}</div>
                        <div className="lista-meta">{p.mensagemErro ?? formatarData(p.iniciadaEm, true)}</div>
                      </div>
                      <Etiqueta cor={p.status === 'erro' ? 'vermelha' : 'amarela'}>{ROTULO_STATUS_PESQUISA[p.status]}</Etiqueta>
                    </li>
                  ))}
                </ul>
              )}
            </Secao>
            <Secao titulo="Roteiros recentes">
              <ListaRoteiros itens={dados.recentes} vazio="Nenhum roteiro ainda." />
            </Secao>
            <Secao titulo="Estado dos serviços">
              <ul className="lista">
                {dados.servicos.map((s) => (
                  <li key={s.nome} className="lista-item">
                    <div className="lista-principal">
                      <div className="lista-titulo">{s.nome}</div>
                      <div className="lista-meta">{s.mensagem}</div>
                    </div>
                    <Etiqueta cor={s.estado === 'conectado' || s.estado === 'local' ? 'verde' : s.estado === 'erro' ? 'vermelha' : 'cinza'}>
                      {{ conectado: 'Conectado', local: 'Local', erro: 'Erro', nao_configurado: 'Não configurado' }[s.estado]}
                    </Etiqueta>
                  </li>
                ))}
              </ul>
            </Secao>
          </div>
        </>
      )}
      <NovoRoteiro aberto={novo} aoFechar={() => setNovo(false)} />
    </>
  )
}

function ListaRoteiros({ itens, vazio }: { itens: RoteiroResumo[]; vazio: string }) {
  const nav = useNavegacao()
  if (itens.length === 0) return <Vazio compacto titulo={vazio} />
  return (
    <ul className="lista">
      {itens.map((r) => (
        <li key={r.id} className="lista-item clicavel" onClick={() => nav.abrirRoteiro(r.id)}>
          <div className="lista-principal">
            <div className="lista-titulo">{r.titulo}</div>
            <div className="lista-meta">
              <span>{ROTULO_TIPO_VIDEO[r.tipoVideo]}</span>
              <span>·</span>
              <span>Atualizado {formatarData(r.atualizadoEm)}</span>
            </div>
          </div>
          <Etiqueta cor={COR_STATUS_ROTEIRO[r.status]}>{ROTULO_STATUS_ROTEIRO[r.status]}</Etiqueta>
        </li>
      ))}
    </ul>
  )
}
