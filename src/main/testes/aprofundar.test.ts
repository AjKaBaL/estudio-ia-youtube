import { afterEach, describe, expect, it } from 'vitest'
import { executar, todos, um } from '../db/conexao'
import { aprofundarPauta, ehAgregador, pautaParecidaExiste, redeAprofundar, termosDaBusca, termosPrincipais, tituloLimpo, urlOriginalBing } from '../pesquisa/aprofundar'
import { criarExecucao } from '../pesquisa/executor'
import type { RespostaWeb } from '../pesquisa/rede'
import { obterPauta, pautaDeResultados } from '../repositorios/pautas'
import { bancoDeTeste, projetoDeTeste } from './auxiliares'

const resposta = (urlFinal: string, corpo: string, tipoConteudo = 'text/html'): RespostaWeb => ({ urlFinal, status: 200, tipoConteudo, corpo, cabecalhos: {} })

const RSS_BING = `<?xml version="1.0" encoding="utf-8" ?><rss version="2.0"><channel><title>busca</title>
<item><title>Campanha usa apps falsos de IA para espalhar vírus</title><link>http://www.bing.com/news/apiclick.aspx?ref=FexRss&amp;url=https%3a%2f%2fwww.spacemoney.com.br%2ftecnologia%2fapps-falsos-ia%2f&amp;c=1</link><description>Uma campanha apontada pela Check Point distribui programas falsos de inteligência artificial com vírus.</description><pubDate>Sat, 31 Oct 2026 01:00:00 GMT</pubDate></item>
<item><title>Apps falsos de IA infectam computadores, alerta empresa</title><link>http://www.bing.com/news/apiclick.aspx?ref=FexRss&amp;url=https%3a%2f%2fbloqueado.com.br%2fapps-falsos-ia&amp;c=2</link><description>Golpistas usam apps falsos de inteligência artificial para infectar computadores.</description></item>
<item><title>Republicado no MSN: apps falsos de IA</title><link>http://www.bing.com/news/apiclick.aspx?ref=FexRss&amp;url=https%3a%2f%2fwww.msn.com%2fpt-br%2fapps-falsos&amp;c=3</link><description>apps falsos de IA vírus computadores campanha</description></item>
<item><title>Receita de bolo de cenoura</title><link>http://www.bing.com/news/apiclick.aspx?ref=FexRss&amp;url=https%3a%2f%2foutro.com%2fbolo&amp;c=4</link><description>Sem relação.</description></item>
</channel></rss>`

afterEach(() => {
  redeAprofundar.buscar = null
})

function pautaDeUmaNoticia(): { db: ReturnType<typeof bancoDeTeste>; pautaId: number } {
  const db = bancoDeTeste()
  const p = projetoDeTeste(db)
  const e = criarExecucao(db, { projetoId: p, consulta: 'ia', pautaId: null, origem: 'manual' }, new Date())
  const t = new Date().toISOString()
  const { id } = executar(
    db,
    `INSERT INTO resultados_pesquisa (execucao_id, fonte_nome, titulo, url, url_canonica, dominio, publicada_em, acessada_em, trecho, tipo_fonte, relevancia, atualidade, confiabilidade, nicho, pontuacao, explicacao, criado_em)
     VALUES (:e, 'Google Notícias', 'Campanha criminosa usa apps falsos de IA para infectar computadores com vírus - Estadão', 'https://news.google.com/rss/articles/CBMiabc', 'https://news.google.com/rss/articles/CBMiabc', 'estadao.com.br', :t, :t, 'Campanha criminosa usa apps falsos de IA.', 'imprensa', 1, 1, 1, 1, 70, '[]', :t)`,
    { e, t }
  )
  return { db, pautaId: pautaDeResultados(db, p, [id]).id }
}

describe('pesquisa extra do tema (várias fontes, links das matérias)', () => {
  it('auxiliares: título sem o nome do site, termos de busca, link original do Bing e agregadores', () => {
    expect(tituloLimpo('Inmetro participa de debate sobre IA - GOV.BR')).toBe('Inmetro participa de debate sobre IA')
    expect(termosDaBusca('Campanha criminosa usa apps falsos de IA para infectar computadores com vírus - Estadão')).toBe('campanha criminosa usa apps falsos ia infectar')
    expect(termosPrincipais('Campanha criminosa usa apps falsos de IA para infectar computadores com vírus - Estadão')).toBe('campanha criminosa ia computadores')
    expect(termosPrincipais('OpenAI, Google e Microsoft prometem novo bloqueio para treinamento de IA')).toBe('openai google microsoft ia')
    expect(urlOriginalBing('http://www.bing.com/news/apiclick.aspx?ref=FexRss&url=https%3a%2f%2fexame.com%2fa%2f&c=1')).toBe('https://exame.com/a/')
    expect(urlOriginalBing('http://www.bing.com/news/apiclick.aspx?url=javascript%3aalert(1)')).toBeNull()
    expect(ehAgregador('https://news.google.com/rss/articles/x')).toBe(true)
    expect(ehAgregador('https://www.msn.com/pt-br/x')).toBe(true)
    expect(ehAgregador('https://exame.com/x')).toBe(false)
  })

  it('busca a mesma notícia em outros sites, guarda o endereço real da matéria e respeita o robots.txt', async () => {
    const { db, pautaId } = pautaDeUmaNoticia()
    const pedidos: string[] = []
    redeAprofundar.buscar = async (url) => {
      pedidos.push(url)
      if (url.startsWith('https://www.bing.com/news/search')) return resposta(url, RSS_BING, 'application/rss+xml')
      if (url === 'https://bloqueado.com.br/robots.txt') return resposta(url, 'User-agent: *\nDisallow: /', 'text/plain')
      if (url.endsWith('/robots.txt')) throw new Error('sem robots')
      if (url.startsWith('https://www.spacemoney.com.br/'))
        return resposta(url, '<html><head><meta name="description" content="A Check Point Research identificou uma campanha que distribui apps falsos de inteligência artificial para instalar programas maliciosos."><meta name="author" content="Redação"></head><body></body></html>')
      throw new Error(`inesperado: ${url}`)
    }
    const r = await aprofundarPauta(db, pautaId, AbortSignal.timeout(5000))
    expect(r.sites.sort()).toEqual(['bloqueado.com.br', 'spacemoney.com.br'])
    expect(r.dominios).toBe(3)
    // Nada do agregador MSN nem a notícia sem relação; a página bloqueada pelo robots.txt nunca é lida.
    expect(pedidos).not.toContain('https://bloqueado.com.br/apps-falsos-ia')
    expect(pedidos.some((u) => u.includes('msn.com') || u.includes('outro.com'))).toBe(false)
    const fontes = obterPauta(db, pautaId).fontes
    const space = fontes.find((f) => f.dominio === 'spacemoney.com.br')!
    expect(space.url).toBe('https://www.spacemoney.com.br/tecnologia/apps-falsos-ia/')
    expect(space.trecho).toMatch(/Check Point Research identificou/)
    expect(space.autor).toBe('Redação')
    expect(fontes.find((f) => f.dominio === 'bloqueado.com.br')!.trecho).toMatch(/Golpistas usam apps falsos/)
    // Proveniência: registrada como pesquisa da própria pauta.
    expect(um<{ n: number }>(db, "SELECT COUNT(*) AS n FROM execucoes_pesquisa WHERE pauta_id = :p AND status = 'concluida'", { p: pautaId })!.n).toBe(1)
    // Rodar de novo não duplica.
    expect((await aprofundarPauta(db, pautaId, AbortSignal.timeout(5000))).novas).toBe(0)
  })

  it('sem internet (testes): usa só pesquisas anteriores', async () => {
    const { db, pautaId } = pautaDeUmaNoticia()
    expect(await aprofundarPauta(db, pautaId, AbortSignal.timeout(5000))).toEqual({ novas: 0, dominios: 1, sites: [] })
  })

  it('pauta repetida: reconhece o mesmo assunto mesmo com o nome do site no fim do título', () => {
    const { db } = pautaDeUmaNoticia()
    const p = todos<{ id: number }>(db, 'SELECT id FROM projetos')[0]!.id
    expect(pautaParecidaExiste(db, p, 'Campanha criminosa usa apps falsos de IA para infectar computadores com vírus - Terra')).toBe(true)
    expect(pautaParecidaExiste(db, p, 'Nvidia anuncia novo chip para data centers')).toBe(false)
  })
})
