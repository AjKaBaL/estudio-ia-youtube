import { mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { executar, todos, um, type Banco } from '../db/conexao'
import { analisarFeed } from '../pesquisa/analisadores'
import { dominioRaiz, feedsAnunciados, identificarFonte, registrarSugestoes } from '../pesquisa/descoberta'
import { criarExecucao } from '../pesquisa/executor'
import { descompactar, ErroRede, type RespostaWeb } from '../pesquisa/rede'
import { gzipSync } from 'node:zlib'
import {
  aplicarPadroesPesquisa,
  aprovarSugestaoFonte,
  listarFontesPesquisa,
  listarSugestoesFontes,
  lerOpcoesPesquisa,
  recusarSugestaoFonte,
  removerFontePesquisa,
  restaurarFontesPadrao
} from '../repositorios/pesquisa'
import { criarPauta, obterPauta } from '../repositorios/pautas'
import { agendarTema, definirFrequencia, moverVideo, painelAdmin, priorizarTema, proximosTemas } from '../producao/painel'
import { lerArquivoCliente, procurarArquivoCliente } from '../youtube/arquivoCliente'
import { CONFIG_EDITORIAL_PADRAO, aplicarFrequencia } from '@shared/editorial'
import { FONTES_PADRAO, TERMOS_PADRAO, dominioReconhecido } from '@shared/fontesPadrao'
import { bancoDeTeste, projetoDeTeste } from './auxiliares'

const FEED = (titulo: string, n = 2): string =>
  `<?xml version="1.0"?><rss version="2.0"><channel><title>${titulo}</title>${Array.from({ length: n }, (_, i) => `<item><title>Notícia ${i}</title><link>https://exemplo.com/${i}</link></item>`).join('')}</channel></rss>`

/** "Internet" falsa: cada URL devolve um corpo fixo; o resto responde 404. */
function internet(paginas: Record<string, string>): { buscar: (url: string) => Promise<RespostaWeb>; pedidos: string[] } {
  const pedidos: string[] = []
  return {
    pedidos,
    buscar: async (url: string) => {
      pedidos.push(url)
      const corpo = paginas[url]
      if (corpo === undefined) throw new ErroRede('http', 'O servidor respondeu com o código 404.', 404)
      return { urlFinal: url, status: 200, tipoConteudo: corpo.startsWith('<?xml') ? 'application/rss+xml' : 'text/html', corpo, cabecalhos: {} }
    }
  }
}

function resultado(db: Banco, execucaoId: number, url: string, dominio: string): void {
  executar(
    db,
    `INSERT INTO resultados_pesquisa (execucao_id, fonte_nome, titulo, url, url_canonica, dominio, acessada_em, relevancia, atualidade, confiabilidade, nicho, pontuacao, explicacao, criado_em)
     VALUES (:e, 'Agregador', :t, :u, :u, :d, '2026-10-31T00:00:00Z', 1, 1, 1, 1, 50, '[]', '2026-10-31T00:00:00Z')`,
    { e: execucaoId, t: `Título em ${dominio}`, u: url, d: dominio }
  )
}

describe('fontes padrão e termos', () => {
  it('aplica uma vez por projeto, não recoloca o que o usuário removeu e restaura sob pedido', () => {
    const db = bancoDeTeste()
    const p = projetoDeTeste(db)
    const r = aplicarPadroesPesquisa(db)
    expect(r).toEqual({ projetos: 1, fontes: FONTES_PADRAO.length, termos: true })
    const fontes = listarFontesPesquisa(db, p)
    expect(fontes).toHaveLength(FONTES_PADRAO.length)
    expect(fontes.every((f) => f.origem === 'padrao' && f.ativo && f.tipo === 'rss')).toBe(true)
    expect(lerOpcoesPesquisa(db).termosMonitorados).toEqual([...TERMOS_PADRAO])

    removerFontePesquisa(db, fontes[0]!.id)
    expect(aplicarPadroesPesquisa(db)).toEqual({ projetos: 0, fontes: 0, termos: false })
    expect(listarFontesPesquisa(db, p)).toHaveLength(FONTES_PADRAO.length - 1)
    expect(restaurarFontesPadrao(db, p)).toBe(1)
    expect(restaurarFontesPadrao(db, p)).toBe(0)

    // Projeto criado depois também recebe as fontes.
    const p2 = projetoDeTeste(db, 'Segundo canal')
    aplicarPadroesPesquisa(db)
    expect(listarFontesPesquisa(db, p2)).toHaveLength(FONTES_PADRAO.length)
  })

  it('a lista padrão não tem endereços repetidos e só usa https', () => {
    expect(new Set(FONTES_PADRAO.map((f) => f.url)).size).toBe(FONTES_PADRAO.length)
    expect(FONTES_PADRAO.every((f) => f.url.startsWith('https://'))).toBe(true)
    expect(TERMOS_PADRAO.length).toBeLessThanOrEqual(30)
  })
})

describe('identificar o feed de um site', () => {
  it('lê o site original de agregadores (<source url>)', () => {
    const xml = '<rss><channel><item><title>A</title><link>https://news.google.com/rss/articles/x</link><source url="https://g1.globo.com">G1</source></item></channel></rss>'
    expect(analisarFeed(xml, 'https://news.google.com/rss').itens[0]!.site).toBe('https://g1.globo.com/')
  })

  it('aceita feed direto, feed anunciado na página, caminho comum e página sem feed', async () => {
    const net = internet({
      'https://a.com/feed.xml': FEED('Feed A'),
      'https://b.com/': '<html><head><link rel="alternate" type="application/rss+xml" href="/noticias/rss"></head></html>',
      'https://b.com/noticias/rss': FEED('Feed B', 3),
      'https://c.com/': '<html><head><title>Site C</title></head></html>',
      'https://c.com/feed/': FEED('Feed C'),
      'https://d.com/': '<html><head><title>Site D</title></head><body>sem feed</body></html>'
    })
    expect(await identificarFonte('https://a.com/feed.xml', net.buscar)).toMatchObject({ tipo: 'rss', url: 'https://a.com/feed.xml', nome: 'Feed A' })
    expect(await identificarFonte('https://b.com/', net.buscar)).toMatchObject({ tipo: 'rss', url: 'https://b.com/noticias/rss', nome: 'Feed B' })
    expect(await identificarFonte('https://c.com/', net.buscar)).toMatchObject({ tipo: 'rss', url: 'https://c.com/feed/' })
    expect(await identificarFonte('https://d.com/', net.buscar)).toMatchObject({ tipo: 'url', url: 'https://d.com/', nome: 'Site D' })
  })

  it('junta subdomínios e só aceita feeds http(s) anunciados', () => {
    expect(dominioRaiz('feeds.arstechnica.com')).toBe('arstechnica.com')
    expect(dominioRaiz('www.olhardigital.com.br')).toBe('olhardigital.com.br')
    expect(dominioRaiz('rss.tecmundo.com.br')).toBe('tecmundo.com.br')
    const html = '<link rel="alternate" type="application/atom+xml" href="javascript:alert(1)"><link rel="alternate" type="application/rss+xml" href="https://x.com/rss">'
    expect(feedsAnunciados(html, 'https://x.com/')).toEqual(['https://x.com/rss'])
  })
})

describe('sugestões de novas fontes', () => {
  it('observa, descobre o feed na 2ª ocorrência e só entra com aprovação', async () => {
    const db = bancoDeTeste()
    const p = projetoDeTeste(db)
    aplicarPadroesPesquisa(db)
    const net = internet({
      'https://www.novo.com.br/': '<html><head><link rel="alternate" type="application/rss+xml" href="https://www.novo.com.br/feed/"></head></html>',
      'https://www.novo.com.br/feed/': FEED('Novo Portal'),
      'https://semfeed.com/': '<html><head><title>x</title></head></html>'
    })
    const e1 = criarExecucao(db, { projetoId: p, consulta: 'ia', pautaId: null, origem: 'manual' }, new Date())
    resultado(db, e1, 'https://www.novo.com.br/a', 'www.novo.com.br')
    resultado(db, e1, 'https://tecnoblog.net/x', 'tecnoblog.net') // já é fonte padrão
    resultado(db, e1, 'https://github.com/x/y', 'github.com') // plataforma: nunca sugerida
    resultado(db, e1, 'https://semfeed.com/1', 'semfeed.com')
    expect(await registrarSugestoes(db, e1, p, net.buscar)).toBe(0)
    expect(net.pedidos).toEqual([]) // uma ocorrência só: nada é buscado
    expect(todos(db, 'SELECT dominio FROM sugestoes_fontes ORDER BY dominio')).toEqual([{ dominio: 'novo.com.br' }, { dominio: 'semfeed.com' }])

    const e2 = criarExecucao(db, { projetoId: p, consulta: 'ia', pautaId: null, origem: 'manual' }, new Date())
    resultado(db, e2, 'https://www.novo.com.br/b', 'www.novo.com.br')
    resultado(db, e2, 'https://semfeed.com/2', 'semfeed.com')
    expect(await registrarSugestoes(db, e2, p, net.buscar)).toBe(1)
    const [s] = listarSugestoesFontes(db, p)
    expect(s).toMatchObject({ dominio: 'novo.com.br', nome: 'Novo Portal', url: 'https://www.novo.com.br/feed/', ocorrencias: 2 })
    expect(um<{ status: string }>(db, "SELECT status FROM sugestoes_fontes WHERE dominio = 'semfeed.com'")!.status).toBe('sem_feed')
    // Sugestão pendente não entra na pesquisa antes de aprovar.
    expect(listarFontesPesquisa(db, p).some((f) => f.url === s!.url)).toBe(false)

    const f = aprovarSugestaoFonte(db, s!.id)
    expect(f).toMatchObject({ origem: 'sugestao', ativo: true, url: 'https://www.novo.com.br/feed/' })
    expect(listarSugestoesFontes(db, p)).toEqual([])
    expect(() => aprovarSugestaoFonte(db, s!.id)).toThrow(/Sugestão pendente/)
  })

  it('veículo reconhecido (Brasil, Europa, EUA, Japão) entra sozinho como fonte, sem esperar aprovação', async () => {
    const db = bancoDeTeste()
    const p = projetoDeTeste(db)
    aplicarPadroesPesquisa(db)
    const net = internet({
      'https://www.asahi.com/': '<html><head><link rel="alternate" type="application/rss+xml" href="https://www.asahi.com/rss/index.rdf"></head></html>',
      'https://www.asahi.com/rss/index.rdf': FEED('Asahi Shimbun')
    })
    for (let i = 0; i < 2; i++) {
      const e = criarExecucao(db, { projetoId: p, consulta: 'ia', pautaId: null, origem: 'manual' }, new Date())
      resultado(db, e, `https://www.asahi.com/articles/${i}`, 'www.asahi.com')
      await registrarSugestoes(db, e, p, net.buscar)
    }
    expect(listarFontesPesquisa(db, p).find((f) => f.url === 'https://www.asahi.com/rss/index.rdf')).toMatchObject({ origem: 'sugestao', ativo: true })
    expect(listarSugestoesFontes(db, p)).toEqual([])
    expect(dominioReconhecido('www3.nhk.or.jp')).toBe(true)
    expect(dominioReconhecido('blog-qualquer.com')).toBe(false)
    expect(dominioRaiz('www3.nhk.or.jp')).toBe('nhk.or.jp')
  })

  it('recusada não volta a ser sugerida', async () => {
    const db = bancoDeTeste()
    const p = projetoDeTeste(db)
    const net = internet({ 'https://site.org/': FEED('Site') })
    for (let i = 0; i < 2; i++) {
      const e = criarExecucao(db, { projetoId: p, consulta: 'ia', pautaId: null, origem: 'manual' }, new Date())
      resultado(db, e, `https://site.org/${i}`, 'site.org')
      await registrarSugestoes(db, e, p, net.buscar)
    }
    const [s] = listarSugestoesFontes(db, p)
    recusarSugestaoFonte(db, s!.id)
    const e = criarExecucao(db, { projetoId: p, consulta: 'ia', pautaId: null, origem: 'manual' }, new Date())
    resultado(db, e, 'https://site.org/9', 'site.org')
    await registrarSugestoes(db, e, p, net.buscar)
    expect(listarSugestoesFontes(db, p)).toEqual([])
    expect(um<{ status: string; ocorrencias: number }>(db, 'SELECT status, ocorrencias FROM sugestoes_fontes')).toEqual({ status: 'recusada', ocorrencias: 2 })
  })
})

describe('frequência rápida', () => {
  it('gera dias espalhados, pausa com 0 e evita conflito com o outro formato', () => {
    const c3 = aplicarFrequencia(CONFIG_EDITORIAL_PADRAO, 'short', 3, '12:00')
    expect(c3.agenda.formatos.short.horarios).toEqual([{ dia: 2, hora: '12:00' }, { dia: 4, hora: '12:00' }, { dia: 6, hora: '12:00' }])
    expect(c3.agenda.formatos.short.limiteSemanal).toBe(3)

    // Longo no domingo às 18:00 (padrão): um Short no mesmo horário vai para as 19:00.
    const c7 = aplicarFrequencia(CONFIG_EDITORIAL_PADRAO, 'short', 7, '18:00')
    expect(c7.agenda.formatos.short.horarios.find((h) => h.dia === 0)).toEqual({ dia: 0, hora: '19:00' })

    const c10 = aplicarFrequencia(CONFIG_EDITORIAL_PADRAO, 'short', 10, '20:00')
    expect(c10.agenda.formatos.short.horarios).toHaveLength(10)
    expect(c10.agenda.formatos.short.horarios.filter((h) => h.hora === '14:00').map((h) => h.dia)).toEqual([2, 4, 6])
    expect(c10.agenda.formatos.short.maxPorDia).toBe(2)

    const c0 = aplicarFrequencia(CONFIG_EDITORIAL_PADRAO, 'longo', 0, '18:00')
    expect(c0.agenda.formatos.longo.pausado).toBe(true)
    expect(c0.agenda.formatos.longo.horarios).toEqual(CONFIG_EDITORIAL_PADRAO.agenda.formatos.longo.horarios)
  })
})

describe('painel do administrador', () => {
  // Segunda-feira, 02/11/2026, 09:00 em São Paulo. Padrão: 1 longo (domingo 18:00) e 3 Shorts.
  const AGORA = new Date('2026-11-02T12:00:00Z')
  const pauta = (db: Banco, p: number, titulo: string, tipo: 'longo' | 'short' = 'longo'): number =>
    criarPauta(db, { projetoId: p, titulo, tema: '', notas: '', palavrasChave: [], perguntaCentral: '', resumo: '', publico: '', tipoSugerido: tipo, potencialNarrativa: null }).id

  it('ordena temas pela prioridade, agenda no próximo horário livre e adianta/adia vídeos', () => {
    const db = bancoDeTeste()
    const p = projetoDeTeste(db)
    const a = pauta(db, p, 'Tema A')
    const b = pauta(db, p, 'Tema B')
    const c = pauta(db, p, 'Tema C', 'short')
    priorizarTema(db, b, 2)
    expect(proximosTemas(db, 20, AGORA).map((t) => t.id)).toEqual([b, a, c])

    agendarTema(db, b, null, AGORA)
    agendarTema(db, a, null, AGORA)
    expect(obterPauta(db, b).status).toBe('aprovada') // agendar aprova o tema
    expect(proximosTemas(db, 20, AGORA).map((t) => t.id)).toEqual([c])
    const datas = (): Record<string, string> =>
      Object.fromEntries(todos<{ titulo: string; inicioUtc: string }>(db, "SELECT titulo, inicio_utc AS inicioUtc FROM calendario_entradas WHERE status = 'planejado'").map((x) => [x.titulo, x.inicioUtc]))
    expect(datas()).toEqual({ 'Tema B': '2026-11-08T21:00:00.000Z', 'Tema A': '2026-11-15T21:00:00.000Z' })

    // Sem mais domingos livres no horizonte de 14 dias.
    expect(() => agendarTema(db, pauta(db, p, 'Tema D'), null, AGORA)).toThrow(/Não há horário livre/)

    const idA = um<{ id: number }>(db, "SELECT id FROM calendario_entradas WHERE titulo = 'Tema A'")!.id
    moverVideo(db, idA, 'adiantar', AGORA)
    expect(datas()).toEqual({ 'Tema A': '2026-11-08T21:00:00.000Z', 'Tema B': '2026-11-15T21:00:00.000Z' })
    expect(() => moverVideo(db, idA, 'adiantar', AGORA)).toThrow(/já é o próximo/)
    moverVideo(db, idA, 'adiar', AGORA)
    expect(datas()['Tema A']).toBe('2026-11-15T21:00:00.000Z')

    const painel = painelAdmin(db, AGORA)
    expect(painel.videos.map((v) => v.titulo)).toEqual(['Tema B', 'Tema A'])
    expect(painel.livres.longo).toBe(0)
    expect(painel.frequencia.short).toMatchObject({ porSemana: 3, hora: '18:00', dias: [2, 4, 6] })
  })

  it('frequência do painel grava a configuração editorial e abre horários', () => {
    const db = bancoDeTeste()
    projetoDeTeste(db)
    const r = definirFrequencia(db, 'longo', 2, '10:00')
    expect(r.frequencia.longo).toMatchObject({ porSemana: 2, hora: '10:00', dias: [0, 3], pausado: false })
  })
})

describe('arquivo de credenciais do Google', () => {
  const pasta = (): string => mkdtempSync(join(tmpdir(), 'estudio-downloads-'))
  const instalado = { installed: { client_id: '123-abc.apps.googleusercontent.com', client_secret: 'segredo-de-teste', redirect_uris: ['http://localhost'] } }

  it('lê o tipo "App para computador" e recusa os outros', () => {
    const d = pasta()
    writeFileSync(join(d, 'ok.json'), JSON.stringify(instalado))
    writeFileSync(join(d, 'web.json'), JSON.stringify({ web: { client_id: 'x.apps.googleusercontent.com', client_secret: 'y' } }))
    writeFileSync(join(d, 'ruim.json'), '{ isto não é json')
    expect(lerArquivoCliente(join(d, 'ok.json'))).toEqual({ clientId: '123-abc.apps.googleusercontent.com', clientSecret: 'segredo-de-teste' })
    expect(() => lerArquivoCliente(join(d, 'web.json'))).toThrow(/Aplicativo da Web/)
    expect(() => lerArquivoCliente(join(d, 'ruim.json'))).toThrow(/Não foi possível ler/)
  })

  it('acha o client_secret mais recente em Downloads e ignora os antigos', () => {
    const d = pasta()
    const agora = new Date('2026-10-31T12:00:00Z')
    for (const [nome, dias] of [['client_secret_antigo.json', 60], ['client_secret_novo.json', 1], ['outro.json', 0]] as const) {
      writeFileSync(join(d, nome), JSON.stringify(instalado))
      const t = new Date(agora.getTime() - dias * 86_400_000)
      utimesSync(join(d, nome), t, t)
    }
    expect(procurarArquivoCliente(d, agora)?.nome).toBe('client_secret_novo.json')
    expect(procurarArquivoCliente(undefined, agora)).toBeNull()
    expect(procurarArquivoCliente(join(d, 'nao-existe'), agora)).toBeNull()
  })
})

describe('servidor que compacta mesmo pedindo sem compressão', () => {
  it('descompacta gzip dentro do limite e recusa bomba de descompressão', () => {
    const xml = Buffer.from(FEED('Compactado'))
    expect(descompactar(gzipSync(xml), 'gzip', 1024 * 1024).toString('utf8')).toBe(xml.toString('utf8'))
    expect(descompactar(xml, undefined, 10)).toBe(xml)
    const bomba = gzipSync(Buffer.alloc(5 * 1024 * 1024))
    expect(bomba.length).toBeLessThan(20_000)
    expect(() => descompactar(bomba, 'gzip', 2 * 1024 * 1024)).toThrow(/maior que o limite/)
    expect(() => descompactar(Buffer.from('lixo'), 'gzip', 1000)).toThrow(/inválido/)
    expect(() => descompactar(xml, 'zstd', 1000)).toThrow(/não suportada/)
  })
})
