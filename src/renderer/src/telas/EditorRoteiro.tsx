import { useCallback, useEffect, useMemo, useState } from 'react'
import { chamar, mensagemDeErro, useDados } from '../api'
import { Icone } from '../componentes/Icone'
import { useRetorno } from '../componentes/retorno'
import { Campo, Carregando, Dialogo, ErroCarregar, Etiqueta, Secao, Vazio, formatarData, formatarDuracao } from '../componentes/ui'
import { COR_STATUS_ROTEIRO, useNavegacao } from '../navegacao'
import { Dossie } from './Dossie'
import { DialogoGeracao } from './Geracao'
import { contarPalavras, diffLinhas, duracaoEstimadaSeg } from '@shared/diff'
import {
  ROTULO_STATUS_ROTEIRO,
  ROTULO_TIPO_FONTE,
  ROTULO_TIPO_VIDEO,
  STATUS_ROTEIRO,
  TIPOS_FONTE,
  TIPOS_VIDEO,
  type StatusRoteiro,
  type TipoFonte,
  type TipoVideo
} from '@shared/dominio'
import type { RoteiroCompleto } from '@shared/tipos'

type Aba = 'texto' | 'fontes' | 'verificacao' | 'versoes' | 'revisao'

interface Formulario {
  titulo: string
  tema: string
  tipoVideo: TipoVideo
  notas: string
  dataPrevista: string
  palavras: string
  conteudo: string
}

const paraFormulario = (r: RoteiroCompleto): Formulario => ({
  titulo: r.titulo,
  tema: r.tema,
  tipoVideo: r.tipoVideo,
  notas: r.notas,
  dataPrevista: r.dataPrevista ?? '',
  palavras: r.palavrasChave.join(', '),
  conteudo: r.conteudo
})

const hoje = (): string => new Date().toLocaleDateString('sv-SE')

export function EditorRoteiro({ id }: { id: number }) {
  const carregado = useDados(() => chamar('roteiros:obter', { id }), [id])
  if (carregado.erro) return <ErroCarregar mensagem={carregado.erro} tentarNovamente={carregado.recarregar} />
  if (!carregado.dados || carregado.dados.id !== id) return <Carregando />
  return <EditorCarregado key={id} inicial={carregado.dados} />
}

function EditorCarregado({ inicial }: { inicial: RoteiroCompleto }) {
  const nav = useNavegacao()
  const { avisar, avisarErro, confirmar } = useRetorno()
  const [roteiro, setRoteiro] = useState<RoteiroCompleto>(inicial)
  const [form, setForm] = useState<Formulario>(() => paraFormulario(inicial))
  const [aba, setAba] = useState<Aba>('texto')
  const [salvando, setSalvando] = useState(false)
  const [renomear, setRenomear] = useState<string | null>(null)
  const [variacao, setVariacao] = useState(false)
  const [derivar, setDerivar] = useState(false)

  const alterado = useMemo(() => JSON.stringify(paraFormulario(roteiro)) !== JSON.stringify(form), [roteiro, form])

  useEffect(() => {
    nav.definirAlteracoesPendentes(() => alterado)
    return () => nav.definirAlteracoesPendentes(null)
  }, [alterado, nav])

  const atualizar = (r: RoteiroCompleto): void => {
    setRoteiro(r)
    setForm(paraFormulario(r))
  }

  const salvar = useCallback(async (): Promise<void> => {
    if (salvando) return
    setSalvando(true)
    try {
      const r = await chamar('roteiros:salvar', {
        id: roteiro.id,
        versaoBase: roteiro.versaoAtual,
        titulo: form.titulo,
        tema: form.tema,
        tipoVideo: form.tipoVideo,
        notas: form.notas,
        dataPrevista: form.dataPrevista || null,
        palavrasChave: form.palavras.split(',').map((p) => p.trim()).filter(Boolean),
        conteudo: form.conteudo
      })
      const novaVersao = r.versaoAtual !== roteiro.versaoAtual
      atualizar(r)
      avisar(novaVersao ? `Salvo como versão ${r.versaoAtual}.` : 'Salvo.')
    } catch (e) {
      avisarErro(mensagemDeErro(e))
    } finally {
      setSalvando(false)
    }
  }, [roteiro, form, salvando, avisar, avisarErro])

  // Ctrl+S salva.
  useEffect(() => {
    const tecla = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void salvar()
      }
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [salvar])

  const mudar = <K extends keyof Formulario>(k: K, v: Formulario[K]): void => setForm({ ...form, [k]: v })
  const palavras = contarPalavras(form.conteudo)

  async function executar(fn: () => Promise<void>): Promise<void> {
    try {
      await fn()
    } catch (e) {
      avisarErro(mensagemDeErro(e))
    }
  }

  const exigeSalvo = async (): Promise<boolean> => {
    if (!alterado) return true
    avisarErro('Salve ou descarte as alterações antes desta ação.')
    return false
  }

  return (
    <>
      <header className="cabecalho">
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', minWidth: 0 }}>
          <button className="botao botao-icone fantasma" onClick={nav.fecharRoteiro} aria-label="Voltar">
            <Icone nome="voltar" />
          </button>
          <div style={{ minWidth: 0 }}>
            <h1 style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{roteiro.titulo}</h1>
            <p>
              {roteiro.projetoNome} · versão {roteiro.versaoAtual} · atualizado {formatarData(roteiro.atualizadoEm, true)}
              {roteiro.arquivadoEm && ' · arquivado'}
            </p>
          </div>
        </div>
        <div className="acoes">
          {alterado && <span className="secundario pequeno">Alterações não salvas</span>}
          {alterado && (
            <button className="botao fantasma" onClick={() => setForm(paraFormulario(roteiro))}>
              Descartar
            </button>
          )}
          <button className="botao primario" onClick={() => void salvar()} disabled={!alterado || salvando} title="Ctrl+S">
            {salvando ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </header>

      <div className="editor">
        <div>
          <div className="abas" role="tablist">
            {(
              [
                ['texto', 'Roteiro'],
                ['fontes', `Fontes (${roteiro.fontes.length})`],
                ['verificacao', 'Verificação'],
                ['versoes', `Versões (${roteiro.versaoAtual})`],
                ['revisao', `Revisão (${roteiro.comentarios.filter((c) => !c.resolvidoEm).length})`]
              ] as const
            ).map(([v, r]) => (
              <button key={v} role="tab" className="aba" aria-selected={aba === v} onClick={() => setAba(v)}>
                {r}
              </button>
            ))}
          </div>
          {aba === 'texto' && (
            <Secao>
              <div className="form-grade" style={{ marginBottom: 12 }}>
                <Campo rotulo="Título">
                  <input className="entrada" value={form.titulo} onChange={(e) => mudar('titulo', e.target.value)} maxLength={200} />
                </Campo>
                <Campo rotulo="Tema">
                  <input className="entrada" value={form.tema} onChange={(e) => mudar('tema', e.target.value)} maxLength={200} />
                </Campo>
              </div>
              <Campo rotulo="Texto do roteiro">
                <textarea className="entrada editor-texto" value={form.conteudo} onChange={(e) => mudar('conteudo', e.target.value)} spellCheck />
              </Campo>
            </Secao>
          )}
          {aba === 'fontes' && <AbaFontes roteiro={roteiro} aoAtualizar={atualizar} />}
          {aba === 'verificacao' && <Dossie roteiroId={roteiro.id} />}
          {aba === 'versoes' && <AbaVersoes roteiro={roteiro} conteudoAtual={form.conteudo} />}
          {aba === 'revisao' && <AbaRevisao roteiro={roteiro} aoAtualizar={atualizar} />}
        </div>

        <aside>
          <Secao titulo="Detalhes">
            <div style={{ display: 'grid', gap: 12 }}>
              <Campo rotulo="Status">
                <select
                  className="entrada"
                  value={roteiro.status}
                  onChange={(e) => void executar(async () => atualizar(await chamar('roteiros:alterarStatus', { id: roteiro.id, status: e.target.value as StatusRoteiro })))}
                >
                  {STATUS_ROTEIRO.map((s) => (
                    <option key={s} value={s} disabled={s === 'aprovado' ? roteiro.status !== 'aprovado' : s === 'publicado' ? roteiro.status !== 'aprovado' && roteiro.status !== 'publicado' : false}>
                      {ROTULO_STATUS_ROTEIRO[s]}
                      {s === 'aprovado' && roteiro.status !== 'aprovado' ? ' (pela Revisão editorial)' : ''}
                    </option>
                  ))}
                </select>
              </Campo>
              <Campo rotulo="Formato">
                <select className="entrada" value={form.tipoVideo} onChange={(e) => mudar('tipoVideo', e.target.value as TipoVideo)}>
                  {TIPOS_VIDEO.map((t) => (
                    <option key={t} value={t}>
                      {ROTULO_TIPO_VIDEO[t]}
                    </option>
                  ))}
                </select>
              </Campo>
              <Campo rotulo="Data prevista de publicação">
                <input type="date" className="entrada" value={form.dataPrevista} onChange={(e) => mudar('dataPrevista', e.target.value)} />
              </Campo>
              <Campo rotulo="Palavras-chave" ajuda="Separe por vírgulas.">
                <input className="entrada" value={form.palavras} onChange={(e) => mudar('palavras', e.target.value)} />
              </Campo>
              <Campo rotulo="Notas">
                <textarea className="entrada" rows={4} value={form.notas} onChange={(e) => mudar('notas', e.target.value)} />
              </Campo>
              <div className="secundario pequeno">
                {palavras} palavras · duração estimada {formatarDuracao(duracaoEstimadaSeg(form.conteudo))} (≈150 palavras/min, estimativa)
              </div>
            </div>
          </Secao>
          <Secao titulo="Ações">
            <div style={{ display: 'grid', gap: 8 }}>
              <button className="botao" onClick={() => void exigeSalvo().then((ok) => ok && setVariacao(true))}>
                Gerar variação
              </button>
              {roteiro.tipoVideo === 'longo' && (
                <button className="botao" onClick={() => void exigeSalvo().then((ok) => ok && setDerivar(true))}>
                  Criar Shorts derivados
                </button>
              )}
              <button className="botao" onClick={() => void exigeSalvo().then((ok) => ok && setRenomear(roteiro.titulo))}>
                Renomear
              </button>
              <button
                className="botao"
                onClick={() =>
                  void executar(async () => {
                    if (!(await exigeSalvo())) return
                    const c = await chamar('roteiros:duplicar', { id: roteiro.id })
                    avisar(`Criado "${c.titulo}".`)
                    nav.abrirRoteiro(c.id)
                  })
                }
              >
                Duplicar
              </button>
              <div className="acoes">
                {(['txt', 'md', 'json'] as const).map((f) => (
                  <button
                    key={f}
                    className="botao pequeno"
                    onClick={() =>
                      void executar(async () => {
                        if (!(await exigeSalvo())) return
                        const r = await chamar('roteiros:exportar', { id: roteiro.id, formato: f })
                        if (r.salvo) avisar(`Exportado: ${r.arquivo}`)
                      })
                    }
                  >
                    Exportar {f.toUpperCase()}
                  </button>
                ))}
              </div>
              <button
                className="botao"
                onClick={() =>
                  void executar(async () => {
                    await chamar(roteiro.arquivadoEm ? 'roteiros:restaurar' : 'roteiros:arquivar', { id: roteiro.id })
                    atualizar(await chamar('roteiros:obter', { id: roteiro.id }))
                    avisar(roteiro.arquivadoEm ? 'Roteiro restaurado.' : 'Roteiro arquivado.')
                  })
                }
              >
                {roteiro.arquivadoEm ? 'Restaurar' : 'Arquivar'}
              </button>
              <button
                className="botao perigo"
                onClick={() =>
                  void executar(async () => {
                    const ok = await confirmar({
                      titulo: 'Excluir roteiro definitivamente?',
                      texto: `"${roteiro.titulo}", suas ${roteiro.versaoAtual} versões, fontes vinculadas e comentários serão apagados. Esta ação não pode ser desfeita.`,
                      confirmar: 'Excluir',
                      perigo: true
                    })
                    if (!ok) return
                    await chamar('roteiros:excluir', { id: roteiro.id })
                    nav.definirAlteracoesPendentes(null)
                    avisar('Roteiro excluído.')
                    nav.irPara('biblioteca')
                  })
                }
              >
                Excluir
              </button>
            </div>
          </Secao>
        </aside>
      </div>

      {derivar && <DialogoDerivados roteiroId={roteiro.id} aoFechar={() => setDerivar(false)} />}
      {variacao && (
        <DialogoGeracao
          roteiroId={roteiro.id}
          tipoInicial={roteiro.tipoVideo}
          aoFechar={(r) => {
            setVariacao(false)
            if (r) void chamar('roteiros:obter', { id: roteiro.id }).then(atualizar)
          }}
        />
      )}
      <Dialogo
        aberto={renomear !== null}
        aoFechar={() => setRenomear(null)}
        titulo="Renomear roteiro"
        acoes={
          <>
            <button className="botao fantasma" onClick={() => setRenomear(null)}>
              Cancelar
            </button>
            <button
              className="botao primario"
              disabled={!renomear?.trim()}
              onClick={() =>
                void executar(async () => {
                  atualizar(await chamar('roteiros:renomear', { id: roteiro.id, titulo: renomear ?? '' }))
                  setRenomear(null)
                  avisar('Roteiro renomeado (nova versão criada).')
                })
              }
            >
              Renomear
            </button>
          </>
        }
      >
        <Campo rotulo="Novo título">
          <input className="entrada" value={renomear ?? ''} onChange={(e) => setRenomear(e.target.value)} maxLength={200} autoFocus />
        </Campo>
      </Dialogo>
    </>
  )
}

function AbaFontes({ roteiro, aoAtualizar }: { roteiro: RoteiroCompleto; aoAtualizar: (r: RoteiroCompleto) => void }) {
  const { avisar, avisarErro, confirmar } = useRetorno()
  const vazia = { titulo: '', url: '', autor: '', tipoFonte: 'outro' as TipoFonte, publicadaEm: '', acessadaEm: hoje(), notas: '' }
  const [nova, setNova] = useState(vazia)

  async function adicionar(): Promise<void> {
    try {
      aoAtualizar(await chamar('roteiros:adicionarFonte', { ...nova, roteiroId: roteiro.id, publicadaEm: nova.publicadaEm || null }))
      setNova(vazia)
      avisar('Fonte adicionada.')
    } catch (e) {
      avisarErro(mensagemDeErro(e))
    }
  }

  return (
    <>
      <Secao titulo="Fontes e referências">
        {roteiro.fontes.length === 0 ? (
          <Vazio compacto titulo="Nenhuma fonte vinculada" texto="Registre de onde vêm as informações do roteiro." />
        ) : (
          <ul className="lista">
            {roteiro.fontes.map((f) => (
              <li key={f.id} className="lista-item">
                <div className="lista-principal">
                  <a className="lista-titulo" href={f.url} target="_blank" rel="noreferrer noopener" style={{ display: 'block' }}>
                    {f.titulo}
                  </a>
                  <div className="lista-meta">
                    <span>{ROTULO_TIPO_FONTE[f.tipoFonte]}</span>
                    {f.autor && <span>· {f.autor}</span>}
                    {f.publicadaEm && <span>· publicado {formatarData(f.publicadaEm)}</span>}
                    <span>· acesso {formatarData(f.acessadaEm)}</span>
                  </div>
                  {f.notas && <div className="secundario pequeno">{f.notas}</div>}
                </div>
                <button
                  className="botao pequeno fantasma"
                  onClick={async () => {
                    const ok = await confirmar({ titulo: 'Remover fonte do roteiro?', texto: 'A fonte continuará registrada no projeto; só o vínculo com este roteiro será removido.', confirmar: 'Remover' })
                    if (!ok) return
                    try {
                      aoAtualizar(await chamar('roteiros:removerFonte', { roteiroId: roteiro.id, fonteId: f.id }))
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
        )}
      </Secao>
      <Secao titulo="Adicionar fonte">
        <form
          className="form-grade"
          onSubmit={(e) => {
            e.preventDefault()
            void adicionar()
          }}
        >
          <Campo rotulo="Título">
            <input className="entrada" value={nova.titulo} onChange={(e) => setNova({ ...nova, titulo: e.target.value })} maxLength={300} />
          </Campo>
          <Campo rotulo="Endereço (URL)">
            <input className="entrada" value={nova.url} onChange={(e) => setNova({ ...nova, url: e.target.value })} placeholder="https://" maxLength={2000} />
          </Campo>
          <Campo rotulo="Autor">
            <input className="entrada" value={nova.autor} onChange={(e) => setNova({ ...nova, autor: e.target.value })} maxLength={200} />
          </Campo>
          <Campo rotulo="Tipo">
            <select className="entrada" value={nova.tipoFonte} onChange={(e) => setNova({ ...nova, tipoFonte: e.target.value as TipoFonte })}>
              {TIPOS_FONTE.map((t) => (
                <option key={t} value={t}>
                  {ROTULO_TIPO_FONTE[t]}
                </option>
              ))}
            </select>
          </Campo>
          <Campo rotulo="Publicada em">
            <input type="date" className="entrada" value={nova.publicadaEm} onChange={(e) => setNova({ ...nova, publicadaEm: e.target.value })} />
          </Campo>
          <Campo rotulo="Acessada em">
            <input type="date" className="entrada" value={nova.acessadaEm} onChange={(e) => setNova({ ...nova, acessadaEm: e.target.value })} />
          </Campo>
          <Campo rotulo="Notas">
            <input className="entrada" value={nova.notas} onChange={(e) => setNova({ ...nova, notas: e.target.value })} maxLength={2000} />
          </Campo>
          <div style={{ alignSelf: 'end' }}>
            <button className="botao primario" type="submit" disabled={!nova.titulo.trim() || !nova.url.trim() || !nova.acessadaEm}>
              Adicionar fonte
            </button>
          </div>
        </form>
      </Secao>
    </>
  )
}

function AbaVersoes({ roteiro, conteudoAtual }: { roteiro: RoteiroCompleto; conteudoAtual: string }) {
  const versoes = useDados(() => chamar('roteiros:versoes', { id: roteiro.id }), [roteiro.id, roteiro.versaoAtual])
  const [escolhida, setEscolhida] = useState<number | null>(null)
  const versao = useDados(
    () => (escolhida ? chamar('roteiros:versao', { roteiroId: roteiro.id, numero: escolhida }) : Promise.resolve(null)),
    [roteiro.id, escolhida]
  )
  const diff = useMemo(() => (versao.dados ? diffLinhas(versao.dados.conteudo, conteudoAtual) : []), [versao.dados, conteudoAtual])

  return (
    <Secao titulo="Histórico de versões">
      {versoes.carregando && !versoes.dados && <Carregando />}
      {versoes.erro && <ErroCarregar mensagem={versoes.erro} tentarNovamente={versoes.recarregar} />}
      <ul className="lista">
        {versoes.dados?.map((v) => (
          <li key={v.numero} className="lista-item clicavel" onClick={() => setEscolhida(v.numero === escolhida ? null : v.numero)} aria-expanded={v.numero === escolhida}>
            <div className="lista-principal">
              <div className="lista-titulo">
                Versão {v.numero} — {v.titulo}
              </div>
              <div className="lista-meta">
                <span>{formatarData(v.criadoEm, true)}</span>
                <span>· {v.resumoAlteracoes}</span>
              </div>
            </div>
            {v.numero === roteiro.versaoAtual && <Etiqueta cor="verde">Atual</Etiqueta>}
          </li>
        ))}
      </ul>
      {escolhida && versao.dados && (
        <div style={{ marginTop: 16 }}>
          <h3>Diferenças da versão {escolhida} para o texto no editor</h3>
          <div className="diff" aria-label="Diferenças">
            {diff.every((l) => l.tipo === 'igual') ? (
              <span className="secundario">Sem diferenças no texto.</span>
            ) : (
              diff.map((l, i) => (
                <span key={i} className={l.tipo === 'adicionada' ? 'add' : l.tipo === 'removida' ? 'rem' : undefined}>
                  {l.tipo === 'adicionada' ? '+ ' : l.tipo === 'removida' ? '− ' : '  '}
                  {l.texto}
                  {'\n'}
                </span>
              ))
            )}
          </div>
        </div>
      )}
    </Secao>
  )
}

function AbaRevisao({ roteiro, aoAtualizar }: { roteiro: RoteiroCompleto; aoAtualizar: (r: RoteiroCompleto) => void }) {
  const { avisarErro } = useRetorno()
  const [texto, setTexto] = useState('')
  return (
    <Secao titulo="Comentários de revisão">
      {roteiro.comentarios.length === 0 ? (
        <Vazio compacto titulo="Nenhum comentário" />
      ) : (
        <ul className="lista">
          {roteiro.comentarios.map((c) => (
            <li key={c.id} className="lista-item">
              <div className="lista-principal">
                <div style={{ whiteSpace: 'pre-wrap' }}>{c.texto}</div>
                <div className="lista-meta">
                  <span>{formatarData(c.criadoEm, true)}</span>
                  <span>· versão {c.versaoNumero}</span>
                </div>
              </div>
              {c.resolvidoEm ? (
                <Etiqueta cor="verde">Resolvido</Etiqueta>
              ) : (
                <button
                  className="botao pequeno"
                  onClick={async () => {
                    try {
                      await chamar('roteiros:resolverComentario', { id: c.id })
                      aoAtualizar(await chamar('roteiros:obter', { id: roteiro.id }))
                    } catch (e) {
                      avisarErro(mensagemDeErro(e))
                    }
                  }}
                >
                  Marcar resolvido
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="form-linha" style={{ marginTop: 12 }}>
        <textarea className="entrada" rows={2} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Escreva um comentário sobre esta versão" style={{ flex: 1 }} maxLength={5000} />
        <button
          className="botao primario"
          disabled={!texto.trim()}
          onClick={async () => {
            try {
              aoAtualizar(await chamar('roteiros:comentar', { roteiroId: roteiro.id, texto }))
              setTexto('')
            } catch (e) {
              avisarErro(mensagemDeErro(e))
            }
          }}
        >
          Comentar
        </button>
      </div>
      <p className="secundario pequeno" style={{ marginTop: 8 }}>
        Status atual: <Etiqueta cor={COR_STATUS_ROTEIRO[roteiro.status]}>{ROTULO_STATUS_ROTEIRO[roteiro.status]}</Etiqueta>
      </p>
    </Secao>
  )
}

function DialogoDerivados({ roteiroId, aoFechar }: { roteiroId: number; aoFechar: () => void }) {
  const nav = useNavegacao()
  const { avisar, avisarErro } = useRetorno()
  const ideias = useDados(() => chamar('derivados:ideias', { id: roteiroId }), [roteiroId])
  return (
    <Dialogo aberto largo aoFechar={aoFechar} titulo="Shorts derivados" acoes={<button className="botao fantasma" onClick={aoFechar}>Fechar</button>}>
      <p className="secundario pequeno">
        Ideias que podem fazer sentido sozinhas, sempre com frases inteiras (nenhuma afirmação é cortada no meio). O Short vira um roteiro próprio, com versões, ligado a este.
      </p>
      {ideias.erro && <ErroCarregar mensagem={ideias.erro} tentarNovamente={ideias.recarregar} />}
      {ideias.dados?.length === 0 && <Vazio compacto titulo="Nenhuma ideia encontrada" texto="Blocos precisam ter entre 25 e 160 palavras em frases completas." />}
      <ul className="lista">
        {ideias.dados?.map((i) => (
          <li key={i.chave} className="lista-item" style={{ alignItems: 'flex-start' }}>
            <div className="lista-principal">
              <div className="lista-titulo">{i.titulo}</div>
              <div className="secundario pequeno">{i.texto}</div>
              <div className="lista-meta">
                {i.palavras} palavras · {i.origem === 'cena' ? 'bloco do roteiro' : 'afirmação verificada'}
              </div>
            </div>
            <button
              className="botao pequeno primario"
              onClick={async () => {
                try {
                  const r = await chamar('derivados:criar', { roteiroId, chave: i.chave })
                  avisar('Short criado.')
                  aoFechar()
                  nav.abrirRoteiro(r.id)
                } catch (e) {
                  avisarErro(mensagemDeErro(e))
                }
              }}
            >
              Criar Short
            </button>
          </li>
        ))}
      </ul>
    </Dialogo>
  )
}
