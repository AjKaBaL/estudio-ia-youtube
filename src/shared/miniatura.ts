/** Miniaturas (thumbs) 1280×720 geradas com o FFmpeg a partir de um quadro do vídeo ou de uma imagem da biblioteca. */

export const MODELOS_MINIATURA = {
  faixa: { rotulo: 'Faixa escura embaixo', dica: 'Texto sobre uma faixa escura na parte de baixo. Funciona com quase qualquer imagem.' },
  lateral: { rotulo: 'Texto à esquerda', dica: 'Painel escuro à esquerda com o texto; deixe o rosto ou o objeto principal à direita.' },
  destaque: { rotulo: 'Texto grande no centro', dica: 'Poucas palavras, bem grandes, com contorno. Ideal para 2 a 4 palavras.' }
} as const
export type ModeloMiniatura = keyof typeof MODELOS_MINIATURA

export const CORES_MINIATURA = {
  amarelo: { rotulo: 'Amarelo', hex: 'FFD400' },
  branco: { rotulo: 'Branco', hex: 'FFFFFF' },
  vermelho: { rotulo: 'Vermelho', hex: 'FF3B3B' },
  verde: { rotulo: 'Verde', hex: '3DDC84' },
  azul: { rotulo: 'Azul', hex: '3EA6FF' }
} as const
export type CorMiniatura = keyof typeof CORES_MINIATURA

/** Arquivos procurados em C:\Windows\Fonts (fontes que acompanham o Windows). */
export const FONTES_MINIATURA = {
  arial: { rotulo: 'Arial Negrito', arquivos: ['arialbd.ttf', 'arial.ttf'] },
  segoe: { rotulo: 'Segoe UI Negrito', arquivos: ['segoeuib.ttf', 'seguisb.ttf'] },
  impact: { rotulo: 'Impact (condensada)', arquivos: ['impact.ttf'] }
} as const
export type FonteMiniatura = keyof typeof FONTES_MINIATURA

export interface OpcoesMiniatura {
  modelo: ModeloMiniatura
  texto: string
  selo: string
  cor: CorMiniatura
  fonte: FonteMiniatura
  maiusculas: boolean
}

export const OPCOES_MINIATURA_PADRAO: Omit<OpcoesMiniatura, 'texto'> = { modelo: 'faixa', selo: '', cor: 'amarelo', fonte: 'arial', maiusculas: true }

/** Limites do YouTube para miniaturas personalizadas. */
export const MINIATURA = { largura: 1280, altura: 720, maxBytes: 2 * 1024 * 1024 }

/** Caracteres por linha e linhas máximas de cada modelo (o texto precisa ser legível no celular). */
const LIMITES: Record<ModeloMiniatura, { porLinha: number; linhas: number }> = {
  faixa: { porLinha: 22, linhas: 2 },
  lateral: { porLinha: 13, linhas: 4 },
  destaque: { porLinha: 14, linhas: 2 }
}

/** Quebra o texto em linhas pelo espaço; palavras que não cabem são cortadas e o excesso vira "…". */
export function quebrarLinhas(texto: string, modelo: ModeloMiniatura, maiusculas: boolean): { linhas: string[]; cortado: boolean } {
  const { porLinha, linhas: max } = LIMITES[modelo]
  const limpo = (maiusculas ? texto.toLocaleUpperCase('pt-BR') : texto).replace(/\s+/g, ' ').trim()
  const palavras = limpo
    .split(' ')
    .filter(Boolean)
    .map((p) => (p.length > porLinha ? `${p.slice(0, porLinha - 1)}…` : p))
  const linhas: string[] = []
  let i = 0
  while (i < palavras.length && linhas.length < max) {
    let linha = palavras[i++]!
    while (i < palavras.length && linha.length + 1 + palavras[i]!.length <= porLinha) linha += ` ${palavras[i++]!}`
    linhas.push(linha)
  }
  const cortado = i < palavras.length
  if (cortado) {
    const ultima = linhas[linhas.length - 1]!.replace(/…$/, '')
    linhas[linhas.length - 1] = `${ultima.length >= porLinha ? ultima.slice(0, porLinha - 1) : ultima}…`
  }
  return { linhas, cortado }
}

/** Largura útil do texto (px) em cada modelo e largura média de um caractere maiúsculo em cada fonte (fração do tamanho). */
const LARGURA_UTIL: Record<ModeloMiniatura, number> = { faixa: 1168, lateral: 650, destaque: 1180 }
const LARGURA_CARACTERE: Record<FonteMiniatura, number> = { arial: 0.68, segoe: 0.66, impact: 0.5 }

/** Tamanho da fonte (px): o maior que cabe na largura útil com a linha mais longa, limitado por modelo e linhas. */
export function tamanhoFonte(modelo: ModeloMiniatura, linhas: string[], fonte: FonteMiniatura): number {
  const teto = modelo === 'destaque' ? [150, 130] : modelo === 'lateral' ? [104, 96, 88, 80] : [116, 100]
  const maximo = teto[Math.min(teto.length, Math.max(1, linhas.length)) - 1]!
  const maior = Math.max(1, ...linhas.map((l) => l.length))
  return Math.max(40, Math.min(maximo, Math.floor(LARGURA_UTIL[modelo] / (maior * LARGURA_CARACTERE[fonte]))))
}

/** Sugestão de texto a partir do título: as primeiras palavras que cabem no modelo. */
export function textoSugerido(titulo: string, modelo: ModeloMiniatura): string {
  return quebrarLinhas(titulo.replace(/[:|–—-].*$/, '').trim() || titulo, modelo, false).linhas.join(' ').replace(/…$/, '')
}
