import { useEffect, useState } from 'react'
import { chamar, mensagemDeErro, useDados } from '../api'
import { useRetorno } from '../componentes/retorno'
import { Alerta, Cabecalho, Campo, Carregando, Dialogo, ErroCarregar, Etiqueta, Secao, Vazio, formatarBytes, formatarData, type CorEtiqueta } from '../componentes/ui'
import type { Publicacao } from '@shared/tipos'
import { GuiaGoogleCloud } from '../componentes/guias'
import { DescricaoAutomatica, MiniaturaPublicacao } from './PublicacaoExtras'
import { BarraProgresso } from '../componentes/progresso'

const ROTULO_STATUS: Record<Publicacao['status'], string> = {
  rascunho: 'Rascunho',
  aprovada: 'Aprovada para envio',
  enviando: 'Enviando',
  pausada: 'Pausada',
  processando: 'Processando no YouTube',
  concluida: 'Concluída',
  erro: 'Erro',
  cancelada: 'Cancelada'
}
const COR: Record<Publicacao['status'], CorEtiqueta> = { rascunho: 'cinza', aprovada: 'azul', enviando: 'amarela', pausada: 'amarela', processando: 'azul', concluida: 'verde', erro: 'vermelha', cancelada: 'cinza' }
const ROTULO_PRIV = { private: 'Privado', unlisted: 'Não listado', public: 'Público' } as const

export function Publicacoes() {
  const [aberta, setAberta] = useState<number | null>(null)
  if (aberta !== null) return <EditarPublicacao id={aberta} voltar={() => setAberta(null)} />
  return (
    <>
      <Cabecalho titulo="Publicações" descricao="Envio pela API oficial do YouTube, privado por padrão e só depois da sua aprovação." />
      <ContaYouTube />
      <ListaPublicacoes abrir={setAberta} />
    </>
  )
}

/** Lê o client_secret_….json baixado do Google: acha sozinho em Downloads ou deixa escolher o arquivo. */
function ImportarCredenciais({ aoImportar }: { aoImportar: () => void }) {
  const { avisar, avisarErro } = useRetorno()
  const achado = useDados(() => chamar('youtube:procurarArquivoCliente'), [])
  const importar = async (usarEncontrado: boolean): Promise<void> => {
    try {
      const r = await chamar('youtube:importarArquivoCliente', { usarEncontrado })
      if (!r) return
      avisar('Credenciais importadas para o cofre. Agora você pode apagar o arquivo .json da pasta Downloads.')
      aoImportar()
    } catch (e) {
      avisarErro(mensagemDeErro(e))
    }
  }
  return (
    <div className="cartao-suave" style={{ marginTop: 12 }}>
      <strong>Importar arquivo baixado do Google</strong>
      {achado.dados ? (
        <p className="secundario pequeno">
          Encontrei <code>{achado.dados.nome}</code> na pasta Downloads (baixado em {formatarData(achado.dados.modificadoEm, true)}).
        </p>
      ) : (
        <p className="secundario pequeno">Nenhum arquivo client_secret_….json recente na pasta Downloads. Baixe-o no passo 6 ou escolha o arquivo manualmente.</p>
      )}
      <div className="acoes">
        {achado.dados && (
          <button className="botao primario" onClick={() => void importar(true)}>
            Usar este arquivo
          </button>
        )}
        <button className="botao" onClick={() => void importar(false)}>
          Escolher arquivo…
        </button>
        <button className="botao fantasma" onClick={achado.recarregar}>
          Procurar de novo
        </button>
      </div>
      <p className="secundario pequeno" style={{ marginBottom: 0 }}>
        O ID e a chave vão direto para o cofre criptografado do Windows. O arquivo não é alterado nem apagado: apague-o você mesmo depois de importar.
      </p>
    </div>
  )
}

export function ContaYouTube({ guiaAberto }: { guiaAberto?: boolean } = {}) {
  const { avisar, avisarErro, confirmar } = useRetorno()
  const painel = useDados(() => chamar('youtube:painel'), [])
  const [cliente, setCliente] = useState({ clientId: '', clientSecret: '' })
  const [metricas, setMetricas] = useState(false)
  const [conectando, setConectando] = useState(false)
  const executarSeguro = async (fn: () => Promise<unknown>, msg?: string): Promise<void> => {
    try {
      await fn()
      if (msg) avisar(msg)
      painel.recarregar()
    } catch (e) {
      avisarErro(mensagemDeErro(e))
    }
  }
  if (painel.erro) return <ErroCarregar mensagem={painel.erro} tentarNovamente={painel.recarregar} />
  if (!painel.dados) return <Carregando />
  const s = painel.dados.status
  return (
    <Secao titulo="Conta do YouTube" acoes={<Etiqueta cor={s.estado === 'conectado' ? 'verde' : 'cinza'}>{s.estado === 'conectado' ? 'Conectada' : s.estado === 'desconectado' ? 'Desconectada' : 'Não configurada'}</Etiqueta>}>
      <p className="secundario">{s.mensagem}</p>
      {s.estado === 'nao_configurado' && (
        <>
          <Alerta tipo="info">
            São duas etapas diferentes: (1) você cria um projeto no Google Cloud, ativa a “YouTube Data API v3” e cria uma credencial OAuth do tipo “App para computador”; (2) depois autoriza a sua conta aqui. A aprovação/verificação do projeto pelo Google é separada da autorização da conta: projetos não verificados podem ficar limitados (por exemplo, vídeos enviados só como privados) e com cota reduzida. Não crie contas ou projetos extras para contornar limites.
          </Alerta>
          <GuiaGoogleCloud aberto={guiaAberto} />
          <ImportarCredenciais aoImportar={painel.recarregar} />
          <p className="secundario pequeno" style={{ marginBottom: 0 }}>Ou digite à mão:</p>
          <div className="form-grade" style={{ marginTop: 8 }}>
            <Campo rotulo="ID do cliente OAuth" ajuda="Termina em .apps.googleusercontent.com">
              <input className="entrada" value={cliente.clientId} onChange={(e) => setCliente({ ...cliente, clientId: e.target.value })} spellCheck={false} />
            </Campo>
            <Campo rotulo="Chave secreta do cliente" ajuda="Guardada no cofre criptografado; nunca exibida de novo.">
              <input type="password" autoComplete="off" className="entrada" value={cliente.clientSecret} onChange={(e) => setCliente({ ...cliente, clientSecret: e.target.value })} />
            </Campo>
          </div>
          <button className="botao primario" style={{ marginTop: 12 }} disabled={!cliente.clientId || !cliente.clientSecret} onClick={() => void executarSeguro(() => chamar('youtube:configurarCliente', cliente), 'Credenciais guardadas.')}>
            Guardar credenciais do projeto
          </button>
        </>
      )}
      {s.estado === 'desconectado' && (
        <>
          <p>Ao conectar, o navegador abrirá a página oficial do Google. Serão pedidas apenas estas permissões:</p>
          <ul className="secundario">
            <li>Ver o canal e as playlists (somente leitura).</li>
            <li>Enviar vídeos (não permite excluir nem editar vídeos existentes).</li>
            {metricas && <li>Ver relatórios do YouTube Analytics (somente leitura).</li>}
          </ul>
          <label className="checkbox">
            <input type="checkbox" checked={metricas} onChange={(e) => setMetricas(e.target.checked)} />
            Incluir permissão de métricas (YouTube Analytics, somente leitura)
          </label>
          <div className="acoes" style={{ marginTop: 12 }}>
            <button
              className="botao primario"
              disabled={conectando}
              onClick={async () => {
                setConectando(true)
                await executarSeguro(() => chamar('youtube:conectar', { metricas, receita: false }), 'Conta conectada.')
                setConectando(false)
              }}
            >
              {conectando ? 'Aguardando autorização no navegador…' : 'Conectar conta'}
            </button>
            <button
              className="botao fantasma"
              onClick={() =>
                void executarSeguro(async () => {
                  if (!(await confirmar({ titulo: 'Remover credenciais do projeto?', texto: 'O ID e a chave do cliente OAuth serão apagados do cofre.', confirmar: 'Remover', perigo: true }))) return
                  await chamar('youtube:removerCliente')
                })
              }
            >
              Remover credenciais do projeto
            </button>
          </div>
        </>
      )}
      {s.estado === 'conectado' && (
        <>
          <p>Permissões concedidas:</p>
          <ul className="secundario">
            {s.escopos.map((e) => (
              <li key={e.escopo}>{e.descricao}</li>
            ))}
          </ul>
          <button
            className="botao"
            onClick={() =>
              void executarSeguro(async () => {
                if (!(await confirmar({ titulo: 'Desconectar a conta?', texto: 'A autorização será revogada no Google (quando possível) e os tokens apagados deste computador.', confirmar: 'Desconectar', perigo: true }))) return
                await chamar('youtube:desconectar')
              }, 'Conta desconectada e credenciais locais removidas.')
            }
          >
            Desconectar e revogar
          </button>
        </>
      )}
      <hr className="nav-separador" />
      <label className="checkbox">
        <input
          type="checkbox"
          checked={painel.dados.aprovacaoObrigatoria}
          onChange={(e) =>
            void executarSeguro(async () => {
              if (!e.target.checked && !(await confirmar({ titulo: 'Desativar aprovação obrigatória?', texto: 'Os envios poderão começar sem a etapa “Aprovar”. Os pré-requisitos (roteiro aprovado, controle de qualidade) continuam valendo. Não recomendado.', confirmar: 'Desativar', perigo: true }))) return
              await chamar('youtube:salvarOpcoes', { aprovacaoObrigatoria: e.target.checked })
            })
          }
        />
        Aprovação obrigatória antes de enviar (recomendado; ativado por padrão)
      </label>
      <p className="secundario pequeno" style={{ marginTop: 8 }}>
        Regras de acesso implementadas: versão {s.versaoRegras}. Cotas e limites da API são definidos pelo Google; consulte a documentação oficial de custo de cota.
      </p>
    </Secao>
  )
}

function ListaPublicacoes({ abrir }: { abrir: (id: number) => void }) {
  const lista = useDados(() => chamar('publicacoes:listar'), [])
  return (
    <Secao titulo="Publicações">
      <p className="secundario pequeno">Para criar uma publicação, abra um projeto no Estúdio, renderize, aprove o controle de qualidade e use “Preparar publicação”.</p>
      {lista.dados?.length === 0 && <Vazio compacto titulo="Nenhuma publicação" />}
      <ul className="lista">
        {lista.dados?.map((p) => (
          <li key={p.id} className="lista-item clicavel" onClick={() => abrir(p.id)}>
            <div className="lista-principal">
              <div className="lista-titulo">{p.titulo}</div>
              <div className="lista-meta">
                {ROTULO_PRIV[p.privacidade]}
                {p.publicarEm && ` · agendado para ${formatarData(p.publicarEm, true)}`}
                {p.videoUrl && ` · ${p.videoUrl}`}
                {p.mensagem && ` · ${p.mensagem}`}
              </div>
            </div>
            <Etiqueta cor={COR[p.status]}>{ROTULO_STATUS[p.status]}</Etiqueta>
          </li>
        ))}
      </ul>
    </Secao>
  )
}

function EditarPublicacao({ id, voltar }: { id: number; voltar: () => void }) {
  const { avisar, avisarErro, confirmar } = useRetorno()
  const dados = useDados(() => chamar('publicacoes:listar').then((l) => l.find((p) => p.id === id) ?? null), [id])
  const [versao, setVersao] = useState(0)
  const pend = useDados(() => chamar('publicacoes:pendencias', { id }), [id, versao])
  const p = dados.dados
  const [f, setF] = useState<null | { titulo: string; descricao: string; tags: string; privacidade: Publicacao['privacidade']; publicarEm: string; feitoParaCriancas: boolean | null; conteudoSintetico: boolean }>(null)
  const [aprovar, setAprovar] = useState(false)
  const [confirmaPublico, setConfirmaPublico] = useState(false)

  useEffect(() => {
    if (p?.status !== 'enviando') return
    const t = setInterval(dados.recarregar, 1000)
    return () => clearInterval(t)
  }, [p?.status, dados.recarregar])

  if (dados.erro) return <ErroCarregar mensagem={dados.erro} tentarNovamente={dados.recarregar} />
  if (!p) return <Carregando />
  const form = f ?? { titulo: p.titulo, descricao: p.descricao, tags: p.tags.join(', '), privacidade: p.privacidade, publicarEm: p.publicarEm ? p.publicarEm.slice(0, 16) : '', feitoParaCriancas: p.feitoParaCriancas, conteudoSintetico: p.conteudoSintetico }
  const editavel = ['rascunho', 'aprovada', 'erro'].includes(p.status)
  const recarregar = (): void => {
    setF(null)
    setVersao((v) => v + 1)
    dados.recarregar()
  }
  const executarSeguro = async (fn: () => Promise<unknown>, msg?: string): Promise<void> => {
    try {
      await fn()
      if (msg) avisar(msg)
      recarregar()
    } catch (e) {
      avisarErro(mensagemDeErro(e))
    }
  }
  const salvar = (): Promise<void> =>
    executarSeguro(
      () =>
        chamar('publicacoes:atualizar', {
          id,
          titulo: form.titulo,
          descricao: form.descricao,
          tags: form.tags.split(',').map((x) => x.trim()).filter(Boolean),
          privacidade: form.privacidade,
          publicarEm: form.publicarEm ? new Date(form.publicarEm).toISOString() : null,
          feitoParaCriancas: form.feitoParaCriancas,
          conteudoSintetico: form.conteudoSintetico,
          miniaturaRecursoId: p.miniaturaRecursoId,
          playlistId: p.playlistId,
          categoriaId: p.categoriaId
        }),
      'Publicação salva.'
    )

  return (
    <>
      <Cabecalho
        titulo={p.titulo}
        descricao={`Roteiro: ${p.roteiroTitulo} · operação ${p.idOperacao.slice(0, 8)}`}
        acoes={
          <>
            <Etiqueta cor={COR[p.status]}>{ROTULO_STATUS[p.status]}</Etiqueta>
            <button className="botao" onClick={voltar}>
              Voltar
            </button>
          </>
        }
      />
      {p.mensagem && <Alerta tipo={p.status === 'erro' ? 'erro' : 'info'}>{p.mensagem}</Alerta>}
      <div className="editor">
        <div>
        <Secao titulo="Dados da publicação">
          <fieldset disabled={!editavel} style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 12 }}>
            <Campo rotulo={`Título (${form.titulo.length}/100)`}>
              <input className="entrada" value={form.titulo} maxLength={100} onChange={(e) => setF({ ...form, titulo: e.target.value })} />
            </Campo>
            <Campo rotulo="Descrição">
              <textarea className="entrada" rows={12} value={form.descricao} maxLength={5000} onChange={(e) => setF({ ...form, descricao: e.target.value })} />
            </Campo>
            <Campo rotulo="Tags (separadas por vírgula)">
              <input className="entrada" value={form.tags} onChange={(e) => setF({ ...form, tags: e.target.value })} />
            </Campo>
            <div className="form-grade">
              <Campo rotulo="Privacidade" ajuda="Recomendado: privado ou não listado primeiro.">
                <select className="entrada" value={form.privacidade} onChange={(e) => setF({ ...form, privacidade: e.target.value as Publicacao['privacidade'] })}>
                  <option value="private">Privado</option>
                  <option value="unlisted">Não listado</option>
                  <option value="public">Público</option>
                </select>
              </Campo>
              <Campo rotulo="Agendar publicação (opcional)" ajuda="Exige privacidade “Privado”; o YouTube publica na data.">
                <input type="datetime-local" className="entrada" value={form.publicarEm} onChange={(e) => setF({ ...form, publicarEm: e.target.value })} />
              </Campo>
              <Campo rotulo="Feito para crianças? (obrigatório)">
                <select className="entrada" value={form.feitoParaCriancas === null ? '' : form.feitoParaCriancas ? 'sim' : 'nao'} onChange={(e) => setF({ ...form, feitoParaCriancas: e.target.value === '' ? null : e.target.value === 'sim' })}>
                  <option value="">Escolha…</option>
                  <option value="nao">Não, não é feito para crianças</option>
                  <option value="sim">Sim, é feito para crianças</option>
                </select>
              </Campo>
            </div>
            <label className="checkbox">
              <input type="checkbox" checked={form.conteudoSintetico} onChange={(e) => setF({ ...form, conteudoSintetico: e.target.checked })} />
              Contém conteúdo realista alterado ou sintético (divulgação exigida pelo YouTube; confira as regras vigentes)
            </label>
          </fieldset>
          {editavel && (
            <button className="botao primario" style={{ marginTop: 12 }} disabled={f === null} onClick={() => void salvar()}>
              Salvar dados {p.status === 'aprovada' && '(desfaz a aprovação)'}
            </button>
          )}
        </Secao>
        <DescricaoAutomatica p={p} editavel={editavel} tags={form.tags.split(',').map((x) => x.trim()).filter(Boolean)} aplicar={(texto) => setF({ ...form, descricao: texto })} />
        <MiniaturaPublicacao p={p} editavel={editavel} recarregar={recarregar} />
        </div>
        <aside>
          <Secao titulo="Pré-requisitos">
            {pend.dados?.length === 0 ? <p className="secundario">Tudo certo para aprovar.</p> : pend.dados?.map((x) => <Alerta key={x} tipo="erro">{x}</Alerta>)}
          </Secao>
          <Secao titulo="Ações">
            <div style={{ display: 'grid', gap: 8 }}>
              {p.status === 'rascunho' && (
                <button className="botao primario" disabled={f !== null || (pend.dados?.length ?? 1) > 0} onClick={() => setAprovar(true)}>
                  Aprovar envio
                </button>
              )}
              {['aprovada', 'pausada', 'erro'].includes(p.status) && (
                <button
                  className="botao primario"
                  onClick={() =>
                    void executarSeguro(async () => {
                      if (!(await confirmar({ titulo: 'Enviar para o YouTube?', texto: `O vídeo será enviado como ${ROTULO_PRIV[p.privacidade].toLowerCase()}${p.publicarEm ? `, com publicação agendada para ${formatarData(p.publicarEm, true)}` : ''}. O envio pode consumir cota da API.`, confirmar: p.status === 'aprovada' ? 'Enviar' : 'Retomar envio' }))) return
                      await chamar('publicacoes:enviar', { id })
                    }, 'Envio iniciado.')
                  }
                >
                  {p.status === 'aprovada' ? 'Enviar' : 'Retomar envio'}
                </button>
              )}
              {p.status === 'enviando' && (
                <>
                  <BarraProgresso
                    percentual={p.tamanho ? (p.bytesEnviados / p.tamanho) * 100 : 0}
                    etapa="Enviando para o YouTube (privado)"
                    detalhe={p.tamanho ? `${formatarBytes(p.bytesEnviados)} de ${formatarBytes(p.tamanho)}` : 'Calculando o tamanho…'}
                  />
                  <button className="botao" onClick={() => void executarSeguro(() => chamar('publicacoes:pausar', { id }))}>
                    Pausar envio
                  </button>
                </>
              )}
              {['processando', 'concluida'].includes(p.status) && (
                <button className="botao" onClick={() => void executarSeguro(() => chamar('publicacoes:atualizarStatus', { id }), 'Status atualizado.')}>
                  Atualizar status no YouTube
                </button>
              )}
              {p.videoUrl && (
                <a className="botao fantasma" href={p.videoUrl} target="_blank" rel="noreferrer noopener">
                  Abrir no YouTube
                </a>
              )}
              {['rascunho', 'aprovada', 'pausada', 'erro'].includes(p.status) && (
                <button
                  className="botao fantasma"
                  onClick={() =>
                    void executarSeguro(async () => {
                      if (!(await confirmar({ titulo: 'Cancelar publicação?', texto: 'A publicação será cancelada. O vídeo e a renderização continuam guardados.', confirmar: 'Cancelar publicação', perigo: true }))) return
                      await chamar('publicacoes:cancelar', { id })
                    })
                  }
                >
                  Cancelar publicação
                </button>
              )}
            </div>
            <p className="secundario pequeno" style={{ marginTop: 8 }}>
              {p.aprovadaEm && `Aprovada em ${formatarData(p.aprovadaEm, true)}. `}
              {p.enviadoEm && `Enviada em ${formatarData(p.enviadoEm, true)}. `}
              {p.videoId && `ID do vídeo: ${p.videoId}.`}
            </p>
          </Secao>
        </aside>
      </div>
      <Dialogo
        aberto={aprovar}
        aoFechar={() => setAprovar(false)}
        titulo="Aprovar envio"
        acoes={
          <>
            <button className="botao fantasma" onClick={() => setAprovar(false)}>
              Cancelar
            </button>
            <button
              className="botao primario"
              disabled={p.privacidade === 'public' && !confirmaPublico}
              onClick={() =>
                void executarSeguro(async () => {
                  await chamar('publicacoes:aprovar', { id, confirmarPublico: confirmaPublico })
                  setAprovar(false)
                }, 'Publicação aprovada.')
              }
            >
              Aprovar
            </button>
          </>
        }
      >
        <p>
          Privacidade: <strong>{ROTULO_PRIV[p.privacidade]}</strong>
          {p.publicarEm && ` · agendado para ${formatarData(p.publicarEm, true)}`}
        </p>
        <p className="secundario pequeno">Título: {p.titulo}</p>
        {p.privacidade === 'public' && (
          <label className="checkbox" style={{ marginTop: 8 }}>
            <input type="checkbox" checked={confirmaPublico} onChange={(e) => setConfirmaPublico(e.target.checked)} />
            Confirmo que este vídeo pode ficar PÚBLICO assim que o envio terminar.
          </label>
        )}
      </Dialogo>
    </>
  )
}
