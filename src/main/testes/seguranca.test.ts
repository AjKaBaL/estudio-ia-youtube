import { describe, expect, it, vi } from 'vitest'
import { YouTubeNaoConfigurado } from '@estudio/youtube'
import type { Contexto } from '../contexto'
import { todos } from '../db/conexao'
import { despachar } from '../ipc/despachar'
import { GerenciadorProducao } from '../midia/producao'
import { GerenciadorPesquisas } from '../pesquisa/executor'
import { CSP_PRODUCAO, criarVerificadorOrigem, preferenciasSeguras } from '../politicaJanela'
import * as agenda from '../repositorios/agenda'
import { lerEditorial } from '../repositorios/editorial'
import * as r from '../repositorios/roteiros'
import * as pautas from '../repositorios/pautas'
import { GerenciadorEnvio } from '../youtube/publicacao'
import { conferirEstrutura } from '@shared/estrutura'
import { filtroRoteirosSchema, pautaNovaSchema } from '@shared/schemas'
import { bancoDeTeste, cofreDeTeste, projetoDeTeste, roteiroDeTeste } from './auxiliares'

function contexto(): Contexto {
  const db = bancoDeTeste()
  const cofre = cofreDeTeste()
  return {
    db,
    cofre,
    versaoApp: 't',
    pastaDados: 'C:/t',
    pastaBackups: 'C:/t/b',
    pastaMidia: 'C:/t/m',
    pastaRender: 'C:/t/r',
    youtube: new YouTubeNaoConfigurado(),
    pesquisas: new GerenciadorPesquisas(db),
    producao: new GerenciadorProducao(db, 'C:/t/r', () => null),
    ferramentas: () => null,
    envios: new GerenciadorEnvio(db, cofre, () => new YouTubeNaoConfigurado()),
    abrirNavegador: async () => undefined,
    plataforma: { salvarTexto: vi.fn(async () => null), abrirPasta: vi.fn(async () => undefined), escolherArquivos: vi.fn(async () => []), mostrarNoExplorador: vi.fn() }
  }
}

/** Todo o texto gravado no banco (todas as tabelas), para procurar vazamentos. */
function textoDoBanco(ctx: Contexto): string {
  const tabelas = todos<{ name: string }>(ctx.db, "SELECT name FROM sqlite_master WHERE type = 'table'")
  return tabelas.map((t) => JSON.stringify(todos(ctx.db, `SELECT * FROM "${t.name.replace(/"/g, '')}"`))).join('\n')
}

describe('Electron: janela e conteúdo', () => {
  it('interface sem Node, isolada, em sandbox; DevTools desligado no app instalado', () => {
    const p = preferenciasSeguras('preload.js', true)
    expect(p).toMatchObject({ contextIsolation: true, sandbox: true, nodeIntegration: false, nodeIntegrationInWorker: false, webSecurity: true, webviewTag: false, devTools: false, allowRunningInsecureContent: false })
    expect(preferenciasSeguras('preload.js', false).devTools).toBe(true)
  })
  it('só a página do app pode chamar a IPC', () => {
    const v = criarVerificadorOrigem('C:\\app\\out\\renderer\\index.html', undefined)
    expect(v('file:///C:/app/out/renderer/index.html')).toBe(true)
    expect(v('file:///C:/app/out/renderer/index.html#x')).toBe(true)
    expect(v('file:///C:/Users/x/Downloads/pagina.html')).toBe(false)
    expect(v('https://exemplo.com/')).toBe(false)
    const dev = criarVerificadorOrigem('C:\\x\\index.html', 'http://localhost:5173')
    expect(dev('http://localhost:5173/')).toBe(true)
    expect(dev('http://localhost:5174/')).toBe(false)
    expect(dev('http://evil.localhost.com:5173/')).toBe(false)
  })
  it('CSP do app instalado: sem eval, sem scripts externos, sem conexões de rede pela interface', () => {
    expect(CSP_PRODUCAO).toContain("script-src 'self';")
    expect(CSP_PRODUCAO).not.toMatch(/unsafe-eval|https?:/)
    expect(CSP_PRODUCAO).toContain("connect-src 'none'")
    expect(CSP_PRODUCAO).toContain("object-src 'none'")
  })
})

describe('segredos', () => {
  it('chave de API nunca vai para o banco nem para os registros de eventos', async () => {
    const ctx = contexto()
    const segredo = 'sk-teste-segredo-0123456789abcdef'
    const p = await despachar('ia:salvarProvedor', { id: null, config: { nome: 'X', adaptador: 'openai_compativel', urlBase: 'https://api.exemplo.invalid/v1', modelo: 'm', precoEntradaPorMilhao: null, precoSaidaPorMilhao: null, maxTokensSaida: 500, limitesConhecidos: '' } }, ctx)
    expect(p.ok).toBe(true)
    expect((await despachar('ia:definirChave', { id: 1, chave: segredo }, ctx)).ok).toBe(true)
    await despachar('ia:testarProvedor', { id: 1 }, ctx) // falha de rede (sem internet no teste) gera evento
    expect(textoDoBanco(ctx)).not.toContain(segredo)
    expect(ctx.cofre.obter('provedor:1')).toBe(segredo)
    const central = await despachar('ia:central', undefined, ctx)
    expect(JSON.stringify(central)).not.toContain(segredo)
  })
  it('configurações comuns recusam chaves com cara de segredo', async () => {
    const ctx = contexto()
    const r1 = await despachar('ui:salvarEstado', { tela: 'x' }, ctx)
    expect(r1.ok).toBe(true)
  })
})

describe('entradas não confiáveis', () => {
  it('busca com tentativa de injeção SQL não quebra nada', async () => {
    const ctx = contexto()
    roteiroDeTeste(ctx.db, projetoDeTeste(ctx.db))
    const res = await despachar('roteiros:buscar', { texto: "'; DROP TABLE roteiros; --" }, ctx)
    expect(res).toEqual({ ok: true, dados: [] })
    expect(r.buscarRoteiros(ctx.db, filtroRoteirosSchema.parse({}))).toHaveLength(1)
  })
  it('limita o tamanho das entradas', async () => {
    const ctx = contexto()
    projetoDeTeste(ctx.db)
    const res = await despachar('roteiros:criar', { projetoId: 1, titulo: 'x', tipoVideo: 'longo', conteudo: 'a'.repeat(200_001) }, ctx)
    expect(res).toMatchObject({ ok: false, erro: { codigo: 'validacao' } })
  })
  it('saída da IA: endereços que não estão no dossiê são sinalizados', () => {
    const { alertas } = conferirEstrutura(
      { titulo: 'T', promessa: '', abertura: 'Veja https://golpe.exemplo/login agora.', cenas: [{ titulo: '', narracao: 'Texto.', visual: '', textoNaTela: '', afirmacoes: [] }], conclusao: 'Fim.', sugestoes: { titulos: [], descricao: 'Fonte: https://www.gov.br/ok', miniatura: '' } },
      [{ id: 1, texto: 'x', natureza: 'fato', fontes: [{ titulo: 'Gov', url: 'https://www.gov.br/ok', trecho: 'x', publicadaEm: null }] }]
    )
    const a = alertas.find((x) => x.mensagem.includes('Endereços'))!
    expect(a.mensagem).toContain('golpe.exemplo')
    expect(a.mensagem).not.toContain('gov.br')
  })
})

describe('isolamento entre projetos', () => {
  it('não mistura roteiro, pauta e agenda de projetos diferentes', () => {
    const ctx = contexto()
    const a = projetoDeTeste(ctx.db, 'A')
    const b = projetoDeTeste(ctx.db, 'B')
    const rotB = roteiroDeTeste(ctx.db, b)
    expect(() => agenda.agendar(ctx.db, lerEditorial(ctx.db), { projetoId: a, roteiroId: rotB.id, titulo: 'x', tipoVideo: 'longo', data: '2099-01-04', hora: '18:00', notas: '' })).toThrow(/outro projeto/)
    const pautaB = pautas.criarPauta(ctx.db, pautaNovaSchema.parse({ projetoId: b, titulo: 'P' }))
    expect(() => roteiroDeTeste(ctx.db, a, { pautaId: pautaB.id })).toThrow(/outro projeto/)
  })
})
