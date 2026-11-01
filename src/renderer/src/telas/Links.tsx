import { useState } from 'react'
import { chamar, mensagemDeErro, useDados } from '../api'
import { Icone } from '../componentes/Icone'
import { useRetorno } from '../componentes/retorno'
import { Ajuda, Alerta, Cabecalho, Campo, Carregando, Dialogo, ErroCarregar, Etiqueta, Secao, Vazio } from '../componentes/ui'
import { CATEGORIAS_LINK, ROTULO_CATEGORIA_LINK, type CategoriaLink } from '@shared/publicacao'
import type { LinkCadastrado } from '@shared/tipos'

/** Cadastro de links usados nas descrições: redes sociais, produtos, afiliados, patrocínio, site. */
export function Links() {
  const projetos = useDados(() => chamar('projetos:listar'), [])
  const [projetoId, setProjetoId] = useState<number | null>(null)
  const pid = projetoId ?? projetos.dados?.[0]?.id ?? null
  const lista = useDados(() => chamar('links:listar', { projetoId: pid }), [pid])
  const [editando, setEditando] = useState<LinkCadastrado | 'novo' | null>(null)

  return (
    <>
      <Cabecalho
        titulo="Links e redes"
        descricao="Cadastre uma vez os links que aparecem nas descrições: redes sociais, produtos citados, links de afiliado, patrocinadores e o seu site."
        acoes={
          <button className="botao primario" onClick={() => setEditando('novo')}>
            <Icone nome="mais" tamanho={18} /> Novo link
          </button>
        }
      />
      <Ajuda titulo="Como os links entram nas descrições">
        <ul>
          <li>
            Links marcados como <strong>Incluir sempre</strong> entram automaticamente na descrição quando você prepara uma publicação. Os outros você escolhe em cada publicação, em <strong>Publicações › Descrição automática</strong>.
          </li>
          <li>Na descrição, os links ficam agrupados por tipo (Redes sociais, Produtos mencionados, Links de afiliado…).</li>
          <li>
            Se houver qualquer <strong>link de afiliado</strong>, o aviso “o canal pode receber uma comissão” é incluído automaticamente. Se houver <strong>patrocínio</strong>, o app lembra de marcar “Inclui promoção paga” no YouTube.
          </li>
          <li>Links “para todos os projetos” aparecem em qualquer canal; os outros, só no projeto escolhido.</li>
          <li>Use apenas endereços em que você confia. Links enganosos ou para conteúdo proibido violam as regras do YouTube.</li>
        </ul>
      </Ajuda>
      {projetos.dados && projetos.dados.length > 1 && (
        <div className="form-linha" style={{ marginTop: 12 }}>
          <Campo rotulo="Projeto">
            <select className="entrada" value={pid ?? ''} onChange={(e) => setProjetoId(Number(e.target.value))}>
              {projetos.dados.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
            </select>
          </Campo>
        </div>
      )}
      {lista.erro && <ErroCarregar mensagem={lista.erro} tentarNovamente={lista.recarregar} />}
      {!lista.dados && !lista.erro && <Carregando />}
      {lista.dados?.length === 0 && (
        <Secao>
          <Vazio
            titulo="Nenhum link cadastrado"
            texto="Comece pelas suas redes sociais (Instagram, TikTok, LinkedIn, X) e pelo seu site; depois cadastre os produtos que você costuma citar."
            acao={
              <button className="botao primario" onClick={() => setEditando('novo')}>
                Cadastrar o primeiro link
              </button>
            }
          />
        </Secao>
      )}
      {CATEGORIAS_LINK.map((cat) => {
        const itens = lista.dados?.filter((l) => l.categoria === cat) ?? []
        if (!itens.length) return null
        return (
          <Secao key={cat} titulo={ROTULO_CATEGORIA_LINK[cat]}>
            <ul className="lista">
              {itens.map((l) => (
                <li key={l.id} className="lista-item clicavel" onClick={() => setEditando(l)}>
                  <div className="lista-principal">
                    <div className="lista-titulo">
                      {l.nome}
                      {!l.ativo && <span className="secundario"> (desativado)</span>}
                    </div>
                    <div className="lista-meta">
                      <span>{l.url}</span>
                      {l.descricao && <span>· {l.descricao}</span>}
                    </div>
                  </div>
                  {l.padrao && <Etiqueta cor="verde">Incluir sempre</Etiqueta>}
                  {l.projetoId === null && <Etiqueta cor="azul">Todos os projetos</Etiqueta>}
                </li>
              ))}
            </ul>
          </Secao>
        )
      })}
      {editando && (
        <EditarLink
          link={editando === 'novo' ? null : editando}
          projetoId={pid}
          aoFechar={(ok) => {
            setEditando(null)
            if (ok) lista.recarregar()
          }}
        />
      )}
    </>
  )
}

const DICAS: Record<CategoriaLink, string> = {
  rede_social: 'Ex.: Instagram, TikTok, LinkedIn, X, Threads, comunidade no Discord.',
  produto: 'Produtos, ferramentas ou serviços citados no vídeo, sem comissão.',
  afiliado: 'Links com comissão (Amazon, Hotmart, programas de afiliados). O aviso de afiliado é incluído automaticamente.',
  patrocinio: 'Marca que pagou ou apoiou o vídeo. Lembre-se de marcar “Inclui promoção paga” no YouTube.',
  site: 'Seu site, newsletter, e-mail comercial (use um endereço https).',
  outro: 'Qualquer outro link útil para quem assiste.'
}

function EditarLink({ link, projetoId, aoFechar }: { link: LinkCadastrado | null; projetoId: number | null; aoFechar: (ok: boolean) => void }) {
  const { avisar, avisarErro, confirmar } = useRetorno()
  const [f, setF] = useState({
    nome: link?.nome ?? '',
    url: link?.url ?? 'https://',
    categoria: link?.categoria ?? ('rede_social' as CategoriaLink),
    descricao: link?.descricao ?? '',
    padrao: link?.padrao ?? false,
    ativo: link?.ativo ?? true,
    todos: link ? link.projetoId === null : false
  })
  const urlValida = /^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(f.url)
  return (
    <Dialogo
      aberto
      aoFechar={() => aoFechar(false)}
      titulo={link ? 'Editar link' : 'Novo link'}
      acoes={
        <>
          {link && (
            <button
              className="botao fantasma"
              onClick={async () => {
                if (!(await confirmar({ titulo: 'Excluir link?', texto: 'Ele deixa de aparecer nas próximas descrições. Descrições já salvas não mudam.', confirmar: 'Excluir', perigo: true }))) return
                try {
                  await chamar('links:remover', { id: link.id })
                  avisar('Link excluído.')
                  aoFechar(true)
                } catch (e) {
                  avisarErro(mensagemDeErro(e))
                }
              }}
            >
              Excluir
            </button>
          )}
          <button className="botao" onClick={() => aoFechar(false)}>
            Cancelar
          </button>
          <button
            className="botao primario"
            disabled={!f.nome.trim() || !urlValida}
            onClick={async () => {
              try {
                await chamar('links:salvar', { id: link?.id, projetoId: f.todos ? null : projetoId, nome: f.nome, url: f.url.trim(), categoria: f.categoria, descricao: f.descricao, padrao: f.padrao, ativo: f.ativo })
                avisar('Link salvo.')
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
        <Campo rotulo="Tipo" ajuda={DICAS[f.categoria]}>
          <select className="entrada" value={f.categoria} onChange={(e) => setF({ ...f, categoria: e.target.value as CategoriaLink })}>
            {CATEGORIAS_LINK.map((c) => (
              <option key={c} value={c}>
                {ROTULO_CATEGORIA_LINK[c]}
              </option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="Nome" ajuda="Como aparece na descrição. Ex.: “Instagram”, “Microfone que eu uso”.">
          <input className="entrada" value={f.nome} maxLength={120} onChange={(e) => setF({ ...f, nome: e.target.value })} />
        </Campo>
      </div>
      <Campo rotulo="Endereço (URL)" ajuda="Copie do navegador. Precisa começar com https:// (ou http://).">
        <input className="entrada" value={f.url} maxLength={2000} spellCheck={false} onChange={(e) => setF({ ...f, url: e.target.value })} />
      </Campo>
      {!urlValida && f.url !== 'https://' && <Alerta tipo="erro">Endereço inválido.</Alerta>}
      <Campo rotulo="Complemento (opcional)" ajuda="Aparece entre parênteses. Ex.: “cupom CANAL10”, “10% de desconto”.">
        <input className="entrada" value={f.descricao} maxLength={200} onChange={(e) => setF({ ...f, descricao: e.target.value })} />
      </Campo>
      <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
        <label className="checkbox">
          <input type="checkbox" checked={f.padrao} onChange={(e) => setF({ ...f, padrao: e.target.checked })} />
          Incluir sempre nas descrições automáticas (bom para redes sociais e site)
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={f.todos} onChange={(e) => setF({ ...f, todos: e.target.checked })} />
          Usar em todos os projetos (canais)
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={f.ativo} onChange={(e) => setF({ ...f, ativo: e.target.checked })} />
          Ativo (desmarque para pausar sem excluir, por exemplo uma promoção encerrada)
        </label>
      </div>
    </Dialogo>
  )
}
