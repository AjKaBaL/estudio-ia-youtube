import { createContext, useContext } from 'react'
import type { NomeIcone } from './componentes/Icone'
import type { StatusRoteiro } from '@shared/dominio'
import type { CorEtiqueta } from './componentes/ui'

export type IdTela =
  | 'painel'
  | 'visao'
  | 'pautas'
  | 'biblioteca'
  | 'revisao'
  | 'calendario'
  | 'estudio'
  | 'fila'
  | 'publicacoes'
  | 'metricas'
  | 'config'
  | 'inicio'
  | 'links'

export interface ItemNav {
  id: IdTela
  rotulo: string
  icone: NomeIcone
  /** Função ainda não implementada: aparece identificada como futura. */
  futuro?: boolean
}

export const NAVEGACAO: ItemNav[][] = [
  [
    { id: 'painel', rotulo: 'Painel de produção', icone: 'painel' },
    { id: 'visao', rotulo: 'Visão geral', icone: 'inicio' },
    { id: 'pautas', rotulo: 'Pautas e pesquisas', icone: 'pauta' },
    { id: 'biblioteca', rotulo: 'Biblioteca de roteiros', icone: 'biblioteca' },
    { id: 'revisao', rotulo: 'Revisão editorial', icone: 'revisao' },
    { id: 'calendario', rotulo: 'Calendário', icone: 'calendario' }
  ],
  [
    { id: 'estudio', rotulo: 'Estúdio/editor', icone: 'estudio' },
    { id: 'fila', rotulo: 'Fila de produção', icone: 'fila' },
    { id: 'publicacoes', rotulo: 'Publicações', icone: 'publicacao' },
    { id: 'links', rotulo: 'Links e redes', icone: 'link' },
    { id: 'metricas', rotulo: 'Métricas', icone: 'metricas' }
  ],
  [
    { id: 'inicio', rotulo: 'Primeiros passos', icone: 'ok' },
    { id: 'config', rotulo: 'Configurações', icone: 'config' }
  ]
]

export interface Navegacao {
  tela: IdTela
  roteiroAberto: number | null
  irPara: (tela: IdTela) => void
  abrirRoteiro: (id: number) => void
  fecharRoteiro: () => void
  /** Registra uma verificação de "alterações não salvas" antes de sair da tela atual. */
  definirAlteracoesPendentes: (pendente: (() => boolean) | null) => void
}

export const ContextoNavegacao = createContext<Navegacao | null>(null)

export function useNavegacao(): Navegacao {
  const n = useContext(ContextoNavegacao)
  if (!n) throw new Error('useNavegacao fora do provedor')
  return n
}

export const COR_STATUS_ROTEIRO: Record<StatusRoteiro, CorEtiqueta> = {
  rascunho: 'cinza',
  precisa_verificacao: 'vermelha',
  pronto_revisao: 'azul',
  em_revisao: 'amarela',
  aprovado: 'verde',
  publicado: 'azul'
}
