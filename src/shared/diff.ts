/** Diferença por linhas (LCS) para comparar versões de roteiro. Sem dependências. */

export type LinhaDiff = { tipo: 'igual' | 'adicionada' | 'removida'; texto: string }

const LIMITE_CELULAS = 4_000_000

export function diffLinhas(antes: string, depois: string): LinhaDiff[] {
  const a = antes.split(/\r?\n/)
  const b = depois.split(/\r?\n/)
  // Textos enormes: evita consumo excessivo de memória e devolve diferença simplificada.
  if (a.length * b.length > LIMITE_CELULAS) {
    return [...a.map((t) => ({ tipo: 'removida' as const, texto: t })), ...b.map((t) => ({ tipo: 'adicionada' as const, texto: t }))]
  }
  const n = a.length
  const m = b.length
  const tabela: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    const linha = tabela[i]!
    const abaixo = tabela[i + 1]!
    for (let j = m - 1; j >= 0; j--) {
      linha[j] = a[i] === b[j] ? abaixo[j + 1]! + 1 : Math.max(abaixo[j]!, linha[j + 1]!)
    }
  }
  const saida: LinhaDiff[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      saida.push({ tipo: 'igual', texto: a[i]! })
      i++
      j++
    } else if (tabela[i + 1]![j]! >= tabela[i]![j + 1]!) {
      saida.push({ tipo: 'removida', texto: a[i++]! })
    } else {
      saida.push({ tipo: 'adicionada', texto: b[j++]! })
    }
  }
  while (i < n) saida.push({ tipo: 'removida', texto: a[i++]! })
  while (j < m) saida.push({ tipo: 'adicionada', texto: b[j++]! })
  return saida
}

/** Resumo legível das diferenças relevantes entre duas versões. */
export function resumirAlteracoes(
  antes: { titulo: string; conteudo: string },
  depois: { titulo: string; conteudo: string }
): string {
  const partes: string[] = []
  if (antes.titulo !== depois.titulo) partes.push(`Título: "${antes.titulo}" → "${depois.titulo}"`)
  if (antes.conteudo !== depois.conteudo) {
    const d = diffLinhas(antes.conteudo, depois.conteudo)
    const add = d.filter((l) => l.tipo === 'adicionada').length
    const rem = d.filter((l) => l.tipo === 'removida').length
    const palavras = (t: string): number => t.split(/\s+/).filter(Boolean).length
    const delta = palavras(depois.conteudo) - palavras(antes.conteudo)
    partes.push(`Texto: +${add} / −${rem} linhas (${delta >= 0 ? '+' : ''}${delta} palavras)`)
  }
  return partes.length ? partes.join('; ') : 'Sem alterações de texto'
}

export function contarPalavras(texto: string): number {
  return texto.split(/\s+/).filter(Boolean).length
}

/** Estimativa de duração de narração (~150 palavras por minuto em português). */
export function duracaoEstimadaSeg(texto: string, palavrasPorMinuto = 150): number {
  return Math.round((contarPalavras(texto) / palavrasPorMinuto) * 60)
}
