import { describe, expect, it } from 'vitest'
import { executar } from '../db/conexao'
import { processarFilaPesquisa } from '../pesquisa/agendadas'
import { criarExecucao, executarPesquisa, GerenciadorPesquisas, type DependenciasPesquisa } from '../pesquisa/executor'
import * as lotes from '../repositorios/lotes'
import * as pautas from '../repositorios/pautas'
import * as pesquisa from '../repositorios/pesquisa'
import { listarTarefas } from '../repositorios/tarefas'
import { PESOS_PADRAO, avaliarPauta, type FontePreliminar } from '@shared/planejador'
import { pautaNovaSchema } from '@shared/schemas'
import { bancoDeTeste, projetoDeTeste, roteiroDeTeste } from './auxiliares'

const AGORA = new Date('2026-10-31T12:00:00Z')
const fonte = (d: Partial<FontePreliminar> = {}): FontePreliminar => ({
  dominio: 'exemplo.com.br',
  tipoFonte: 'outro',
  publicadaEm: '2026-10-30T12:00:00Z',
  relevancia: 0.8,
  confiabilidade: 0.6,
  nicho: 0.5,
  alertaInjecao: false,
  ...d
})

describe('avaliação de pauta (regras fixas)', () => {
  it('sem fontes: risco alto, penalidade e aviso de que não prevê visualizações', () => {
    const a = avaliarPauta({ tipoSugerido: null, potencialNarrativa: null, resumo: '' }, [], [], PESOS_PADRAO, AGORA)
    expect(a.riscos[0]).toMatchObject({ codigo: 'sem_fontes', nivel: 'alto' })
    expect(a.pontuacao.penalidades.some((p) => p.pontos === PESOS_PADRAO.penalidadeRiscoAlto)).toBe(true)
    expect(a.pontuacao.aviso).toMatch(/Não prevê visualizações/)
  })

  it('explica cada fator e reage aos pesos configuráveis', () => {
    const fontes = [fonte(), fonte({ dominio: 'gov.br', tipoFonte: 'oficial', confiabilidade: 0.85 }), fonte({ dominio: 'outro.org' })]
    const a = avaliarPauta({ tipoSugerido: null, potencialNarrativa: 5, resumo: '' }, fontes, [], PESOS_PADRAO, AGORA)
    expect(a.pontuacao.fatores.map((f) => f.chave)).toEqual(['atualidade', 'relevancia', 'confiabilidade', 'nicho', 'diversidade', 'narrativa'])
    expect(a.pontuacao.fatores.every((f) => f.explicacao.includes('%'))).toBe(true)
    expect(a.tipoSugerido).toMatchObject({ tipo: 'longo', definidoPeloUsuario: false })
    expect(a.atualidade.rotulo).toBe('Muito atual')
    const soNarrativa = avaliarPauta({ tipoSugerido: null, potencialNarrativa: 1, resumo: '' }, fontes, [], { ...PESOS_PADRAO, atualidade: 0, relevancia: 0, confiabilidade: 0, nicho: 0, diversidade: 0, narrativa: 1 }, AGORA)
    expect(soNarrativa.pontuacao.total).toBe(0)
  })

  it('aponta fonte única, direitos autorais, texto suspeito e semelhança sem bloquear', () => {
    const a = avaliarPauta(
      { tipoSugerido: 'short', potencialNarrativa: null, resumo: '' },
      [fonte({ dominio: 'youtube.com', tipoFonte: 'rede_social', alertaInjecao: true })],
      [{ tipo: 'roteiro', id: 1, titulo: 'Roteiro antigo', similaridade: 0.8 }],
      PESOS_PADRAO,
      AGORA
    )
    expect(a.riscos.map((r) => r.codigo)).toEqual(expect.arrayContaining(['fonte_unica', 'direitos', 'injecao', 'repetido']))
    expect(a.recomendacao).toMatch(/diferencie/)
    expect(a.tipoSugerido).toMatchObject({ tipo: 'short', definidoPeloUsuario: true })
  })
})

const RSS = `<rss><channel><title>T</title>
<item><title>Agentes de IA chegam ao varejo brasileiro</title><link>https://a.exemplo.com.br/1</link><pubDate>Fri, 30 Oct 2026 10:00:00 GMT</pubDate><description>Agentes de IA no varejo.</description></item>
<item><title>Varejo testa agentes de IA em lojas</title><link>https://b.exemplo.org/2</link><pubDate>Fri, 30 Oct 2026 11:00:00 GMT</pubDate><description>Testes com agentes.</description></item>
</channel></rss>`
const deps: DependenciasPesquisa = { agora: () => AGORA, buscar: async (url) => ({ urlFinal: url, status: 200, tipoConteudo: 'application/rss+xml', corpo: RSS, cabecalhos: {} }) }

async function comResultados() {
  const db = bancoDeTeste()
  const p = projetoDeTeste(db)
  pesquisa.adicionarFontePesquisa(db, { projetoId: p, tipo: 'rss', nome: 'Feed', url: 'https://feed.exemplo.com/rss' })
  const ex = criarExecucao(db, { projetoId: p, consulta: 'agentes', pautaId: null, origem: 'manual' }, AGORA)
  await executarPesquisa(db, ex, deps, new AbortController().signal)
  return { db, p, ex, resultados: pesquisa.obterExecucao(db, ex).resultados }
}

describe('pautas a partir da pesquisa', () => {
  it('cria cartão com fontes preliminares sem alterar a pesquisa', async () => {
    const { db, p, ex, resultados } = await comResultados()
    const antes = JSON.stringify(pesquisa.obterExecucao(db, ex))
    const pauta = pautas.pautaDeResultados(db, p, resultados.map((r) => r.id))
    expect(pauta.origem).toBe('pesquisa')
    expect(pauta.fontes).toHaveLength(2)
    expect(pauta.resumo).toContain('Agentes de IA no varejo')
    expect(pauta.avaliacao.riscos.some((r) => r.codigo === 'fonte_unica')).toBe(false)
    expect(JSON.stringify(pesquisa.obterExecucao(db, ex))).toBe(antes)
  })

  it('combina pautas: as originais ficam preservadas e marcadas', async () => {
    const { db, p, resultados } = await comResultados()
    const a = pautas.pautaDeResultados(db, p, [resultados[0]!.id])
    const b = pautas.pautaDeResultados(db, p, [resultados[1]!.id])
    const c = pautas.combinarPautas(db, [a.id, b.id], 'Agentes de IA no varejo')
    expect(c.fontes).toHaveLength(2)
    expect(c.notas).toMatch(/Combinada de/)
    expect(pautas.obterPauta(db, a.id)).toMatchObject({ combinadaEm: c.id, titulo: a.titulo, resumo: a.resumo })
    expect(pautas.listarPautas(db, { texto: '', status: null }).map((x) => x.id)).toEqual([c.id])
    expect(() => pautas.combinarPautas(db, [a.id, c.id], 'x')).toThrow(/já foi combinada/)
  })

  it('detecta tema parecido com roteiro anterior e recomenda diferenciar', () => {
    const db = bancoDeTeste()
    const p = projetoDeTeste(db)
    roteiroDeTeste(db, p, { titulo: 'Agentes de IA no varejo brasileiro', tema: 'varejo' })
    const nova = pautas.criarPauta(db, pautaNovaSchema.parse({ projetoId: p, titulo: 'Agentes de IA no varejo', tema: 'varejo' }))
    expect(nova.avaliacao.semelhantes[0]).toMatchObject({ tipo: 'roteiro' })
    expect(nova.avaliacao.recomendacao).toMatch(/diferencie/)
  })

  it('aprovar, rejeitar e editar mantêm o restante intacto', () => {
    const db = bancoDeTeste()
    const p = projetoDeTeste(db)
    const a = pautas.criarPauta(db, pautaNovaSchema.parse({ projetoId: p, titulo: 'Pauta', perguntaCentral: 'Por quê?' }))
    expect(pautas.alterarStatusPauta(db, a.id, 'aprovada')).toMatchObject({ status: 'aprovada', perguntaCentral: 'Por quê?' })
    expect(pautas.alterarStatusPauta(db, a.id, 'descartada').status).toBe('descartada')
    const ed = pautas.atualizarPauta(db, { ...a, status: 'ideia', potencialNarrativa: 4, publico: 'Pequenos empresários' })
    expect(ed).toMatchObject({ potencialNarrativa: 4, publico: 'Pequenos empresários' })
  })

  it('fila de pesquisa: a tarefa usa as palavras-chave da pauta e vincula a execução', async () => {
    const { db, p } = await comResultados()
    const a = pautas.criarPauta(db, pautaNovaSchema.parse({ projetoId: p, titulo: 'Agentes', palavrasChave: ['agentes', 'varejo'] }))
    expect(pautas.colocarNaFilaPesquisa(db, a.id).naFilaPesquisa).toBe(true)
    expect(() => pautas.colocarNaFilaPesquisa(db, a.id)).toThrow(/já está na fila/)
    await processarFilaPesquisa(db, new GerenciadorPesquisas(db, deps))
    expect(listarTarefas(db)[0]).toMatchObject({ status: 'concluida' })
    expect(pesquisa.listarExecucoes(db, p, 1)[0]!.consulta).toBe('agentes, varejo')
    expect(pautas.obterPauta(db, a.id).naFilaPesquisa).toBe(false)
  })
})

describe('lotes', () => {
  it('lote semanal reúne pautas da semana com metas da agenda e alerta excesso', () => {
    const db = bancoDeTeste()
    const p = projetoDeTeste(db)
    const criar = (titulo: string, tipo: 'longo' | 'short') => pautas.criarPauta(db, pautaNovaSchema.parse({ projetoId: p, titulo, tipoSugerido: tipo }))
    const longos = [criar('L1', 'longo'), criar('L2', 'longo')]
    const s = [criar('S1', 'short'), criar('S2', 'short')]
    const velha = criar('Antiga', 'short')
    executar(db, "UPDATE pautas SET criado_em = '2026-01-01T00:00:00.000Z' WHERE id = :id", { id: velha.id })
    const lote = lotes.gerarLoteSemanal(db, p, new Date())
    expect(lote).toMatchObject({ metaLongos: 1, metaShorts: 3 })
    expect(lote.pautas.map((x) => x.titulo).sort()).toEqual(['L1', 'L2', 'S1', 'S2'])
    lotes.selecionarNoLote(db, lote.id, longos[0]!.id, true)
    const comExcesso = lotes.selecionarNoLote(db, lote.id, longos[1]!.id, true)
    expect(comExcesso.alertas[0]).toMatch(/2 vídeos longos para uma meta de 1/)
    lotes.selecionarNoLote(db, lote.id, s[0]!.id, true)
    const fechado = lotes.fecharLote(db, lote.id, true)
    expect(fechado.status).toBe('fechado')
    expect(() => lotes.selecionarNoLote(db, lote.id, s[1]!.id, true)).toThrow(/fechado/)
    // Vários lotes em paralelo.
    lotes.criarLote(db, { projetoId: p, nome: 'Especial', inicio: '2026-11-01', fim: '2026-11-30', metaLongos: 2, metaShorts: 6 })
    expect(lotes.listarLotes(db, p)).toHaveLength(2)
  })
})
