import { describe, expect, it } from 'vitest'
import { abrirBanco, executar } from '../db/conexao'
import { MIGRACOES, migrar } from '../db/migracoes'
import * as ia from '../ia/central'
import * as dossie from '../repositorios/dossie'
import * as pautas from '../repositorios/pautas'
import * as r from '../repositorios/roteiros'
import * as revisao from '../revisao/fluxo'
import { gerarRoteiro, planejarGeracao, type PedidoGeracao } from '../roteiros/gerador'
import { analisarTexto } from '@shared/analiseTexto'
import { conferirEstrutura, type Estrutura } from '@shared/estrutura'
import { pautaNovaSchema } from '@shared/schemas'
import { bancoDeTeste, cofreDeTeste, projetoDeTeste } from './auxiliares'

const sinal = (): AbortSignal => new AbortController().signal

/** Pauta aprovada com duas afirmações confirmadas por fontes informadas pelo usuário (dados de teste). */
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
  return { db, cofre, p, pauta }
}
const pedido = (pautaId: number, extra: Partial<PedidoGeracao> = {}): PedidoGeracao => ({ pautaId, roteiroId: null, tipo: 'longo', provedorId: null, angulo: '', ...extra })

describe('migração 7 (recriação da tabela de roteiros)', () => {
  it('preserva roteiros, versões e vínculos existentes', () => {
    const db = abrirBanco(':memory:')
    for (const m of MIGRACOES.filter((x) => x.versao <= 6)) {
      db.exec(m.sql)
      db.exec(`PRAGMA user_version = ${m.versao}`)
    }
    const t = '2026-10-01T00:00:00.000Z'
    executar(db, "INSERT INTO projetos (nome, criado_em, atualizado_em) VALUES ('P', :t, :t)", { t })
    executar(db, "INSERT INTO roteiros (projeto_id, titulo, tipo_video, status, criado_em, atualizado_em) VALUES (1, 'Antigo', 'longo', 'aprovado', :t, :t)", { t })
    executar(db, "INSERT INTO roteiro_versoes (roteiro_id, numero, titulo, conteudo, resumo_alteracoes, criado_em) VALUES (1, 1, 'Antigo', 'texto', 'v1', :t)", { t })
    expect(migrar(db)).toEqual(MIGRACOES.filter((x) => x.versao > 6).map((x) => x.versao))
    expect(r.obterRoteiro(db, 1)).toMatchObject({ titulo: 'Antigo', status: 'aprovado', conteudo: 'texto' })
    r.alterarStatus(db, 1, 'precisa_verificacao')
    r.excluirRoteiro(db, 1)
    expect(db.prepare('SELECT COUNT(*) AS n FROM roteiro_versoes').get()).toEqual({ n: 0 }) // cascata continua funcionando
  })
})

describe('gerador de roteiros', () => {
  it('modo estruturado (sem IA): roteiro longo com fontes reais, nunca aprovado', async () => {
    const { db, cofre, pauta } = preparar()
    expect(planejarGeracao(db, cofre, pedido(pauta.id))).toEqual({ plano: null, afirmacoesProntas: 2, rota: null })
    const g = await gerarRoteiro(db, cofre, pedido(pauta.id), null, sinal())
    expect(g.status).toBe('pronto_revisao')
    expect(g.origem).toBe('estruturado')
    const rot = r.obterRoteiro(db, g.roteiroId)
    expect(rot.conteudo).toContain('## Abertura')
    expect(rot.conteudo).toContain('https://www.gov.br/norma')
    expect(rot.conteudo).toContain('[Fontes: F1]')
    expect(rot.conteudo).toContain('não garantem cliques')
    expect(rot.status).not.toBe('aprovado')
  })

  it('Short de teste e variação que preserva a versão anterior', async () => {
    const { db, cofre, pauta } = preparar()
    const s = await gerarRoteiro(db, cofre, pedido(pauta.id, { tipo: 'short' }), null, sinal())
    const curto = r.obterRoteiro(db, s.roteiroId)
    expect(curto.tipoVideo).toBe('short')
    expect(curto.conteudo).toContain('9:16')
    const v = await gerarRoteiro(db, cofre, { pautaId: null, roteiroId: s.roteiroId, tipo: 'short', provedorId: null, angulo: 'exemplo prático' }, null, sinal())
    expect(v.versao).toBe(2)
    expect(r.obterVersao(db, s.roteiroId, 1).conteudo).toBe(curto.conteudo)
    expect(r.listarVersoes(db, s.roteiroId)[0]!.resumoAlteracoes).toMatch(/ângulo: exemplo prático/)
  })

  it('com o adaptador simulado: texto marcado e alerta para afirmação inexistente', async () => {
    const { db, cofre, pauta } = preparar()
    const prov = ia.salvarProvedor(db, cofre, null, { nome: 'Simulado', adaptador: 'simulado', urlBase: '', modelo: '', precoEntradaPorMilhao: null, precoSaidaPorMilhao: null, maxTokensSaida: 1000, limitesConhecidos: '' })
    const g = await gerarRoteiro(db, cofre, pedido(pauta.id, { provedorId: prov.id }), null, sinal())
    expect(r.obterRoteiro(db, g.roteiroId).conteudo).toContain('[SIMULADO]')
    expect(g.origem).toBe('ia:Simulado')
  })

  it('exige pauta aprovada', async () => {
    const { db, cofre, p } = preparar()
    const outra = pautas.criarPauta(db, pautaNovaSchema.parse({ projetoId: p, titulo: 'Ideia' }))
    await expect(gerarRoteiro(db, cofre, pedido(outra.id), null, sinal())).rejects.toThrow(/Aprove a pauta/)
  })

  it('confere a saída: remove referência inventada e marca números novos', () => {
    const e: Estrutura = {
      titulo: 'T',
      promessa: '',
      abertura: 'Em 2031 tudo mudou.',
      cenas: [{ titulo: '', narracao: 'São 12 artigos e 99% de adesão, segundo estudos.', visual: '', textoNaTela: '', afirmacoes: [1, 999] }],
      conclusao: 'Fim.',
      sugestoes: { titulos: [], descricao: '', miniatura: '' }
    }
    const { estrutura, alertas } = conferirEstrutura(e, [{ id: 1, texto: 'A norma tem 12 artigos.', natureza: 'fato', fontes: [] }])
    expect(estrutura.cenas[0]!.afirmacoes).toEqual([1])
    expect(alertas.map((a) => a.tipo)).toEqual(expect.arrayContaining(['referencia_inexistente', 'fato_novo']))
    expect(alertas.find((a) => a.tipo === 'fato_novo' && a.cena === 0)!.mensagem).toMatch(/99%/)
    expect(alertas.some((a) => a.mensagem.includes('2031'))).toBe(true)
  })
})

describe('revisão editorial obrigatória', () => {
  it('fluxo completo com bloqueio, correção, aprovações separadas e invalidação ao editar', async () => {
    const { db, cofre, pauta } = preparar()
    const g = await gerarRoteiro(db, cofre, pedido(pauta.id), null, sinal())
    const id = g.roteiroId

    // Sem aprovações: produção bloqueada.
    expect(() => revisao.aprovarParaProducao(db, id, '')).toThrow(/Falta aprovação factual/)
    // Editor acrescenta um número que não está no dossiê: revisão factual bloqueia.
    const atual = r.obterRoteiro(db, id)
    const frase = 'Cerca de 75% das empresas já se adaptaram.\n'
    r.salvarRoteiro(db, { ...atual, conteudo: atual.conteudo.replace('## Conclusão\n', `## Conclusão\n${frase}`), versaoBase: atual.versaoAtual })
    expect(revisao.painelRevisao(db, id).pendenciasFactuais.join(' ')).toMatch(/75%/)
    expect(() => revisao.aprovarFactual(db, id, '')).toThrow(/pendência/)
    // Pedir correção devolve para rascunho e registra.
    revisao.solicitarCorrecoes(db, id, 'factual', 'Remover o dado de 75% sem fonte.')
    expect(r.obterRoteiro(db, id).status).toBe('rascunho')
    const v3 = r.obterRoteiro(db, id)
    r.salvarRoteiro(db, { ...v3, conteudo: v3.conteudo.replace(frase, ''), versaoBase: v3.versaoAtual })

    revisao.aprovarFactual(db, id, 'Fontes conferidas.')
    // A aprovação editorial é separada e não apaga alertas factuais.
    let painel = revisao.aprovarEditorial(db, id, 'Texto ok.')
    expect(painel.aprovacaoFactual).not.toBeNull()
    expect(painel.podeAprovarProducao).toBe(true)
    painel = revisao.aprovarParaProducao(db, id, 'Liberado')
    expect(painel.roteiro.status).toBe('aprovado')

    // Alteração depois da aprovação: nova versão, aprovações invalidadas para as partes alteradas.
    const ap = r.obterRoteiro(db, id)
    r.salvarRoteiro(db, { ...ap, conteudo: ap.conteudo.replace('## Conclusão', '## Conclusão\n\nUm parágrafo novo.'), versaoBase: ap.versaoAtual })
    painel = revisao.painelRevisao(db, id)
    expect(painel.roteiro.status).toBe('em_revisao')
    expect(painel.aprovacaoFactual).toBeNull()
    expect(painel.historico.filter((h) => h.acao === 'invalidada').length).toBeGreaterThanOrEqual(2)
    expect(painel.historico.find((h) => h.invalidadaMotivo)!.invalidadaMotivo).toMatch(/Conclusão/)
    // Histórico auditável: versão, tipo e ação de cada decisão.
    expect(painel.historico.map((h) => `${h.tipo}:${h.acao}`)).toEqual(expect.arrayContaining(['factual:correcoes', 'factual:aprovado', 'editorial:aprovado', 'producao:aprovado']))
  })

  it('salvar sem mudar o texto mantém a aprovação', async () => {
    const { db, cofre, pauta } = preparar()
    const g = await gerarRoteiro(db, cofre, pedido(pauta.id), null, sinal())
    revisao.aprovarFactual(db, g.roteiroId, '')
    const rot = r.obterRoteiro(db, g.roteiroId)
    r.salvarRoteiro(db, { ...rot, notas: 'só uma nota', versaoBase: rot.versaoAtual })
    expect(revisao.painelRevisao(db, g.roteiroId).aprovacaoFactual).not.toBeNull()
  })

  it('marcar afirmação como verificada exige fonte registrada', () => {
    const { db, pauta } = preparar()
    const alvo = { pautaId: pauta.id, roteiroId: null }
    dossie.criarAfirmacao(db, alvo, { texto: 'Sem fonte ainda.', natureza: 'fato', relevante: true, temaRapido: false, observacoes: '' })
    const a = dossie.relatorio(db, alvo).afirmacoes.at(-1)!
    expect(() => dossie.marcarVerificada(db, a.id, 'conferi')).toThrow(/vincule antes/)
    dossie.vincularNovaFonte(db, a.id, { titulo: 'Blog', url: 'https://blog.exemplo/x', autor: '', tipoFonte: 'blog', publicadaEm: null, acessadaEm: '2026-10-30' }, { trecho: 'trecho', papel: 'secundaria', posicao: 'sustenta' })
    expect(dossie.relatorio(db, alvo).afirmacoes.at(-1)!.verificacao.situacao).toBe('parcial')
    dossie.marcarVerificada(db, a.id, 'Conferido no documento original.')
    const v = dossie.relatorio(db, alvo).afirmacoes.at(-1)!
    expect(v.verificacao).toMatchObject({ situacao: 'confirmada', pronta: true })
    expect(v.verificacao.razao).toMatch(/Verificada manualmente.*documento original/)
  })

  it('análise de texto: cópia de fonte, exagero, repetição e título apelativo', () => {
    const fonte = 'a agência anunciou hoje um conjunto amplo de regras para sistemas de inteligência artificial usados em serviços públicos'
    const texto = `## Bloco\n\n${fonte}. Isso é incrível e vai mudar sua vida. No mundo de hoje tudo muda rápido demais para todos.\nNo mundo de hoje tudo muda rápido demais para todos.`
    const alertas = analisarTexto('VOCÊ NÃO VAI ACREDITAR!!', texto, { anteriores: [], trechosFontes: [fonte], numerosDossie: [] })
    const tipos = alertas.map((a) => a.tipo)
    expect(tipos).toEqual(expect.arrayContaining(['copia', 'exagero', 'linguagem', 'repeticao', 'titulo']))
    expect(alertas.find((a) => a.tipo === 'copia')!.gravidade).toBe('critico')
  })
})
