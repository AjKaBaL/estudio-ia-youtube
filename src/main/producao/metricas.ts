import type { YouTubeGateway } from '@estudio/youtube'
import { type Banco, agoraIso, executar, todos, transacao, um } from '../db/conexao'
import { naoEncontrado } from '../erros'
import { palavras } from '../pesquisa/texto'
import { duracaoEstimadaSeg } from '@shared/diff'
import { inicioSemana, somarDias } from '@shared/tempo'
import type { LinhaPainelMetricas, PainelMetricas, RelatorioSemanal, Sugestao } from '@shared/tipos'

/**
 * Métricas por meios oficiais (YouTube Analytics API) e relatório semanal (Etapa 15).
 * Mostra só o que a API devolve para a conta autorizada; recomendações são sugestões para aprovação.
 */

export const LIMITACOES = [
  'Os dados do YouTube Analytics costumam ter atraso de um a alguns dias e podem ser revisados depois.',
  'Impressões e taxa de cliques da miniatura não estão disponíveis na API pública de relatórios; consulte o YouTube Studio.',
  'Vídeos longos e Shorts têm dinâmicas diferentes (descoberta, duração, retenção); compare cada formato com ele mesmo.',
  'Vídeos publicados há menos tempo tiveram menos tempo para acumular visualizações.',
  'Com poucos vídeos, qualquer comparação é frágil. Correlação não indica causa.',
  'Receita e RPM exigem canal monetizado e permissão específica; não são coletados nesta versão.'
]

const hojeIso = (agora: Date): string => agora.toISOString().slice(0, 10)

/** Coleta números das publicações enviadas. Falta de permissão vira mensagem clara (não inventa dados). */
export async function coletarMetricas(db: Banco, yt: YouTubeGateway, agora = new Date()): Promise<{ coletados: number }> {
  const pubs = todos<{ id: number; videoId: string; enviadoEm: string }>(
    db,
    "SELECT id, video_id AS videoId, enviado_em AS enviadoEm FROM publicacoes WHERE video_id IS NOT NULL AND status IN ('processando','concluida')"
  )
  if (!pubs.length) return { coletados: 0 }
  const inicio = pubs.map((p) => p.enviadoEm.slice(0, 10)).sort()[0]!
  const fim = hojeIso(agora)
  const linhas = await yt.metricas(inicio, fim, pubs.map((p) => p.videoId))
  transacao(db, () => {
    for (const l of linhas) {
      const p = pubs.find((x) => x.videoId === l.videoId)
      if (!p) continue
      executar(
        db,
        `INSERT INTO metricas_videos (publicacao_id, video_id, coletado_em, periodo_inicio, periodo_fim, visualizacoes, minutos_assistidos, duracao_media_seg, percentual_medio, inscritos_ganhos)
         VALUES (:p, :v, :t, :i, :f, :vis, :min, :dur, :perc, :ins)`,
        { p: p.id, v: l.videoId, t: agoraIso(), i: p.enviadoEm.slice(0, 10), f: fim, vis: l.visualizacoes ?? null, min: l.minutosAssistidos ?? null, dur: l.duracaoMediaSeg ?? null, perc: l.percentualMedioAssistido ?? null, ins: l.inscritosGanhos ?? null }
      )
    }
  })
  return { coletados: linhas.length }
}

function mediana(v: number[]): number | null {
  if (!v.length) return null
  const s = [...v].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}

export function painelMetricas(db: Banco, filtro: { de: string | null; ate: string | null; tipo: 'longo' | 'short' | null }, agora = new Date()): PainelMetricas {
  const linhas = todos<Omit<LinhaPainelMetricas, 'diasDesdePublicacao' | 'duracaoRoteiroSeg' | 'relacaoComMediana' | 'custoEstimado'> & { conteudo: string; tema: string }>(
    db,
    `SELECT p.id AS publicacaoId, p.video_id AS videoId, p.video_url AS videoUrl, p.titulo, r.tipo_video AS tipoVideo, r.tema, v.conteudo,
       p.enviado_em AS publicadoEm, m.visualizacoes, m.minutos_assistidos AS minutosAssistidos, m.duracao_media_seg AS duracaoMediaSeg,
       m.percentual_medio AS percentualMedio, m.inscritos_ganhos AS inscritosGanhos, m.coletado_em AS coletadoEm
     FROM publicacoes p JOIN roteiros r ON r.id = p.roteiro_id
     JOIN roteiro_versoes v ON v.roteiro_id = r.id AND v.numero = r.versao_atual
     LEFT JOIN metricas_videos m ON m.id = (SELECT MAX(id) FROM metricas_videos WHERE publicacao_id = p.id)
     WHERE p.video_id IS NOT NULL
       AND (:de IS NULL OR substr(p.enviado_em, 1, 10) >= :de) AND (:ate IS NULL OR substr(p.enviado_em, 1, 10) <= :ate)
       AND (:tipo IS NULL OR r.tipo_video = :tipo)
     ORDER BY p.enviado_em DESC`,
    { de: filtro.de, ate: filtro.ate, tipo: filtro.tipo }
  )
  const medianas = {
    longo: mediana(linhas.filter((l) => l.tipoVideo === 'longo' && l.visualizacoes !== null).map((l) => l.visualizacoes!)),
    short: mediana(linhas.filter((l) => l.tipoVideo === 'short' && l.visualizacoes !== null).map((l) => l.visualizacoes!))
  }
  const resultado: LinhaPainelMetricas[] = linhas.map(({ conteudo, tema: _t, ...l }) => {
    const custo = um<{ c: number | null }>(db, "SELECT SUM(custo) AS c FROM uso_servicos WHERE finalidade LIKE '%' || :t || '%'", { t: l.titulo.slice(0, 60) })?.c ?? null
    const med = medianas[l.tipoVideo]
    return {
      ...l,
      diasDesdePublicacao: l.publicadoEm ? Math.floor((agora.getTime() - new Date(l.publicadoEm).getTime()) / 86_400_000) : null,
      duracaoRoteiroSeg: duracaoEstimadaSeg(conteudo),
      relacaoComMediana: med && l.visualizacoes !== null ? l.visualizacoes / med : null,
      custoEstimado: custo
    }
  })
  return { linhas: resultado, limitacoes: LIMITACOES, amostra: { longo: linhas.filter((l) => l.tipoVideo === 'longo').length, short: linhas.filter((l) => l.tipoVideo === 'short').length } }
}

/** Relatório semanal explicável, com sugestões registradas como pendentes. */
export function gerarRelatorioSemanal(db: Banco, dataReferencia: string, agora = new Date()): RelatorioSemanal {
  const inicio = inicioSemana(dataReferencia)
  const fim = somarDias(inicio, 6)
  const todosDados = painelMetricas(db, { de: null, ate: null, tipo: null }, agora)
  const daSemana = todosDados.linhas.filter((l) => l.publicadoEm && l.publicadoEm.slice(0, 10) >= inicio && l.publicadoEm.slice(0, 10) <= fim)
  const comDados = todosDados.linhas.filter((l) => l.visualizacoes !== null)
  const observacoes: string[] = []
  const sugestoes: { tipo: string; texto: string }[] = []
  if (!comDados.length) observacoes.push('Ainda não há métricas autorizadas coletadas. Conecte a conta com permissão de análise e use “Atualizar métricas”.')
  for (const tipo of ['longo', 'short'] as const) {
    const grupo = comDados.filter((l) => l.tipoVideo === tipo)
    if (grupo.length && grupo.length < 5) observacoes.push(`${tipo === 'longo' ? 'Vídeos longos' : 'Shorts'}: apenas ${grupo.length} vídeo(s) com dados — comparações são frágeis.`)
    for (const l of grupo) {
      if (l.relacaoComMediana !== null && (l.diasDesdePublicacao ?? 0) >= 7) {
        if (l.relacaoComMediana >= 1.5) observacoes.push(`“${l.titulo}” teve ${l.relacaoComMediana.toFixed(1)}× a mediana dos ${tipo === 'longo' ? 'vídeos longos' : 'Shorts'} do canal (${l.diasDesdePublicacao} dias publicado).`)
        if (l.relacaoComMediana <= 0.5) observacoes.push(`“${l.titulo}” ficou abaixo da metade da mediana do formato (${l.diasDesdePublicacao} dias publicado).`)
      }
      if (tipo === 'longo' && l.percentualMedio !== null && l.percentualMedio < 30) {
        sugestoes.push({ tipo: 'narrativa', texto: `Retenção média de ${l.percentualMedio.toFixed(0)}% em “${l.titulo}”: testar uma abertura que apresente a pergunta mais cedo.` })
      }
      if (tipo === 'short' && l.percentualMedio !== null && l.percentualMedio < 50) {
        sugestoes.push({ tipo: 'narrativa', texto: `Short “${l.titulo}” com ${l.percentualMedio.toFixed(0)}% assistido em média: testar começar pela informação principal.` })
      }
      if (tipo === 'longo' && l.duracaoMediaSeg !== null && l.duracaoRoteiroSeg > 0 && l.duracaoMediaSeg < l.duracaoRoteiroSeg * 0.25) {
        sugestoes.push({ tipo: 'duracao', texto: `Em “${l.titulo}”, a duração média assistida é bem menor que a do vídeo: avaliar um formato mais curto para temas parecidos.` })
      }
    }
  }
  const acima = comDados.filter((l) => (l.relacaoComMediana ?? 0) >= 1.2)
  const contagem = new Map<string, number>()
  for (const l of acima) for (const p of new Set(palavras(l.titulo))) contagem.set(p, (contagem.get(p) ?? 0) + 1)
  const temas = [...contagem.entries()].filter(([, n]) => n >= 1).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([p]) => p)
  if (temas.length) sugestoes.push({ tipo: 'tema', texto: `Temas para novos testes (aparecem em vídeos acima da mediana): ${temas.join(', ')}. Isso não garante resultado.` })
  if (comDados.length >= 3) sugestoes.push({ tipo: 'titulo', texto: 'Teste títulos mais diretos na pergunta central em um próximo vídeo e compare com o histórico do mesmo formato.' })
  const custo = um<{ c: number | null; n: number }>(db, 'SELECT SUM(custo) AS c, COUNT(*) AS n FROM uso_servicos WHERE substr(criado_em, 1, 10) BETWEEN :i AND :f', { i: inicio, f: fim })
  const conteudo: RelatorioSemanal['conteudo'] = {
    semana: { inicio, fim },
    publicados: daSemana.map((l) => ({ titulo: l.titulo, tipo: l.tipoVideo, url: l.videoUrl, publicadoEm: l.publicadoEm })),
    resultados: daSemana.map((l) => ({ titulo: l.titulo, visualizacoes: l.visualizacoes, percentualMedio: l.percentualMedio, dias: l.diasDesdePublicacao })),
    observacoes,
    custos: { valor: custo?.c ?? 0, chamadas: custo?.n ?? 0 },
    limitacoes: LIMITACOES
  }
  return transacao(db, () => {
    const { id } = executar(db, 'INSERT INTO relatorios_semanais (semana_inicio, conteudo, criado_em) VALUES (:s, :c, :t)', { s: inicio, c: JSON.stringify(conteudo), t: agoraIso() })
    for (const s of sugestoes) executar(db, 'INSERT INTO sugestoes (relatorio_id, tipo, texto, criado_em) VALUES (:r, :tipo, :texto, :t)', { r: id, tipo: s.tipo, texto: s.texto.slice(0, 500), t: agoraIso() })
    return obterRelatorioSemanal(db, id)
  })
}

export function obterRelatorioSemanal(db: Banco, id: number): RelatorioSemanal {
  const r = um<{ id: number; semanaInicio: string; conteudo: string; criadoEm: string }>(db, 'SELECT id, semana_inicio AS semanaInicio, conteudo, criado_em AS criadoEm FROM relatorios_semanais WHERE id = :id', { id })
  if (!r) throw naoEncontrado('Relatório')
  return { ...r, conteudo: JSON.parse(r.conteudo) as RelatorioSemanal['conteudo'], sugestoes: listarSugestoes(db, id) }
}

export function listarRelatoriosSemanais(db: Banco): { id: number; semanaInicio: string; criadoEm: string }[] {
  return todos(db, 'SELECT id, semana_inicio AS semanaInicio, criado_em AS criadoEm FROM relatorios_semanais ORDER BY id DESC LIMIT 52')
}

export function listarSugestoes(db: Banco, relatorioId: number | null): Sugestao[] {
  return todos<Sugestao>(
    db,
    `SELECT id, relatorio_id AS relatorioId, tipo, texto, status, criado_em AS criadoEm, decidido_em AS decididoEm FROM sugestoes
     ${relatorioId ? 'WHERE relatorio_id = :r' : ''} ORDER BY id DESC LIMIT 200`,
    relatorioId ? { r: relatorioId } : {}
  )
}

/** Aceitar só registra a decisão: nada no calendário ou na identidade editorial muda automaticamente. */
export function decidirSugestao(db: Banco, id: number, aceita: boolean): void {
  if (executar(db, "UPDATE sugestoes SET status = :s, decidido_em = :t WHERE id = :id AND status = 'pendente'", { id, s: aceita ? 'aceita' : 'rejeitada', t: agoraIso() }).changes === 0) throw naoEncontrado('Sugestão pendente')
}

export function relatorioSemanalMarkdown(r: RelatorioSemanal): string {
  const c = r.conteudo
  const l = [
    `# Relatório semanal — ${c.semana.inicio} a ${c.semana.fim}`,
    '',
    '## Publicados',
    ...(c.publicados.length ? c.publicados.map((p) => `- ${p.titulo} (${p.tipo}) — ${p.url ?? 'sem link'}`) : ['Nenhum vídeo publicado nesta semana.']),
    '',
    '## Resultados observados',
    ...(c.resultados.length ? c.resultados.map((x) => `- ${x.titulo}: ${x.visualizacoes ?? 'sem dados'} visualizações; ${x.percentualMedio === null ? 'retenção sem dados' : `${x.percentualMedio.toFixed(0)}% assistido em média`}; ${x.dias ?? '?'} dia(s) publicado`) : ['Sem dados.']),
    '',
    '## Observações',
    ...(c.observacoes.length ? c.observacoes.map((o) => `- ${o}`) : ['Nenhuma.']),
    '',
    '## Sugestões (para aprovação; nada é aplicado automaticamente)',
    ...(r.sugestoes.length ? r.sugestoes.map((s) => `- [${s.status}] ${s.texto}`) : ['Nenhuma.']),
    '',
    `## Custos de serviços na semana`,
    `- ${c.custos.chamadas} chamada(s), custo aproximado ${c.custos.valor.toFixed(4)}`,
    '',
    '## Limitações',
    ...c.limitacoes.map((x) => `- ${x}`)
  ]
  return `${l.join('\n')}\n`
}
