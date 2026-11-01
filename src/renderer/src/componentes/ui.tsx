import { useEffect, useRef, type ReactNode } from 'react'
import { Icone, type NomeIcone } from './Icone'

/** Componentes visuais reutilizáveis. Mantêm a mesma aparência em todas as telas. */

export function Cabecalho({ titulo, descricao, acoes }: { titulo: string; descricao?: string; acoes?: ReactNode }) {
  return (
    <header className="cabecalho">
      <div>
        <h1>{titulo}</h1>
        {descricao && <p>{descricao}</p>}
      </div>
      {acoes && <div className="acoes">{acoes}</div>}
    </header>
  )
}

export function Secao({ titulo, acoes, children }: { titulo?: string; acoes?: ReactNode; children: ReactNode }) {
  return (
    <section className="secao">
      {(titulo || acoes) && (
        <div className="secao-titulo">
          {titulo && <h2>{titulo}</h2>}
          {acoes}
        </div>
      )}
      {children}
    </section>
  )
}

export function Carregando({ texto = 'Carregando…' }: { texto?: string }) {
  return (
    <div className="estado" role="status" aria-live="polite">
      <div className="giro" />
      <span>{texto}</span>
    </div>
  )
}

export function Vazio({ titulo, texto, icone = 'vazio', acao, compacto }: { titulo: string; texto?: string; icone?: NomeIcone; acao?: ReactNode; compacto?: boolean }) {
  return (
    <div className={`estado${compacto ? ' compacto' : ''}`}>
      {!compacto && <Icone nome={icone} tamanho={40} />}
      <strong>{titulo}</strong>
      {texto && <span>{texto}</span>}
      {acao}
    </div>
  )
}

export function ErroCarregar({ mensagem, tentarNovamente }: { mensagem: string; tentarNovamente?: () => void }) {
  return (
    <div className="alerta erro" role="alert">
      <Icone nome="alerta" tamanho={20} />
      <div style={{ flex: 1 }}>
        <strong>Não foi possível carregar.</strong> {mensagem}
      </div>
      {tentarNovamente && (
        <button className="botao pequeno" onClick={tentarNovamente}>
          Tentar novamente
        </button>
      )}
    </div>
  )
}

export function Alerta({ tipo = 'aviso', children }: { tipo?: 'aviso' | 'erro' | 'info'; children: ReactNode }) {
  return (
    <div className={`alerta${tipo === 'aviso' ? '' : ` ${tipo}`}`} role={tipo === 'erro' ? 'alert' : 'note'}>
      <Icone nome={tipo === 'info' ? 'relogio' : 'alerta'} tamanho={18} />
      <div>{children}</div>
    </div>
  )
}

export type CorEtiqueta = 'cinza' | 'verde' | 'amarela' | 'vermelha' | 'azul'
export function Etiqueta({ cor = 'cinza', children }: { cor?: CorEtiqueta; children: ReactNode }) {
  return <span className={`etiqueta${cor === 'cinza' ? '' : ` ${cor}`}`}>{children}</span>
}

export function Campo({ rotulo, ajuda, children }: { rotulo: string; ajuda?: string; children: ReactNode }) {
  return (
    <label className="campo">
      <span>{rotulo}</span>
      {children}
      {ajuda && <small>{ajuda}</small>}
    </label>
  )
}

/** Diálogo modal nativo (foco preso e tecla Esc já tratados pelo navegador). */
export function Dialogo({
  aberto,
  aoFechar,
  titulo,
  children,
  acoes,
  largo
}: {
  aberto: boolean
  aoFechar: () => void
  titulo: string
  children: ReactNode
  acoes?: ReactNode
  largo?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (aberto && !d.open) d.showModal()
    if (!aberto && d.open) d.close()
  }, [aberto])
  return (
    <dialog ref={ref} className={largo ? 'largo' : undefined} onClose={aoFechar} aria-labelledby="titulo-dialogo">
      {aberto && (
        <>
          <h2 id="titulo-dialogo">{titulo}</h2>
          {children}
          {acoes && <div className="dialogo-acoes">{acoes}</div>}
        </>
      )}
    </dialog>
  )
}

export function formatarData(iso: string | null | undefined, comHora = false): string {
  if (!iso) return '—'
  const d = iso.length === 10 ? new Date(`${iso}T12:00:00`) : new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('pt-BR', comHora ? { dateStyle: 'short', timeStyle: 'short' } : { dateStyle: 'short' })
}

export function formatarDuracao(seg: number): string {
  const m = Math.floor(seg / 60)
  const s = seg % 60
  return m ? `${m} min ${String(s).padStart(2, '0')} s` : `${s} s`
}

export function formatarBytes(b: number): string {
  if (b >= 1024 ** 3) return `${(b / 1024 ** 3).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} GB`
  if (b >= 1024 ** 2) return `${Math.round(b / 1024 ** 2).toLocaleString('pt-BR')} MB`
  return `${Math.max(1, Math.round(b / 1024))} KB`
}

/** 8.4 → "8 s"; 754 → "12 min 34 s". */
export function formatarSegundos(seg: number): string {
  return formatarDuracao(Math.round(seg))
}

/** Bloco de ajuda recolhível, para explicações longas sem poluir a tela. */
export function Ajuda({ titulo, aberto, children }: { titulo: string; aberto?: boolean; children: ReactNode }) {
  return (
    <details className="ajuda" open={aberto}>
      <summary>{titulo}</summary>
      <div className="ajuda-corpo">{children}</div>
    </details>
  )
}
