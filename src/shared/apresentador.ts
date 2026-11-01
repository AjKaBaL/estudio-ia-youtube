import type { EstadoEdicao } from './edicao'

/**
 * Apresentador animado (personagem original do canal): fica no canto e muda de pose conforme o que está sendo dito,
 * como numa animação tradicional (troca de poses + boca abrindo e fechando enquanto fala).
 * A escolha da pose é por regras fixas sobre o texto de cada legenda (sem IA).
 */

export const POSES_APRESENTADOR = ['falando', 'pergunta', 'ideia', 'dado', 'alerta', 'comemorando', 'pensando', 'apresentando'] as const
export type PoseApresentador = (typeof POSES_APRESENTADOR)[number]

const normal = (t: string): string => t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/** Pose para uma frase. A ordem das regras importa: pergunta e alerta vêm antes dos números. */
export function escolherPose(texto: string): PoseApresentador {
  const t = normal(texto)
  if (texto.includes('?')) return 'pergunta'
  if (/\b(cuidado|atencao|risco|perigo|alerta|golpe|falha|proib|ameaca|vazamento|crise)/.test(t)) return 'alerta'
  if (/\d/.test(t) || /\b(por cento|milh|bilh|trilh|percentual|metade|dobro|triplo)/.test(t)) return 'dado'
  if (/\b(ideia|solucao|dica|segredo|imagine|por exemplo|o truque|a chave)/.test(t)) return 'ideia'
  if (/\b(talvez|sera que|pode ser|hipotese|previs|no futuro|pensar|reflet|depende)/.test(t)) return 'pensando'
  if (/\b(otimo|incrivel|sucesso|conquist|recorde|vitoria|parabens|excelente|avanco|comemor)/.test(t)) return 'comemorando'
  return 'falando'
}

export interface TrechoApresentador {
  inicio: number
  fim: number
  pose: PoseApresentador
  /** Abertura de cada cena: o apresentador aparece maior (zoom) para chamar a atenção. */
  destaque: boolean
  /** Lado da tela: alterna a cada cena, como um apresentador que circula pelo cenário. */
  lado: 'direita' | 'esquerda'
  /** Começo de cena: entra deslizando pela lateral. */
  entrada: boolean
}

/**
 * Linha do tempo do apresentador a partir das legendas: uma pose por frase; o começo de cada cena é
 * "apresentando" em destaque (maior). Sem legendas, fica falando durante o vídeo todo.
 */
export function planoApresentador(e: EstadoEdicao, total: number, ladoInicial: 'direita' | 'esquerda' = 'direita'): TrechoApresentador[] {
  const legendas = e.clips.filter((c) => c.faixa === 'legendas' && c.texto.trim()).sort((a, b) => a.inicio - b.inicio)
  if (!legendas.length) return total > 0 ? [{ inicio: 0, fim: total, pose: 'falando', destaque: false, lado: ladoInicial, entrada: true }] : []
  const outro = ladoInicial === 'direita' ? 'esquerda' : 'direita'
  const vistas = new Set<number | null>()
  const trechos: TrechoApresentador[] = []
  for (const l of legendas) {
    const novaCena = !vistas.has(l.cena)
    vistas.add(l.cena)
    const lado = vistas.size % 2 === 1 ? ladoInicial : outro
    const inicio = Math.max(0, l.inicio)
    const fim = Math.min(total, l.inicio + l.duracao)
    if (fim - inicio < 0.05) continue
    if (novaCena && fim - inicio > 2.2) {
      // Abertura da cena em destaque por ~1,6 s; o resto da frase volta ao tamanho normal com a pose do texto.
      trechos.push({ inicio, fim: inicio + 1.6, pose: 'apresentando', destaque: true, lado, entrada: true })
      trechos.push({ inicio: inicio + 1.6, fim, pose: escolherPose(l.texto), destaque: false, lado, entrada: false })
    } else trechos.push({ inicio, fim, pose: novaCena ? 'apresentando' : escolherPose(l.texto), destaque: novaCena, lado, entrada: novaCena })
  }
  return trechos
}
