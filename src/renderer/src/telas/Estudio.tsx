import { useState } from 'react'
import { chamar, mensagemDeErro, useDados } from '../api'
import { useRetorno } from '../componentes/retorno'
import { Alerta, Cabecalho, Campo, Carregando, Dialogo, ErroCarregar, Etiqueta, Secao, Vazio, formatarData } from '../componentes/ui'
import { ROTULO_CATEGORIA_MIDIA, ROTULO_LICENCA, SITUACOES_LICENCA, type SituacaoLicenca } from '@shared/midia'
import { filtroRoteirosSchema } from '@shared/schemas'
import type { RecursoMidia } from '@shared/tipos'
import { EditorVideo } from './EditorVideo'
import { InstalarFfmpeg } from '../componentes/rapido'
import { GuiaFfmpeg } from '../componentes/guias'

type Aba = 'projetos' | 'midia' | 'ferramentas'

/** Estúdio (Etapas 11 e 12): projetos de edição, biblioteca de mídia e ferramentas. */
export function Estudio() {
  const [aba, setAba] = useState<Aba>('projetos')
  const [aberto, setAberto] = useState<number | null>(null)
  if (aberto !== null) return <EditorVideo id={aberto} voltar={() => setAberto(null)} />
  return (
    <>
      <Cabecalho titulo="Estúdio/editor" descricao="Monte o vídeo a partir do roteiro, com mídia de origem registrada." />
      <div className="abas" role="tablist">
        {(
          [
            ['projetos', 'Projetos de edição'],
            ['midia', 'Biblioteca de mídia'],
            ['ferramentas', 'Ferramentas (FFmpeg)']
          ] as const
        ).map(([v, r]) => (
          <button key={v} role="tab" className="aba" aria-selected={aba === v} onClick={() => setAba(v)}>
            {r}
          </button>
        ))}
      </div>
      {aba === 'projetos' && <ListaEdicoes abrir={setAberto} />}
      {aba === 'midia' && <BibliotecaMidia />}
      {aba === 'ferramentas' && <FerramentasFfmpeg />}
    </>
  )
}

function ListaEdicoes({ abrir }: { abrir: (id: number) => void }) {
  const { avisarErro, confirmar } = useRetorno()
  const lista = useDados(() => chamar('edicao:listar'), [])
  const roteiros = useDados(() => chamar('roteiros:buscar', filtroRoteirosSchema.parse({})), [])
  const [novo, setNovo] = useState<string | null>(null)
  return (
    <>
      <div className="filtros">
        <p className="secundario" style={{ margin: 0, flex: 1 }}>
          Um projeto começa com uma cena por seção do roteiro e as legendas da narração. Você adiciona imagens, vídeos e áudio da biblioteca.
        </p>
        <button className="botao primario" onClick={() => setNovo('')}>
          Novo projeto de edição
        </button>
      </div>
      <Secao>
        {lista.erro && <ErroCarregar mensagem={lista.erro} tentarNovamente={lista.recarregar} />}
        {lista.carregando && !lista.dados && <Carregando />}
        {lista.dados?.length === 0 && <Vazio titulo="Nenhum projeto de edição" icone="estudio" />}
        <ul className="lista">
          {lista.dados?.map((e) => (
            <li key={e.id} className="lista-item clicavel" onClick={() => abrir(e.id)}>
              <div className="lista-principal">
                <div className="lista-titulo">{e.nome}</div>
                <div className="lista-meta">
                  Roteiro: {e.roteiroTitulo} · {e.formato} · revisão {e.revisao} · salvo {formatarData(e.atualizadoEm, true)}
                </div>
              </div>
              <button
                className="botao pequeno fantasma"
                onClick={async (ev) => {
                  ev.stopPropagation()
                  if (!(await confirmar({ titulo: 'Excluir projeto de edição?', texto: 'O projeto, suas cópias e renderizações registradas serão excluídos. Mídias da biblioteca e o roteiro não são afetados.', confirmar: 'Excluir', perigo: true }))) return
                  try {
                    await chamar('edicao:excluir', { id: e.id })
                    lista.recarregar()
                  } catch (err) {
                    avisarErro(mensagemDeErro(err))
                  }
                }}
              >
                Excluir
              </button>
            </li>
          ))}
        </ul>
      </Secao>
      <Dialogo
        aberto={novo !== null}
        aoFechar={() => setNovo(null)}
        titulo="Novo projeto de edição"
        acoes={
          <>
            <button className="botao fantasma" onClick={() => setNovo(null)}>
              Cancelar
            </button>
            <button
              className="botao primario"
              disabled={!novo}
              onClick={async () => {
                try {
                  const e = await chamar('edicao:criar', { roteiroId: Number(novo) })
                  setNovo(null)
                  abrir(e.id)
                } catch (err) {
                  avisarErro(mensagemDeErro(err))
                }
              }}
            >
              Criar
            </button>
          </>
        }
      >
        <Campo rotulo="Roteiro" ajuda="O formato (16:9 ou 9:16) segue o tipo do roteiro. A renderização para publicação exige roteiro aprovado no controle de qualidade.">
          <select className="entrada" value={novo ?? ''} onChange={(e) => setNovo(e.target.value)}>
            <option value="">Escolha…</option>
            {roteiros.dados?.map((r) => (
              <option key={r.id} value={r.id}>
                {r.titulo} ({r.tipoVideo === 'short' ? 'Short' : 'longo'})
              </option>
            ))}
          </select>
        </Campo>
      </Dialogo>
    </>
  )
}

export function BibliotecaMidia() {
  const { avisar, avisarErro, confirmar } = useRetorno()
  const projetos = useDados(() => chamar('projetos:listar'), [])
  const projetoId = projetos.dados?.[0]?.id ?? null
  const lista = useDados(() => (projetoId ? chamar('midia:listar', { projetoId }) : Promise.resolve([])), [projetoId])
  const [situacao, setSituacao] = useState<SituacaoLicenca>('nao_verificado')
  const [editando, setEditando] = useState<RecursoMidia | null>(null)
  const [verificacao, setVerificacao] = useState<string | null>(null)
  if (!projetoId) return <Alerta>Crie um projeto em Configurações primeiro.</Alerta>
  return (
    <>
      <div className="filtros">
        <Campo rotulo="Situação de uso ao importar">
          <select className="entrada" value={situacao} onChange={(e) => setSituacao(e.target.value as SituacaoLicenca)}>
            {SITUACOES_LICENCA.map((s) => (
              <option key={s} value={s}>
                {ROTULO_LICENCA[s]}
              </option>
            ))}
          </select>
        </Campo>
        <button
          className="botao primario"
          onClick={async () => {
            try {
              const r = await chamar('midia:importar', { projetoId, situacaoLicenca: situacao })
              if (r.importados.length) avisar(`${r.importados.length} arquivo(s) importado(s).`)
              for (const e of r.erros) avisarErro(`${e.arquivo}: ${e.mensagem}`)
              lista.recarregar()
            } catch (e) {
              avisarErro(mensagemDeErro(e))
            }
          }}
        >
          Importar arquivos
        </button>
        <button
          className="botao"
          onClick={async () => {
            try {
              const v = await chamar('midia:verificar', { projetoId })
              setVerificacao(`${v.total} mídia(s): ${v.ausentes.length} ausente(s), ${v.duplicados.length} grupo(s) duplicado(s), ${v.semLicenca.length} com origem/licença pendente.`)
            } catch (e) {
              avisarErro(mensagemDeErro(e))
            }
          }}
        >
          Verificar biblioteca
        </button>
      </div>
      {verificacao && <Alerta tipo="info">{verificacao}</Alerta>}
      <p className="secundario pequeno">
        Os arquivos são copiados para a pasta do aplicativo e nunca executados. Nunca presuma que uma imagem da internet pode ser reutilizada: registre origem e licença.
      </p>
      <Secao>
        {lista.dados?.length === 0 && <Vazio titulo="Biblioteca vazia" texto="Importe vídeos, imagens, áudios ou legendas." />}
        <ul className="lista">
          {lista.dados?.map((m) => (
            <li key={m.id} className="lista-item" style={{ alignItems: 'flex-start' }}>
              {m.categoria === 'imagem' && m.arquivoExiste ? <img className="miniatura-midia" src={`midia://recurso/${m.id}`} alt="" /> : <div className="miniatura-midia">{ROTULO_CATEGORIA_MIDIA[m.categoria]}</div>}
              <div className="lista-principal">
                <div className="lista-titulo">{m.nomeOriginal}</div>
                <div className="lista-meta">
                  <span>{ROTULO_CATEGORIA_MIDIA[m.categoria]}</span>
                  <span>· {(m.tamanhoBytes / 1024 / 1024).toFixed(1)} MB</span>
                  {m.cena && <span>· cena: {m.cena}</span>}
                  {m.autor && <span>· autor: {m.autor}</span>}
                  {m.origem && <span>· origem: {m.origem}</span>}
                  <span>· importado {formatarData(m.criadoEm)}</span>
                  <Etiqueta cor={m.situacaoLicenca === 'nao_verificado' ? 'vermelha' : m.alertas.length ? 'amarela' : 'verde'}>{ROTULO_LICENCA[m.situacaoLicenca]}</Etiqueta>
                  {!m.arquivoExiste && <Etiqueta cor="vermelha">Arquivo ausente</Etiqueta>}
                </div>
                {m.alertas.map((a) => (
                  <div key={a} className="pequeno" style={{ color: '#ffd45e' }}>
                    {a}
                  </div>
                ))}
              </div>
              <button className="botao pequeno fantasma" onClick={() => setEditando(m)}>
                Origem e licença
              </button>
              <button
                className="botao pequeno fantasma"
                onClick={async () => {
                  if (!(await confirmar({ titulo: 'Remover da biblioteca?', texto: 'O registro será removido (o arquivo copiado permanece na pasta do aplicativo). Não é possível remover mídia usada em projetos de edição.', confirmar: 'Remover', perigo: true }))) return
                  try {
                    await chamar('midia:remover', { id: m.id })
                    lista.recarregar()
                  } catch (e) {
                    avisarErro(mensagemDeErro(e))
                  }
                }}
              >
                Remover
              </button>
            </li>
          ))}
        </ul>
      </Secao>
      {editando && <EditarMidia m={editando} aoFechar={(ok) => { setEditando(null); if (ok) lista.recarregar() }} />}
    </>
  )
}

function EditarMidia({ m, aoFechar }: { m: RecursoMidia; aoFechar: (ok: boolean) => void }) {
  const { avisarErro } = useRetorno()
  const [f, setF] = useState({ cena: m.cena, origem: m.origem, autor: m.autor, urlOrigem: m.urlOrigem, licenca: m.licenca, situacaoLicenca: m.situacaoLicenca, obtidoEm: m.obtidoEm?.slice(0, 10) ?? '' })
  return (
    <Dialogo
      aberto
      largo
      aoFechar={() => aoFechar(false)}
      titulo={`Origem e licença — ${m.nomeOriginal}`}
      acoes={
        <>
          <button className="botao fantasma" onClick={() => aoFechar(false)}>
            Cancelar
          </button>
          <button
            className="botao primario"
            onClick={async () => {
              try {
                await chamar('midia:atualizar', { id: m.id, roteiroId: m.roteiroId, ...f, obtidoEm: f.obtidoEm || null })
                aoFechar(true)
              } catch (e) {
                avisarErro(mensagemDeErro(e))
              }
            }}
          >
            Salvar
          </button>
        </>
      }
    >
      <div className="form-grade">
        <Campo rotulo="Situação de uso">
          <select className="entrada" value={f.situacaoLicenca} onChange={(e) => setF({ ...f, situacaoLicenca: e.target.value as SituacaoLicenca })}>
            {SITUACOES_LICENCA.map((s) => (
              <option key={s} value={s}>
                {ROTULO_LICENCA[s]}
              </option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="Licença ou condições de uso">
          <input className="entrada" value={f.licenca} onChange={(e) => setF({ ...f, licenca: e.target.value })} maxLength={1000} placeholder="Ex.: CC BY 4.0, crédito obrigatório" />
        </Campo>
        <Campo rotulo="Origem">
          <input className="entrada" value={f.origem} onChange={(e) => setF({ ...f, origem: e.target.value })} maxLength={300} placeholder="Ex.: banco de imagens X, gravação própria" />
        </Campo>
        <Campo rotulo="Endereço de origem (URL)">
          <input className="entrada" value={f.urlOrigem} onChange={(e) => setF({ ...f, urlOrigem: e.target.value })} maxLength={2000} placeholder="https://" />
        </Campo>
        <Campo rotulo="Autor">
          <input className="entrada" value={f.autor} onChange={(e) => setF({ ...f, autor: e.target.value })} maxLength={200} />
        </Campo>
        <Campo rotulo="Data de criação/obtenção">
          <input type="date" className="entrada" value={f.obtidoEm} onChange={(e) => setF({ ...f, obtidoEm: e.target.value })} />
        </Campo>
        <Campo rotulo="Cena (opcional)" ajuda="Usado pela montagem automática: escreva o título da cena (ex.: Abertura), “narração” para a locução ou “trilha” para a música de fundo.">
          <input className="entrada" value={f.cena} onChange={(e) => setF({ ...f, cena: e.target.value })} maxLength={200} />
        </Campo>
      </div>
    </Dialogo>
  )
}

export function FerramentasFfmpeg() {
  const { avisar, avisarErro } = useRetorno()
  const estado = useDados(() => chamar('producao:ferramentas'), [])
  return (
    <Secao titulo="FFmpeg (renderização e controle de qualidade)">
      {estado.dados?.encontrado ? (
        <Alerta tipo="info">
          Encontrado: {estado.dados.ffmpeg} — {estado.dados.versao}
        </Alerta>
      ) : (
        <Alerta>FFmpeg não encontrado. Sem ele, o editor funciona, mas não é possível renderizar nem medir o vídeo final.</Alerta>
      )}
      <GuiaFfmpeg aberto={estado.dados ? !estado.dados.encontrado : false} />
      <div className="acoes" style={{ marginTop: 12 }}>
        <InstalarFfmpeg aoConcluir={estado.recarregar} />
        <button
          className="botao"
          onClick={async () => {
            try {
              const r = await chamar('producao:escolherFfmpeg')
              if (r.encontrado) avisar('FFmpeg configurado.')
              estado.recarregar()
            } catch (e) {
              avisarErro(mensagemDeErro(e))
            }
          }}
        >
          Escolher ffmpeg.exe
        </button>
      </div>
    </Secao>
  )
}
