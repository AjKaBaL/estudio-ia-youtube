import { useState } from 'react'
import { chamar, mensagemDeErro, useDados } from '../api'
import { useRetorno } from '../componentes/retorno'
import { Alerta, Campo, Dialogo, Etiqueta, formatarDuracao } from '../componentes/ui'
import { useNavegacao } from '../navegacao'
import { ROTULO_STATUS_ROTEIRO, type TipoVideo } from '@shared/dominio'
import type { PlanoEnvio } from '@shared/ia'
import { BarraProgresso } from '../componentes/progresso'
import type { PlanoGeracao, ResultadoGeracao } from '@shared/tipos'

/** Mostra exatamente o que será enviado, para onde, para quê e o custo estimado. */
export function ResumoPlano({ plano }: { plano: PlanoEnvio }) {
  return (
    <div style={{ display: 'grid', gap: 6, fontSize: 13 }}>
      <div>
        <strong>Provedor:</strong> {plano.provedorNome} {plano.adaptador === 'simulado' && <Etiqueta cor="amarela">SIMULADO</Etiqueta>} · {plano.local ? 'local' : 'online'}
      </div>
      <div>
        <strong>Destino:</strong> {plano.destino}
      </div>
      <div>
        <strong>Finalidade:</strong> {plano.finalidade}
      </div>
      <div>
        <strong>Dados enviados:</strong> {plano.dados.map((d) => `${d.rotulo} (${d.caracteres} caracteres)`).join('; ')}
      </div>
      <div>
        <strong>Tokens estimados:</strong> {plano.tokensEstimados.entrada} de entrada, até {plano.tokensEstimados.saida} de saída
      </div>
      <div>
        <strong>Custo estimado:</strong> {plano.custo.valor === null ? 'não estimável' : `${plano.custo.valor.toFixed(4)} ${plano.custo.moeda}`}
      </div>
      {plano.avisos.map((a) => (
        <Alerta key={a}>{a}</Alerta>
      ))}
      {plano.bloqueios.map((b) => (
        <Alerta key={b} tipo="erro">
          {b}
        </Alerta>
      ))}
    </div>
  )
}

/** Geração de roteiro (novo a partir de pauta aprovada, ou variação de um roteiro). */
export function DialogoGeracao({ pautaId = null, roteiroId = null, tipoInicial = 'longo', aoFechar }: { pautaId?: number | null; roteiroId?: number | null; tipoInicial?: TipoVideo; aoFechar: (r: ResultadoGeracao | null) => void }) {
  const nav = useNavegacao()
  const { avisarErro } = useRetorno()
  const central = useDados(() => chamar('ia:central'), [])
  const [tipo, setTipo] = useState<TipoVideo>(tipoInicial)
  // "auto": o app escolhe a IA (PC ou gratuitas) pela rota; "" = modo estruturado; número = provedor escolhido.
  const [escolha, setEscolha] = useState<string>('auto')
  const automatico = escolha === 'auto'
  const provedorId = automatico || escolha === '' ? null : Number(escolha)
  const [angulo, setAngulo] = useState('')
  const [plano, setPlano] = useState<PlanoGeracao | null>(null)
  const [autorizo, setAutorizo] = useState(false)
  const [gerando, setGerando] = useState(false)
  const [resultado, setResultado] = useState<ResultadoGeracao | null>(null)
  const pedido = { pautaId, roteiroId, tipo, provedorId, automatico, angulo }

  async function preparar(): Promise<void> {
    try {
      setAutorizo(false)
      setPlano(await chamar('geracao:planejar', pedido))
    } catch (e) {
      avisarErro(mensagemDeErro(e))
    }
  }

  async function gerar(): Promise<void> {
    setGerando(true)
    try {
      setResultado(await chamar('geracao:gerar', { pedido, autorizacao: plano?.plano?.exigeAutorizacao ? plano.plano.assinatura : null }))
    } catch (e) {
      avisarErro(mensagemDeErro(e))
    } finally {
      setGerando(false)
    }
  }

  if (resultado) {
    return (
      <Dialogo
        aberto
        aoFechar={() => aoFechar(resultado)}
        titulo="Roteiro gerado"
        acoes={
          <button
            className="botao primario"
            onClick={() => {
              aoFechar(resultado)
              nav.abrirRoteiro(resultado.roteiroId)
            }}
          >
            Abrir roteiro
          </button>
        }
      >
        <p>
          Versão {resultado.versao} · <Etiqueta cor={resultado.status === 'precisa_verificacao' ? 'vermelha' : 'azul'}>{ROTULO_STATUS_ROTEIRO[resultado.status]}</Etiqueta> · {resultado.palavras} palavras · duração provável{' '}
          {formatarDuracao(resultado.duracaoSeg)}
        </p>
        <p className="secundario pequeno">A geração nunca aprova o roteiro. Revise, edite e passe pela verificação e pela revisão editorial.</p>
        {resultado.alertas.length === 0 ? <p className="secundario">Nenhum alerta automático.</p> : resultado.alertas.map((a, i) => <Alerta key={i} tipo={a.tipo === 'fato_novo' || a.tipo === 'sem_fonte' ? 'erro' : 'aviso'}>{a.mensagem}</Alerta>)}
      </Dialogo>
    )
  }

  const p = plano?.plano
  const podeGerar = plano !== null && (!p || (p.bloqueios.length === 0 && (!p.exigeAutorizacao || autorizo)))
  return (
    <Dialogo
      aberto
      largo
      aoFechar={() => aoFechar(null)}
      titulo={roteiroId ? 'Gerar variação do roteiro' : 'Gerar roteiro a partir da pauta'}
      acoes={
        <>
          {gerando && (
            <button className="botao fantasma" onClick={() => void chamar('geracao:cancelar')}>
              Cancelar geração
            </button>
          )}
          <button className="botao fantasma" onClick={() => aoFechar(null)} disabled={gerando}>
            Fechar
          </button>
          {plano === null ? (
            <button className="botao primario" onClick={() => void preparar()}>
              Revisar o que será feito
            </button>
          ) : (
            <button className="botao primario" disabled={!podeGerar || gerando} onClick={() => void gerar()}>
              {gerando ? 'Gerando…' : p?.exigeAutorizacao ? 'Autorizar e gerar' : 'Gerar'}
            </button>
          )}
        </>
      }
    >
      <div className="form-grade">
        <Campo rotulo="Formato">
          <select className="entrada" value={tipo} onChange={(e) => { setTipo(e.target.value as TipoVideo); setPlano(null) }} disabled={roteiroId !== null}>
            <option value="longo">Vídeo longo (16:9)</option>
            <option value="short">Short (9:16)</option>
          </select>
        </Campo>
        <Campo rotulo="Como gerar" ajuda="Automático: o app escolhe a IA disponível (PC ou gratuitas); sem nenhuma, usa o modo estruturado, que monta as cenas com as afirmações verificadas.">
          <select className="entrada" value={escolha} onChange={(e) => { setEscolha(e.target.value); setPlano(null) }}>
            <option value="auto">Automático: o app escolhe a IA</option>
            <option value="">Modo estruturado (sem IA, sem custo)</option>
            {central.dados?.provedores
              .filter((x) => x.ativo)
              .map((x) => (
                <option key={x.id} value={x.id}>
                  IA: {x.config.nome} {x.config.adaptador === 'simulado' ? '(SIMULADO)' : x.local ? '(local)' : '(online)'}
                </option>
              ))}
          </select>
        </Campo>
        <Campo rotulo="Ângulo ou diferença desejada (opcional)">
          <input className="entrada" value={angulo} onChange={(e) => { setAngulo(e.target.value); setPlano(null) }} maxLength={300} placeholder="Ex.: explicar com um exemplo de pequena empresa" />
        </Campo>
      </div>
      {gerando && (
        <BarraProgresso
          percentual={null}
          etapa={automatico ? 'A IA está escrevendo o roteiro (se uma falhar, o app tenta a próxima)' : provedorId ? 'A IA está escrevendo o roteiro' : 'Montando o roteiro'}
          detalhe="A IA não informa a porcentagem; costuma levar de alguns segundos a poucos minutos."
        />
      )}
      {plano && (
        <div style={{ marginTop: 16 }}>
          {plano.afirmacoesProntas === 0 && <Alerta tipo="erro">Nenhuma afirmação pronta no dossiê. O resultado ficará como “precisa de verificação”.</Alerta>}
          <p className="secundario pequeno">{plano.afirmacoesProntas} afirmação(ões) verificada(s) serão usadas como base factual.</p>
          {plano.rota && (
            <div className="cartao-suave" style={{ marginBottom: 12 }}>
              {plano.rota.ordem.length ? (
                <p className="pequeno" style={{ margin: 0 }}>
                  O app vai tentar, nesta ordem: <strong>{plano.rota.ordem.map((o) => `${o.nome}${o.local ? ' (PC)' : ''}`).join(' → ')}</strong>. Se todas falharem, usa o modo estruturado.
                </p>
              ) : (
                <p className="pequeno" style={{ margin: 0 }}>Nenhuma IA disponível para escrever agora: será usado o modo estruturado (sem IA). Veja Configurações › Serviços de IA.</p>
              )}
            </div>
          )}
          {p ? (
            <>
              <h3>{plano.rota ? 'Plano de envio da primeira IA' : 'Plano de envio'}</h3>
              <ResumoPlano plano={p} />
              {p.exigeAutorizacao && p.bloqueios.length === 0 && (
                <label className="checkbox" style={{ marginTop: 8 }}>
                  <input type="checkbox" checked={autorizo} onChange={(e) => setAutorizo(e.target.checked)} />
                  Autorizo enviar estes dados a este provedor, para esta finalidade, com este custo estimado.
                </label>
              )}
            </>
          ) : (
            <p className="secundario">Nada será enviado para fora do computador.</p>
          )}
        </div>
      )}
    </Dialogo>
  )
}
