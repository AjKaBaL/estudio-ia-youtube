import { useCallback, useEffect, useState } from 'react'
import type { Canal } from '@shared/canais'
import type { Entrada, Saidas } from '@shared/ipc'
import type { Resposta } from '@shared/tipos'

declare global {
  interface Window {
    estudio: { invoke(canal: Canal, entrada?: unknown): Promise<unknown> }
  }
}

export class ErroApi extends Error {
  constructor(
    readonly codigo: string,
    mensagem: string
  ) {
    super(mensagem)
  }
}

type Args<C extends Canal> = undefined extends Entrada<C> ? [entrada?: Entrada<C>] : [entrada: Entrada<C>]

/** Chamada tipada ao processo principal. Lança ErroApi com mensagem pronta para o usuário. */
export async function chamar<C extends Canal>(canal: C, ...args: Args<C>): Promise<Saidas[C]> {
  const r = (await window.estudio.invoke(canal, args[0])) as Resposta<Saidas[C]>
  if (!r.ok) throw new ErroApi(r.erro.codigo, r.erro.mensagem)
  return r.dados
}

export function mensagemDeErro(e: unknown): string {
  return e instanceof Error ? e.message : 'Erro inesperado.'
}

export interface EstadoDados<T> {
  dados: T | null
  erro: string | null
  carregando: boolean
  recarregar: () => void
}

interface Estado<T> {
  chave: string | null
  dados: T | null
  erro: string | null
}

/**
 * Carrega dados ao montar e quando as dependências mudam. Mantém os dados anteriores
 * visíveis durante a recarga e ignora respostas que chegam depois de uma troca de filtro.
 */
export function useDados<T>(carregar: () => Promise<T>, deps: readonly unknown[]): EstadoDados<T> {
  const [versao, setVersao] = useState(0)
  const chave = `${JSON.stringify(deps)}#${versao}`
  const [estado, setEstado] = useState<Estado<T>>({ chave: null, dados: null, erro: null })

  useEffect(() => {
    let ativo = true
    carregar().then(
      (dados) => {
        if (ativo) setEstado({ chave, dados, erro: null })
      },
      (e: unknown) => {
        if (ativo) setEstado((s) => ({ chave, dados: s.dados, erro: mensagemDeErro(e) }))
      }
    )
    return () => {
      ativo = false
    }
    // A função "carregar" é recriada a cada renderização; a chave representa suas dependências.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave])

  const recarregar = useCallback(() => setVersao((v) => v + 1), [])
  return { dados: estado.dados, erro: estado.erro, carregando: estado.chave !== chave, recarregar }
}
