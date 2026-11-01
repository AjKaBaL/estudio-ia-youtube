import { describe, expect, it } from 'vitest'
import { analisarFeed } from '../pesquisa/analisadores'
import { buscarSeguro } from '../pesquisa/rede'
import { identificarFonte } from '../pesquisa/descoberta'
import { FONTES_PADRAO } from '@shared/fontesPadrao'
import { criarExecucao, DEPENDENCIAS_PADRAO, executarPesquisa } from '../pesquisa/executor'
import { aplicarPadroesPesquisa, lerOpcoesPesquisa, obterExecucao } from '../repositorios/pesquisa'
import { todos } from '../db/conexao'
import { bancoDeTeste, cofreDeTeste, projetoDeTeste } from './auxiliares'
import { adicionarDoCatalogo } from '../ia/central'
import { baixarMidia, buscarWikimedia } from '../midia/imagens'
import { produzirMidias } from '../midia/automatica'
import { criarEdicao, obterEdicao } from '../midia/edicao'
import { listarMidia } from '../midia/biblioteca'
import { roteiroDeTeste } from './auxiliares'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Contexto } from '../contexto'

// Teste opcional com internet real. Rode com: REDE_REAL=1 npx vitest run rede-real
describe.skipIf(!process.env.REDE_REAL)('rede real (opcional)', () => {
  it('lê um feed público por HTTPS com validação de certificado', async () => {
    const r = await buscarSeguro('https://github.blog/feed/', { tempoLimiteMs: 20_000 })
    expect(r.status).toBe(200)
    expect(analisarFeed(r.corpo, r.urlFinal).itens.length).toBeGreaterThan(0)
  }, 30_000)
  it('recusa certificado inválido', async () => {
    await expect(buscarSeguro('https://expired.badssl.com/', { tempoLimiteMs: 20_000 })).rejects.toMatchObject({ codigo: 'conexao' })
  }, 30_000)
  it('acha o feed a partir do endereço do site', async () => {
    expect(await identificarFonte('https://tecnoblog.net/', buscarSeguro)).toMatchObject({ tipo: 'rss' })
  }, 60_000)
  it('todas as fontes padrão respondem com um feed com itens (pelas proteções do app)', async () => {
    const falhas: string[] = []
    for (const f of FONTES_PADRAO) {
      try {
        const r = await buscarSeguro(f.url, { tempoLimiteMs: 20_000 })
        if (analisarFeed(r.corpo, r.urlFinal).itens.length === 0) falhas.push(`${f.nome}: sem itens`)
      } catch (e) {
        falhas.push(`${f.nome}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    expect(falhas).toEqual([])
  }, 600_000)
  it('pesquisa completa com as fontes e termos padrão, dentro do limite de tempo', async () => {
    const db = bancoDeTeste()
    const p = projetoDeTeste(db)
    aplicarPadroesPesquisa(db)
    const id = criarExecucao(db, { projetoId: p, consulta: lerOpcoesPesquisa(db).termosMonitorados.join(', '), pautaId: null, origem: 'manual' }, new Date())
    const inicio = Date.now()
    await executarPesquisa(db, id, DEPENDENCIAS_PADRAO, new AbortController().signal)
    const e = obterExecucao(db, id)
    const sugestoes = todos<{ dominio: string; status: string; ocorrencias: number }>(db, 'SELECT dominio, status, ocorrencias FROM sugestoes_fontes ORDER BY ocorrencias DESC')
    console.log(JSON.stringify({ segundos: (Date.now() - inicio) / 1000, status: e.status, fontes: e.fontesConsultadas, comErro: e.fontesComErro, resultados: e.totalResultados, erros: e.registros.filter((r) => r.nivel !== 'info').map((r) => `${r.fonte}: ${r.mensagem}`), sugestoes: sugestoes.slice(0, 10) }, null, 1))
    expect(e.status).toBe('concluida')
    expect(e.totalResultados).toBeGreaterThan(0)
  }, 300_000)
  it('catálogo de IA: chave inválida é recusada pelo fornecedor real e a IA fica desativada', async () => {
    const db = bancoDeTeste()
    const r = await adicionarDoCatalogo(db, cofreDeTeste(), 'groq', 'chave-invalida-de-teste-123')
    expect(r.modelos).toEqual([])
    expect(r.mensagem).toMatch(/401/)
    expect(r.provedor.ativo).toBe(false)
  }, 60_000)
  it('Wikimedia Commons: busca só licenças livres e baixa a imagem conferindo o tipo', async () => {
    const r = await buscarWikimedia('data center', 3, false, 'horizontal')
    expect(r.length).toBeGreaterThan(0)
    expect(r.every((x) => /public domain|cc0|cc by(?!-sa)|pd/i.test(x.licenca) && x.largura >= x.altura)).toBe(true)
    const d = await baixarMidia(r[0]!)
    expect(['.jpg', '.png', '.webp']).toContain(d.ext)
    console.log(JSON.stringify(r.map((x) => ({ titulo: x.titulo, autor: x.autor, licenca: x.licenca })), null, 1))
  }, 120_000)
  it.skipIf(process.platform !== 'win32')('produção completa: voz do Windows + imagens do Wikimedia + montagem', async () => {
    const db = bancoDeTeste()
    const pasta = mkdtempSync(join(tmpdir(), 'estudio-producao-real-'))
    const ctx = { db, cofre: cofreDeTeste(), pastaMidia: join(pasta, 'midia'), pastaDados: pasta, ferramentas: () => null } as unknown as Contexto
    const p = projetoDeTeste(db)
    const rot = roteiroDeTeste(db, p, { titulo: 'Data centers e inteligência artificial', conteudo: ['# T', '', '## Data centers', '', 'Os data centers sustentam a inteligência artificial.', '', '## Energia solar', '', 'A energia solar ajuda a reduzir custos.'].join('\n') })
    const ed = criarEdicao(db, rot.id, '16:9')
    const r = await produzirMidias(ctx, ed.id, { narracao: true, imagens: true })
    console.log(r.relatorio.join(' | '))
    const e = obterEdicao(db, ed.id).estado
    expect(e.clips.filter((c) => c.faixa === 'narracao')).toHaveLength(2)
    expect(e.clips.filter((c) => c.faixa === 'video' && c.recursoId !== null).length).toBeGreaterThan(0)
    const imgs = listarMidia(db, { projetoId: p, roteiroId: rot.id }).filter((m) => m.categoria === 'imagem')
    expect(imgs.every((m) => m.autor && m.licenca && m.urlOrigem.startsWith('https://commons.wikimedia.org/'))).toBe(true)
  }, 300_000)
})
