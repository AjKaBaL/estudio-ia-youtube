import { useEffect, useState } from 'react'
import { chamar, mensagemDeErro } from '../api'
import { useRetorno } from './retorno'
import { Etiqueta, Secao, formatarData } from './ui'
import { formatarTempo } from './progresso'
import { useNavegacao, type IdTela } from '../navegacao'
import { ROTULO_ETAPA_PILOTO, ROTULO_OPCAO_PILOTO, type ConfigPiloto, type EstadoPiloto, type EtapaPiloto } from '@shared/piloto'

const COR = { feito: 'verde', aguardando: 'azul', erro: 'amarela' } as const
// Erro de uma etapa não é tarefa sua: o piloto corrige, tenta de novo ou troca o tema sozinho.
const ROTULO_RESULTADO = { feito: 'Feito', aguardando: 'Em andamento', erro: 'Resolvendo' } as const
/** Onde resolver o que só você pode fazer (ex.: conectar o YouTube). */
const DESTINO: Partial<Record<EtapaPiloto, { tela: IdTela; rotulo: string }>> = {
  tema: { tela: 'painel', rotulo: 'Escolher tema' },
  dossie: { tela: 'pautas', rotulo: 'Abrir pautas' },
  aprovar_roteiro: { tela: 'revisao', rotulo: 'Revisar e aprovar' },
  qualidade: { tela: 'estudio', rotulo: 'Abrir no Estúdio' },
  render: { tela: 'estudio', rotulo: 'Abrir no Estúdio' },
  aprovar_publicacao: { tela: 'publicacoes', rotulo: 'Aprovar publicação' },
  envio: { tela: 'publicacoes', rotulo: 'Abrir publicações' }
}

/**
 * Painel do piloto automático: liga/desliga e mostra em que etapa está cada vídeo. A IA aprova, corrige e publica;
 * "Precisa de você" só aparece para o que nenhum programa resolve (conectar a conta do YouTube, etapa desligada).
 */
export function PilotoAutomatico() {
  const nav = useNavegacao()
  const { avisar, avisarErro, confirmar } = useRetorno()
  const [e, setE] = useState<EstadoPiloto | null>(null)
  const [agora, setAgora] = useState(() => Date.now())

  useEffect(() => {
    let vivo = true
    const consultar = (): void => {
      chamar('piloto:estado').then(
        (d) => {
          if (!vivo) return
          setE(d)
          setAgora(Date.now())
        },
        () => undefined
      )
    }
    consultar()
    const t = setInterval(consultar, 3000)
    return () => {
      vivo = false
      clearInterval(t)
    }
  }, [])

  if (!e) return null
  const salvar = async (c: ConfigPiloto, aviso?: string): Promise<void> => {
    try {
      setE(await chamar('piloto:salvar', c))
      if (aviso) avisar(aviso)
    } catch (err) {
      avisarErro(mensagemDeErro(err))
    }
  }
  const faltam = e.proximoCiclo ? Math.max(0, (new Date(e.proximoCiclo).getTime() - agora) / 1000) : null
  const esperando = e.itens.filter((i) => i.precisaUsuario)
  return (
    <Secao
      titulo="Piloto automático"
      acoes={
        <>
          <Etiqueta cor={e.config.ligado ? 'verde' : 'cinza'}>{e.config.ligado ? (e.rodando ? 'Trabalhando' : 'Ligado') : 'Desligado'}</Etiqueta>
          {e.config.ligado ? (
            <>
              <button className="botao pequeno" disabled={e.rodando} onClick={async () => {
                try {
                  setE(await chamar('piloto:rodarAgora'))
                  avisar('Piloto rodando agora.')
                } catch (err) {
                  avisarErro(mensagemDeErro(err))
                }
              }}>
                {e.rodando ? 'Rodando…' : 'Rodar agora'}
              </button>
              <button className="botao pequeno fantasma" onClick={async () => {
                const ok = await confirmar({
                  titulo: 'Recomeçar a fila?',
                  texto: 'Os vídeos ainda não publicados saem da agenda, os roteiros deles vão para o arquivo e as pautas em espera são descartadas. O que já foi ao ar não muda. O piloto pesquisa de novo e monta roteiros novos, cada um com várias fontes.',
                  confirmar: 'Recomeçar'
                })
                if (!ok) return
                try {
                  const r = await chamar('piloto:recomecarFila')
                  setE(r.estado)
                  avisar(r.mensagem)
                } catch (err) {
                  avisarErro(mensagemDeErro(err))
                }
              }}>
                Recomeçar a fila
              </button>
              <button className="botao pequeno fantasma" onClick={() => void salvar({ ...e.config, ligado: false }, 'Piloto automático desligado.')}>
                Desligar
              </button>
            </>
          ) : (
            <button className="botao primario" onClick={() => void salvar({ ...e.config, ligado: true }, 'Piloto automático ligado: ele produz, aprova e publica os vídeos sozinho.')}>
              Ligar piloto automático
            </button>
          )}
        </>
      }
    >
      <p className="secundario pequeno" style={{ marginTop: 0 }}>
        Produz sozinho, do começo ao fim: pauta → tema na agenda → dossiê com trechos exatos das notícias → roteiro com IA → revisão e correção pela IA (checa se não inventou nada) → narração e imagens → renderização e controle de qualidade → publicação aprovada pela IA → {e.config.publicarSozinho ? <strong>vai ao ar sozinho no horário marcado</strong> : <>envio ao YouTube como <strong>privado</strong></>}. O que falhar, o piloto corrige sozinho (ou troca o tema).
      </p>
      {e.config.ligado && (
        <p className="pequeno" style={{ margin: '0 0 8px' }}>
          {e.rodando ? `Agora: ${e.etapaAtual ?? 'conferindo as etapas dos vídeos'}.` : faltam !== null ? `Próxima rodada em ${formatarTempo(faltam)}.` : 'A primeira rodada começa em instantes.'}
          {e.ultimoCiclo && ` Última rodada: ${formatarData(e.ultimoCiclo, true)}.`}
        </p>
      )}
      {esperando.length > 0 && (
        <div className="cartao-suave" style={{ marginBottom: 8, borderColor: 'var(--amarelo)' }}>
          <strong className="pequeno">Precisa de você ({esperando.length})</strong>
          <ul className="status-lista pequeno" style={{ marginTop: 4 }}>
            {esperando.map((i) => (
              <li key={i.calendarioId}>
                <strong>{i.titulo}</strong> · {ROTULO_ETAPA_PILOTO[i.etapa]}: {i.mensagem}{' '}
                {DESTINO[i.etapa] && (
                  <button className="link-botao" onClick={() => nav.irPara(DESTINO[i.etapa]!.tela)}>
                    {DESTINO[i.etapa]!.rotulo}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {e.itens.length > 0 && (
        <ul className="lista">
          {e.itens.map((i) => (
            <li key={i.calendarioId} className="lista-item" style={{ alignItems: 'flex-start' }}>
              <Etiqueta cor={COR[i.resultado]}>{ROTULO_RESULTADO[i.resultado]}</Etiqueta>
              <div className="lista-principal">
                <div className="lista-titulo">
                  {i.titulo} <span className="secundario pequeno">· {formatarData(i.inicioUtc, true)}</span>
                </div>
                <div className="pequeno">
                  <strong>{ROTULO_ETAPA_PILOTO[i.etapa]}:</strong> {i.mensagem}
                </div>
              </div>
              {DESTINO[i.etapa] && i.precisaUsuario && (
                <button className="botao pequeno fantasma" onClick={() => nav.irPara(DESTINO[i.etapa]!.tela)}>
                  {DESTINO[i.etapa]!.rotulo}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <details className="ajuda">
        <summary>Etapas que o piloto faz sozinho</summary>
        <div className="ajuda-corpo">
          {(Object.keys(ROTULO_OPCAO_PILOTO) as (keyof typeof ROTULO_OPCAO_PILOTO)[]).map((k) => (
            <label key={k} className="checkbox" style={{ display: 'flex' }}>
              <input type="checkbox" checked={e.config[k]} onChange={(ev) => void salvar({ ...e.config, [k]: ev.target.checked })} />
              {ROTULO_OPCAO_PILOTO[k]}
            </label>
          ))}
          <label className="checkbox" style={{ display: 'flex', gap: 8 }}>
            Começar a produzir os vídeos agendados para os próximos
            <select className="entrada" style={{ width: 'auto' }} value={e.config.diasAntecedencia} onChange={(ev) => void salvar({ ...e.config, diasAntecedencia: Number(ev.target.value) })}>
              {[3, 5, 7, 10, 14, 21, 30].map((d) => (
                <option key={d} value={d}>
                  {d} dias
                </option>
              ))}
            </select>
          </label>
          <p className="secundario pequeno">A IA só aprova um roteiro sem nenhum ponto crítico (depois de até 2 correções); se não conseguir, arquiva e pesquisa mais. Bloqueadores do controle de qualidade nunca são aceitos: o piloto corrige e renderiza de novo (até 3 vezes) e, se não der, troca o tema. Tema com fonte única é trocado por outro. Etapas com erro são tentadas de novo depois de 3 horas.</p>
        </div>
      </details>
      {e.registros.length > 0 && (
        <details className="ajuda">
          <summary>O que o piloto fez ({e.registros.length} registro(s) recentes)</summary>
          <div className="ajuda-corpo">
            <ul className="status-lista pequeno">
              {e.registros.map((r) => (
                <li key={r.id}>
                  <Etiqueta cor={COR[r.resultado]}>{ROTULO_RESULTADO[r.resultado]}</Etiqueta> {formatarData(r.criadoEm, true)} · <strong>{ROTULO_ETAPA_PILOTO[r.etapa]}</strong> · {r.titulo}: {r.mensagem}
                </li>
              ))}
            </ul>
          </div>
        </details>
      )}
    </Secao>
  )
}
