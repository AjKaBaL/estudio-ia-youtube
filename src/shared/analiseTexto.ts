/**
 * Alertas editoriais por regras fixas (Etapa 9). São sinais para o revisor, não julgamentos:
 * a ausência de alerta não garante ausência de problema.
 */

export interface AlertaTexto {
  tipo: 'repeticao' | 'semelhanca' | 'copia' | 'citacao_longa' | 'linguagem' | 'exagero' | 'titulo' | 'fato_novo'
  gravidade: 'critico' | 'aviso'
  mensagem: string
  trecho?: string
}

function normal(t: string): string {
  return t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}\s%]/gu, ' ').replace(/\s+/g, ' ').trim()
}

const EXAGEROS = ['incrivel', 'chocante', 'inacreditavel', 'voce nao vai acreditar', 'revolucionari', 'vai mudar sua vida', 'mudar tudo', 'garantid', '100%', 'nunca antes', 'o segredo', 'ninguem te conta', 'bombastic', 'urgente', 'definitivo', 'imperdivel']
const ARTIFICIAL = ['no mundo de hoje', 'vale ressaltar', 'e importante destacar', 'em suma', 'mergulhar fundo', 'desbloquear', 'nao e apenas', 'em um mundo cada vez mais', 'no cenario atual', 'jornada', 'sem mais delongas', 'neste artigo']

function frases(texto: string): string[] {
  return texto
    .split(/(?<=[.!?])\s+|\n+/)
    .map((f) => f.trim())
    .filter((f) => f.split(/\s+/).length >= 7)
}

function ngramas(texto: string, n: number): Set<string> {
  const p = normal(texto).split(' ').filter(Boolean)
  const s = new Set<string>()
  for (let i = 0; i + n <= p.length; i++) s.add(p.slice(i, i + n).join(' '))
  return s
}

function jaccard(a: string, b: string): number {
  const A = new Set(normal(a).split(' ').filter((x) => x.length > 2))
  const B = new Set(normal(b).split(' ').filter((x) => x.length > 2))
  if (!A.size || !B.size) return 0
  let i = 0
  for (const x of A) if (B.has(x)) i++
  return i / (A.size + B.size - i)
}

/** Remove partes que não são narração (cabeçalho técnico, lista de fontes e sugestões). */
export function narracaoDoRoteiro(texto: string): string {
  const saida: string[] = []
  let ignorar = false
  for (const l of texto.split(/\r?\n/)) {
    if (l.startsWith('## ')) ignorar = /^## (Fontes|Sugestões)/i.test(l)
    if (ignorar || l.startsWith('#') || l.startsWith('Formato:') || l.startsWith('[Visual:') || l.startsWith('[Texto na tela:')) continue
    saida.push(l.replace(/\[Fontes?:[^\]]*\]/g, ''))
  }
  return saida.join('\n')
}

export function analisarTexto(
  titulo: string,
  texto: string,
  contexto: { anteriores: { titulo: string; conteudo: string }[]; trechosFontes: string[]; numerosDossie: string[] }
): AlertaTexto[] {
  const alertas: AlertaTexto[] = []
  const narracao = narracaoDoRoteiro(texto)

  // Frases repetidas dentro do próprio roteiro.
  const vistas = new Map<string, number>()
  for (const f of frases(narracao)) vistas.set(normal(f), (vistas.get(normal(f)) ?? 0) + 1)
  for (const [f, n] of vistas) if (n > 1) alertas.push({ tipo: 'repeticao', gravidade: 'aviso', mensagem: `Frase repetida ${n} vezes.`, trecho: f.slice(0, 160) })

  // Parágrafos muito parecidos com roteiros anteriores.
  const paragrafos = narracao.split(/\n\s*\n/).filter((p) => p.split(/\s+/).length >= 15)
  for (const a of contexto.anteriores) {
    const outros = narracaoDoRoteiro(a.conteudo).split(/\n\s*\n/).filter((p) => p.split(/\s+/).length >= 15)
    for (const p of paragrafos) {
      if (outros.some((o) => jaccard(p, o) >= 0.6)) {
        alertas.push({ tipo: 'semelhanca', gravidade: 'aviso', mensagem: `Trecho semelhante ao roteiro “${a.titulo}”.`, trecho: p.slice(0, 160) })
        break
      }
    }
  }

  // Material de terceiros: sequência longa idêntica a um trecho de fonte, ou citação longa entre aspas.
  const doRoteiro = ngramas(narracao, 12)
  for (const t of contexto.trechosFontes) {
    const comum = [...ngramas(t, 12)].find((g) => doRoteiro.has(g))
    if (comum) alertas.push({ tipo: 'copia', gravidade: 'critico', mensagem: 'Trecho idêntico (12+ palavras) a uma fonte: reescreva com suas palavras ou cite como citação curta com crédito.', trecho: comum })
  }
  for (const m of narracao.matchAll(/[“"]([^”"]{1,2000})[”"]/g)) {
    if (m[1]!.split(/\s+/).length > 25) alertas.push({ tipo: 'citacao_longa', gravidade: 'aviso', mensagem: 'Citação longa entre aspas: confira direitos e reduza.', trecho: m[1]!.slice(0, 160) })
  }

  // Linguagem exagerada, promessas e marcas de texto artificial.
  const n = ` ${normal(narracao)} `
  for (const e of EXAGEROS) if (n.includes(` ${e}`)) alertas.push({ tipo: 'exagero', gravidade: 'aviso', mensagem: `Termo exagerado ou promessa: “${e}”. Confirme se é sustentado.` })
  for (const a of ARTIFICIAL) if (n.includes(` ${a} `)) alertas.push({ tipo: 'linguagem', gravidade: 'aviso', mensagem: `Expressão com cara de texto artificial: “${a}”.` })

  // Título enganoso ou apelativo.
  const tn = ` ${normal(titulo)} `
  if (/[!?]{2,}/.test(titulo) || (titulo.match(/\b[A-ZÀ-Ú]{4,}\b/g) ?? []).length >= 2 || EXAGEROS.some((e) => tn.includes(` ${e}`))) {
    alertas.push({ tipo: 'titulo', gravidade: 'aviso', mensagem: 'Título com sinais de apelação (exagero, CAIXA ALTA ou pontuação repetida). Confirme que não é enganoso.' })
  }

  // Números/datas na narração que não estão no dossiê.
  const numeros = new Set(contexto.numerosDossie)
  const novos = [...new Set((narracao.match(/\b\d+(?:[.,]\d+)*\s?%?/g) ?? []).map((x) => x.replace(/\s/g, '').replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.')))].filter(
    (x) => !numeros.has(x)
  )
  if (novos.length) alertas.push({ tipo: 'fato_novo', gravidade: 'critico', mensagem: `Números ou datas sem afirmação correspondente no dossiê: ${novos.slice(0, 10).join(', ')}.` })
  return alertas
}

/** Extrai os números do dossiê no mesmo formato usado pela análise. */
export function numerosDeTextos(textos: string[]): string[] {
  return [...new Set(textos.flatMap((t) => (t.match(/\b\d+(?:[.,]\d+)*\s?%?/g) ?? []).map((x) => x.replace(/\s/g, '').replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.'))))]
}
