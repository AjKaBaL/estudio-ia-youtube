import { useState } from 'react'
import { chamar, mensagemDeErro, useDados } from '../api'
import { useRetorno } from './retorno'
import { Alerta, Campo, Dialogo, Etiqueta, Secao } from './ui'
import { BarraProgresso, useProgressoRemoto } from './progresso'
import { useNavegacao } from '../navegacao'
import { pedirAbaConfig } from '../telas/Configuracoes'
import { FONTES_IMAGEM, GERADORES_IMAGEM, INFO_FONTE_IMAGEM, INFO_GERADOR, INFO_MOTOR_VOZ, MOTORES_VOZ, type PreferenciaMidia } from '@shared/geracaoMidia'
import type { PainelMidiaAuto } from '@shared/tipos'

type Servico = keyof PainelMidiaAuto['chaves']

/** Botão do editor: narração por voz sintética + imagens (busca livre e IA) + montagem, com barra de progresso. */
export function ProduzirMidias({ edicaoId, antes, depois }: { edicaoId: number; antes: () => boolean; depois: (relatorio: string[]) => Promise<void> }) {
  const nav = useNavegacao()
  const { avisarErro } = useRetorno()
  const [aberto, setAberto] = useState(false)
  const [narracao, setNarracao] = useState(true)
  const [imagens, setImagens] = useState(true)
  const [rodando, setRodando] = useState(false)
  const [relatorio, setRelatorio] = useState<string[] | null>(null)
  const painel = useDados(() => (aberto ? chamar('midiaAuto:painel') : Promise.resolve(null)), [aberto])
  const prog = useProgressoRemoto(() => chamar('midiaAuto:progresso', { id: edicaoId }), rodando)
  const p = painel.dados
  const temChave = (f: string): boolean => (p?.chaves as Record<string, boolean> | undefined)?.[f] ?? false
  const fontesProntas = p ? p.preferencia.busca.fontes.filter((f) => !INFO_FONTE_IMAGEM[f].exigeChave || temChave(f)) : []
  const geradorPronto = p ? p.preferencia.geracao.ativa && p.chaves[p.preferencia.geracao.gerador] : false
  return (
    <>
      <button className="botao primario" title="Narração por voz sintética, imagens com licença livre ou geradas por IA, e montagem" onClick={() => (setRelatorio(null), setAberto(true))}>
        Gerar narração e imagens
      </button>
      {aberto && (
        <Dialogo
          aberto
          largo
          titulo="Gerar narração e imagens (1 clique)"
          aoFechar={() => !rodando && setAberto(false)}
          acoes={
            <>
              <button className="botao fantasma" disabled={rodando} onClick={() => (pedirAbaConfig('midia'), nav.irPara('config'))}>
                Ajustar voz e fontes
              </button>
              <button className="botao fantasma" disabled={rodando} onClick={() => setAberto(false)}>
                Fechar
              </button>
              <button
                className="botao primario"
                disabled={rodando || (!narracao && !imagens)}
                onClick={async () => {
                  if (!antes()) return avisarErro('Aguarde o salvamento automático terminar e tente de novo.')
                  setRodando(true)
                  setRelatorio(null)
                  try {
                    const r = await chamar('midiaAuto:produzir', { edicaoId, narracao, imagens })
                    await depois(r.relatorio)
                    setRelatorio(r.relatorio)
                  } catch (e) {
                    avisarErro(mensagemDeErro(e))
                  } finally {
                    setRodando(false)
                  }
                }}
              >
                {rodando ? 'Produzindo…' : 'Produzir agora'}
              </button>
            </>
          }
        >
          <label className="checkbox">
            <input type="checkbox" checked={narracao} disabled={rodando} onChange={(e) => setNarracao(e.target.checked)} />
            Narração por voz sintética, cena por cena (cada cena passa a durar o tempo da fala)
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={imagens} disabled={rodando} onChange={(e) => setImagens(e.target.checked)} />
            Imagens para as cenas vazias: busca com licença livre e, se nada servir, imagem gerada por IA
          </label>
          {p && (
            <div className="cartao-suave pequeno" style={{ marginTop: 12 }}>
              <div>
                <strong>Voz:</strong> {INFO_MOTOR_VOZ[p.preferencia.voz.motor].nome}
                {p.preferencia.voz.motor === 'piper' && !p.piperInstalado && ' (não instalada: será usada a voz do Windows)'}
              </div>
              <div>
                <strong>Busca:</strong> {fontesProntas.map((f) => INFO_FONTE_IMAGEM[f].nome).join(', ') || 'nenhuma fonte pronta'}
                {p.preferencia.busca.fontes.some((f) => INFO_FONTE_IMAGEM[f].exigeChave && !temChave(f)) && ' (Pexels/Pixabay sem chave ficam de fora)'}
              </div>
              <div>
                <strong>Geração por IA:</strong> {p.preferencia.geracao.ativa ? `${INFO_GERADOR[p.preferencia.geracao.gerador].nome}${geradorPronto ? '' : ' (sem chave: pulada)'}` : 'desligada'}
              </div>
              <div>
                <strong>Sem imagem:</strong> {p.preferencia.geracao.cartoes ? 'o app cria um cartão gráfico com o título e a frase da cena (sem chave)' : 'a cena fica sem imagem'}
              </div>
              <div>
                <strong>Acabamento:</strong> {resumoEstilo(p.preferencia.video)}
              </div>
            </div>
          )}
          <p className="secundario pequeno">Tudo vai para a biblioteca com origem, autor e licença. Créditos obrigatórios entram sozinhos na descrição. O resultado pode ser desfeito com Ctrl+Z.</p>
          {rodando && <BarraProgresso percentual={prog?.percentual ?? 0} etapa={prog?.etapa ?? 'Preparando'} detalhe={prog?.detalhe} inicio={prog?.iniciadoEm} />}
          {relatorio && (
            <Alerta tipo="info">
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {relatorio.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            </Alerta>
          )}
        </Dialogo>
      )}
    </>
  )
}

/** Configurações › Mídia automática: voz, fontes de imagem com chaves e gerador por IA. */
export function ConfigMidiaAutomatica() {
  const painel = useDados(() => chamar('midiaAuto:painel'), [])
  if (painel.erro) return <Alerta tipo="erro">{painel.erro}</Alerta>
  if (!painel.dados) return <p className="secundario">Carregando…</p>
  return <ConfigCarregada key={JSON.stringify(painel.dados.preferencia)} p={painel.dados} recarregar={painel.recarregar} />
}

function ConfigCarregada({ p, recarregar }: { p: PainelMidiaAuto; recarregar: () => void }) {
  const { avisar, avisarErro } = useRetorno()
  const [pref, setPref] = useState<PreferenciaMidia>(p.preferencia)
  const [texto, setTexto] = useState('Olá! Este é um exemplo da narração do canal.')
  const [ouvindo, setOuvindo] = useState(false)
  const [instalando, setInstalando] = useState(false)
  const prog = useProgressoRemoto(() => chamar('rapido:progresso'), instalando)
  const alterada = JSON.stringify(pref) !== JSON.stringify(p.preferencia)
  const salvar = async (nova = pref): Promise<void> => {
    try {
      await chamar('midiaAuto:salvarPreferencia', nova)
      avisar('Preferências de mídia salvas.')
      recarregar()
    } catch (e) {
      avisarErro(mensagemDeErro(e))
    }
  }
  return (
    <>
      <Secao titulo="Voz da narração" acoes={<Etiqueta cor="verde">No seu PC, sem custo</Etiqueta>}>
        <div className="opcoes-rapidas">
          {MOTORES_VOZ.map((m) => (
            <label key={m} className="opcao-rapida" style={{ cursor: 'pointer', borderColor: pref.voz.motor === m ? 'var(--azul)' : undefined }}>
              <span>
                <input type="radio" name="motor" checked={pref.voz.motor === m} onChange={() => setPref({ ...pref, voz: { ...pref.voz, motor: m } })} /> <strong>{INFO_MOTOR_VOZ[m].nome}</strong>{' '}
                {m === 'piper' && (p.piperInstalado ? <Etiqueta cor="verde">Instalada</Etiqueta> : <Etiqueta>Não instalada</Etiqueta>)}
              </span>
              <span className="secundario pequeno">{INFO_MOTOR_VOZ[m].descricao}</span>
            </label>
          ))}
        </div>
        {!p.piperInstalado && (
          <div style={{ marginTop: 12 }}>
            <button
              className="botao primario"
              disabled={instalando}
              onClick={async () => {
                setInstalando(true)
                try {
                  avisar((await chamar('rapido:instalarPiper')).mensagem)
                  recarregar()
                } catch (e) {
                  avisarErro(mensagemDeErro(e))
                } finally {
                  setInstalando(false)
                }
              }}
            >
              {instalando ? 'Instalando a voz neural…' : 'Instalar voz neural Piper (1 clique, ~85 MB)'}
            </button>
            {instalando && prog?.pacote === 'piper' && <BarraProgresso percentual={prog.percentual} etapa={prog.etapa} detalhe={prog.detalhe} inicio={prog.iniciadoEm} ativo={prog.ativo} />}
          </div>
        )}
        <div className="form-grade" style={{ marginTop: 12 }}>
          {pref.voz.motor === 'windows' && (
            <Campo rotulo="Voz do Windows">
              <select className="entrada" value={pref.voz.vozWindows} onChange={(e) => setPref({ ...pref, voz: { ...pref.voz, vozWindows: e.target.value } })}>
                <option value="">Automática (primeira em português)</option>
                {p.vozesWindows.map((v) => (
                  <option key={v.nome} value={v.nome}>
                    {v.nome} ({v.idioma})
                  </option>
                ))}
              </select>
            </Campo>
          )}
          <Campo rotulo={`Velocidade: ${pref.voz.velocidade > 0 ? '+' : ''}${pref.voz.velocidade}`}>
            <input type="range" min={-5} max={5} value={pref.voz.velocidade} onChange={(e) => setPref({ ...pref, voz: { ...pref.voz, velocidade: Number(e.target.value) } })} />
          </Campo>
        </div>
        <div className="acoes" style={{ marginTop: 8 }}>
          <input className="entrada" style={{ flex: 1, minWidth: 220 }} value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={400} aria-label="Texto de exemplo" />
          <button
            className="botao"
            disabled={ouvindo || !texto.trim() || alterada}
            title={alterada ? 'Salve as preferências antes de ouvir' : undefined}
            onClick={async () => {
              setOuvindo(true)
              try {
                const r = await chamar('midiaAuto:testarVoz', { texto })
                const url = URL.createObjectURL(new Blob([Uint8Array.from(atob(r.base64), (c) => c.charCodeAt(0))], { type: 'audio/wav' }))
                const audio = new Audio(url)
                audio.onended = () => URL.revokeObjectURL(url)
                await audio.play()
                avisar(r.descricao)
              } catch (e) {
                avisarErro(mensagemDeErro(e))
              } finally {
                setOuvindo(false)
              }
            }}
          >
            {ouvindo ? 'Gerando…' : 'Ouvir exemplo'}
          </button>
        </div>
      </Secao>

      <Secao titulo="Imagens e vídeos com licença livre">
        <p className="secundario pequeno" style={{ marginTop: 0 }}>
          A busca segue esta ordem e para quando a cena já tem o que precisa. Cada arquivo guarda autor, licença e endereço; os créditos obrigatórios entram na descrição do vídeo.
        </p>
        <ul className="lista">
          {FONTES_IMAGEM.map((f) => (
            <LinhaFonte
              key={f}
              nome={INFO_FONTE_IMAGEM[f].nome}
              descricao={INFO_FONTE_IMAGEM[f].descricao}
              urlChave={INFO_FONTE_IMAGEM[f].urlChave}
              exigeChave={INFO_FONTE_IMAGEM[f].exigeChave}
              servico={f === 'wikimedia' ? null : f}
              temChave={f === 'wikimedia' ? true : p.chaves[f]}
              ativo={pref.busca.fontes.includes(f)}
              aoAtivar={(a) => setPref({ ...pref, busca: { ...pref.busca, fontes: a ? FONTES_IMAGEM.filter((x) => x === f || pref.busca.fontes.includes(x)) : pref.busca.fontes.filter((x) => x !== f) } })}
              aoSalvarChave={recarregar}
            />
          ))}
        </ul>
        <div className="acoes" style={{ marginTop: 8 }}>
          <label className="checkbox">
            <input type="checkbox" checked={pref.busca.preferirVideos} onChange={(e) => setPref({ ...pref, busca: { ...pref.busca, preferirVideos: e.target.checked } })} />
            Preferir vídeos (Pexels/Pixabay)
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={pref.busca.aceitarCompartilhaIgual} onChange={(e) => setPref({ ...pref, busca: { ...pref.busca, aceitarCompartilhaIgual: e.target.checked } })} />
            Aceitar CC BY-SA (exige que o vídeo use a mesma licença)
          </label>
          <Campo rotulo="Por cena">
            <select className="entrada" value={pref.busca.porCena} onChange={(e) => setPref({ ...pref, busca: { ...pref.busca, porCena: Number(e.target.value) } })}>
              {[1, 2, 3].map((n) => (
                <option key={n} value={n}>
                  {n} {n === 1 ? 'mídia' : 'mídias'}
                </option>
              ))}
            </select>
          </Campo>
        </div>
      </Secao>

      <Secao titulo="Imagens geradas por IA">
        <label className="checkbox">
          <input type="checkbox" checked={pref.geracao.ativa} onChange={(e) => setPref({ ...pref, geracao: { ...pref.geracao, ativa: e.target.checked } })} />
          Gerar imagem por IA quando a busca não achar nada
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={pref.geracao.sempre} onChange={(e) => setPref({ ...pref, geracao: { ...pref.geracao, sempre: e.target.checked } })} />
          Gerar também para cenas que já acharam imagem na busca
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={pref.geracao.cartoes} onChange={(e) => setPref({ ...pref, geracao: { ...pref.geracao, cartoes: e.target.checked } })} />
          Sem imagem da busca nem da IA: criar um cartão gráfico (título e frase da cena), sem chave e sem internet
        </label>
        <ul className="lista" style={{ marginTop: 8 }}>
          {GERADORES_IMAGEM.map((g) => (
            <LinhaFonte
              key={g}
              nome={INFO_GERADOR[g].nome}
              descricao={INFO_GERADOR[g].descricao}
              urlChave={INFO_GERADOR[g].urlChave}
              exigeChave
              servico={g}
              temChave={p.chaves[g]}
              ativo={pref.geracao.gerador === g}
              radio
              aoAtivar={() => setPref({ ...pref, geracao: { ...pref.geracao, gerador: g } })}
              aoSalvarChave={recarregar}
            />
          ))}
        </ul>
        <div className="form-grade" style={{ marginTop: 8 }}>
          <Campo rotulo="Estilo das imagens">
            <input className="entrada" value={pref.geracao.estilo} maxLength={200} onChange={(e) => setPref({ ...pref, geracao: { ...pref.geracao, estilo: e.target.value } })} />
          </Campo>
          {pref.geracao.gerador === 'cloudflare' && (
            <Campo rotulo="ID da conta Cloudflare (32 caracteres)">
              <input className="entrada" value={pref.geracao.contaCloudflare} maxLength={40} onChange={(e) => setPref({ ...pref, geracao: { ...pref.geracao, contaCloudflare: e.target.value.trim() } })} />
            </Campo>
          )}
        </div>
        <p className="secundario pequeno">
          O pedido à IA proíbe texto, logotipos e pessoas reais identificáveis. Se uma imagem gerada parecer real, marque “Conteúdo alterado ou sintético” ao publicar (o app lembra no controle de qualidade e na descrição).
        </p>
      </Secao>
      <Secao titulo="Acabamento do vídeo" acoes={<Etiqueta cor="verde">Sem custo</Etiqueta>}>
        {(
          [
            ['apresentador', 'Apresentador animado no canto, com poses que acompanham o texto (pergunta, ideia, número, alerta…)'],
            ['movimento', 'Fotos em movimento: zoom e deslocamento suaves, com efeito parallax quando a foto não encaixa na tela'],
            ['transicoes', 'Transição suave na troca de cena'],
            ['videos', 'Intercalar vídeos com licença livre entre as fotos'],
            ['titulos', 'Título de cada cena na tela nos primeiros segundos'],
            ['trilha', 'Trilha sonora em todo vídeo (o app compõe uma original se a biblioteca não tiver)']
          ] as const
        ).map(([k, rotulo]) => (
          <label key={k} className="checkbox">
            <input type="checkbox" checked={pref.video[k]} onChange={(e) => setPref({ ...pref, video: { ...pref.video, [k]: e.target.checked } })} />
            {rotulo}
          </label>
        ))}
        {pref.video.apresentador && (
          <Campo rotulo="Lado do apresentador">
            <select className="entrada" value={pref.video.lado} onChange={(e) => setPref({ ...pref, video: { ...pref.video, lado: e.target.value as 'direita' | 'esquerda' } })}>
              <option value="direita">Direita</option>
              <option value="esquerda">Esquerda</option>
            </select>
          </Campo>
        )}
      </Secao>
      <div className="acoes">
        <button className="botao primario" disabled={!alterada} onClick={() => void salvar()}>
          Salvar preferências de mídia
        </button>
      </div>
    </>
  )
}

function LinhaFonte(props: {
  nome: string
  descricao: string
  urlChave: string
  exigeChave: boolean
  servico: Servico | null
  temChave: boolean
  ativo: boolean
  radio?: boolean
  aoAtivar: (ativo: boolean) => void
  aoSalvarChave: () => void
}) {
  const { avisar, avisarErro } = useRetorno()
  const [chave, setChave] = useState('')
  const guardar = async (valor: string | null): Promise<void> => {
    if (!props.servico) return
    try {
      await chamar('midiaAuto:definirChave', { servico: props.servico, chave: valor })
      avisar(valor ? 'Chave guardada no cofre criptografado.' : 'Chave removida.')
      setChave('')
      props.aoSalvarChave()
    } catch (e) {
      avisarErro(mensagemDeErro(e))
    }
  }
  return (
    <li className="lista-item" style={{ alignItems: 'flex-start' }}>
      <input type={props.radio ? 'radio' : 'checkbox'} checked={props.ativo} onChange={(e) => props.aoAtivar(e.target.checked)} aria-label={props.nome} style={{ marginTop: 4 }} />
      <div className="lista-principal">
        <div className="lista-titulo">
          {props.nome} {props.exigeChave ? <Etiqueta cor={props.temChave ? 'verde' : 'cinza'}>{props.temChave ? 'Chave guardada' : 'Sem chave'}</Etiqueta> : <Etiqueta cor="verde">Sem chave</Etiqueta>}
        </div>
        <div className="secundario pequeno">{props.descricao}</div>
        {props.exigeChave && props.servico && (
          <div className="acoes" style={{ marginTop: 6 }}>
            <a className="botao pequeno link-passo" href={props.urlChave} target="_blank" rel="noreferrer">
              Criar chave ↗
            </a>
            <input type="password" autoComplete="off" spellCheck={false} className="entrada" style={{ flex: 1, minWidth: 160 }} placeholder={props.temChave ? 'Nova chave (para trocar)' : 'Cole a chave aqui'} value={chave} onChange={(e) => setChave(e.target.value)} maxLength={500} aria-label={`Chave de ${props.nome}`} />
            <button className="botao pequeno" disabled={chave.trim().length < 8} onClick={() => void guardar(chave)}>
              Guardar
            </button>
            {props.temChave && (
              <button className="botao pequeno fantasma" onClick={() => void guardar(null)}>
                Remover
              </button>
            )}
          </div>
        )}
      </div>
    </li>
  )
}

function resumoEstilo(v: PreferenciaMidia['video']): string {
  const itens = [v.apresentador && 'apresentador animado', v.movimento && 'fotos em movimento', v.transicoes && 'transições', v.videos && 'vídeos intercalados', v.titulos && 'títulos das cenas', v.trilha && 'trilha sonora']
  return itens.filter(Boolean).join(', ') || 'simples (sem efeitos)'
}
