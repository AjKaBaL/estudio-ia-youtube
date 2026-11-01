import { useState, type ReactNode } from 'react'
import { chamar, mensagemDeErro, useDados } from '../api'
import { Icone } from '../componentes/Icone'
import { GuiaOllama } from '../componentes/guias'
import { PreferenciaVideo } from '../componentes/render'
import { useRetorno } from '../componentes/retorno'
import { Alerta, Cabecalho, Campo, Carregando, ErroCarregar, Etiqueta, Secao } from '../componentes/ui'
import { useNavegacao } from '../navegacao'
import { ROTULO_FREQUENCIA, ROTULO_PERIODO, ROTULO_POLITICA } from '@shared/editorial'
import { ROTULO_MODO } from '@shared/ia'
import { ETAPAS_ASSISTENTE, type EtapaAssistente } from '@shared/schemas'
import type { EstadoAssistente } from '@shared/tipos'
import { FontesEOpcoes } from './Pesquisa'
import { ContaYouTube } from './Publicacoes'
import { FerramentasFfmpeg } from './Estudio'
import { pedirAbaConfig, SegundoPlano } from './Configuracoes'
import { ItemCatalogo } from './Servicos'
import { BotaoRapido, InstalarFfmpeg, InstalarOllama } from '../componentes/rapido'
import { CATALOGO_IA } from '@shared/catalogoIa'
import { PRESETS_AGENDA } from '@shared/configRapida'

/**
 * Assistente de primeiros passos: guia detalhado das configurações que precisam ser feitas uma vez.
 * Cada etapa mostra o que é, por que importa e como fazer, e a situação vem dos dados reais.
 */

const TITULOS: Record<EtapaAssistente, string> = {
  boasvindas: 'Boas-vindas',
  projeto: 'Projeto do canal',
  pesquisa: 'Fontes de pesquisa',
  agenda: 'Agenda e pesquisas automáticas',
  ia: 'Inteligência artificial',
  video: 'Vídeo e renderização',
  youtube: 'Conta do YouTube',
  backup: 'Backup e conclusão'
}

const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']

export function PrimeirosPassos() {
  const estado = useDados(() => chamar('assistente:estado'), [])
  if (estado.erro) return <ErroCarregar mensagem={estado.erro} tentarNovamente={estado.recarregar} />
  if (!estado.dados) return <Carregando />
  return <Assistente inicial={estado.dados} />
}

function Assistente({ inicial }: { inicial: EstadoAssistente }) {
  const nav = useNavegacao()
  const { avisarErro } = useRetorno()
  const [estado, setEstado] = useState(inicial)
  // Começa na primeira etapa obrigatória ainda não feita.
  const [atual, setAtual] = useState<EtapaAssistente>(ETAPAS_ASSISTENTE.find((e) => !inicial.etapas[e].feito && !inicial.etapas[e].opcional) ?? 'boasvindas')
  const indice = ETAPAS_ASSISTENTE.indexOf(atual)

  const salvar = async (d: { revisada?: EtapaAssistente; concluido?: boolean; dispensado?: boolean }): Promise<void> => {
    try {
      setEstado(await chamar('assistente:salvar', d))
    } catch (e) {
      avisarErro(mensagemDeErro(e))
    }
  }
  const atualizar = async (): Promise<void> => {
    try {
      setEstado(await chamar('assistente:estado'))
    } catch (e) {
      avisarErro(mensagemDeErro(e))
    }
  }
  const revisarEAvancar = async (etapa: EtapaAssistente): Promise<void> => {
    await salvar({ revisada: etapa })
    const prox = ETAPAS_ASSISTENTE[ETAPAS_ASSISTENTE.indexOf(etapa) + 1]
    if (prox) setAtual(prox)
  }

  // Depois de um botão de 1 clique: atualiza a situação e vai para a próxima etapa.
  const aplicado = (novo: EstadoAssistente, etapa?: EtapaAssistente): void => {
    setEstado(novo)
    const prox = etapa ? ETAPAS_ASSISTENTE[ETAPAS_ASSISTENTE.indexOf(etapa) + 1] : undefined
    if (prox) setAtual(prox)
  }
  const props: PropsEtapa = { estado, atualizar, revisarEAvancar, aplicado }
  return (
    <>
      <Cabecalho
        titulo="Primeiros passos"
        descricao="Configuração guiada, feita uma vez. Você pode parar e continuar depois: o progresso fica salvo."
        acoes={
          !estado.concluido && (
            <button
              className="botao fantasma"
              onClick={async () => {
                await salvar({ dispensado: true })
                nav.irPara('visao')
              }}
            >
              Continuar depois
            </button>
          )
        }
      />
      {!estado.concluido && (
        <div className="cartao-suave rapido-tudo">
          <div>
            <strong>Configuração rápida (1 clique)</strong>
            <p className="secundario pequeno" style={{ margin: '4px 0 0' }}>
              Aplica o recomendado em tudo que não depende de conta: projeto do canal, 27 fontes e termos de pesquisa, agenda (1 longo + 3 Shorts por semana), IA híbrida com revisão interna, vídeo automático até 4K e o primeiro backup. Depois faltam só as chaves das IAs gratuitas (ou o Ollama) e, se quiser, o YouTube.
            </p>
          </div>
          <BotaoRapido acao="tudo" primario aoConcluir={(e) => (setEstado(e), setAtual('ia'))}>
            Configurar tudo com o recomendado
          </BotaoRapido>
        </div>
      )}
      <div className="assistente">
        <nav aria-label="Etapas da configuração">
          <ol className="passos">
            <li className="pequeno secundario" style={{ padding: '4px 10px' }}>
              {estado.concluidas} de {estado.obrigatorias} etapas essenciais
            </li>
            <li>
              <div className="progresso-geral" aria-hidden>
                <div style={{ width: `${Math.round((estado.concluidas / estado.obrigatorias) * 100)}%` }} />
              </div>
            </li>
            {ETAPAS_ASSISTENTE.map((e, i) => (
              <li key={e}>
                <button className={`passo${estado.etapas[e].feito ? ' feito' : ''}`} aria-current={e === atual ? 'step' : undefined} onClick={() => setAtual(e)}>
                  <span className="passo-num">{estado.etapas[e].feito ? <Icone nome="ok" tamanho={14} /> : i + 1}</span>
                  <span className="passo-texto">
                    <span>
                      {TITULOS[e]}
                      {estado.etapas[e].opcional && <span className="secundario"> (opcional)</span>}
                    </span>
                    <small>{estado.etapas[e].detalhe}</small>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </nav>
        <div>
          {atual === 'boasvindas' && <BoasVindas {...props} />}
          {atual === 'projeto' && <EtapaProjeto {...props} />}
          {atual === 'pesquisa' && <EtapaPesquisa {...props} />}
          {atual === 'agenda' && <EtapaAgenda {...props} />}
          {atual === 'ia' && <EtapaIa {...props} />}
          {atual === 'video' && <EtapaVideo {...props} />}
          {atual === 'youtube' && <EtapaYouTube {...props} />}
          {atual === 'backup' && <EtapaBackup {...props} concluir={() => void salvar({ concluido: true }).then(() => nav.irPara('visao'))} />}
          <div className="navegacao-passos">
            <button className="botao" disabled={indice === 0} onClick={() => setAtual(ETAPAS_ASSISTENTE[indice - 1]!)}>
              <Icone nome="voltar" tamanho={18} /> Anterior
            </button>
            {indice < ETAPAS_ASSISTENTE.length - 1 && (
              <button className="botao" onClick={() => setAtual(ETAPAS_ASSISTENTE[indice + 1]!)}>
                Próxima etapa: {TITULOS[ETAPAS_ASSISTENTE[indice + 1]!]}
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

interface PropsEtapa {
  estado: EstadoAssistente
  atualizar: () => Promise<void>
  revisarEAvancar: (e: EtapaAssistente) => Promise<void>
  aplicado: (novo: EstadoAssistente, etapa?: EtapaAssistente) => void
}

/** Cabeçalho comum de etapa: o que é e por que importa. */
function Explicacao({ etapa, estado, oQue, porQue, children }: { etapa: EtapaAssistente; estado: EstadoAssistente; oQue: ReactNode; porQue: ReactNode; children?: ReactNode }) {
  const s = estado.etapas[etapa]
  return (
    <Secao titulo={TITULOS[etapa]} acoes={<Etiqueta cor={s.feito ? 'verde' : s.opcional ? 'cinza' : 'amarela'}>{s.feito ? 'Concluída' : s.opcional ? 'Opcional' : 'Pendente'}</Etiqueta>}>
      <div className="explicacao">
        <h3>O que é</h3>
        <div className="secundario">{oQue}</div>
        <h3>Por que importa</h3>
        <div className="secundario">{porQue}</div>
        {children}
      </div>
    </Secao>
  )
}

function BoasVindas({ estado, revisarEAvancar }: PropsEtapa) {
  const info = useDados(() => chamar('sistema:info'), [])
  return (
    <Explicacao
      etapa="boasvindas"
      estado={estado}
      oQue={
        <>
          <p>O Estúdio IA YouTube ajuda a produzir vídeos sobre tecnologia, IA e negócios com método: pesquisa em fontes que você escolhe, pautas avaliadas, verificação de fatos, roteiro, revisão, edição, controle de qualidade e publicação.</p>
          <p>Este assistente passa por tudo que precisa ser configurado uma vez. Leva de 15 a 30 minutos (a conta do YouTube é opcional e pode ficar para depois).</p>
        </>
      }
      porQue={
        <ul className="lista-verificacao">
          <li>
            <Icone nome="ok" tamanho={16} /> Nada é publicado sem a sua aprovação. Os vídeos vão primeiro como <strong>privados</strong>.
          </li>
          <li>
            <Icone nome="ok" tamanho={16} /> Nenhuma fonte, citação ou número é inventado: o roteiro só usa afirmações que você verificou no dossiê.
          </li>
          <li>
            <Icone nome="ok" tamanho={16} /> Sem gastos por padrão: IA paga fica desligada (teto de gasto zero) até você decidir o contrário.
          </li>
          <li>
            <Icone nome="ok" tamanho={16} /> Senhas e chaves ficam num cofre criptografado pelo Windows, separado do banco de dados.
          </li>
        </ul>
      }
    >
      <h3>Onde ficam seus dados</h3>
      <p className="secundario">
        Tudo fica neste computador, em <code>{info.dados?.pastaDados ?? '…'}</code>. Desinstalar o aplicativo não apaga essa pasta.
      </p>
      <div className="acoes" style={{ marginTop: 12 }}>
        <button className="botao primario" onClick={() => void revisarEAvancar('boasvindas')}>
          Entendi, vamos começar
        </button>
      </div>
    </Explicacao>
  )
}

function EtapaProjeto({ estado, atualizar, revisarEAvancar, aplicado }: PropsEtapa) {
  const { avisar, avisarErro } = useRetorno()
  const projetos = useDados(() => chamar('projetos:listar'), [estado.projetoId])
  const [novo, setNovo] = useState({ nome: '', descricao: '' })
  return (
    <Explicacao
      etapa="projeto"
      estado={estado}
      oQue={<p>Um projeto representa um canal. Ele agrupa as fontes de pesquisa, as pautas, os roteiros, a mídia e a agenda. Você pode ter mais de um (por exemplo, um segundo canal), mas a maioria das pessoas usa só um.</p>}
      porQue={<p>Sem projeto, não é possível cadastrar fontes nem criar roteiros. A descrição ajuda você a manter o foco editorial: escreva para quem o canal fala e que tipo de vídeo ele faz.</p>}
    >
      {projetos.dados && projetos.dados.length > 0 && (
        <>
          <h3>Projetos existentes</h3>
          <ul className="lista">
            {projetos.dados.map((p) => (
              <li key={p.id} className="lista-item">
                <div className="lista-principal">
                  <div className="lista-titulo">{p.nome}</div>
                  <div className="lista-meta">{p.descricao || 'Sem descrição'}</div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      {!projetos.dados?.length && (
        <div className="acoes" style={{ marginTop: 12 }}>
          <BotaoRapido acao="projeto" primario aoConcluir={(e) => (projetos.recarregar(), aplicado(e, 'projeto'))}>
            Criar o projeto com o recomendado (1 clique)
          </BotaoRapido>
          <span className="secundario pequeno">Cria “Meu canal” com uma descrição de tecnologia, IA e negócios; você renomeia depois.</span>
        </div>
      )}
      <details className="ajuda">
        <summary>{projetos.dados?.length ? 'Criar outro projeto (opcional)' : 'Prefiro escolher o nome e a descrição'}</summary>
        <div className="ajuda-corpo">
      <div className="form-grade">
        <Campo rotulo="Nome do canal" ajuda="Como você reconhece este canal. Pode ser alterado depois.">
          <input className="entrada" value={novo.nome} maxLength={120} placeholder="Ex.: Meu canal de tecnologia" onChange={(e) => setNovo({ ...novo, nome: e.target.value })} />
        </Campo>
        <Campo rotulo="Descrição e público (opcional)" ajuda="Ex.: “Explico novidades de IA e negócios para profissionais não técnicos, com foco em impacto prático.”">
          <textarea className="entrada" rows={3} maxLength={1000} value={novo.descricao} onChange={(e) => setNovo({ ...novo, descricao: e.target.value })} />
        </Campo>
      </div>
      <div className="acoes" style={{ marginTop: 12 }}>
        <button
          className="botao primario"
          disabled={!novo.nome.trim()}
          onClick={async () => {
            try {
              await chamar('projetos:criar', novo)
              avisar('Projeto criado.')
              setNovo({ nome: '', descricao: '' })
              projetos.recarregar()
              await atualizar()
            } catch (e) {
              avisarErro(mensagemDeErro(e))
            }
          }}
        >
          Criar projeto
        </button>
      </div>
        </div>
      </details>
      <div className="acoes" style={{ marginTop: 12 }}>
        {estado.etapas.projeto.feito && (
          <button className="botao" onClick={() => void revisarEAvancar('projeto')}>
            Continuar
          </button>
        )}
      </div>
    </Explicacao>
  )
}

function EtapaPesquisa({ estado, atualizar, revisarEAvancar, aplicado }: PropsEtapa) {
  return (
    <>
      <Explicacao
        etapa="pesquisa"
        estado={estado}
        oQue={
          <p>
            São os sites que o aplicativo consulta para encontrar novidades: feeds RSS (listas automáticas de publicações) e páginas. Os <strong>termos monitorados</strong> são os assuntos que você quer acompanhar (ex.: “inteligência artificial”, “startups”, “chips”).
          </p>
        }
        porQue={
          <p>
            O aplicativo não procura na internet inteira: ele só lê o que você cadastrar. Fontes confiáveis geram pautas melhores e menos trabalho de verificação. Comece com 5 a 15 fontes; você pode ajustar a qualquer momento em <strong>Pautas e pesquisas › Fontes e opções</strong>.
          </p>
        }
      >
        <div className="acoes" style={{ marginTop: 12 }}>
          <BotaoRapido acao="pesquisa" primario aoConcluir={(e) => aplicado(e, 'pesquisa')}>
            Usar as 27 fontes e os termos recomendados (1 clique)
          </BotaoRapido>
          {!estado.projetoId && <span className="secundario pequeno">Sem projeto ainda: o botão cria “Meu canal” antes.</span>}
        </div>
      </Explicacao>
      {estado.projetoId && (
        <details className="ajuda">
          <summary>Ver, ajustar ou adicionar fontes e termos</summary>
          <div className="ajuda-corpo">
            <FontesEOpcoes projetoId={estado.projetoId} />
          </div>
        </details>
      )}
      {estado.projetoId && (
        <div className="acoes" style={{ marginTop: 12 }}>
          <button className="botao" onClick={() => void atualizar()}>
            Conferir situação
          </button>
          {estado.etapas.pesquisa.feito && (
            <button className="botao primario" onClick={() => void revisarEAvancar('pesquisa')}>
              Continuar
            </button>
          )}
        </div>
      )}
    </>
  )
}

function EtapaAgenda({ estado, aplicado }: PropsEtapa) {
  const nav = useNavegacao()
  const ed = useDados(() => chamar('editorial:obter'), [])
  const c = ed.dados?.config
  const horarios = (f: { horarios: { dia: number; hora: string }[] }): string => f.horarios.map((h) => `${DIAS[h.dia]} ${h.hora}`).join(', ') || 'nenhum horário'
  return (
    <Explicacao
      etapa="agenda"
      estado={estado}
      oQue={<p>Define quando o aplicativo pesquisa novidades sozinho, quanto tempo para trás ele procura e quantos vídeos você planeja publicar por semana.</p>}
      porQue={
        <p>
          Uma meta realista evita acumular roteiros sem revisão. O aplicativo avisa quando a meta passa da sua capacidade de revisão ou do orçamento. Importante: as tarefas automáticas só rodam com o aplicativo aberto; se ele estiver fechado no horário, vale a regra de “horário perdido” abaixo.
        </p>
      }
    >
      {ed.erro && <ErroCarregar mensagem={ed.erro} tentarNovamente={ed.recarregar} />}
      {c && (
        <>
          <h3>Como está configurado agora</h3>
          <table>
            <tbody>
              <tr>
                <td>Pesquisa automática</td>
                <td>
                  {ROTULO_FREQUENCIA[c.pesquisa.frequencia]}
                  {c.pesquisa.frequencia !== 'manual' && `, às ${c.pesquisa.horario}`}
                </td>
              </tr>
              <tr>
                <td>Período procurado</td>
                <td>{ROTULO_PERIODO[c.pesquisa.periodo]}</td>
              </tr>
              <tr>
                <td>Se o app estiver fechado no horário</td>
                <td>{ROTULO_POLITICA[c.pesquisa.politicaPerdida]}</td>
              </tr>
              <tr>
                <td>Horizonte de planejamento</td>
                <td>{c.horizonteDias} dias</td>
              </tr>
              <tr>
                <td>Vídeos longos</td>
                <td>
                  {c.agenda.formatos.longo.pausado ? 'pausados' : `até ${c.agenda.formatos.longo.limiteSemanal} por semana`} · {horarios(c.agenda.formatos.longo)}
                </td>
              </tr>
              <tr>
                <td>Shorts</td>
                <td>
                  {c.agenda.formatos.short.pausado ? 'pausados' : `até ${c.agenda.formatos.short.limiteSemanal} por semana`} · {horarios(c.agenda.formatos.short)}
                </td>
              </tr>
              <tr>
                <td>Fuso horário</td>
                <td>{c.agenda.fuso}</td>
              </tr>
              <tr>
                <td>Revisões que você consegue fazer por semana</td>
                <td>{c.capacidade.revisoesPorSemana}</td>
              </tr>
            </tbody>
          </table>
          {ed.dados!.alertas.map((a) => (
            <Alerta key={a}>{a}</Alerta>
          ))}
          <h3>Recomendação para começar</h3>
          <p className="secundario">
            Mantenha o padrão (1 vídeo longo e 3 Shorts por semana, pesquisa diária às 08:00 olhando os últimos 7 dias) nas primeiras semanas. Depois ajuste com base no tempo real que cada vídeo leva para você.
          </p>
        </>
      )}
      <h3>Escolha o ritmo (1 clique)</h3>
      <div className="opcoes-rapidas">
        {(Object.keys(PRESETS_AGENDA) as (keyof typeof PRESETS_AGENDA)[]).map((k, i) => (
          <div key={k} className="opcao-rapida">
            <strong>
              {PRESETS_AGENDA[k].rotulo}
              {i === 0 && ' (recomendado)'}
            </strong>
            <span className="secundario pequeno">{PRESETS_AGENDA[k].descricao}; pesquisa diária às 08:00.</span>
            <BotaoRapido acao={`agenda_${k}`} primario={i === 0} aoConcluir={(e) => (ed.recarregar(), aplicado(e, 'agenda'))}>
              Usar este ritmo
            </BotaoRapido>
          </div>
        ))}
      </div>
      <div className="acoes" style={{ marginTop: 12 }}>
        <button className="botao" onClick={() => (pedirAbaConfig('editorial'), nav.irPara('config'))}>
          Ajustar em Configurações › Pesquisa e agenda
        </button>
      </div>
    </Explicacao>
  )
}

function EtapaIa({ estado, revisarEAvancar, aplicado }: PropsEtapa) {
  const nav = useNavegacao()
  const central = useDados(() => chamar('ia:central'), [])
  const cadastradas = new Set(central.dados?.provedores.map((p) => p.config.catalogo).filter(Boolean))
  return (
    <Explicacao
      etapa="ia"
      estado={estado}
      oQue={
        <>
          <p>A IA escreve os roteiros e faz a revisão interna. Há três modos:</p>
          <ol>
            <li>
              <strong>Somente local (padrão):</strong> só o PC (Ollama) ou, sem ele, o modo estruturado (sem IA). Nada sai do computador.
            </li>
            <li>
              <strong>Híbrido (recomendado para produção automática):</strong> o aplicativo escolhe sozinho entre o PC e as IAs gratuitas que você cadastrar (Groq, Gemini, Mistral, OpenRouter e outras), na ordem de prioridade. Quando uma atinge o limite do dia, entra em pausa e a próxima assume.
            </li>
            <li>
              <strong>IAs pagas:</strong> para depois, se o canal gerar receita. Só são usadas quando você escolhe, com teto de gasto e autorização.
            </li>
          </ol>
          <p>
            Abaixo: um clique liga o modo híbrido; outro instala a IA do PC (Ollama); para as gratuitas, crie a chave no site (botão “Criar chave”), cole e clique em Conectar.
          </p>
        </>
      }
      porQue={
        <p>
          Controla custos e privacidade. Todo roteiro passa pela <strong>revisão interna</strong> do aplicativo: regras fixas e uma segunda IA, diferente da que escreveu, que compara o texto com as fontes verificadas. Fatos que não estão no dossiê são sinalizados, e a aprovação final continua sendo sua.
        </p>
      }
    >
      {central.dados && (
        <p>
          Situação atual: <strong>{ROTULO_MODO[central.dados.politica.modo]}</strong>, teto mensal {central.dados.politica.tetoMensal === null ? 'sem teto' : `${central.dados.politica.tetoMensal} ${central.dados.politica.moeda}`}, {central.dados.provedores.length} provedor(es) cadastrado(s).
        </p>
      )}
      <h3>1. Escolha o modo (1 clique)</h3>
      <div className="acoes">
        <BotaoRapido acao="ia_hibrido" primario aoConcluir={(e) => (central.recarregar(), aplicado(e))}>
          Ligar IA híbrida (recomendado)
        </BotaoRapido>
        <BotaoRapido acao="ia_local" aoConcluir={(e) => (central.recarregar(), aplicado(e))}>
          Somente local
        </BotaoRapido>
      </div>
      <h3>2. Dê IAs para o app usar</h3>
      <p className="secundario pequeno">Quanto mais IAs, menos o canal para quando uma atinge o limite do dia. Comece pelo Ollama (no PC) e por duas gratuitas: uma escreve e a outra revisa.</p>
      <InstalarOllama aoConcluir={central.recarregar} />
      <div className="painel-grade" style={{ marginTop: 12 }}>
        {CATALOGO_IA.filter((c) => c.id === 'groq' || c.id === 'gemini').map((item) => (
          <ItemCatalogo key={item.id} item={item} cadastrado={cadastradas.has(item.id)} aoAdicionar={central.recarregar} />
        ))}
      </div>
      <details className="ajuda">
        <summary>Ver as outras IAs gratuitas e o guia do Ollama</summary>
        <div className="ajuda-corpo">
          <div className="painel-grade">
            {CATALOGO_IA.filter((c) => !['groq', 'gemini', 'ollama'].includes(c.id)).map((item) => (
              <ItemCatalogo key={item.id} item={item} cadastrado={cadastradas.has(item.id)} aoAdicionar={central.recarregar} />
            ))}
          </div>
          <GuiaOllama />
        </div>
      </details>
      <div className="acoes" style={{ marginTop: 12 }}>
        <button className="botao primario" onClick={() => void revisarEAvancar('ia')}>
          Continuar
        </button>
        <button className="botao" onClick={() => (pedirAbaConfig('servicos'), nav.irPara('config'))}>
          Mais opções em Configurações › Serviços de IA
        </button>
      </div>
    </Explicacao>
  )
}

function EtapaVideo({ estado, atualizar, revisarEAvancar, aplicado }: PropsEtapa) {
  const nav = useNavegacao()
  const pref = useDados(() => chamar('render:preferencia'), [])
  return (
    <>
      <Explicacao
        etapa="video"
        estado={estado}
        oQue={
          <p>
            O <strong>FFmpeg</strong> é o programa gratuito que transforma a linha do tempo do editor no arquivo de vídeo final e mede a qualidade (silêncio, tela preta, resolução). A <strong>resolução</strong> define o tamanho da imagem: de 720p até 4K (3840×2160).
          </p>
        }
        porQue={
          <p>
            Resoluções maiores aproveitam melhor câmeras e gravações de tela em alta definição, mas demoram mais para renderizar e ocupam mais espaço. Ampliar uma mídia pequena para 4K não cria detalhe novo. Por isso o recomendado é o modo automático: ele escolhe pela qualidade real das mídias de cada projeto.
          </p>
        }
      />
      <Secao titulo="Configurar em 1 clique">
        <div className="acoes">
          <InstalarFfmpeg aoConcluir={() => void atualizar()} />
          <BotaoRapido acao="video" primario={estado.etapas.video.detalhe.startsWith('FFmpeg encontrado')} aoConcluir={(e) => (pref.recarregar(), aplicado(e, e.etapas.video.feito ? 'video' : undefined))}>
            Usar a resolução recomendada (automática, até 4K)
          </BotaoRapido>
        </div>
      </Secao>
      <Secao titulo="Narração e imagens automáticas">
        <p className="secundario pequeno" style={{ marginTop: 0 }}>
          No editor, o botão <strong>Gerar narração e imagens</strong> narra o roteiro com voz sintética, busca imagens com licença livre (Wikimedia sem chave; Pexels e Pixabay com chave gratuita) e gera por IA o que faltar. A voz do Windows já funciona; a voz neural (Piper) é mais natural.
        </p>
        <button className="botao" onClick={() => (pedirAbaConfig('midia'), nav.irPara('config'))}>
          Configurar voz e fontes de imagem
        </button>
      </Secao>
      <details className="ajuda">
        <summary>Ajustar FFmpeg, resolução e qualidade manualmente</summary>
        <div className="ajuda-corpo">
          <FerramentasFfmpeg />
          <Secao titulo="Resolução e qualidade padrão">
            {pref.erro && <ErroCarregar mensagem={pref.erro} tentarNovamente={pref.recarregar} />}
            {pref.dados && <PreferenciaVideo inicial={pref.dados} aoSalvar={() => void atualizar()} />}
          </Secao>
        </div>
      </details>
      <div className="acoes" style={{ marginTop: 12 }}>
        <button className="botao" onClick={() => void atualizar()}>
          Conferir situação
        </button>
        {estado.etapas.video.feito && (
          <button className="botao primario" onClick={() => void revisarEAvancar('video')}>
            Continuar
          </button>
        )}
      </div>
    </>
  )
}

function EtapaYouTube({ estado, atualizar, revisarEAvancar }: PropsEtapa) {
  return (
    <>
      <Explicacao
        etapa="youtube"
        estado={estado}
        oQue={
          <p>
            É a ligação entre o aplicativo e o seu canal, usando a autorização oficial do Google (OAuth). O aplicativo pede apenas: ver o canal (somente leitura) e enviar vídeos. Métricas são uma permissão separada e opcional.
          </p>
        }
        porQue={
          <p>
            Sem ela, você produz tudo no aplicativo e envia o arquivo final manualmente pelo YouTube Studio, o que funciona bem. Com ela, o envio sai daqui (sempre privado primeiro e com sua aprovação) e as métricas voltam para o relatório semanal. Pode deixar para depois sem prejuízo.
          </p>
        }
      />
      <ContaYouTube guiaAberto />
      <div className="acoes" style={{ marginTop: 12 }}>
        <button className="botao" onClick={() => void atualizar()}>
          Conferir situação
        </button>
        <button className="botao primario" onClick={() => void revisarEAvancar('youtube')}>
          {estado.etapas.youtube.feito ? 'Continuar' : 'Deixar para depois e continuar'}
        </button>
      </div>
    </>
  )
}

function EtapaBackup({ estado, atualizar, revisarEAvancar, concluir }: PropsEtapa & { concluir: () => void }) {
  const { avisar, avisarErro } = useRetorno()
  const info = useDados(() => chamar('sistema:info'), [])
  const pendentes = ETAPAS_ASSISTENTE.filter((e) => !estado.etapas[e].feito && !estado.etapas[e].opcional && e !== 'backup')
  return (
    <Explicacao
      etapa="backup"
      estado={estado}
      oQue={<p>Uma cópia completa do banco de dados (projetos, fontes, pautas, roteiros, versões, agenda). Os 10 mais recentes ficam guardados. Chaves e tokens não vão para o backup.</p>}
      porQue={
        <p>
          Se o computador der problema, o backup recupera todo o seu trabalho. O aplicativo também faz um backup automático antes de cada atualização do banco. Recomendação: de tempos em tempos, copie a pasta de backups para um pendrive ou para a nuvem (OneDrive, Google Drive).
        </p>
      }
    >
      <p className="secundario">
        Pasta de backups: <code>{info.dados ? `${info.dados.pastaDados}\\backups` : '…'}</code> · {info.dados?.backups.length ?? 0} backup(s)
      </p>
      <div className="acoes" style={{ marginTop: 12 }}>
        <button
          className="botao primario"
          onClick={async () => {
            try {
              await chamar('sistema:backup')
              avisar('Backup criado.')
              info.recarregar()
              await revisarEAvancar('backup')
              await atualizar()
            } catch (e) {
              avisarErro(mensagemDeErro(e))
            }
          }}
        >
          Fazer o primeiro backup agora
        </button>
        <button className="botao" onClick={() => void chamar('sistema:abrirPastaDados').catch((e: unknown) => avisarErro(mensagemDeErro(e)))}>
          Abrir pasta de dados
        </button>
      </div>
      <SegundoPlano />
      <h3>Resumo</h3>
      {pendentes.length > 0 ? (
        <Alerta>Ainda faltam: {pendentes.map((e) => TITULOS[e]).join(', ')}. Você pode concluir assim mesmo e voltar aqui pelo menu “Primeiros passos”.</Alerta>
      ) : (
        <Alerta tipo="info">Tudo pronto. Próximo passo sugerido: em Pautas e pesquisas, clique em Pesquisar para encontrar as primeiras pautas.</Alerta>
      )}
      <div className="acoes" style={{ marginTop: 12 }}>
        <button className="botao primario" onClick={concluir}>
          Concluir configuração
        </button>
      </div>
    </Explicacao>
  )
}
