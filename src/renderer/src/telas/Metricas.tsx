import { useState } from 'react'
import { chamar, mensagemDeErro, useDados } from '../api'
import { useRetorno } from '../componentes/retorno'
import { Alerta, Cabecalho, Campo, Carregando, ErroCarregar, Etiqueta, Secao, Vazio, formatarData, formatarDuracao } from '../componentes/ui'
import type { TipoVideo } from '@shared/dominio'

const n = (v: number | null, dec = 0): string => (v === null ? '—' : v.toLocaleString('pt-BR', { maximumFractionDigits: dec }))

export function Metricas() {
  const { avisar, avisarErro } = useRetorno()
  const [filtro, setFiltro] = useState<{ de: string | null; ate: string | null; tipo: TipoVideo | null }>({ de: null, ate: null, tipo: null })
  const painel = useDados(() => chamar('metricas:painel', filtro), [filtro])
  const yt = useDados(() => chamar('youtube:painel'), [])
  const temPermissao = yt.dados?.status.escopos.some((e) => e.escopo.includes('yt-analytics')) ?? false
  const [trafego, setTrafego] = useState<{ fonte: string; visualizacoes: number }[] | null>(null)

  return (
    <>
      <Cabecalho
        titulo="Métricas"
        descricao="Somente dados disponíveis pela API oficial para a conta autorizada."
        acoes={
          <button
            className="botao primario"
            disabled={!temPermissao}
            title={!temPermissao ? 'Conecte a conta com a permissão de métricas em Publicações' : undefined}
            onClick={async () => {
              try {
                const r = await chamar('metricas:coletar')
                avisar(`${r.coletados} vídeo(s) atualizados.`)
                painel.recarregar()
              } catch (e) {
                avisarErro(mensagemDeErro(e))
              }
            }}
          >
            Atualizar métricas
          </button>
        }
      />
      {yt.dados && yt.dados.status.estado !== 'conectado' && <Alerta>Conta do YouTube não conectada: não há métricas a exibir. Conecte em Publicações.</Alerta>}
      {yt.dados?.status.estado === 'conectado' && !temPermissao && <Alerta>A conta foi conectada sem a permissão de métricas. Para ver dados, desconecte e conecte de novo marcando “Incluir permissão de métricas”.</Alerta>}
      <div className="filtros">
        <Campo rotulo="Publicados de">
          <input type="date" className="entrada" value={filtro.de ?? ''} onChange={(e) => setFiltro({ ...filtro, de: e.target.value || null })} />
        </Campo>
        <Campo rotulo="Até">
          <input type="date" className="entrada" value={filtro.ate ?? ''} onChange={(e) => setFiltro({ ...filtro, ate: e.target.value || null })} />
        </Campo>
        <Campo rotulo="Formato">
          <select className="entrada" value={filtro.tipo ?? ''} onChange={(e) => setFiltro({ ...filtro, tipo: (e.target.value || null) as TipoVideo | null })}>
            <option value="">Todos</option>
            <option value="longo">Vídeos longos</option>
            <option value="short">Shorts</option>
          </select>
        </Campo>
      </div>
      <Secao titulo="Vídeos publicados">
        {painel.erro && <ErroCarregar mensagem={painel.erro} tentarNovamente={painel.recarregar} />}
        {painel.carregando && !painel.dados && <Carregando />}
        {painel.dados?.linhas.length === 0 && <Vazio compacto titulo="Nenhum vídeo publicado por este aplicativo" />}
        {painel.dados && painel.dados.linhas.length > 0 && (
          <div className="tabela-wrap">
            <table>
              <thead>
                <tr>
                  <th>Vídeo</th>
                  <th>Formato</th>
                  <th>Dias publicado</th>
                  <th>Visualizações</th>
                  <th>Minutos assistidos</th>
                  <th>Duração média</th>
                  <th>% assistido</th>
                  <th>Inscritos</th>
                  <th>× mediana do formato</th>
                  <th>Custo IA aprox.</th>
                </tr>
              </thead>
              <tbody>
                {painel.dados.linhas.map((l) => (
                  <tr key={l.publicacaoId}>
                    <td className="td-titulo">
                      {l.videoUrl ? (
                        <a href={l.videoUrl} target="_blank" rel="noreferrer noopener">
                          {l.titulo}
                        </a>
                      ) : (
                        l.titulo
                      )}
                      <div className="lista-meta">{l.coletadoEm ? `dados de ${formatarData(l.coletadoEm, true)}` : 'sem dados coletados'}</div>
                    </td>
                    <td>{l.tipoVideo === 'short' ? 'Short' : 'Longo'}</td>
                    <td>{l.diasDesdePublicacao ?? '—'}</td>
                    <td>{n(l.visualizacoes)}</td>
                    <td>{n(l.minutosAssistidos)}</td>
                    <td>{l.duracaoMediaSeg === null ? '—' : formatarDuracao(Math.round(l.duracaoMediaSeg))}</td>
                    <td>{n(l.percentualMedio, 1)}</td>
                    <td>{n(l.inscritosGanhos)}</td>
                    <td>{l.relacaoComMediana === null ? '—' : `${l.relacaoComMediana.toFixed(2)}×`}</td>
                    <td>{l.custoEstimado === null ? '—' : l.custoEstimado.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="secundario pequeno">
              Amostra: {painel.dados.amostra.longo} vídeo(s) longo(s) e {painel.dados.amostra.short} Short(s). Impressões e taxa de cliques: indisponíveis pela API pública.
            </p>
          </div>
        )}
      </Secao>
      <Secao
        titulo="Fontes de tráfego"
        acoes={
          <button
            className="botao pequeno"
            disabled={!temPermissao}
            onClick={async () => {
              const ate = new Date().toISOString().slice(0, 10)
              const de = new Date(Date.now() - 28 * 86_400_000).toISOString().slice(0, 10)
              try {
                setTrafego(await chamar('metricas:trafego', { de, ate }))
              } catch (e) {
                avisarErro(mensagemDeErro(e))
              }
            }}
          >
            Consultar últimos 28 dias
          </button>
        }
      >
        {trafego === null ? <p className="secundario pequeno">Consulta sob demanda (consome cota da API de Analytics).</p> : trafego.length === 0 ? <Vazio compacto titulo="Sem dados" /> : (
          <ul className="lista">
            {trafego.map((t) => (
              <li key={t.fonte} className="lista-item">
                <div className="lista-principal">{t.fonte}</div>
                <strong>{n(t.visualizacoes)}</strong>
              </li>
            ))}
          </ul>
        )}
      </Secao>
      <RelatoriosSemanais />
      {painel.dados && (
        <Secao titulo="Limitações dos dados">
          <ul className="secundario">
            {painel.dados.limitacoes.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </Secao>
      )}
    </>
  )
}

function RelatoriosSemanais() {
  const { avisar, avisarErro } = useRetorno()
  const lista = useDados(() => chamar('metricas:relatorios'), [])
  const [aberto, setAberto] = useState<number | null>(null)
  const rel = useDados(() => (aberto ? chamar('metricas:relatorio', { id: aberto }) : Promise.resolve(null)), [aberto])
  const executarSeguro = async (fn: () => Promise<unknown>, msg?: string): Promise<void> => {
    try {
      await fn()
      if (msg) avisar(msg)
      rel.recarregar()
      lista.recarregar()
    } catch (e) {
      avisarErro(mensagemDeErro(e))
    }
  }
  return (
    <Secao
      titulo="Relatório semanal"
      acoes={
        <button
          className="botao pequeno primario"
          onClick={() =>
            void executarSeguro(async () => {
              const r = await chamar('metricas:gerarRelatorio', { dataReferencia: new Date(Date.now() - 7 * 86_400_000).toLocaleDateString('sv-SE') })
              setAberto(r.id)
            }, 'Relatório gerado.')
          }
        >
          Gerar relatório da semana passada
        </button>
      }
    >
      <p className="secundario pequeno">As recomendações entram como sugestões para sua aprovação. Nada muda automaticamente no calendário ou na linha editorial.</p>
      <div className="chips" style={{ margin: '8px 0' }}>
        {lista.dados?.map((r) => (
          <button key={r.id} className="chip" aria-pressed={aberto === r.id} onClick={() => setAberto(r.id)}>
            Semana de {formatarData(r.semanaInicio)}
          </button>
        ))}
      </div>
      {rel.dados && (
        <>
          <h3>
            {formatarData(rel.dados.conteudo.semana.inicio)} a {formatarData(rel.dados.conteudo.semana.fim)}
          </h3>
          <p>
            <strong>Publicados:</strong> {rel.dados.conteudo.publicados.length ? rel.dados.conteudo.publicados.map((p) => p.titulo).join('; ') : 'nenhum'}
          </p>
          <ul className="secundario">
            {rel.dados.conteudo.observacoes.map((o) => (
              <li key={o}>{o}</li>
            ))}
          </ul>
          <p className="secundario pequeno">
            Serviços na semana: {rel.dados.conteudo.custos.chamadas} chamada(s), custo aproximado {rel.dados.conteudo.custos.valor.toFixed(4)}.
          </p>
          <h3>Sugestões</h3>
          {rel.dados.sugestoes.length === 0 && <p className="secundario pequeno">Nenhuma sugestão com os dados disponíveis.</p>}
          <ul className="lista">
            {rel.dados.sugestoes.map((s) => (
              <li key={s.id} className="lista-item">
                <div className="lista-principal">{s.texto}</div>
                {s.status === 'pendente' ? (
                  <>
                    <button className="botao pequeno" onClick={() => void executarSeguro(() => chamar('metricas:decidir', { id: s.id, aceita: true }), 'Sugestão aceita (registrada).')}>
                      Aceitar
                    </button>
                    <button className="botao pequeno fantasma" onClick={() => void executarSeguro(() => chamar('metricas:decidir', { id: s.id, aceita: false }))}>
                      Rejeitar
                    </button>
                  </>
                ) : (
                  <Etiqueta cor={s.status === 'aceita' ? 'verde' : 'cinza'}>{s.status}</Etiqueta>
                )}
              </li>
            ))}
          </ul>
          <button
            className="botao pequeno"
            style={{ marginTop: 8 }}
            onClick={() =>
              void executarSeguro(async () => {
                const r = await chamar('metricas:exportarRelatorio', { id: rel.dados!.id })
                if (r.salvo) avisar(`Exportado: ${r.arquivo}`)
              })
            }
          >
            Exportar (Markdown)
          </button>
        </>
      )}
    </Secao>
  )
}
