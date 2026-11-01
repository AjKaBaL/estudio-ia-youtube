import { createHash } from 'node:crypto'
import { type Banco, agoraIso, executar, todos, um } from '../db/conexao'

/**
 * Seções do roteiro e invalidação de aprovações (Etapa 9).
 * Módulo sem dependência de outros repositórios para poder ser chamado ao salvar qualquer versão.
 */

export interface Secao {
  titulo: string
  hash: string
}

/** Divide o texto por títulos "## " (ou por parágrafos, se não houver títulos) e calcula um hash de cada parte. */
export function secoesDoTexto(texto: string): Secao[] {
  const linhas = texto.split(/\r?\n/)
  const temTitulos = linhas.some((l) => l.startsWith('## '))
  const partes: { titulo: string; corpo: string[] }[] = []
  if (temTitulos) {
    let atual = { titulo: 'Início', corpo: [] as string[] }
    for (const l of linhas) {
      if (l.startsWith('## ')) {
        partes.push(atual)
        atual = { titulo: l.slice(3).trim(), corpo: [] }
      } else atual.corpo.push(l)
    }
    partes.push(atual)
  } else {
    texto
      .split(/\n\s*\n/)
      .filter((p) => p.trim())
      .forEach((p, i) => partes.push({ titulo: `Parágrafo ${i + 1}`, corpo: [p] }))
  }
  return partes
    .filter((p) => p.titulo !== 'Início' || p.corpo.join('').trim())
    .map((p) => ({ titulo: p.titulo, hash: createHash('sha256').update(p.corpo.join('\n').trim()).digest('hex').slice(0, 16) }))
}

export function secoesAlteradas(antes: Secao[], depois: Secao[]): string[] {
  const mapa = new Map(antes.map((s) => [s.titulo, s.hash]))
  const alteradas = depois.filter((s) => mapa.get(s.titulo) !== s.hash).map((s) => s.titulo)
  const removidas = antes.filter((s) => !depois.some((d) => d.titulo === s.titulo)).map((s) => `${s.titulo} (removida)`)
  return [...alteradas, ...removidas]
}

/**
 * Chamado sempre que uma nova versão é salva: aprovações de versões anteriores cujas seções mudaram
 * são invalidadas, e um roteiro aprovado volta para "em revisão".
 */
export function invalidarAprovacoesSeAlterado(db: Banco, roteiroId: number): string[] {
  const atual = um<{ conteudo: string; numero: number }>(
    db,
    'SELECT v.conteudo, v.numero FROM roteiros r JOIN roteiro_versoes v ON v.roteiro_id = r.id AND v.numero = r.versao_atual WHERE r.id = :id',
    { id: roteiroId }
  )
  if (!atual) return []
  const novas = secoesDoTexto(atual.conteudo)
  const validas = todos<{ id: number; tipo: string; versao: number; secoes: string }>(
    db,
    "SELECT id, tipo, versao_numero AS versao, secoes FROM aprovacoes WHERE roteiro_id = :id AND acao = 'aprovado' AND invalidada_em IS NULL AND versao_numero < :n",
    { id: roteiroId, n: atual.numero }
  )
  const todasAlteradas = new Set<string>()
  for (const a of validas) {
    const alteradas = secoesAlteradas(JSON.parse(a.secoes) as Secao[], novas)
    if (!alteradas.length) {
      // Nada mudou no texto: a aprovação continua valendo para a nova versão.
      executar(db, 'UPDATE aprovacoes SET versao_numero = :n WHERE id = :id', { id: a.id, n: atual.numero })
      continue
    }
    alteradas.forEach((s) => todasAlteradas.add(s))
    executar(db, 'UPDATE aprovacoes SET invalidada_em = :t, invalidada_motivo = :m WHERE id = :id', {
      id: a.id,
      t: agoraIso(),
      m: `Alterado na versão ${atual.numero}: ${alteradas.join(', ')}`.slice(0, 500)
    })
    executar(
      db,
      `INSERT INTO aprovacoes (roteiro_id, versao_numero, tipo, acao, comentario, secoes, criado_em)
       VALUES (:r, :n, :tipo, 'invalidada', :c, :s, :t)`,
      { r: roteiroId, n: atual.numero, tipo: a.tipo, c: `Aprovação ${a.tipo} da versão ${a.versao} invalidada: ${alteradas.join(', ')}`.slice(0, 500), s: JSON.stringify(novas), t: agoraIso() }
    )
  }
  if (todasAlteradas.size) {
    executar(db, "UPDATE roteiros SET status = 'em_revisao' WHERE id = :id AND status = 'aprovado'", { id: roteiroId })
  }
  return [...todasAlteradas]
}
