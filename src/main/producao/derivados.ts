import { type Banco, executar, transacao } from '../db/conexao'
import { ErroApp } from '../erros'
import { relatorio } from '../repositorios/dossie'
import { criarRoteiro, obterRoteiro } from '../repositorios/roteiros'
import { contarPalavras } from '@shared/diff'
import type { IdeiaShort, RoteiroCompleto } from '@shared/tipos'

/**
 * Shorts derivados de um vídeo longo (Etapa 14): só ideias que façam sentido sozinhas,
 * sempre com frases inteiras (nunca corta uma afirmação no meio). O Short vira conteúdo próprio
 * e versionado, ligado ao roteiro de origem.
 */

const MAX_PALAVRAS_SHORT = 160 // ~60 s a ~165 palavras/min
const MIN_PALAVRAS = 25

function frasesInteiras(texto: string): string[] {
  return texto
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?…])\s+/)
    .filter((f) => /[.!?…]$/.test(f))
}

/** Junta frases inteiras até o limite; se a primeira já passar do limite, não serve. */
function encaixar(frases: string[]): string | null {
  const escolhidas: string[] = []
  for (const f of frases) {
    if (contarPalavras([...escolhidas, f].join(' ')) > MAX_PALAVRAS_SHORT) break
    escolhidas.push(f)
  }
  const texto = escolhidas.join(' ')
  return contarPalavras(texto) >= MIN_PALAVRAS ? texto : null
}

export function ideiasParaShorts(db: Banco, roteiroId: number): IdeiaShort[] {
  const r = obterRoteiro(db, roteiroId)
  if (r.tipoVideo !== 'longo') throw new ErroApp('tipo', 'Shorts derivados partem de um roteiro de vídeo longo.')
  const ideias: IdeiaShort[] = []
  // Cada bloco do roteiro longo (exceto abertura e conclusão) é candidato, se couber com frases inteiras.
  let titulo: string | null = null
  let corpo: string[] = []
  const fechar = (): void => {
    if (titulo && !/^(Abertura|Conclusão)$/i.test(titulo)) {
      const texto = encaixar(frasesInteiras(corpo.join(' ')))
      if (texto) ideias.push({ chave: `cena:${titulo}`, titulo, texto, palavras: contarPalavras(texto), origem: 'cena' })
    }
  }
  for (const l of r.conteudo.split(/\r?\n/)) {
    if (l.startsWith('## ')) {
      fechar()
      titulo = /^## (Fontes|Sugestões)/i.test(l) ? null : l.slice(3).replace(/^(Bloco|Parte) \d+ — /, '').trim()
      corpo = []
    } else if (titulo && !l.startsWith('[') && !l.startsWith('#') && !l.startsWith('Formato:')) {
      corpo.push(l.replace(/\[Fontes?:[^\]]*\]/g, ''))
    }
  }
  fechar()
  // Afirmações verificadas que se sustentam sozinhas também são candidatas.
  for (const a of relatorio(db, { pautaId: null, roteiroId }).afirmacoes) {
    if (a.verificacao.pronta && a.texto.split(/\s+/).length >= 8 && a.fontes.length) {
      ideias.push({ chave: `afirmacao:${a.id}`, titulo: a.texto.slice(0, 60), texto: a.texto, palavras: contarPalavras(a.texto), origem: 'afirmacao' })
    }
  }
  return ideias
}

export function criarShortDerivado(db: Banco, roteiroId: number, chave: string): RoteiroCompleto {
  const origem = obterRoteiro(db, roteiroId)
  const ideia = ideiasParaShorts(db, roteiroId).find((i) => i.chave === chave)
  if (!ideia) throw new ErroApp('ideia', 'Ideia não encontrada neste roteiro.')
  const frases = frasesInteiras(ideia.texto)
  const abertura = frases[0] ?? ideia.texto
  const resto = frases.slice(1).join(' ') || ideia.texto
  const conteudo = [
    `# ${ideia.titulo}`,
    '',
    `Formato: Short (9:16, vertical) · derivado de “${origem.titulo}”`,
    '',
    '## Abertura',
    '',
    abertura,
    '[Visual: vertical 9:16, texto grande e legível no centro; primeiros 2 segundos com a ideia principal.]',
    '',
    '## Parte 1',
    '',
    resto,
    '[Visual: enquadramento vertical; evitar elementos nas bordas onde ficam botões do app.]',
    '',
    '## Conclusão',
    '',
    '[Escreva um fechamento que conclua a ideia sem depender do vídeo longo.]',
    ''
  ].join('\n')
  return transacao(db, () => {
    const novo = criarRoteiro(db, {
      projetoId: origem.projetoId,
      pautaId: origem.pautaId,
      titulo: `Short: ${ideia.titulo}`.slice(0, 200),
      tema: origem.tema,
      tipoVideo: 'short',
      notas: `Derivado do roteiro nº ${origem.id} (“${origem.titulo}”), versão ${origem.versaoAtual}. Origem: ${ideia.origem}.`,
      dataPrevista: null,
      palavrasChave: origem.palavrasChave,
      conteudo
    })
    executar(db, 'UPDATE roteiros SET origem_roteiro_id = :o WHERE id = :id', { id: novo.id, o: origem.id })
    executar(db, "UPDATE roteiro_versoes SET origem = 'derivado', resumo_alteracoes = :r WHERE roteiro_id = :id AND numero = 1", { id: novo.id, r: `Short derivado do roteiro nº ${origem.id}` })
    // Fontes do roteiro de origem continuam disponíveis no Short.
    executar(db, 'INSERT OR IGNORE INTO roteiro_fontes (roteiro_id, fonte_id) SELECT :n, fonte_id FROM roteiro_fontes WHERE roteiro_id = :o', { n: novo.id, o: origem.id })
    return obterRoteiro(db, novo.id)
  })
}
