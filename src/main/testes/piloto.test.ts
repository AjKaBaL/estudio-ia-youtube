import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { YouTubeNaoConfigurado } from '@estudio/youtube'
import type { Contexto } from '../contexto'
import { executar, todos, um } from '../db/conexao'
import * as ia from '../ia/central'
import { GerenciadorProducao } from '../midia/producao'
import { CHAVE_PREFERENCIA } from '../midia/automatica'
import { GerenciadorPesquisas, criarExecucao } from '../pesquisa/executor'
import { GerenciadorEnvio } from '../youtube/publicacao'
import { gravarConfig } from '../repositorios/configuracoes'
import { obterRoteiro } from '../repositorios/roteiros'
import { cicloPiloto, corroboracoes, recomecarFila, estadoPiloto, instaladoresPiloto, postarAgora, reforcarProducao, salvarConfigPiloto, situacoesVideos } from '../piloto'
import { pautaDeResultados } from '../repositorios/pautas'
import { obterEdicao } from '../midia/edicao'
import { CONFIG_PILOTO_PADRAO } from '@shared/piloto'
import { PREFERENCIA_MIDIA_PADRAO } from '@shared/geracaoMidia'
import { bancoDeTeste, cofreDeTeste, projetoDeTeste } from './auxiliares'
import { executarFerramenta, localizarFerramentas } from '../midia/ffmpeg'
import { importarMidia } from '../midia/biblioteca'

/** IA falsa no próprio PC: responde dossiê, roteiro ou revisão conforme o pedido. */
const servidores: http.Server[] = []
/** Como a IA revisora falsa se comporta: sem problemas, um ponto crítico só na 1ª revisão, ou sempre. */
let modoRevisor: 'ok' | 'critico_uma_vez' | 'sempre_critico' = 'ok'
let revisoes = 0
afterAll(() => servidores.forEach((s) => s.close()))
instaladoresPiloto.ffmpeg = async () => 'FFmpeg instalado (teste, nada foi instalado).'

async function iaFalsa(): Promise<string> {
  const s = http.createServer((req, res) => {
    let corpo = ''
    req.on('data', (p) => (corpo += p))
    req.on('end', () => {
      if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'modelo' }] }))
      const pedido = JSON.parse(corpo) as { messages: { content: string }[] }
      const [sis, usr] = [pedido.messages[0]!.content, pedido.messages[1]!.content]
      let conteudo: unknown
      if (sis.includes('dossiê factual')) {
        // Evidências: começo EXATO do texto de cada notícia (o piloto confere).
        const noticias = [...usr.matchAll(/\[(\d+)\] [^\n]*\nTexto: ([^\n]+)/g)].map((m) => ({ r: Number(m[1]), trecho: m[2]!.slice(0, 60) }))
        conteudo = {
          afirmacoes: [
            { texto: 'O governo publicou a nova norma de inteligência artificial.', natureza: 'fato', evidencias: [noticias[0], noticias[1]] },
            { texto: 'As empresas terão prazo para se adaptar à norma.', natureza: 'fato', evidencias: [noticias[2], noticias[3]] },
            { texto: 'A norma define regras para empresas e órgãos públicos.', natureza: 'fato', evidencias: [noticias[1], noticias[0]] },
            { texto: 'Haverá um período de adaptação antes de as regras valerem.', natureza: 'fato', evidencias: [noticias[3], noticias[2]] },
            { texto: 'Afirmação com trecho inventado não pode entrar.', natureza: 'fato', evidencias: [{ r: noticias[0]!.r, trecho: 'este trecho não existe em nenhuma notícia' }] }
          ]
        }
      } else if (sis.includes('desenvolve UMA cena')) {
        // Cena desenvolvida (sem números: a regra fixa recusa número sem fonte).
        conteudo = { narracao: Array.from({ length: 12 }, () => 'Explicação mais completa da norma, com contexto e consequências práticas para as empresas.').join(' ') }
      } else if (sis.includes('revisor interno')) {
        revisoes++
        const critico = modoRevisor === 'sempre_critico' || (modoRevisor === 'critico_uma_vez' && revisoes === 1)
        conteudo = critico
          ? { nota: 4, resumo: 'Há uma promessa sem base.', itens: [{ tipo: 'fato_sem_base', gravidade: 'critico', trecho: 'O que muda com a norma de inteligência artificial', problema: 'Afirma algo que não está nas afirmações.', sugestao: 'Remover.' }] }
          : { nota: 9, resumo: 'Sem problemas.', itens: [] }
      } else {
        const ids = [...new Set([...usr.matchAll(/\[A(\d+)\]/g)].map((m) => Number(m[1])))]
        conteudo = {
          titulo: 'A nova norma de IA',
          promessa: 'Entender a norma.',
          abertura: 'O que muda com a norma de inteligência artificial?',
          cenas: ids.map((id, i) => ({ titulo: `Parte ${'ABCD'[i]}`, narracao: `Explicação da parte ${'ABCD'[i]} da norma.`, visual: '', textoNaTela: '', afirmacoes: [id] })),
          conclusao: 'Essa é a resposta.',
          sugestoes: { titulos: [], descricao: '', miniatura: '' }
        }
      }
      res.end(JSON.stringify({ message: { content: JSON.stringify(conteudo) }, prompt_eval_count: 10, eval_count: 10 }))
    })
  })
  servidores.push(s)
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()))
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}`
}

function contexto(): Contexto {
  const db = bancoDeTeste()
  const pasta = mkdtempSync(join(tmpdir(), 'estudio-piloto-'))
  return {
    db,
    cofre: cofreDeTeste(),
    pastaMidia: join(pasta, 'midia'),
    pastaRender: join(pasta, 'render'),
    producao: new GerenciadorProducao(db, join(pasta, 'render'), () => null),
    ferramentas: () => null,
    pesquisas: new GerenciadorPesquisas(db, { buscar: async () => Promise.reject(new Error('rede desativada')), agora: () => new Date() }),
    versaoApp: '0.0.0-teste',
    pastaDados: pasta,
    pastaBackups: join(pasta, 'backups'),
    youtube: new YouTubeNaoConfigurado(),
    envios: new GerenciadorEnvio(db, cofreDeTeste(), () => new YouTubeNaoConfigurado()),
    abrirNavegador: async () => undefined,
    plataforma: { salvarTexto: vi.fn(async () => null), abrirPasta: vi.fn(async () => undefined), escolherArquivos: vi.fn(async () => []), mostrarNoExplorador: vi.fn() }
  }
}

/** Pesquisa concluída com 4 notícias do mesmo assunto, de dois sites (uma fonte oficial). */
function pesquisaConcluida(ctx: Contexto, projetoId: number, fonteUnica = false): void {
  const e = criarExecucao(ctx.db, { projetoId, consulta: 'norma ia', pautaId: null, origem: 'manual' }, new Date())
  executar(ctx.db, "UPDATE execucoes_pesquisa SET status = 'concluida', concluida_em = :t WHERE id = :id", { id: e, t: new Date().toISOString() })
  const agora = new Date().toISOString()
  const noticias: [string, string, string, string, string][] = [
    ['Governo publica norma de inteligência artificial', 'https://www.gov.br/norma-ia', 'www.gov.br', 'oficial', 'O governo federal publicou hoje a norma que regula o uso de inteligência artificial nas empresas do país.'],
    ['Norma de IA é publicada pelo governo', 'https://tecnoblog.net/norma-ia', 'tecnoblog.net', 'imprensa', 'Foi publicada a norma brasileira de inteligência artificial, que define regras para empresas e órgãos públicos.'],
    ['Empresas terão prazo para a norma de IA', 'https://www.gov.br/prazo-ia', 'www.gov.br', 'oficial', 'As empresas terão um período de adaptação antes que as regras da norma de inteligência artificial passem a valer.'],
    ['Prazo de adaptação à norma de IA', 'https://tecnoblog.net/prazo-ia', 'tecnoblog.net', 'imprensa', 'Haverá um prazo de adaptação para as empresas cumprirem a nova norma de inteligência artificial no Brasil.']
  ]
  let primeiro: number | null = null
  for (const [titulo, url, dominio, tipo, trecho] of fonteUnica ? noticias.slice(1, 2) : noticias) {
    const { id } = executar(
      ctx.db,
      `INSERT INTO resultados_pesquisa (execucao_id, fonte_nome, titulo, url, url_canonica, dominio, publicada_em, acessada_em, trecho, tipo_fonte, relevancia, atualidade, confiabilidade, nicho, pontuacao, explicacao, grupo, criado_em)
       VALUES (:e, 'Fonte', :titulo, :url, :url, :dominio, :t, :t, :trecho, :tipo, 1, 1, 1, 1, 80, '[]', :g, :t)`,
      { e, titulo, url, dominio, tipo, trecho, t: agora, g: primeiro }
    )
    primeiro ??= id
    executar(ctx.db, 'UPDATE resultados_pesquisa SET grupo = :g WHERE id = :id', { g: primeiro, id })
  }
}

async function montarCenario(): Promise<{ ctx: Contexto; agora: Date }> {
  const ctx = contexto()
  const p = projetoDeTeste(ctx.db)
  ia.salvarProvedor(ctx.db, ctx.cofre, null, { nome: 'IA do PC', adaptador: 'ollama', urlBase: await iaFalsa(), modelo: 'modelo', precoEntradaPorMilhao: null, precoSaidaPorMilhao: null, maxTokensSaida: 2000, limitesConhecidos: '' })
  // Sem busca/geração de imagens nestes testes (sem internet).
  gravarConfig(ctx.db, CHAVE_PREFERENCIA, { ...PREFERENCIA_MIDIA_PADRAO, busca: { ...PREFERENCIA_MIDIA_PADRAO.busca, fontes: [] }, geracao: { ...PREFERENCIA_MIDIA_PADRAO.geracao, ativa: false } })
  pesquisaConcluida(ctx, p)
  revisoes = 0
  return { ctx, agora: new Date(Date.now() + 60_000) }
}

describe('piloto automático', () => {
  it('produz sozinho: a IA revisa e aprova o roteiro, sem esperar por você', async () => {
    modoRevisor = 'ok'
    const { ctx, agora } = await montarCenario()
    // Desligado: não faz nada (a não ser forçado).
    expect(await cicloPiloto(ctx, { agora })).toEqual([])
    salvarConfigPiloto(ctx.db, { ...CONFIG_PILOTO_PADRAO, ligado: true })

    // Ciclo 1: pauta da pesquisa, tema na agenda e pesquisa extra de fontes (sem IA).
    const c1 = await cicloPiloto(ctx, { agora })
    expect(c1.map((r) => `${r.etapa}:${r.resultado}`)).toEqual(['pautas:feito', 'tema:feito', 'dossie:feito'])
    expect(c1[2]!.mensagem).toMatch(/Pesquisa extra: 0 matéria\(s\) nova\(s\); o tema tem 2 site\(s\) de fonte/)
    // Ciclo 1b: dossiê com IA (só trechos exatos entram).
    const c1b = await cicloPiloto(ctx, { agora })
    expect(c1b.map((r) => `${r.etapa}:${r.resultado}`)).toEqual(['dossie:feito'])
    expect(c1b[0]!.mensagem).toMatch(/4 afirmação\(ões\) extraída\(s\).*4 pronta/)
    expect(um<{ n: number }>(ctx.db, 'SELECT COUNT(*) AS n FROM afirmacoes')!.n).toBe(4)

    // Ciclo 2: roteiro escrito, revisado e aprovado pela IA pelas mesmas travas da aprovação manual.
    const c2 = await cicloPiloto(ctx, { agora })
    expect(c2.map((r) => `${r.etapa}:${r.resultado}`)).toEqual(['roteiro:feito'])
    expect(c2[0]!.mensagem).toMatch(/Aprovado pela IA: revisão interna sem pontos críticos/)
    const cal = um<{ roteiroId: number }>(ctx.db, "SELECT roteiro_id AS roteiroId FROM calendario_entradas WHERE status = 'planejado'")!
    expect(obterRoteiro(ctx.db, cal.roteiroId).status).toBe('aprovado')
    expect(todos<{ comentario: string }>(ctx.db, 'SELECT comentario FROM aprovacoes WHERE roteiro_id = :r', { r: cal.roteiroId }).every((a) => a.comentario.startsWith('Aprovado pela IA'))).toBe(true)

    if (process.platform === 'win32') {
      // Ciclo 3: edição + narração (voz real do Windows); ciclo 4: sem FFmpeg, o piloto instala sozinho (falso no teste).
      const c3 = await cicloPiloto(ctx, { agora })
      expect(c3.map((r) => `${r.etapa}:${r.resultado}`)).toEqual(['midia:feito'])
      const c4 = await cicloPiloto(ctx, { agora })
      expect(c4.at(-1)).toMatchObject({ etapa: 'render', resultado: 'feito', precisaUsuario: false })
      expect(c4.at(-1)!.mensagem).toMatch(/FFmpeg instalado/)

      // Controle de qualidade com bloqueador: nunca aceito; o piloto corrige o projeto (revisão nova = renderiza de novo).
      const cal2 = um<{ id: number }>(ctx.db, "SELECT id FROM calendario_entradas WHERE status = 'planejado'")!
      const ed = um<{ id: number; revisao: number }>(ctx.db, 'SELECT id, revisao FROM projetos_edicao ORDER BY id DESC LIMIT 1')!
      const renderReprovado = (revisao: number): void => {
        const t = new Date().toISOString()
        const r = executar(ctx.db, "INSERT INTO renderizacoes (edicao_id, revisao, preset, opcoes, arquivo, status, iniciada_em, criado_em) VALUES (:e, :r, '16:9-1080p', '{}', 'x.mp4', 'concluida', :t, :t)", { e: ed.id, r: revisao, t }).id
        executar(
          ctx.db,
          "INSERT INTO relatorios_qualidade (renderizacao_id, itens, bloqueadores, avisos, excecoes, aprovado, pasta_capturas, capturas, criado_em, atualizado_em) VALUES (:r, :i, 1, 0, '[]', 0, '', '[]', :t, :t)",
          { r, i: JSON.stringify([{ codigo: 'tela_preta', nivel: 'bloqueador', mensagem: 'Mais da metade do vídeo é tela preta: imagens ausentes?' }]), t }
        )
      }
      // Erro de controle de qualidade de uma renderização ANTIGA (há 1 h) não pode segurar a renderização nova.
      executar(ctx.db, "INSERT INTO piloto_registros (calendario_id, titulo, etapa, resultado, mensagem, criado_em) VALUES (:c, 'x', 'qualidade', 'erro', 'Bloqueado (render antigo)', :q)", { c: cal2.id, q: new Date(Date.now() - 3_600_000).toISOString() })
      renderReprovado(obterEdicao(ctx.db, ed.id).revisao)
      const c5 = await cicloPiloto(ctx, { agora })
      expect(c5.at(-1)).toMatchObject({ etapa: 'qualidade', resultado: 'feito' })
      expect(c5.at(-1)!.mensagem).toMatch(/Correção automática 1\/3.*renderizado de novo/)
      expect(obterEdicao(ctx.db, ed.id).revisao).toBeGreaterThan(ed.revisao)
      expect(situacoesVideos(ctx.db).get(cal2.id)?.fase).toBe('corrigindo')
      expect(estadoPiloto(ctx.db).itens.every((i) => !i.precisaUsuario)).toBe(true)
      // Depois de 3 correções sem sucesso, o tema sai da agenda (outro ocupa o horário); nada fica para você aprovar.
      for (let k = 2; k <= 3; k++) executar(ctx.db, "INSERT INTO piloto_registros (calendario_id, titulo, etapa, resultado, mensagem, criado_em) VALUES (:c, 'x', 'qualidade', 'feito', :m, '2000-01-01T00:00:00Z')", { c: cal2.id, m: `Correção automática ${k}/3: teste` })
      renderReprovado(obterEdicao(ctx.db, ed.id).revisao)
      const c6 = await cicloPiloto(ctx, { agora })
      expect(c6.at(-1)).toMatchObject({ etapa: 'tema', resultado: 'feito' })
      expect(c6.at(-1)!.mensagem).toMatch(/3 correções automáticas.*outro tema ocupa o horário/)
      expect(um<{ s: string }>(ctx.db, 'SELECT status AS s FROM calendario_entradas WHERE id = :id', { id: cal2.id })!.s).toBe('cancelado')
    }
  }, 120_000)

  it('ponto crítico na revisão: a IA corrige o roteiro e só então aprova', async () => {
    modoRevisor = 'critico_uma_vez'
    const { ctx, agora } = await montarCenario()
    salvarConfigPiloto(ctx.db, { ...CONFIG_PILOTO_PADRAO, ligado: true })
    await cicloPiloto(ctx, { agora })
    await cicloPiloto(ctx, { agora })
    const c2 = await cicloPiloto(ctx, { agora })
    expect(c2[0]!.mensagem).toMatch(/depois de 1 correção\(ões\) automática/)
    const cal = um<{ roteiroId: number }>(ctx.db, "SELECT roteiro_id AS roteiroId FROM calendario_entradas WHERE status = 'planejado'")!
    expect(obterRoteiro(ctx.db, cal.roteiroId)).toMatchObject({ status: 'aprovado', versaoAtual: 2 })
  }, 60_000)

  it('sem conseguir corrigir: arquiva o roteiro e escreve outro; o tema nunca é abandonado', async () => {
    modoRevisor = 'sempre_critico'
    const { ctx, agora } = await montarCenario()
    salvarConfigPiloto(ctx.db, { ...CONFIG_PILOTO_PADRAO, ligado: true })
    await cicloPiloto(ctx, { agora })
    await cicloPiloto(ctx, { agora })
    const c2 = await cicloPiloto(ctx, { agora })
    expect(c2[0]).toMatchObject({ etapa: 'roteiro', resultado: 'feito', precisaUsuario: false })
    expect(c2[0]!.mensagem).toMatch(/Roteiro reprovado na revisão \(Depois de 2 correções.*escreve outro na próxima rodada/)
    expect(um<{ r: number | null }>(ctx.db, "SELECT roteiro_id AS r FROM calendario_entradas WHERE status = 'planejado'")!.r).toBeNull()
    expect(um<{ n: number }>(ctx.db, "SELECT COUNT(*) AS n FROM roteiros WHERE arquivado_em IS NOT NULL AND status <> 'aprovado'")!.n).toBe(1)
    // Sem esperar horas: o segundo roteiro sai já; reprovado de novo, o próximo vem em 30 minutos (o tema continua).
    const c3 = await cicloPiloto(ctx, { agora })
    expect(c3[0]).toMatchObject({ etapa: 'roteiro', resultado: 'feito' })
    expect(c3[0]!.mensagem).toMatch(/Roteiro reprovado.*escreve outro em 30 minutos/)
    const c4 = await cicloPiloto(ctx, { agora })
    expect(c4[0]).toMatchObject({ etapa: 'roteiro', resultado: 'aguardando' })
    expect(c4[0]!.mensagem).toMatch(/reprovado 2 vez\(es\).*escreve outro às/)
    // A própria mensagem de espera não conta como reprovação nem adia a próxima tentativa.
    const c5 = await cicloPiloto(ctx, { agora: new Date(agora.getTime() + 10 * 60_000) })
    expect(c5[0]!.mensagem).toMatch(/reprovado 2 vez\(es\)/)
    const c6 = await cicloPiloto(ctx, { agora: new Date(agora.getTime() + 31 * 60_000) })
    expect(c6[0]).toMatchObject({ etapa: 'roteiro', resultado: 'feito' })
    expect(c6[0]!.mensagem).toMatch(/Roteiro reprovado na revisão/)
    expect(um(ctx.db, "SELECT 1 FROM calendario_entradas WHERE status = 'planejado'")).toBeDefined()
    expect(estadoPiloto(ctx.db).itens.filter((i) => i.precisaUsuario)).toEqual([])
  }, 60_000)

  it('dossiê: a afirmação citada por um site só ganha a frase de outro site que diz o mesmo (com os mesmos números)', () => {
    const fontes = [
      { id: 1, titulo: 'Norma de IA', trecho: 'O governo publicou a norma de inteligência artificial com prazo de 12 meses para as empresas.', dominio: 'a.com' },
      { id: 2, titulo: 'Outra coisa', trecho: 'A norma de inteligência artificial terá prazo de 18 meses para empresas.', dominio: 'b.com' },
      { id: 3, titulo: 'Sem relação', trecho: 'Receita de bolo de cenoura com cobertura de chocolate.', dominio: 'c.com' }
    ]
    const r = corroboracoes('A norma de inteligência artificial dá prazo de 12 meses às empresas.', fontes)
    expect(r.map((x) => x.fonte.id)).toEqual([1])
    expect(r[0]!.trecho).toBe('O governo publicou a norma de inteligência artificial com prazo de 12 meses para as empresas.')
  })

  it('tema de fonte única: pesquisa extra na hora e continua procurando a cada 30 min (o tema não é abandonado)', async () => {
    const ctx = contexto()
    const p = projetoDeTeste(ctx.db)
    ia.salvarProvedor(ctx.db, ctx.cofre, null, { nome: 'IA do PC', adaptador: 'ollama', urlBase: await iaFalsa(), modelo: 'modelo', precoEntradaPorMilhao: null, precoSaidaPorMilhao: null, maxTokensSaida: 2000, limitesConhecidos: '' })
    pesquisaConcluida(ctx, p, true)
    const agora = new Date(Date.now() + 60_000)
    salvarConfigPiloto(ctx.db, { ...CONFIG_PILOTO_PADRAO, ligado: true })
    const c1 = await cicloPiloto(ctx, { agora })
    expect(c1.map((r) => `${r.etapa}:${r.resultado}`)).toEqual(['pautas:feito', 'tema:feito', 'dossie:feito'])
    expect(c1[2]).toMatchObject({ precisaUsuario: false })
    expect(c1[2]!.mensagem).toMatch(/Pesquisa extra: 0 matéria.*falta uma segunda fonte.*continua procurando/)
    const pauta = um<{ id: number }>(ctx.db, 'SELECT id FROM pautas ORDER BY id DESC LIMIT 1')!
    expect(um<{ s: string }>(ctx.db, 'SELECT status AS s FROM calendario_entradas ORDER BY id DESC LIMIT 1')!.s).toBe('planejado')
    expect(um<{ s: string }>(ctx.db, 'SELECT status AS s FROM pautas WHERE id = :id', { id: pauta.id })!.s).toBe('aprovada')
    // Logo depois: espera a próxima busca (30 min), dizendo quando.
    const c2 = await cicloPiloto(ctx, { agora })
    expect(c2.at(-1)).toMatchObject({ etapa: 'dossie', resultado: 'aguardando' })
    expect(c2.at(-1)!.mensagem).toMatch(/uma fonte só: o piloto procura outras matérias às \d\d:\d\d/)
    // 30 min depois: nova pesquisa extra.
    const c3 = await cicloPiloto(ctx, { agora: new Date(Date.now() + 31 * 60_000) })
    expect(c3.at(-1)!.mensagem).toMatch(/Pesquisa extra/)
    expect(estadoPiloto(ctx.db).itens.filter((i) => i.precisaUsuario)).toEqual([])
  }, 60_000)

  it('pesquisa extra: anexa a mesma notícia de outro site (de pesquisas anteriores) e o tema segue para o dossiê', async () => {
    const ctx = contexto()
    const p = projetoDeTeste(ctx.db)
    ia.salvarProvedor(ctx.db, ctx.cofre, null, { nome: 'IA do PC', adaptador: 'ollama', urlBase: await iaFalsa(), modelo: 'modelo', precoEntradaPorMilhao: null, precoSaidaPorMilhao: null, maxTokensSaida: 2000, limitesConhecidos: '' })
    pesquisaConcluida(ctx, p, true)
    // Outra pesquisa trouxe a mesma notícia em outro site (grupo diferente: a pauta nasceu com uma notícia só).
    const e = criarExecucao(ctx.db, { projetoId: p, consulta: 'x', pautaId: null, origem: 'manual' }, new Date())
    const t0 = new Date().toISOString()
    executar(
      ctx.db,
      `INSERT INTO resultados_pesquisa (execucao_id, fonte_nome, titulo, url, url_canonica, dominio, publicada_em, acessada_em, trecho, tipo_fonte, relevancia, atualidade, confiabilidade, nicho, pontuacao, explicacao, criado_em)
       VALUES (:e, 'Canaltech', 'Governo publica a norma de IA', 'https://canaltech.com.br/norma-ia', 'https://canaltech.com.br/norma-ia', 'canaltech.com.br', :t, :t, 'Foi publicada a norma brasileira de inteligência artificial para empresas.', 'imprensa', 1, 1, 1, 1, 40, '[]', :t)`,
      { e, t: t0 }
    )
    const agora = new Date(Date.now() + 60_000)
    salvarConfigPiloto(ctx.db, { ...CONFIG_PILOTO_PADRAO, ligado: true })
    const c1 = await cicloPiloto(ctx, { agora })
    expect(c1.at(-1)!.mensagem).toMatch(/Pesquisa extra: 1 matéria\(s\) nova\(s\) \(canaltech\.com\.br\); o tema tem 2 site/)
    expect(um<{ s: string }>(ctx.db, 'SELECT status AS s FROM calendario_entradas ORDER BY id DESC LIMIT 1')!.s).toBe('planejado')
    const c2 = await cicloPiloto(ctx, { agora })
    expect(c2.map((r) => r.etapa)).toEqual(['dossie'])
    expect(c2[0]!.mensagem).not.toMatch(/Pesquisa extra/)
  }, 60_000)

  it('não cria a mesma pauta de novo a cada pesquisa; "Recomeçar a fila" limpa o que não foi ao ar', async () => {
    modoRevisor = 'ok'
    const { ctx, agora } = await montarCenario()
    salvarConfigPiloto(ctx.db, { ...CONFIG_PILOTO_PADRAO, ligado: true })
    await cicloPiloto(ctx, { agora })
    // Nova pesquisa com as mesmas notícias: nenhuma pauta repetida.
    pesquisaConcluida(ctx, um<{ id: number }>(ctx.db, 'SELECT id FROM projetos LIMIT 1')!.id)
    const c = await cicloPiloto(ctx, { agora })
    expect(c.filter((r) => r.etapa === 'pautas')).toEqual([])
    expect(um<{ n: number }>(ctx.db, 'SELECT COUNT(*) AS n FROM pautas')!.n).toBe(1)
    await cicloPiloto(ctx, { agora })
    const m = recomecarFila(ctx.db)
    expect(m).toMatch(/1 vídeo\(s\) não publicado\(s\) cancelado\(s\), 1 roteiro\(s\) arquivado\(s\) e 1 pauta/)
    expect(um(ctx.db, "SELECT 1 FROM calendario_entradas WHERE status = 'planejado'")).toBeUndefined()
    expect(um<{ n: number }>(ctx.db, 'SELECT COUNT(*) AS n FROM roteiros WHERE arquivado_em IS NULL')!.n).toBe(0)
    // Depois de recomeçar, a pesquisa gera a pauta de novo (com a pesquisa extra de fontes).
    const c2 = await cicloPiloto(ctx, { agora })
    expect(c2[0]).toMatchObject({ etapa: 'pautas', resultado: 'feito' })
  }, 60_000)

  it('pausa geral impede o piloto, mesmo forçado', async () => {
    const ctx = contexto()
    salvarConfigPiloto(ctx.db, { ...CONFIG_PILOTO_PADRAO, ligado: true })
    gravarConfig(ctx.db, 'automacao.pausada', true)
    expect(await cicloPiloto(ctx, { forcar: true })).toEqual([])
  })

  it('vigia: uma hora sem nenhum vídeo avançar, põe outro tema em produção na frente (sem abandonar os travados)', async () => {
    const { ctx, agora } = await montarCenario()
    const proj = um<{ id: number }>(ctx.db, 'SELECT id FROM projetos LIMIT 1')!.id
    const ids = todos<{ id: number }>(ctx.db, 'SELECT id FROM resultados_pesquisa ORDER BY id').map((r) => r.id)
    const pauta = pautaDeResultados(ctx.db, proj, ids)
    const registro = (etapa: string, mensagem: string, minutosAtras: number): void => {
      executar(ctx.db, "INSERT INTO piloto_registros (calendario_id, titulo, etapa, resultado, mensagem, criado_em) VALUES (NULL, 'x', :e, 'feito', :m, :q)", {
        e: etapa,
        m: mensagem,
        q: new Date(agora.getTime() - minutosAtras * 60_000).toISOString()
      })
    }
    // Avançou há pouco (envio há 20 min): o vigia não mexe. Só dossiês na última hora: entra o reforço.
    registro('envio', 'No YouTube.', 20)
    expect(reforcarProducao(ctx.db, agora)).toEqual([])
    executar(ctx.db, "DELETE FROM piloto_registros WHERE etapa = 'envio'")
    registro('dossie', 'Dossiê incompleto: 2 de 4 fatos confirmados.', 5)
    const r = reforcarProducao(ctx.db, agora)
    expect(r).toHaveLength(1)
    expect(r[0]!.mensagem).toMatch(/^Reforço: .*2 site\(s\) de fonte/)
    const cal = um<{ pautaId: number; prioridade: number }>(ctx.db, "SELECT pauta_id AS pautaId, prioridade FROM calendario_entradas WHERE status = 'planejado'")!
    expect(cal).toEqual({ pautaId: pauta.id, prioridade: 100 })
    // Logo em seguida não põe outro (o reforço conta como avanço).
    expect(reforcarProducao(ctx.db, agora)).toEqual([])
  })
})

const ffmpeg = process.env.FFMPEG_REAL && process.platform === 'win32' ? localizarFerramentas(process.env.FFMPEG_CAMINHO ?? null) : null
describe.skipIf(!ffmpeg)('piloto automático até a publicação (FFmpeg real, opcional)', () => {
  it('renderiza, aprova o controle de qualidade, espera o horário para publicar sozinho; sem YouTube conectado, avisa', async () => {
    const base = contexto()
    const ctx: Contexto = { ...base, ferramentas: () => ffmpeg, producao: new GerenciadorProducao(base.db, base.pastaRender, () => ffmpeg) }
    const p = projetoDeTeste(ctx.db)
    ia.salvarProvedor(ctx.db, ctx.cofre, null, { nome: 'IA do PC', adaptador: 'ollama', urlBase: await iaFalsa(), modelo: 'modelo', precoEntradaPorMilhao: null, precoSaidaPorMilhao: null, maxTokensSaida: 2000, limitesConhecidos: '' })
    gravarConfig(ctx.db, CHAVE_PREFERENCIA, { ...PREFERENCIA_MIDIA_PADRAO, busca: { ...PREFERENCIA_MIDIA_PADRAO.busca, fontes: [] }, geracao: { ...PREFERENCIA_MIDIA_PADRAO.geracao, ativa: false } })
    // Imagens próprias (criadas aqui) para a montagem automática usar.
    for (const cor of ['red', 'green', 'blue', 'orange', 'purple', 'gray']) {
      const arq = join(ctx.pastaDados, `${cor}.png`)
      await executarFerramenta(ffmpeg!.ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${cor}:s=1920x1080`, '-frames:v', '1', arq], {})
      await importarMidia(ctx.db, ctx.pastaMidia, { projetoId: p, roteiroId: null, caminho: arq, situacaoLicenca: 'criado_usuario' })
    }
    pesquisaConcluida(ctx, p)
    const agora = new Date(Date.now() + 60_000)
    modoRevisor = 'ok'
    salvarConfigPiloto(ctx.db, { ...CONFIG_PILOTO_PADRAO, ligado: true })
    await cicloPiloto(ctx, { agora }) // pauta, tema e pesquisa extra de fontes
    await cicloPiloto(ctx, { agora }) // dossiê
    await cicloPiloto(ctx, { agora }) // roteiro
    expect((await cicloPiloto(ctx, { agora })).map((r) => r.etapa)).toEqual(['midia'])
    expect((await cicloPiloto(ctx, { agora })).map((r) => `${r.etapa}:${r.resultado}`)).toEqual(['render:feito'])
    const inicioRender = Date.now()
    for (let i = 0; i < 1800 && um(ctx.db, "SELECT 1 FROM renderizacoes WHERE status IN ('pendente','em_andamento')"); i++) await new Promise((r) => setTimeout(r, 500))
    const ed = um<{ estado: string }>(ctx.db, 'SELECT estado FROM projetos_edicao ORDER BY id DESC LIMIT 1')!
    const duracaoVideo = Math.max(...(JSON.parse(ed.estado) as { clips: { inicio: number; duracao: number }[] }).clips.map((c) => c.inicio + c.duracao))
    console.log(`Render: vídeo de ${duracaoVideo.toFixed(0)} s em ${((Date.now() - inicioRender) / 1000).toFixed(0)} s`)
    expect(um<{ s: string }>(ctx.db, 'SELECT status AS s FROM renderizacoes ORDER BY id DESC LIMIT 1')!.s).toBe('concluida')
    const qc = await cicloPiloto(ctx, { agora })
    expect(qc[0]!.etapa).toBe('qualidade')
    console.log('QC:', qc[0]!.mensagem, JSON.stringify(todos<{ itens: string }>(ctx.db, 'SELECT itens FROM relatorios_qualidade').map((r) => (JSON.parse(r.itens) as { codigo: string; nivel: string; mensagem: string }[]).filter((i) => i.nivel !== 'ok'))))
    expect(qc[0]!.mensagem).toMatch(/Controle de qualidade aprovado/)
    expect((await cicloPiloto(ctx, { agora })).map((r) => `${r.etapa}:${r.resultado}`)).toEqual(['publicacao:feito'])
    // Pronto e aprovado: sobe já ao YouTube (agendado para o horário). Sem conta conectada, é a única coisa que precisa de você.
    const cal = um<{ id: number }>(ctx.db, "SELECT id FROM calendario_entradas WHERE status = 'planejado'")!
    expect(situacoesVideos(ctx.db).get(cal.id)).toMatchObject({ fase: 'pronto', podePostar: true })
    await expect(postarAgora(ctx, cal.id)).rejects.toThrow(/Conecte a conta do YouTube/)
    const envio = await cicloPiloto(ctx, { agora })
    expect(envio[0]).toMatchObject({ etapa: 'envio', resultado: 'aguardando', precisaUsuario: true })
    expect(envio[0]!.mensagem).toMatch(/conta do YouTube não está conectada/)
    expect(estadoPiloto(ctx.db).itens[0]!.precisaUsuario).toBe(true)
    expect(um<{ s: string }>(ctx.db, 'SELECT status AS s FROM publicacoes')!.s).toBe('rascunho')
  }, 1_200_000)
})

