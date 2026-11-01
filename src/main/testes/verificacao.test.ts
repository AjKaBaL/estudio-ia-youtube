import { describe, expect, it } from 'vitest'
import { criarExecucao, executarPesquisa } from '../pesquisa/executor'
import * as dossie from '../repositorios/dossie'
import * as pautas from '../repositorios/pautas'
import * as pesquisa from '../repositorios/pesquisa'
import { pautaNovaSchema } from '@shared/schemas'
import { verificarAfirmacao, type VinculoFonte } from '@shared/verificacao'
import { bancoDeTeste, projetoDeTeste, roteiroDeTeste } from './auxiliares'

const AGORA = new Date('2026-10-31T12:00:00Z')
const v = (d: Partial<VinculoFonte>): VinculoFonte => ({ dominio: 'a.com', tipoFonte: 'jornalistica', papel: 'secundaria', posicao: 'sustenta', publicadaEm: '2026-10-30', ...d })
const fato = { natureza: 'fato' as const, relevante: true, temaRapido: false, decisao: null }

describe('situação das afirmações (regras fixas)', () => {
  it('sem fonte, parcial, confirmada e conflitante', () => {
    expect(verificarAfirmacao(fato, [], AGORA)).toMatchObject({ situacao: 'sem_fonte', confianca: 'baixa', pronta: false })
    expect(verificarAfirmacao(fato, [v({})], AGORA)).toMatchObject({ situacao: 'parcial', pronta: false })
    expect(verificarAfirmacao(fato, [v({}), v({ dominio: 'b.org' })], AGORA)).toMatchObject({ situacao: 'confirmada', confianca: 'alta', pronta: true })
    expect(verificarAfirmacao(fato, [v({ papel: 'primaria', tipoFonte: 'oficial', dominio: 'gov.br' })], AGORA).situacao).toBe('confirmada')
    expect(verificarAfirmacao(fato, [v({}), v({ dominio: 'c.net', posicao: 'contradiz' })], AGORA)).toMatchObject({ situacao: 'conflitante', pronta: false })
    // Duas matérias do mesmo site não são fontes independentes.
    expect(verificarAfirmacao(fato, [v({}), v({})], AGORA).situacao).toBe('parcial')
  })
  it('opinião, estimativa e afirmações de menor relevância', () => {
    expect(verificarAfirmacao({ ...fato, natureza: 'opiniao' }, [], AGORA)).toMatchObject({ situacao: 'opiniao', pronta: true })
    expect(verificarAfirmacao({ ...fato, natureza: 'estimativa' }, [v({}), v({ dominio: 'b.org' })], AGORA).razao).toMatch(/como estimativa, não como fato/)
    expect(verificarAfirmacao({ ...fato, relevante: false }, [v({})], AGORA).situacao).toBe('confirmada')
  })
  it('tema em rápida mudança exige fonte recente', () => {
    const r = verificarAfirmacao({ ...fato, temaRapido: true }, [v({ publicadaEm: '2026-08-01' }), v({ dominio: 'b.org', publicadaEm: '2026-08-02' })], AGORA)
    expect(r.situacao).toBe('confirmada')
    expect(r.pronta).toBe(false)
    expect(r.pendencias[0]).toMatch(/90 dias/)
  })
  it('decisões do usuário: incerta assumida, remover e corrigir', () => {
    expect(verificarAfirmacao({ ...fato, decisao: 'incerto' }, [], AGORA)).toMatchObject({ pronta: true, pendencias: [] })
    expect(verificarAfirmacao({ ...fato, decisao: 'remover' }, [], AGORA)).toMatchObject({ pronta: false, removida: true, pendencias: [] })
    expect(verificarAfirmacao({ ...fato, decisao: 'corrigir' }, [v({}), v({ dominio: 'b.org' })], AGORA).pendencias.join()).toMatch(/Correção solicitada/)
  })
})

describe('dossiê no banco', () => {
  it('liga afirmações a resultados reais e gera relatório com pendências', async () => {
    const db = bancoDeTeste()
    const p = projetoDeTeste(db)
    pesquisa.adicionarFontePesquisa(db, { projetoId: p, tipo: 'rss', nome: 'F', url: 'https://f.exemplo/rss' })
    const RSS = '<rss><channel><item><title>Governo publica norma de IA</title><link>https://www.gov.br/norma</link><pubDate>Fri, 30 Oct 2026 10:00:00 GMT</pubDate></item></channel></rss>'
    const ex = criarExecucao(db, { projetoId: p, consulta: 'norma', pautaId: null, origem: 'manual' }, AGORA)
    await executarPesquisa(db, ex, { agora: () => AGORA, buscar: async (url) => ({ urlFinal: url, status: 200, tipoConteudo: 'application/rss+xml', corpo: RSS, cabecalhos: {} }) }, new AbortController().signal)
    const res = pesquisa.obterExecucao(db, ex).resultados[0]!
    const pauta = pautas.criarPauta(db, pautaNovaSchema.parse({ projetoId: p, titulo: 'Norma de IA' }))
    const alvo = { pautaId: pauta.id, roteiroId: null }
    dossie.criarAfirmacao(db, alvo, { texto: 'O governo publicou a norma.', natureza: 'fato', relevante: true, temaRapido: false, observacoes: '' })
    dossie.criarAfirmacao(db, alvo, { texto: 'A norma vai mudar tudo.', natureza: 'previsao', relevante: true, temaRapido: false, observacoes: '' })
    let r = dossie.relatorio(db, alvo, AGORA)
    expect(r.pendencias).toHaveLength(2)

    const [a1] = r.afirmacoes
    dossie.vincularResultado(db, a1!.id, res.id, { trecho: 'Governo publica norma de IA', papel: 'primaria', posicao: 'sustenta' })
    r = dossie.relatorio(db, alvo, AGORA)
    const a = r.afirmacoes[0]!
    expect(a.verificacao.situacao).toBe('confirmada')
    expect(a.fontes[0]).toMatchObject({ url: 'https://www.gov.br/norma', publicadaEm: '2026-10-30', trecho: 'Governo publica norma de IA' })
    expect(r.resumo.prontas).toBe(1)

    // O roteiro criado da pauta herda as afirmações da pauta no relatório.
    const rot = roteiroDeTeste(db, p, { pautaId: pauta.id })
    expect(dossie.relatorio(db, { pautaId: null, roteiroId: rot.id }).resumo.total).toBe(2)
    expect(() => dossie.conferirAntesDaRevisao(db, rot.id)).toThrow(/pendência/)
    dossie.atualizarAfirmacao(db, r.afirmacoes[1]!.id, { texto: 'A norma pode mudar o setor.', natureza: 'previsao', relevante: true, temaRapido: false, observacoes: '', decisao: 'incerto' })
    expect(() => dossie.conferirAntesDaRevisao(db, rot.id)).not.toThrow()

    const md = dossie.relatorioMarkdown(dossie.relatorio(db, alvo, AGORA), 'Norma de IA')
    expect(md).toContain('[Governo publica norma de IA](<https://www.gov.br/norma>)')
    expect(md).toContain('Pendências')
  })

  it('não aceita resultado de outro projeto', async () => {
    const db = bancoDeTeste()
    const p1 = projetoDeTeste(db, 'A')
    const p2 = projetoDeTeste(db, 'B')
    pesquisa.adicionarFontePesquisa(db, { projetoId: p2, tipo: 'rss', nome: 'F', url: 'https://f.exemplo/rss' })
    const ex = criarExecucao(db, { projetoId: p2, consulta: 'x', pautaId: null, origem: 'manual' }, AGORA)
    await executarPesquisa(db, ex, { agora: () => AGORA, buscar: async (url) => ({ urlFinal: url, status: 200, tipoConteudo: 'application/rss+xml', corpo: '<rss><channel><item><title>x</title><link>https://x.com/1</link></item></channel></rss>', cabecalhos: {} }) }, new AbortController().signal)
    const res = pesquisa.obterExecucao(db, ex).resultados[0]!
    const pauta = pautas.criarPauta(db, pautaNovaSchema.parse({ projetoId: p1, titulo: 'P' }))
    dossie.criarAfirmacao(db, { pautaId: pauta.id, roteiroId: null }, { texto: 'x', natureza: 'fato', relevante: true, temaRapido: false, observacoes: '' })
    const af = dossie.relatorio(db, { pautaId: pauta.id, roteiroId: null }).afirmacoes[0]!
    expect(() => dossie.vincularResultado(db, af.id, res.id, { trecho: 'x', papel: 'secundaria', posicao: 'sustenta' })).toThrow(/outro projeto/)
  })
})
