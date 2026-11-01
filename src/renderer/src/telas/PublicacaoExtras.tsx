import { useState } from 'react'
import { chamar, mensagemDeErro, useDados } from '../api'
import { useRetorno } from '../componentes/retorno'
import { Ajuda, Alerta, Campo, Dialogo, Etiqueta, Secao, Vazio, formatarBytes } from '../componentes/ui'
import { useNavegacao } from '../navegacao'
import {
  CORES_MINIATURA,
  FONTES_MINIATURA,
  MODELOS_MINIATURA,
  OPCOES_MINIATURA_PADRAO,
  textoSugerido,
  type CorMiniatura,
  type FonteMiniatura,
  type ModeloMiniatura,
  type OpcoesMiniatura
} from '@shared/miniatura'
import { ROTULO_CATEGORIA_LINK } from '@shared/publicacao'
import type { Publicacao } from '@shared/tipos'

/** Projeto do roteiro da publicação (links e imagens são por projeto). */
function useProjetoDaPublicacao(p: Publicacao): number | null {
  const r = useDados(() => chamar('roteiros:obter', { id: p.roteiroId }), [p.roteiroId])
  return r.dados?.projetoId ?? null
}

/** Escolha dos links cadastrados e geração da descrição completa (resumo, capítulos, links, fontes, hashtags). */
export function DescricaoAutomatica({ p, editavel, tags, aplicar }: { p: Publicacao; editavel: boolean; tags: string[]; aplicar: (texto: string) => void }) {
  const nav = useNavegacao()
  const { avisar, avisarErro } = useRetorno()
  const projetoId = useProjetoDaPublicacao(p)
  const links = useDados(() => (projetoId === null ? Promise.resolve([]) : chamar('links:listar', { projetoId })), [projetoId])
  const [escolhidos, setEscolhidos] = useState<Set<number>>(new Set(p.links))
  const [avisos, setAvisos] = useState<string[]>([])
  const ativos = links.dados?.filter((l) => l.ativo) ?? []

  return (
    <Secao titulo="Descrição automática">
      <p className="secundario pequeno">
        Monta a descrição com o resumo do roteiro, os capítulos (vídeos longos), os links escolhidos abaixo, as fontes verificadas e até 3 hashtags das tags. Nada é inventado. O texto vai para o campo Descrição para você revisar; depois clique em Salvar dados.
      </p>
      {ativos.length === 0 ? (
        <Vazio
          compacto
          titulo="Nenhum link cadastrado"
          texto="Cadastre redes sociais, produtos e links de afiliado uma vez e escolha aqui em cada vídeo."
          acao={
            <button className="botao pequeno" onClick={() => nav.irPara('links')}>
              Abrir Links e redes
            </button>
          }
        />
      ) : (
        <div style={{ display: 'grid', gap: 6, margin: '8px 0' }}>
          {ativos.map((l) => (
            <label key={l.id} className="checkbox">
              <input
                type="checkbox"
                disabled={!editavel}
                checked={escolhidos.has(l.id)}
                onChange={(e) => {
                  const s = new Set(escolhidos)
                  if (e.target.checked) s.add(l.id)
                  else s.delete(l.id)
                  setEscolhidos(s)
                }}
              />
              <span>
                {l.nome} <span className="secundario pequeno">· {ROTULO_CATEGORIA_LINK[l.categoria]}</span>
              </span>
            </label>
          ))}
        </div>
      )}
      <button
        className="botao"
        disabled={!editavel}
        onClick={async () => {
          try {
            const ordem = ativos.filter((l) => escolhidos.has(l.id)).map((l) => l.id)
            const r = await chamar('publicacoes:gerarDescricao', { id: p.id, links: ordem, tags })
            aplicar(r.texto)
            setAvisos(r.avisos)
            avisar('Descrição gerada. Revise e clique em Salvar dados.')
          } catch (e) {
            avisarErro(mensagemDeErro(e))
          }
        }}
      >
        Gerar descrição
      </button>
      {avisos.map((a) => (
        <Alerta key={a}>{a}</Alerta>
      ))}
    </Secao>
  )
}

/** Miniatura atual da publicação, com criação a partir de um quadro do vídeo ou de uma imagem. */
export function MiniaturaPublicacao({ p, editavel, recarregar }: { p: Publicacao; editavel: boolean; recarregar: () => void }) {
  const { avisar, avisarErro } = useRetorno()
  const [criando, setCriando] = useState(false)
  return (
    <Secao
      titulo="Miniatura"
      acoes={
        editavel && (
          <button className="botao pequeno primario" onClick={() => setCriando(true)}>
            {p.miniaturaRecursoId ? 'Criar outra' : 'Criar miniatura'}
          </button>
        )
      }
    >
      {p.miniaturaRecursoId ? (
        <>
          <img className="miniatura-grande" src={`midia://recurso/${p.miniaturaRecursoId}`} alt="Miniatura escolhida" />
          {editavel && (
            <button
              className="botao pequeno fantasma"
              style={{ marginTop: 8 }}
              onClick={async () => {
                try {
                  await chamar('miniaturas:definir', { publicacaoId: p.id, recursoId: null })
                  avisar('Miniatura removida desta publicação (a imagem continua na biblioteca).')
                  recarregar()
                } catch (e) {
                  avisarErro(mensagemDeErro(e))
                }
              }}
            >
              Remover desta publicação
            </button>
          )}
        </>
      ) : (
        <Vazio compacto titulo="Sem miniatura" texto="Sem miniatura, o YouTube escolhe um quadro automaticamente. Uma miniatura própria costuma atrair mais cliques." />
      )}
      <p className="secundario pequeno" style={{ marginTop: 8 }}>
        1280×720, JPG até 2 MB. A conta precisa estar verificada no YouTube para usar miniaturas personalizadas. Em Shorts, o YouTube pode não exibir a miniatura escolhida.
      </p>
      {criando && (
        <CriarMiniatura
          p={p}
          aoFechar={(ok) => {
            setCriando(false)
            if (ok) recarregar()
          }}
        />
      )}
    </Secao>
  )
}

type Origem = { tipo: 'quadro'; tempo: number } | { tipo: 'imagem'; recursoId: number }

function CriarMiniatura({ p, aoFechar }: { p: Publicacao; aoFechar: (ok: boolean) => void }) {
  const { avisar, avisarErro } = useRetorno()
  const projetoId = useProjetoDaPublicacao(p)
  const quadros = useDados(() => chamar('miniaturas:quadros', { renderizacaoId: p.renderizacaoId }), [p.renderizacaoId])
  const imagens = useDados(() => (projetoId === null ? Promise.resolve([]) : chamar('midia:listar', { projetoId, roteiroId: null })), [projetoId])
  const [aba, setAba] = useState<'quadro' | 'imagem'>('quadro')
  const [origem, setOrigem] = useState<Origem | null>(null)
  const [o, setO] = useState<OpcoesMiniatura>({ ...OPCOES_MINIATURA_PADRAO, texto: textoSugerido(p.titulo, OPCOES_MINIATURA_PADRAO.modelo) })
  const [versaoPrevia, setVersaoPrevia] = useState(0)
  const [ocupado, setOcupado] = useState(false)

  // Começa no quadro sugerido (o de mais detalhe).
  const sugerido = quadros.dados?.find((q) => q.sugerido)
  const origemAtual: Origem | null = origem ?? (sugerido ? { tipo: 'quadro', tempo: sugerido.tempo } : null)
  const fonte = origemAtual ? (origemAtual.tipo === 'quadro' ? { tipo: 'quadro' as const, renderizacaoId: p.renderizacaoId, tempo: origemAtual.tempo } : origemAtual) : null

  // A prévia é gerada sozinha quando o quadro sugerido chega e de novo a cada "Atualizar prévia".
  const carregamento = useDados(() => (fonte ? chamar('miniaturas:previa', { fonte, opcoes: o, publicacaoId: null }) : Promise.resolve(null)), [versaoPrevia, Boolean(fonte)])
  const previa = carregamento.dados
  const gerando = carregamento.carregando

  const fotos = imagens.dados?.filter((m) => m.categoria === 'imagem' && m.arquivoExiste && m.cena !== 'Miniatura') ?? []
  return (
    <Dialogo
      aberto
      largo
      aoFechar={() => aoFechar(false)}
      titulo="Criar miniatura"
      acoes={
        <>
          <button className="botao" onClick={() => aoFechar(false)}>
            Cancelar
          </button>
          <button className="botao" disabled={!fonte || ocupado || gerando} onClick={() => setVersaoPrevia((v) => v + 1)}>
            {gerando ? 'Gerando…' : 'Atualizar prévia'}
          </button>
          <button
            className="botao primario"
            disabled={!fonte || ocupado}
            onClick={async () => {
              if (!fonte) return
              setOcupado(true)
              try {
                await chamar('miniaturas:salvar', { fonte, opcoes: o, publicacaoId: p.id })
                avisar('Miniatura salva na biblioteca e ligada a esta publicação.')
                aoFechar(true)
              } catch (e) {
                avisarErro(mensagemDeErro(e))
                setOcupado(false)
              }
            }}
          >
            Usar esta miniatura
          </button>
        </>
      }
    >
      <div className="miniatura-editor">
        <div>
          <div className="previa-miniatura">{previa ? <img src={previa.dataUrl} alt="Prévia da miniatura" /> : <span className="secundario">{gerando ? 'Gerando prévia…' : 'Escolha uma imagem'}</span>}</div>
          {carregamento.erro && <Alerta tipo="erro">{carregamento.erro}</Alerta>}
          {previa && (
            <p className="secundario pequeno">
              Prévia 1280×720 · {formatarBytes(previa.bytes)}
              {previa.linhasCortadas && ' · o texto foi encurtado para caber: use menos palavras.'}
            </p>
          )}
          <div className="abas" role="tablist" style={{ marginTop: 8 }}>
            <button role="tab" className="aba" aria-selected={aba === 'quadro'} onClick={() => setAba('quadro')}>
              Quadro do vídeo
            </button>
            <button role="tab" className="aba" aria-selected={aba === 'imagem'} onClick={() => setAba('imagem')}>
              Imagem da biblioteca
            </button>
          </div>
          {aba === 'quadro' && (
            <div className="grade-quadros">
              {quadros.erro && <Alerta tipo="erro">{quadros.erro}</Alerta>}
              {quadros.dados?.map((q) => {
                const sel = origemAtual?.tipo === 'quadro' && origemAtual.tempo === q.tempo
                return (
                  <button key={q.indice} className={`quadro${sel ? ' selecionado' : ''}`} onClick={() => setOrigem({ tipo: 'quadro', tempo: q.tempo })} title={`${q.tempo.toFixed(1)} s`}>
                    <img src={`midia://quadro/${p.renderizacaoId}/q-${q.indice}.jpg`} alt={`Quadro em ${q.tempo.toFixed(1)} s`} />
                    {q.sugerido && <Etiqueta cor="verde">Sugerido</Etiqueta>}
                  </button>
                )
              })}
            </div>
          )}
          {aba === 'imagem' && (
            <div className="grade-quadros">
              {fotos.length === 0 && <Vazio compacto titulo="Nenhuma imagem no projeto" texto="Importe fotos em Estúdio › Biblioteca de mídia (registre origem e licença)." />}
              {fotos.map((m) => {
                const sel = origemAtual?.tipo === 'imagem' && origemAtual.recursoId === m.id
                return (
                  <button key={m.id} className={`quadro${sel ? ' selecionado' : ''}`} onClick={() => setOrigem({ tipo: 'imagem', recursoId: m.id })} title={m.nomeOriginal}>
                    <img src={`midia://recurso/${m.id}`} alt={m.nomeOriginal} />
                  </button>
                )
              })}
            </div>
          )}
        </div>
        <div style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
          <Campo rotulo="Texto da miniatura" ajuda="Poucas palavras (até 4–6). Complementa o título em vez de repeti-lo.">
            <input className="entrada" value={o.texto} maxLength={80} onChange={(e) => setO({ ...o, texto: e.target.value })} />
          </Campo>
          <Campo rotulo="Selo (opcional)" ajuda="Etiqueta vermelha no canto. Ex.: NOVO, IA, URGENTE, GUIA.">
            <input className="entrada" value={o.selo} maxLength={14} onChange={(e) => setO({ ...o, selo: e.target.value })} />
          </Campo>
          <div className="opcoes-escolha" role="radiogroup" aria-label="Modelo">
            {(Object.keys(MODELOS_MINIATURA) as ModeloMiniatura[]).map((m) => (
              <label key={m} className={`opcao${o.modelo === m ? ' selecionada' : ''}`}>
                <input type="radio" name="modelo-miniatura" checked={o.modelo === m} onChange={() => setO({ ...o, modelo: m })} />
                <div>
                  <div className="opcao-titulo">{MODELOS_MINIATURA[m].rotulo}</div>
                  <div className="lista-meta">{MODELOS_MINIATURA[m].dica}</div>
                </div>
              </label>
            ))}
          </div>
          <div className="form-grade">
            <Campo rotulo="Cor do texto">
              <select className="entrada" value={o.cor} onChange={(e) => setO({ ...o, cor: e.target.value as CorMiniatura })}>
                {(Object.keys(CORES_MINIATURA) as CorMiniatura[]).map((c) => (
                  <option key={c} value={c}>
                    {CORES_MINIATURA[c].rotulo}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo rotulo="Fonte">
              <select className="entrada" value={o.fonte} onChange={(e) => setO({ ...o, fonte: e.target.value as FonteMiniatura })}>
                {(Object.keys(FONTES_MINIATURA) as FonteMiniatura[]).map((f) => (
                  <option key={f} value={f}>
                    {FONTES_MINIATURA[f].rotulo}
                  </option>
                ))}
              </select>
            </Campo>
          </div>
          <label className="checkbox">
            <input type="checkbox" checked={o.maiusculas} onChange={(e) => setO({ ...o, maiusculas: e.target.checked })} />
            Texto em maiúsculas
          </label>
          <Ajuda titulo="Dicas para uma boa miniatura">
            <ul>
              <li>Uma ideia só: um rosto ou objeto grande e poucas palavras legíveis no celular.</li>
              <li>Contraste alto entre texto e fundo; o modelo “Faixa escura” resolve a maioria dos casos.</li>
              <li>A miniatura deve corresponder ao conteúdo: imagens ou promessas enganosas violam as regras do YouTube.</li>
              <li>Se usar imagem de terceiros, confira a licença; a origem fica registrada na biblioteca.</li>
            </ul>
          </Ajuda>
        </div>
      </div>
    </Dialogo>
  )
}
