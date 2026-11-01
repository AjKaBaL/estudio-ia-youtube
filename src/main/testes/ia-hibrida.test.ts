import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, describe, expect, it } from 'vitest'
import * as ia from '../ia/central'
import { executarRoteado, rota } from '../ia/roteador'
import * as dossie from '../repositorios/dossie'
import * as pautas from '../repositorios/pautas'
import * as revisao from '../revisao/fluxo'
import { conferirItem, revisaoInternaAtual, revisarInternamente } from '../revisao/interna'
import { gerarRoteiro } from '../roteiros/gerador'
import { ErroRede } from '../pesquisa/rede'
import { escolherModelo, escolherReservas, CATALOGO_IA } from '@shared/catalogoIa'
import { POLITICA_PADRAO, type ProvedorIaEntrada } from '@shared/ia'
import { pautaNovaSchema } from '@shared/schemas'
import { bancoDeTeste, cofreDeTeste, projetoDeTeste } from './auxiliares'

/** "Ollama" falso no próprio computador, com um comportamento por servidor. */
type Modo = 'estrutura' | '429' | 'lixo' | 'revisao' | 'cotaPorModelo' | 'modeloSumiu'
const servidores: http.Server[] = []
async function ollamaFalso(modo: Modo): Promise<{ url: string; pedidos: string[] }> {
  const pedidos: string[] = []
  const s = http.createServer((req, res) => {
    let corpo = ''
    req.on('data', (p) => (corpo += p))
    req.on('end', () => {
      if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'modelo-teste' }] }))
      pedidos.push(corpo)
      // Só o modelo principal ("modelo-teste") está sem cota; o reserva responde.
      if (modo === '429' || (modo === 'cotaPorModelo' && (JSON.parse(corpo) as { model: string }).model === 'modelo-teste')) {
        res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '120' })
        return res.end(JSON.stringify({ error: 'limite diário atingido' }))
      }
      // O fornecedor não tem mais o modelo principal (404); o reserva responde.
      if (modo === 'modeloSumiu' && (JSON.parse(corpo) as { model: string }).model === 'modelo-teste') {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        return res.end(JSON.stringify({ error: 'model not found' }))
      }
      const ids = [...new Set([...corpo.matchAll(/\[A(\d+)\]/g)].map((m) => Number(m[1])))]
      const conteudo =
        modo === 'lixo'
          ? 'isto não é json'
          : modo === 'estrutura' || modo === 'cotaPorModelo' || modo === 'modeloSumiu'
            ? JSON.stringify({
                titulo: 'A norma de IA explicada',
                promessa: 'Entender a norma.',
                abertura: 'O que muda com a norma de IA?',
                cenas: ids.map((id, i) => ({ titulo: `Bloco ${'ABCD'[i]}`, narracao: `Narração de teste do bloco ${'ABCD'[i]} sobre a norma.`, visual: '', textoNaTela: '', afirmacoes: [id] })),
                conclusao: 'Essa é a resposta.',
                sugestoes: { titulos: [], descricao: '', miniatura: '' }
              })
            : JSON.stringify({
                nota: 7,
                resumo: 'Roteiro coerente, com um ponto a conferir.',
                itens: [
                  { tipo: 'fato_sem_base', gravidade: 'critico', trecho: 'Narração de teste do bloco A sobre a norma', problema: 'Confirme que o bloco A está nas afirmações.', sugestao: 'Citar a fonte.' },
                  { tipo: 'numero_divergente', gravidade: 'critico', trecho: 'frase que não existe no roteiro', problema: 'Inventado pelo revisor.', sugestao: '' }
                ]
              })
      res.end(JSON.stringify({ message: { content: conteudo }, prompt_eval_count: 100, eval_count: 50 }))
    })
  })
  servidores.push(s)
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()))
  return { url: `http://127.0.0.1:${(s.address() as AddressInfo).port}`, pedidos }
}
afterAll(() => servidores.forEach((s) => s.close()))

const local = (nome: string, url: string, extra: Partial<ProvedorIaEntrada> = {}): ProvedorIaEntrada => ({
  nome,
  adaptador: 'ollama',
  urlBase: url,
  modelo: 'modelo-teste',
  precoEntradaPorMilhao: null,
  precoSaidaPorMilhao: null,
  maxTokensSaida: 2000,
  limitesConhecidos: '',
  ...extra
})
const online = (nome: string, extra: Partial<ProvedorIaEntrada> = {}): ProvedorIaEntrada => ({
  nome,
  adaptador: 'openai_compativel',
  urlBase: 'https://api.exemplo-ia.com/v1',
  modelo: 'm',
  precoEntradaPorMilhao: null,
  precoSaidaPorMilhao: null,
  maxTokensSaida: 2000,
  limitesConhecidos: '',
  ...extra
})

function preparar() {
  const db = bancoDeTeste()
  const cofre = cofreDeTeste()
  const p = projetoDeTeste(db)
  const pauta = pautas.criarPauta(db, pautaNovaSchema.parse({ projetoId: p, titulo: 'Norma de IA', perguntaCentral: 'O que muda com a norma de IA?' }))
  pautas.alterarStatusPauta(db, pauta.id, 'aprovada')
  const alvo = { pautaId: pauta.id, roteiroId: null }
  for (const [texto, url] of [
    ['O órgão publicou a norma em 2026 com 12 artigos.', 'https://www.gov.br/norma'],
    ['Empresas terão 180 dias para se adaptar.', 'https://www.gov.br/prazo']
  ] as const) {
    dossie.criarAfirmacao(db, alvo, { texto, natureza: 'fato', relevante: true, temaRapido: false, observacoes: '' })
    const a = dossie.relatorio(db, alvo).afirmacoes.at(-1)!
    dossie.vincularNovaFonte(db, a.id, { titulo: 'Diário oficial', url, autor: '', tipoFonte: 'oficial', publicadaEm: '2026-10-29', acessadaEm: '2026-10-30' }, { trecho: texto, papel: 'primaria', posicao: 'sustenta' })
  }
  return { db, cofre, pauta }
}
const sinal = (): AbortSignal => new AbortController().signal
const pedidoAuto = (pautaId: number) => ({ pautaId, roteiroId: null, tipo: 'longo' as const, provedorId: null, automatico: true, angulo: '' })

describe('roteador da IA híbrida', () => {
  it('decide por modo, gratuidade, permissão, papel e prioridade', () => {
    const { db, cofre } = preparar()
    const pc = ia.salvarProvedor(db, cofre, null, local('PC', 'http://127.0.0.1:11434', { prioridade: 5 }))
    const gratis = ia.salvarProvedor(db, cofre, null, online('Grátis', { gratuito: true, prioridade: 1 }))
    const paga = ia.salvarProvedor(db, cofre, null, online('Paga', { precoEntradaPorMilhao: 1, precoSaidaPorMilhao: 2, prioridade: 1 }))
    const soEscreve = ia.salvarProvedor(db, cofre, null, online('Só escreve', { gratuito: true, prioridade: 2, papeis: { escrever: true, revisar: false } }))
    ia.salvarProvedor(db, cofre, null, { ...online('Simulado'), adaptador: 'simulado', urlBase: '' })
    for (const id of [gratis.id, paga.id, soEscreve.id]) ia.definirChave(db, cofre, id, 'chave-de-teste-123')

    // Padrão: somente local.
    expect(rota(db, cofre, 'escrever').ordem.map((o) => o.nome)).toEqual(['PC'])
    expect(rota(db, cofre, 'escrever').descartados).toEqual(
      expect.arrayContaining([{ nome: 'Grátis', motivo: 'modo “somente local”' }, { nome: 'Simulado', motivo: 'Simulado não entra na escolha automática' }])
    )
    // Híbrido sem permitir gratuitas automáticas: ainda só o PC.
    ia.salvarPolitica(db, { ...POLITICA_PADRAO, modo: 'hibrido' })
    expect(rota(db, cofre, 'escrever').descartados.find((d) => d.nome === 'Grátis')!.motivo).toMatch(/uso automático de IAs gratuitas está desligado/)
    // Híbrido com gratuitas: ordem pela prioridade; paga nunca entra; papel respeitado.
    ia.salvarPolitica(db, { ...POLITICA_PADRAO, modo: 'hibrido', gratuitosAutomaticos: true })
    expect(rota(db, cofre, 'escrever').ordem.map((o) => o.nome)).toEqual(['Grátis', 'Só escreve', 'PC'])
    expect(rota(db, cofre, 'revisar').ordem.map((o) => o.nome)).toEqual(['Grátis', 'PC'])
    expect(rota(db, cofre, 'escrever').descartados.find((d) => d.nome === 'Paga')!.motivo).toMatch(/pago/)
    expect(rota(db, cofre, 'revisar', { excluir: [gratis.id] }).ordem.map((o) => o.nome)).toEqual(['PC'])

    // Gratuita com permissão: custo zero e sem autorização a cada envio; paga continua exigindo.
    const plano = ia.planejarEnvio(db, cofre, { provedorId: gratis.id, finalidade: 't', sistema: 's', partes: [{ rotulo: 'x', texto: 'y' }] })
    expect(plano).toMatchObject({ exigeAutorizacao: false, custo: { valor: 0 }, bloqueios: [] })
    expect(ia.planejarEnvio(db, cofre, { provedorId: paga.id, finalidade: 't', sistema: 's', partes: [{ rotulo: 'x', texto: 'y' }] }).exigeAutorizacao).toBe(true)

    // Limite diário definido pelo usuário tira a IA da rota.
    ia.salvarProvedor(db, cofre, pc.id, { ...ia.obterProvedor(db, cofre, pc.id).config, limiteDiario: 1 })
    db.prepare("INSERT INTO uso_servicos (provedor_id, provedor_nome, finalidade, moeda, sucesso, criado_em) VALUES (:p, 'PC', 'x', 'USD', 1, :t)").run({ p: pc.id, t: new Date().toISOString() })
    expect(rota(db, cofre, 'revisar').descartados.find((d) => d.nome === 'PC')!.motivo).toMatch(/limite diário/)
  })

  it('passa para a próxima IA quando uma atinge o limite (429) ou responde fora do formato, e pausa só no limite', async () => {
    const { db, cofre, pauta } = preparar()
    const limite = await ollamaFalso('429')
    const lixo = await ollamaFalso('lixo')
    const boa = await ollamaFalso('estrutura')
    const a = ia.salvarProvedor(db, cofre, null, local('Sem cota', limite.url, { prioridade: 1 }))
    const b = ia.salvarProvedor(db, cofre, null, local('Responde errado', lixo.url, { prioridade: 2 }))
    ia.salvarProvedor(db, cofre, null, local('Funciona', boa.url, { prioridade: 3 }))
    ia.salvarPolitica(db, { ...POLITICA_PADRAO, revisaoInterna: { automatica: false, outroModelo: true } })

    const g = await gerarRoteiro(db, cofre, pedidoAuto(pauta.id), null, sinal())
    expect(g.origem).toBe('ia:Funciona')
    expect(g.alertas[0]!.mensagem).toMatch(/Sem cota .*429.*Responde errado/)
    expect(ia.obterProvedor(db, cofre, a.id).pausadoAte).not.toBeNull() // limite: pausa automática
    expect(ia.obterProvedor(db, cofre, b.id).pausadoAte).toBeNull() // formato errado: não pausa
    expect(rota(db, cofre, 'escrever').ordem.map((o) => o.nome)).toEqual(['Responde errado', 'Funciona'])
    ia.reativarProvedor(db, a.id)
    expect(rota(db, cofre, 'escrever').ordem[0]!.nome).toBe('Sem cota')
  })

  it('modelo sem cota passa para o modelo reserva do mesmo fornecedor, sem pausar o fornecedor', async () => {
    const { db, cofre, pauta } = preparar()
    const srv = await ollamaFalso('cotaPorModelo')
    const a = ia.salvarProvedor(db, cofre, null, local('Fornecedor', srv.url, { modelosReserva: ['reserva-teste'] }))
    ia.salvarPolitica(db, { ...POLITICA_PADRAO, revisaoInterna: { automatica: false, outroModelo: true } })

    const g = await gerarRoteiro(db, cofre, pedidoAuto(pauta.id), null, sinal())
    expect(g.origem).toBe('ia:Fornecedor')
    const modelos = (): string[] => srv.pedidos.map((c) => (JSON.parse(c) as { model: string }).model)
    expect(modelos()[0]).toBe('modelo-teste')
    expect(modelos().slice(1).every((m) => m === 'reserva-teste') && modelos().length > 1).toBe(true)
    expect(ia.obterProvedor(db, cofre, a.id).pausadoAte).toBeNull()
    expect(ia.modelosLivres(db, ia.obterProvedor(db, cofre, a.id).config, a.id, new Date())).toEqual(['reserva-teste'])
    const usos = db.prepare('SELECT provedor_nome AS n, sucesso AS ok FROM uso_servicos ORDER BY id').all() as { n: string; ok: number }[]
    expect(usos[0]).toEqual({ n: 'Fornecedor', ok: 0 })
    expect(usos.slice(1).every((u) => u.n === 'Fornecedor (reserva-teste)' && u.ok === 1)).toBe(true)

    // Próximo pedido vai direto ao reserva; com todos sem cota, o fornecedor entra em pausa.
    await gerarRoteiro(db, cofre, pedidoAuto(pauta.id), null, sinal())
    expect(modelos().filter((m) => m === 'modelo-teste')).toHaveLength(1)
    ia.pausarModelo(db, a.id, 'reserva-teste', new Date(Date.now() + 60_000))
    expect(ia.modelosLivres(db, ia.obterProvedor(db, cofre, a.id).config, a.id, new Date())).toEqual(['modelo-teste'])
  })

  it('modelo que o fornecedor não tem mais (404) fica de lado e o reserva responde', async () => {
    const { db, cofre, pauta } = preparar()
    const srv = await ollamaFalso('modeloSumiu')
    const a = ia.salvarProvedor(db, cofre, null, local('Fornecedor', srv.url, { modelosReserva: ['reserva-teste'] }))
    ia.salvarPolitica(db, { ...POLITICA_PADRAO, revisaoInterna: { automatica: false, outroModelo: true } })

    const g = await gerarRoteiro(db, cofre, pedidoAuto(pauta.id), null, sinal())
    expect(g.origem).toBe('ia:Fornecedor')
    const modelos = srv.pedidos.map((c) => (JSON.parse(c) as { model: string }).model)
    expect(modelos.filter((m) => m === 'modelo-teste')).toHaveLength(1)
    expect(ia.obterProvedor(db, cofre, a.id).pausadoAte).toBeNull()
    expect(ia.modelosLivres(db, ia.obterProvedor(db, cofre, a.id).config, a.id, new Date())).toEqual(['reserva-teste'])
  })

  it('sem nenhuma IA disponível, usa o modo estruturado e explica', async () => {
    const { db, cofre, pauta } = preparar()
    const g = await gerarRoteiro(db, cofre, pedidoAuto(pauta.id), null, sinal())
    expect(g.origem).toBe('estruturado')
    expect(g.alertas[0]!.mensagem).toMatch(/Nenhuma IA disponível agora/)
    const r = await executarRoteado(db, cofre, 'revisar', () => ({ provedorId: 0, finalidade: '', sistema: '', partes: [] }), { temperatura: 0, json: false, sinal: sinal() })
    expect(r.ok).toBe(false)
  })

  it('pausa: 429 respeita o tempo pedido; chave recusada pausa 24 h; outros erros não pausam', () => {
    const agora = new Date('2026-10-31T12:00:00Z')
    expect(ia.pausaPorErro(new ErroRede('http', 'x', 429, 120_000), agora)!.ate.toISOString()).toBe('2026-10-31T12:02:00.000Z')
    expect(ia.pausaPorErro(new ErroRede('http', 'x', 429), agora)!.ate.toISOString()).toBe('2026-10-31T13:00:00.000Z')
    expect(ia.pausaPorErro(new ErroRede('http', 'x', 401), agora)!.motivo).toMatch(/Chave recusada/)
    expect(ia.pausaPorErro(new ErroRede('http', 'x', 400), agora)).toBeNull()
    expect(ia.pausaPorErro(new Error('formato'), agora)).toBeNull()
  })

  it('catálogo: escolhe o modelo atual pelas preferências e ignora modelos que não escrevem texto', () => {
    const groq = CATALOGO_IA.find((c) => c.id === 'groq')!
    expect(escolherModelo(groq, ['whisper-large-v3', 'llama-3.1-8b-instant', 'llama-3.3-70b-versatile'])).toBe('llama-3.3-70b-versatile')
    const or = CATALOGO_IA.find((c) => c.id === 'openrouter')!
    expect(escolherModelo(or, ['openai/gpt-5', 'google/gemma-4-31b-it:free', 'x/y:free'])).toBe('google/gemma-4-31b-it:free')
    expect(escolherModelo(or, ['openai/gpt-5'])).toBeNull()
    // Reservas: outros modelos de texto do mesmo fornecedor, pela ordem das preferências.
    expect(escolherReservas(groq, ['whisper-large-v3', 'openai/gpt-oss-120b', 'llama-3.1-8b-instant', 'qwen/qwen3-32b', 'groq/compound', 'meta-llama/llama-guard-4-12b', 'llama-3.3-70b-versatile'], 'openai/gpt-oss-120b'))
      .toEqual(['llama-3.3-70b-versatile', 'qwen/qwen3-32b', 'llama-3.1-8b-instant'])
    expect(new Set(CATALOGO_IA.map((c) => c.id)).size).toBe(CATALOGO_IA.length)
    expect(CATALOGO_IA.filter((c) => c.adaptador !== 'ollama').every((c) => c.urlBase.startsWith('https://'))).toBe(true)
  })
})

describe('revisão interna', () => {
  it('outra IA revisa, descarta trecho inventado e pontos críticos bloqueiam até serem conferidos', async () => {
    const { db, cofre, pauta } = preparar()
    const escritora = await ollamaFalso('estrutura')
    const revisora = await ollamaFalso('revisao')
    // A escritora também poderia revisar, mas a política pede outra IA.
    ia.salvarProvedor(db, cofre, null, local('Escritora', escritora.url, { prioridade: 1 }))
    ia.salvarProvedor(db, cofre, null, local('Revisora', revisora.url, { prioridade: 2 }))
    const g = await gerarRoteiro(db, cofre, pedidoAuto(pauta.id), null, sinal())
    expect(g.origem).toBe('ia:Escritora')

    const rev = await revisarInternamente(db, cofre, g.roteiroId)
    expect(rev.revisor).toBe('regras + IA: Revisora')
    // (pedidos para desenvolver cenas curtas não contam aqui: são da escrita, não da revisão)
    const semDesenvolver = (ps: unknown[]): unknown[] => ps.filter((x) => !JSON.stringify(x).includes('desenvolve UMA cena'))
    expect(semDesenvolver(revisora.pedidos)).toHaveLength(1)
    expect(semDesenvolver(escritora.pedidos)).toHaveLength(1) // só escreveu
    const daIa = rev.itens.filter((i) => i.origem === 'ia')
    expect(daIa).toHaveLength(1)
    expect(rev.observacoes.join(' ')).toMatch(/1 ponto\(s\) da IA descartado/)
    expect(rev.resultado).toBe('reprovada')

    revisao.aprovarFactual(db, g.roteiroId, '')
    revisao.aprovarEditorial(db, g.roteiroId, '')
    expect(() => revisao.aprovarParaProducao(db, g.roteiroId, '')).toThrow(/Revisão interna: 1 ponto/)
    expect(() => conferirItem(db, rev.id, rev.itens.findIndex((i) => i.origem === 'regras'), '')).toThrow()
    conferirItem(db, rev.id, rev.itens.indexOf(daIa[0]!), 'Conferido na fonte.')
    expect(revisao.aprovarParaProducao(db, g.roteiroId, 'ok').roteiro.status).toBe('aprovado')
  })

  it('sem IA revisora, faz só as regras; aprovar para produção roda as regras se faltar a revisão', async () => {
    const { db, cofre, pauta } = preparar()
    const g = await gerarRoteiro(db, cofre, { ...pedidoAuto(pauta.id), automatico: false }, null, sinal())
    const rev = await revisarInternamente(db, cofre, g.roteiroId)
    expect(rev.revisor).toBe('regras')
    expect(rev.observacoes.join(' ')).toMatch(/só a revisão por regras/)

    const g2 = await gerarRoteiro(db, cofre, { pautaId: null, roteiroId: g.roteiroId, tipo: 'longo', provedorId: null, angulo: 'outro' }, null, sinal())
    expect(revisaoInternaAtual(db, g2.roteiroId)).toBeNull() // nova versão: revisão anterior não vale
    revisao.aprovarFactual(db, g2.roteiroId, '')
    revisao.aprovarEditorial(db, g2.roteiroId, '')
    revisao.aprovarParaProducao(db, g2.roteiroId, '')
    expect(revisaoInternaAtual(db, g2.roteiroId)!.observacoes[0]).toMatch(/ao aprovar para produção/)
  })
})
