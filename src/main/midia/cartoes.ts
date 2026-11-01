import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ErroApp } from '../erros'
import { executarFerramenta, type Ferramentas } from './ffmpeg'
import { localizarFonte } from './miniaturas'

/**
 * Cartões gráficos: imagem criada pelo próprio app (fundo em degradê, título da cena e uma frase-chave),
 * sem chave, sem internet e sem IA. Garante que nenhuma cena fique sem imagem.
 * Textos vão por arquivo (textfile, expansion=none) e a fonte é copiada para a pasta de trabalho.
 */

const PALETAS: [string, string, string][] = [
  ['0x0f172a', '0x1e3a8a', '0xff0033'],
  ['0x111827', '0x065f46', '0x34d399'],
  ['0x1f1033', '0x6d28d9', '0xf59e0b'],
  ['0x0b1320', '0x0e7490', '0x38bdf8'],
  ['0x1a1a1a', '0x7c2d12', '0xfb923c']
]

/** Quebra o texto em linhas de até N caracteres, no máximo M linhas (com reticências se cortar). */
export function quebrar(texto: string, porLinha: number, maxLinhas: number): string[] {
  const palavras = texto.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)
  const linhas: string[] = []
  let atual = ''
  for (const p of palavras) {
    if ((atual + ' ' + p).trim().length > porLinha && atual) {
      linhas.push(atual)
      atual = p
    } else atual = `${atual} ${p}`.trim()
  }
  if (atual) linhas.push(atual)
  if (linhas.length > maxLinhas) {
    const cortadas = linhas.slice(0, maxLinhas)
    cortadas[maxLinhas - 1] = `${cortadas[maxLinhas - 1]!.replace(/[.,;:!?]?$/, '')}…`
    return cortadas
  }
  return linhas
}

/** "Bloco 2 — Participação do Inmetro" → "Participação do Inmetro". */
export function tituloDoCartao(titulo: string): string {
  return titulo.replace(/^(bloco|ponto|parte|cena)\s*\d+\s*[—–:-]\s*/i, '').trim() || titulo.trim()
}

/** Primeira frase da narração da cena (até ~120 caracteres). */
export function fraseDoCartao(narracao: string): string {
  const primeira = narracao.replace(/\s+/g, ' ').trim().split(/(?<=[.!?…])\s/)[0] ?? ''
  return primeira.length > 120 ? `${primeira.slice(0, 117).replace(/\s+\S*$/, '')}…` : primeira
}

export async function gerarCartao(f: Ferramentas, d: { titulo: string; frase: string; formato: '16:9' | '9:16'; indice: number; pasta: string }): Promise<string> {
  mkdirSync(d.pasta, { recursive: true })
  const vertical = d.formato === '9:16'
  const [W, H] = vertical ? [1080, 1920] : [1920, 1080]
  const [c0, c1, destaque] = PALETAS[d.indice % PALETAS.length]!
  const titulo = quebrar(tituloDoCartao(d.titulo), vertical ? 16 : 24, 3)
  const frase = quebrar(d.frase, vertical ? 30 : 52, 3)
  const tamTitulo = vertical ? 96 : 104
  const tamFrase = vertical ? 50 : 48
  writeFileSync(join(d.pasta, 'titulo.txt'), titulo.join('\n'), 'utf8')
  writeFileSync(join(d.pasta, 'frase.txt'), frase.join('\n'), 'utf8')
  copyFileSync(localizarFonte('segoe'), join(d.pasta, 'fonte.ttf'))
  const x = vertical ? 90 : 140
  const yTitulo = Math.round(H * (vertical ? 0.3 : 0.26))
  // Altura de cada linha do título: a fonte (~1,33×) mais o espaço entre linhas.
  const alturaTitulo = Math.round(titulo.length * tamTitulo * 1.51 - tamTitulo * 0.18)
  const yFrase = yTitulo + alturaTitulo + (vertical ? 60 : 44)
  const filtro = [
    `drawbox=x=${x - 50}:y=${yTitulo}:w=14:h=${alturaTitulo}:color=${destaque}:t=fill`,
    `drawbox=x=0:y=ih-18:w=iw:h=18:color=${destaque}@0.9:t=fill`,
    `drawtext=fontfile=fonte.ttf:textfile=titulo.txt:expansion=none:fontcolor=white:fontsize=${tamTitulo}:line_spacing=${Math.round(tamTitulo * 0.18)}:x=${x}:y=${yTitulo}:shadowx=4:shadowy=4:shadowcolor=black@0.45`,
    ...(frase.length ? [`drawtext=fontfile=fonte.ttf:textfile=frase.txt:expansion=none:fontcolor=white@0.86:fontsize=${tamFrase}:line_spacing=${Math.round(tamFrase * 0.3)}:x=${x}:y=${yFrase}`] : [])
  ].join(',')
  const saida = join(d.pasta, `cartao-${d.indice}.jpg`)
  const r = await executarFerramenta(
    f.ffmpeg,
    ['-hide_banner', '-nostdin', '-y', '-f', 'lavfi', '-i', `gradients=s=${W}x${H}:c0=${c0}:c1=${c1}:x0=0:y0=0:x1=${W}:y1=${H}:d=1`, '-frames:v', '1', '-vf', filtro, '-q:v', '2', saida],
    { cwd: d.pasta, tempoLimiteMs: 60_000 }
  )
  if (r.codigo !== 0 || !existsSync(saida)) throw new ErroApp('cartao', `Não foi possível criar o cartão gráfico. ${r.stderr.slice(-200)}`)
  return saida
}
