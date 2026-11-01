import { useEffect, useState } from 'react'

/** Relógio que avança a cada segundo enquanto a barra estiver ativa (para tempo decorrido e restante). */
function useAgora(ativo: boolean): number {
  const [agora, setAgora] = useState(() => Date.now())
  useEffect(() => {
    if (!ativo) return
    const t = setInterval(() => setAgora(Date.now()), 1000)
    return () => clearInterval(t)
  }, [ativo])
  return agora
}

export function formatarTempo(seg: number): string {
  const s = Math.max(0, Math.round(seg))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  return h ? `${h} h ${String(m).padStart(2, '0')} min` : m ? `${m} min ${String(r).padStart(2, '0')} s` : `${r} s`
}

/**
 * Barra de progresso padrão do app: etapa, porcentagem, detalhe, tempo decorrido e tempo restante estimado.
 * O restante é calculado pela velocidade observada desde que a barra apareceu (vale também para envios retomados).
 * Sem porcentagem conhecida (ex.: IA gerando texto), mostra uma barra em movimento e só o tempo decorrido.
 */
export function BarraProgresso({
  percentual,
  etapa,
  detalhe,
  inicio,
  ativo = true,
  erro = false
}: {
  percentual: number | null
  etapa?: string
  detalhe?: string
  /** Quando a tarefa começou (ISO); sem ele, conta a partir de quando a barra apareceu. */
  inicio?: string | null
  ativo?: boolean
  erro?: boolean
}) {
  const agora = useAgora(ativo)
  const [base] = useState(() => ({ t0: Date.now(), p0: percentual ?? 0 }))
  const pct = percentual === null ? null : Math.max(0, Math.min(100, percentual))
  const comeco = inicio ? new Date(inicio).getTime() : base.t0
  const decorrido = (agora - comeco) / 1000
  const ritmo = pct !== null && pct > base.p0 + 1 ? (pct - base.p0) / Math.max(1, (agora - base.t0) / 1000) : null
  const restante = ativo && pct !== null && ritmo ? (100 - pct) / ritmo : null
  return (
    <div className="progresso" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined} aria-label={etapa ?? 'Progresso'}>
      <div className="progresso-topo">
        <span>{etapa}</span>
        {pct !== null && <strong>{Math.floor(pct)}%</strong>}
      </div>
      <div className={`progresso-trilho${pct === null && ativo ? ' indeterminado' : ''}${erro ? ' erro' : ''}`}>
        <div style={{ width: pct === null ? (ativo ? '30%' : '0%') : `${pct}%` }} />
      </div>
      <div className="progresso-rodape secundario pequeno">
        <span>{detalhe}</span>
        {ativo && (
          <span>
            {formatarTempo(decorrido)} decorrido(s)
            {restante !== null && restante > 1 && ` · cerca de ${formatarTempo(restante)} restante(s)`}
          </span>
        )}
      </div>
    </div>
  )
}

/** Consulta o progresso no processo principal a cada ~0,8 s enquanto "ativo" for verdadeiro. */
export function useProgressoRemoto<T>(buscar: () => Promise<T | null>, ativo: boolean, intervaloMs = 800): T | null {
  const [valor, setValor] = useState<T | null>(null)
  useEffect(() => {
    if (!ativo) return
    let vivo = true
    const consultar = (): void => {
      buscar().then(
        (v) => vivo && setValor(v),
        () => undefined
      )
    }
    const t = setInterval(consultar, intervaloMs)
    consultar()
    return () => {
      vivo = false
      clearInterval(t)
    }
    // "buscar" é recriada a cada renderização; o que importa é ligar/desligar a consulta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ativo, intervaloMs])
  return valor
}
