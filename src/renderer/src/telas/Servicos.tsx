import { useState } from 'react'
import { chamar, mensagemDeErro, useDados } from '../api'
import { useRetorno } from '../componentes/retorno'
import { Alerta, Campo, Carregando, Dialogo, ErroCarregar, Etiqueta, Secao, Vazio, formatarData } from '../componentes/ui'
import { ADAPTADORES_LLM, INFO_ADAPTADOR, ROTULO_CATEGORIA, ROTULO_MODO, ROTULO_TAREFA, type AdaptadorLlm, type PoliticaIa, type ProvedorIaConfig } from '@shared/ia'
import { CATALOGO_IA, type ItemCatalogoIa } from '@shared/catalogoIa'
import type { CentralServicos, ProvedorIa } from '@shared/tipos'
import { GuiaOllama } from '../componentes/guias'
import { BotaoRapido, InstalarOllama } from '../componentes/rapido'

/** Central de serviços e custos (Etapa 10). */
export function Servicos() {
  const dados = useDados(() => chamar('ia:central'), [])
  if (dados.erro) return <ErroCarregar mensagem={dados.erro} tentarNovamente={dados.recarregar} />
  if (!dados.dados) return <Carregando />
  return <ServicosCarregado key={JSON.stringify(dados.dados.politica)} c={dados.dados} recarregar={dados.recarregar} />
}

function ServicosCarregado({ c, recarregar }: { c: CentralServicos; recarregar: () => void }) {
  const { avisar, avisarErro, confirmar } = useRetorno()
  const [pol, setPol] = useState<PoliticaIa>(c.politica)
  const [editando, setEditando] = useState<ProvedorIa | 'novo' | null>(null)
  const [chave, setChave] = useState<ProvedorIa | null>(null)
  const alterada = JSON.stringify(pol) !== JSON.stringify(c.politica)
  const executarSeguro = async (fn: () => Promise<void>): Promise<void> => {
    try {
      await fn()
      recarregar()
    } catch (e) {
      avisarErro(mensagemDeErro(e))
    }
  }
  const num = (v: string): number | null => (v === '' ? null : Math.max(0, Number(v) || 0))

  return (
    <>
      {!c.cofreDisponivel && <Alerta tipo="erro">A criptografia do Windows não está disponível: não será possível guardar chaves.</Alerta>}
      <Secao titulo="Configuração rápida">
        <div className="acoes">
          <BotaoRapido acao="ia_hibrido" primario aoConcluir={recarregar}>
            Ligar IA híbrida recomendada (1 clique)
          </BotaoRapido>
          <BotaoRapido acao="ia_local" aoConcluir={recarregar}>
            Somente local
          </BotaoRapido>
        </div>
        <p className="secundario pequeno" style={{ marginBottom: 0 }}>
          Híbrida recomendada: o app escolhe entre o PC e as IAs gratuitas, usa as gratuitas sem pedir autorização a cada envio, faz a revisão interna sozinha com outra IA e mantém as pagas bloqueadas (teto zero).
        </p>
        <InstalarOllama aoConcluir={recarregar} />
      </Secao>
      <GuiaOllama />
      <Secao titulo="Política de uso e custos">
        <div className="form-grade">
          <Campo rotulo="Modo de operação">
            <select className="entrada" value={pol.modo} onChange={(e) => setPol({ ...pol, modo: e.target.value as PoliticaIa['modo'] })}>
              {(Object.keys(ROTULO_MODO) as PoliticaIa['modo'][]).map((m) => (
                <option key={m} value={m}>
                  {ROTULO_MODO[m]}
                </option>
              ))}
            </select>
          </Campo>
          <Campo rotulo="Moeda dos preços">
            <select className="entrada" value={pol.moeda} onChange={(e) => setPol({ ...pol, moeda: e.target.value as PoliticaIa['moeda'] })}>
              <option value="USD">US$ (dólar)</option>
              <option value="BRL">R$ (real)</option>
            </select>
          </Campo>
          <Campo rotulo="Teto mensal" ajuda="Vazio = sem teto (não recomendado). Zero bloqueia serviços pagos.">
            <input type="number" min={0} step="0.01" className="entrada" value={pol.tetoMensal ?? ''} onChange={(e) => setPol({ ...pol, tetoMensal: num(e.target.value) })} />
          </Campo>
          <Campo rotulo="Teto por execução">
            <input type="number" min={0} step="0.01" className="entrada" value={pol.tetoPorExecucao ?? ''} onChange={(e) => setPol({ ...pol, tetoPorExecucao: num(e.target.value) })} />
          </Campo>
        </div>
        <p className="secundario pequeno" style={{ marginBottom: 0 }}>
          <strong>Híbrido</strong> é o recomendado: o aplicativo decide sozinho qual IA usar em cada tarefa (o PC com Ollama ou as IAs gratuitas cadastradas), na ordem de prioridade, e pula as que estão sem cota. IAs pagas só são usadas quando você escolhe e autoriza.
        </p>
        <div className="acoes" style={{ marginTop: 12 }}>
          <label className="checkbox">
            <input type="checkbox" checked={pol.gratuitosAutomaticos} onChange={(e) => setPol({ ...pol, gratuitosAutomaticos: e.target.checked })} />
            Usar IAs gratuitas automaticamente (sem pedir autorização a cada envio)
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={pol.revisaoInterna.automatica} onChange={(e) => setPol({ ...pol, revisaoInterna: { ...pol.revisaoInterna, automatica: e.target.checked } })} />
            Revisão interna automática depois de gerar
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={pol.revisaoInterna.outroModelo} onChange={(e) => setPol({ ...pol, revisaoInterna: { ...pol.revisaoInterna, outroModelo: e.target.checked } })} />
            A IA que revisa deve ser diferente da que escreveu
          </label>
        </div>
        {pol.gratuitosAutomaticos && pol.modo === 'local' && <Alerta>Com o modo “somente local”, as IAs gratuitas online não são usadas. Escolha “Híbrido”.</Alerta>}
        <div className="acoes" style={{ marginTop: 12 }}>
          {(['tts', 'imagem', 'video'] as const).map((k) => (
            <label key={k} className="checkbox">
              <input type="checkbox" checked={pol.recursosCaros[k]} onChange={(e) => setPol({ ...pol, recursosCaros: { ...pol.recursosCaros, [k]: e.target.checked } })} />
              Permitir {k === 'tts' ? 'narração (TTS)' : k === 'imagem' ? 'geração de imagem' : 'geração de vídeo'}
            </label>
          ))}
          <span style={{ flex: 1 }} />
          <button
            className="botao primario"
            disabled={!alterada}
            onClick={() =>
              void executarSeguro(async () => {
                await chamar('ia:salvarPolitica', pol)
                avisar('Política salva.')
              })
            }
          >
            Salvar política
          </button>
        </div>
        <p className="secundario pequeno" style={{ marginTop: 8 }}>
          Gasto aproximado neste mês: {c.gastoMes.toFixed(4)} {c.politica.moeda}
          {c.chamadasSemCustoEstimadoNoMes > 0 && ` · ${c.chamadasSemCustoEstimadoNoMes} chamada(s) sem custo estimável`}. Valores são estimativas; confira a fatura do fornecedor.
        </p>
      </Secao>

      <Rotas c={c} />
      <CatalogoGratuito c={c} aoAdicionar={recarregar} />

      <Secao
        titulo="IAs cadastradas"
        acoes={
          <button className="botao pequeno" onClick={() => setEditando('novo')}>
            Adicionar manualmente
          </button>
        }
      >
        <p className="secundario pequeno" style={{ marginTop: 0 }}>
          A ordem (prioridade 1 = primeira) define quem o aplicativo tenta primeiro. Se uma IA atingir o limite do fornecedor, ela entra em pausa sozinha e a próxima assume.
        </p>
        {c.provedores.length === 0 && <Vazio compacto titulo="Nenhum provedor" texto="A biblioteca e o modo estruturado funcionam sem IA. Para testar o fluxo de IA sem custo, adicione o adaptador “Simulado”." />}
        <ul className="lista">
          {c.provedores.map((p) => (
            <li key={p.id} className="lista-item">
              <div className="lista-principal">
                <div className="lista-titulo">
                  <Etiqueta>{p.config.prioridade}º</Etiqueta> {p.config.nome} {p.config.adaptador === 'simulado' && <Etiqueta cor="amarela">SIMULADO</Etiqueta>} {p.config.gratuito && !p.local && <Etiqueta cor="verde">Gratuita</Etiqueta>}{' '}
                  {p.local && p.config.adaptador !== 'simulado' && <Etiqueta cor="azul">No PC</Etiqueta>} {p.pausadoAte && <Etiqueta cor="amarela">Em pausa</Etiqueta>}
                </div>
                <div className="lista-meta">
                  <span>Faz: {[p.config.papeis.escrever && 'escrever', p.config.papeis.revisar && 'revisar'].filter(Boolean).join(' e ') || 'nada (nenhum papel marcado)'}</span>
                  <span>
                    · uso hoje {p.usoHoje}
                    {p.config.limiteDiario !== null ? ` de ${p.config.limiteDiario}` : ''}
                  </span>
                </div>
                {p.pausadoAte && (
                  <div className="pequeno" style={{ color: 'var(--amarelo)' }}>
                    Em pausa até {formatarData(p.pausadoAte, true)}: {p.ultimoErro}{' '}
                    <button className="botao pequeno fantasma" onClick={() => void executarSeguro(() => chamar('ia:reativar', { id: p.id }).then(() => undefined))}>
                      Reativar agora
                    </button>
                  </div>
                )}
                {!p.pausadoAte && !p.ativo && p.ultimoErro && <div className="pequeno" style={{ color: 'var(--vermelho-suave)' }}>{p.ultimoErro}</div>}
                <div className="lista-meta">
                  <span>{INFO_ADAPTADOR[p.config.adaptador].nome}</span>
                  {p.config.modelo && <span>· modelo {p.config.modelo}</span>}
                  <span>· {p.local ? 'local (nada sai do computador)' : 'online'}</span>
                  {!p.local && (
                    <span>
                      · preço {p.config.precoEntradaPorMilhao ?? '?'} / {p.config.precoSaidaPorMilhao ?? '?'} por milhão de tokens (entrada/saída)
                    </span>
                  )}
                  <span>· última utilização {formatarData(p.ultimaUtilizacao, true)}</span>
                </div>
                {p.config.limitesConhecidos && <div className="lista-meta">Limites: {p.config.limitesConhecidos}</div>}
              </div>
              {p.exigeChave && <Etiqueta cor={p.chaveConfigurada ? 'verde' : 'vermelha'}>{p.chaveConfigurada ? 'Chave guardada' : 'Sem chave'}</Etiqueta>}
              <label className="checkbox pequeno">
                <input type="checkbox" checked={p.ativo} onChange={(e) => void executarSeguro(() => chamar('ia:ativarProvedor', { id: p.id, ativo: e.target.checked }).then(() => undefined))} />
                Ativo
              </label>
              <div className="acoes" style={{ flexWrap: 'nowrap' }}>
                <button className="botao pequeno fantasma" title="Subir na ordem" disabled={p.config.prioridade <= 1} onClick={() => void executarSeguro(() => chamar('ia:salvarProvedor', { id: p.id, config: { ...p.config, prioridade: p.config.prioridade - 1 } }).then(() => undefined))}>
                  ↑
                </button>
                <button className="botao pequeno fantasma" title="Descer na ordem" disabled={p.config.prioridade >= 99} onClick={() => void executarSeguro(() => chamar('ia:salvarProvedor', { id: p.id, config: { ...p.config, prioridade: p.config.prioridade + 1 } }).then(() => undefined))}>
                  ↓
                </button>
                <button
                  className="botao pequeno"
                  onClick={() =>
                    void executarSeguro(async () => {
                      const r = await chamar('ia:testarProvedor', { id: p.id })
                      avisar(r.mensagem)
                    })
                  }
                >
                  Testar
                </button>
                {p.exigeChave && (
                  <button className="botao pequeno fantasma" onClick={() => setChave(p)}>
                    Chave
                  </button>
                )}
                <button className="botao pequeno fantasma" onClick={() => setEditando(p)}>
                  Editar
                </button>
                <button
                  className="botao pequeno fantasma"
                  onClick={() =>
                    void executarSeguro(async () => {
                      if (!(await confirmar({ titulo: 'Remover provedor?', texto: `“${p.config.nome}” será removido e a chave apagada do cofre.`, confirmar: 'Remover', perigo: true }))) return
                      await chamar('ia:removerProvedor', { id: p.id })
                    })
                  }
                >
                  Remover
                </button>
              </div>
            </li>
          ))}
        </ul>
      </Secao>

      <Secao titulo="Outras categorias de serviço">
        <ul className="lista">
          {c.categorias
            .filter((x) => x.categoria !== 'llm')
            .map((x) => (
              <li key={x.categoria} className="lista-item">
                <div className="lista-principal">
                  <div className="lista-titulo">{ROTULO_CATEGORIA[x.categoria]}</div>
                  <div className="lista-meta">{x.mensagem}</div>
                </div>
                <Etiqueta>Não disponível</Etiqueta>
              </li>
            ))}
        </ul>
      </Secao>

      <Secao titulo="Uso recente">
        {c.usoRecente.length === 0 && <Vazio compacto titulo="Nenhum uso registrado" />}
        <div className="tabela-wrap">
          <table>
            {c.usoRecente.length > 0 && (
              <thead>
                <tr>
                  <th>Quando</th>
                  <th>Provedor</th>
                  <th>Finalidade</th>
                  <th>Tokens (entrada/saída)</th>
                  <th>Custo aprox.</th>
                  <th>Resultado</th>
                </tr>
              </thead>
            )}
            <tbody>
              {c.usoRecente.map((u, i) => (
                <tr key={i}>
                  <td>{formatarData(u.criadoEm, true)}</td>
                  <td>{u.provedor}</td>
                  <td className="td-titulo">{u.finalidade}</td>
                  <td>
                    {u.tokensEntrada ?? '?'} / {u.tokensSaida ?? '?'}
                  </td>
                  <td>{u.custo === null ? 'não estimável' : `${u.custo.toFixed(4)} ${u.moeda}`}</td>
                  <td>
                    <Etiqueta cor={u.sucesso ? 'verde' : 'vermelha'}>{u.sucesso ? 'OK' : 'Erro'}</Etiqueta>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Secao>
      {editando && <EditarProvedor p={editando === 'novo' ? null : editando} aoFechar={(ok) => { setEditando(null); if (ok) recarregar() }} />}
      {chave && <DialogoChave p={chave} aoFechar={(ok) => { setChave(null); if (ok) recarregar() }} />}
    </>
  )
}

function EditarProvedor({ p, aoFechar }: { p: ProvedorIa | null; aoFechar: (ok: boolean) => void }) {
  const { avisarErro } = useRetorno()
  const [c, setC] = useState<ProvedorIaConfig>(
    p?.config ?? {
      nome: 'Simulado (teste)',
      adaptador: 'simulado',
      urlBase: '',
      modelo: '',
      precoEntradaPorMilhao: null,
      precoSaidaPorMilhao: null,
      maxTokensSaida: 3000,
      limitesConhecidos: '',
      gratuito: false,
      prioridade: 10,
      papeis: { escrever: true, revisar: true },
      limiteDiario: null,
      catalogo: null,
      modelosReserva: []
    }
  )
  const modelos = useDados(() => (p && p.config.adaptador !== 'simulado' ? chamar('ia:modelos', { id: p.id }) : Promise.resolve([] as string[])), [p?.id])
  const info = INFO_ADAPTADOR[c.adaptador]
  const num = (v: string): number | null => (v === '' ? null : Math.max(0, Number(v) || 0))
  return (
    <Dialogo
      aberto
      largo
      aoFechar={() => aoFechar(false)}
      titulo={p ? 'Editar provedor' : 'Adicionar provedor'}
      acoes={
        <>
          <button className="botao fantasma" onClick={() => aoFechar(false)}>
            Cancelar
          </button>
          <button
            className="botao primario"
            disabled={!c.nome.trim()}
            onClick={async () => {
              try {
                await chamar('ia:salvarProvedor', { id: p?.id ?? null, config: c })
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
        <Campo rotulo="Tipo">
          <select
            className="entrada"
            value={c.adaptador}
            disabled={p !== null}
            onChange={(e) => {
              const a = e.target.value as AdaptadorLlm
              setC({ ...c, adaptador: a, nome: INFO_ADAPTADOR[a].nome, urlBase: INFO_ADAPTADOR[a].urlPadrao })
            }}
          >
            {ADAPTADORES_LLM.map((a) => (
              <option key={a} value={a}>
                {INFO_ADAPTADOR[a].nome}
              </option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="Nome">
          <input className="entrada" value={c.nome} onChange={(e) => setC({ ...c, nome: e.target.value })} maxLength={80} />
        </Campo>
      </div>
      <p className="secundario pequeno" style={{ margin: '8px 0' }}>
        {info.descricao}
      </p>
      {c.adaptador !== 'simulado' && (
        <div className="form-grade">
          <Campo rotulo="Endereço da API" ajuda={info.local ? 'Somente 127.0.0.1 ou localhost.' : 'Somente https://. Ex.: https://api.fornecedor.com/v1'}>
            <input className="entrada" value={c.urlBase} onChange={(e) => setC({ ...c, urlBase: e.target.value })} maxLength={300} />
          </Campo>
          <Campo rotulo="Modelo" ajuda={modelos.dados?.length ? `${modelos.dados.length} modelo(s) disponíveis agora no fornecedor.` : 'Nome exato do modelo no fornecedor.'}>
            {modelos.dados?.length ? (
              <select className="entrada" value={c.modelo} onChange={(e) => setC({ ...c, modelo: e.target.value })}>
                {!modelos.dados.includes(c.modelo) && <option value={c.modelo}>{c.modelo || '(escolha)'}</option>}
                {modelos.dados.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            ) : (
              <input className="entrada" value={c.modelo} onChange={(e) => setC({ ...c, modelo: e.target.value })} maxLength={120} />
            )}
          </Campo>
          <Campo rotulo="Máximo de tokens de saída">
            <input type="number" min={64} max={32000} className="entrada" value={c.maxTokensSaida} onChange={(e) => setC({ ...c, maxTokensSaida: Math.min(32000, Math.max(64, Number(e.target.value) || 64)) })} />
          </Campo>
          {!info.local && (
            <>
              <Campo rotulo="Preço por milhão de tokens de entrada" ajuda="Confira no site do fornecedor. Vazio = custo não estimável.">
                <input type="number" min={0} step="0.0001" className="entrada" value={c.precoEntradaPorMilhao ?? ''} onChange={(e) => setC({ ...c, precoEntradaPorMilhao: num(e.target.value) })} />
              </Campo>
              <Campo rotulo="Preço por milhão de tokens de saída">
                <input type="number" min={0} step="0.0001" className="entrada" value={c.precoSaidaPorMilhao ?? ''} onChange={(e) => setC({ ...c, precoSaidaPorMilhao: num(e.target.value) })} />
              </Campo>
            </>
          )}
          <Campo rotulo="Limites conhecidos (anotação)">
            <input className="entrada" value={c.limitesConhecidos} onChange={(e) => setC({ ...c, limitesConhecidos: e.target.value })} maxLength={500} placeholder="Ex.: 60 pedidos por minuto" />
          </Campo>
        </div>
      )}
      <h3 style={{ marginTop: 16 }}>Uso automático (modo híbrido)</h3>
      <div className="form-grade">
        <Campo rotulo="Prioridade" ajuda="1 = tentada primeiro.">
          <input type="number" min={1} max={99} className="entrada" value={c.prioridade} onChange={(e) => setC({ ...c, prioridade: Math.min(99, Math.max(1, Number(e.target.value) || 1)) })} />
        </Campo>
        <Campo rotulo="Limite diário de chamadas (seu)" ajuda="Vazio = sem limite próprio. O app também pausa sozinho quando o fornecedor avisa que a cota acabou.">
          <input type="number" min={1} className="entrada" value={c.limiteDiario ?? ''} onChange={(e) => setC({ ...c, limiteDiario: e.target.value === '' ? null : Math.max(1, Number(e.target.value) || 1) })} />
        </Campo>
      </div>
      <div className="acoes" style={{ marginTop: 8 }}>
        <label className="checkbox">
          <input type="checkbox" checked={c.papeis.escrever} onChange={(e) => setC({ ...c, papeis: { ...c.papeis, escrever: e.target.checked } })} />
          Pode escrever roteiros
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={c.papeis.revisar} onChange={(e) => setC({ ...c, papeis: { ...c.papeis, revisar: e.target.checked } })} />
          Pode fazer a revisão interna
        </label>
        {!info.local && (
          <label className="checkbox">
            <input type="checkbox" checked={c.gratuito} onChange={(e) => setC({ ...c, gratuito: e.target.checked })} />
            Camada gratuita (custo zero)
          </label>
        )}
      </div>
    </Dialogo>
  )
}

function DialogoChave({ p, aoFechar }: { p: ProvedorIa; aoFechar: (ok: boolean) => void }) {
  const { avisar, avisarErro } = useRetorno()
  const [chave, setChave] = useState('')
  const salvar = async (valor: string | null): Promise<void> => {
    try {
      await chamar('ia:definirChave', { id: p.id, chave: valor })
      avisar(valor ? 'Chave guardada no cofre criptografado.' : 'Chave removida.')
      aoFechar(true)
    } catch (e) {
      avisarErro(mensagemDeErro(e))
    }
  }
  return (
    <Dialogo
      aberto
      aoFechar={() => aoFechar(false)}
      titulo={`Chave de “${p.config.nome}”`}
      acoes={
        <>
          {p.chaveConfigurada && (
            <button className="botao perigo" onClick={() => void salvar(null)}>
              Remover chave
            </button>
          )}
          <button className="botao fantasma" onClick={() => aoFechar(false)}>
            Cancelar
          </button>
          <button className="botao primario" disabled={chave.trim().length < 8} onClick={() => void salvar(chave)}>
            Guardar
          </button>
        </>
      }
    >
      <p className="secundario pequeno">
        A chave é criptografada pelo Windows e guardada fora do banco. Ela nunca é exibida de novo, não vai para os registros e só é usada no momento da chamada.
      </p>
      <Campo rotulo="Chave da API">
        <input type="password" autoComplete="off" spellCheck={false} className="entrada" value={chave} onChange={(e) => setChave(e.target.value)} maxLength={500} autoFocus />
      </Campo>
    </Dialogo>
  )
}

/** Como o roteador está decidindo agora: a ordem de cada tarefa e quem ficou de fora (e por quê). */
function Rotas({ c }: { c: CentralServicos }) {
  return (
    <Secao titulo="Como o aplicativo decide agora">
      <div className="painel-grade">
        {c.rotas.map((r) => (
          <div key={r.tarefa} className="cartao-suave">
            <strong>{ROTULO_TAREFA[r.tarefa]}</strong>
            {r.ordem.length === 0 ? (
              <p className="secundario pequeno">
                Nenhuma IA disponível: {r.tarefa === 'escrever' ? 'o roteiro é montado no modo estruturado (sem IA).' : 'a revisão interna usa só as regras fixas.'}
              </p>
            ) : (
              <ol className="pequeno" style={{ paddingLeft: 18, margin: '6px 0' }}>
                {r.ordem.map((o, i) => (
                  <li key={o.id}>
                    {o.nome} {o.local ? '(no PC)' : '(online)'} {i === 0 ? '← usada primeiro' : '← reserva'}
                  </li>
                ))}
              </ol>
            )}
            {r.descartados.length > 0 && (
              <details className="pequeno secundario">
                <summary>{r.descartados.length} fora da escolha automática</summary>
                <ul style={{ paddingLeft: 18, margin: '4px 0' }}>
                  {r.descartados.map((d) => (
                    <li key={d.nome}>
                      {d.nome}: {d.motivo}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        ))}
      </div>
    </Secao>
  )
}

/** Catálogo de IAs gratuitas: cole a chave e o app conecta, escolhe o modelo e coloca na fila. */
function CatalogoGratuito({ c, aoAdicionar }: { c: CentralServicos; aoAdicionar: () => void }) {
  const cadastrados = new Set(c.provedores.map((p) => p.config.catalogo).filter(Boolean))
  return (
    <Secao titulo="IAs gratuitas: adicionar">
      <p className="secundario pequeno" style={{ marginTop: 0 }}>
        Cadastre quantas quiser: quanto mais IAs, menos o canal para quando uma delas atinge o limite do dia. Crie a chave no site do fornecedor (botão “Criar chave”), cole aqui e clique em Conectar: o aplicativo testa, escolhe um modelo atual e coloca a IA na fila. As chaves vão para o cofre criptografado do Windows.
      </p>
      <div className="painel-grade">
        {CATALOGO_IA.map((item) => (
          <ItemCatalogo key={item.id} item={item} cadastrado={cadastrados.has(item.id)} aoAdicionar={aoAdicionar} />
        ))}
      </div>
    </Secao>
  )
}

export function ItemCatalogo({ item, cadastrado, aoAdicionar }: { item: ItemCatalogoIa; cadastrado: boolean; aoAdicionar: () => void }) {
  // A IA do PC tem um fluxo próprio de 1 clique (instala, abre, baixa o modelo e cadastra).
  if (item.adaptador === 'ollama') return <InstalarOllama aoConcluir={aoAdicionar} />
  return <ItemCatalogoOnline item={item} cadastrado={cadastrado} aoAdicionar={aoAdicionar} />
}

function ItemCatalogoOnline({ item, cadastrado, aoAdicionar }: { item: ItemCatalogoIa; cadastrado: boolean; aoAdicionar: () => void }) {
  const { avisar, avisarErro } = useRetorno()
  const [chave, setChave] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const local = item.adaptador === 'ollama'
  const conectar = async (): Promise<void> => {
    setOcupado(true)
    try {
      const r = await chamar('ia:adicionarCatalogo', { catalogo: item.id, chave: local ? null : chave })
      if (r.modelos.length) avisar(r.mensagem)
      else avisarErro(r.mensagem)
      setChave('')
      aoAdicionar()
    } catch (e) {
      avisarErro(mensagemDeErro(e))
    } finally {
      setOcupado(false)
    }
  }
  return (
    <div className="cartao-suave">
      <div className="lista-titulo">
        {item.nome} {cadastrado && <Etiqueta cor="verde">Cadastrada</Etiqueta>} {local && <Etiqueta cor="azul">No PC</Etiqueta>}
      </div>
      <p className="secundario pequeno" style={{ margin: '4px 0' }}>{item.resumo}</p>
      <p className="secundario pequeno" style={{ margin: '4px 0' }}>
        <strong>Limites:</strong> {item.limites} <strong>Privacidade:</strong> {item.privacidade}
      </p>
      <div className="acoes" style={{ marginTop: 6 }}>
        <a className="botao pequeno link-passo" href={item.urlChave} target="_blank" rel="noreferrer">
          {local ? 'Baixar o Ollama ↗' : 'Criar chave ↗'}
        </a>
        {!local && (
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            className="entrada"
            style={{ flex: 1, minWidth: 160 }}
            placeholder={cadastrado ? 'Nova chave (para trocar)' : 'Cole a chave aqui'}
            value={chave}
            onChange={(e) => setChave(e.target.value)}
            maxLength={500}
            aria-label={`Chave de ${item.nome}`}
          />
        )}
        <button className="botao primario pequeno" disabled={ocupado || (!local && chave.trim().length < 8)} onClick={() => void conectar()}>
          {ocupado ? 'Conectando…' : cadastrado ? (local ? 'Detectar de novo' : 'Trocar chave') : local ? 'Detectar no PC' : 'Conectar'}
        </button>
      </div>
    </div>
  )
}
