import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { YouTubeNaoConfigurado } from '@estudio/youtube'
import type { Contexto } from '../contexto'
import { GerenciadorProducao } from '../midia/producao'
import { GerenciadorPesquisas } from '../pesquisa/executor'
import { GerenciadorEnvio } from '../youtube/publicacao'
import { criarEdicao, obterEdicao } from '../midia/edicao'
import { listarMidia } from '../midia/biblioteca'
import { produzirMidias } from '../midia/automatica'
import { extensaoPeloConteudo } from '../midia/imagens'
import { listarVozesWindows, sintetizar } from '../midia/voz'
import { duracaoWav, licencaAceita, promptDaCena, termosDeBusca, PREFERENCIA_MIDIA_PADRAO } from '@shared/geracaoMidia'
import { estadoInicial, intervaloCena, retemporizarComNarracao, textosDasCenas } from '@shared/edicao'
import { gerarDescricao } from '@shared/publicacao'
import { avaliarQualidade, type DadosQualidade } from '@shared/qualidade'
import { bancoDeTeste, cofreDeTeste, projetoDeTeste, roteiroDeTeste } from './auxiliares'

const ROTEIRO = '# Teste\n\n## Abertura\n\nA inteligência artificial chegou às pequenas empresas.\n\n## Conclusão\n\nE isso muda a forma de trabalhar.\n'
const windows = process.platform === 'win32'

function contexto(): Contexto {
  const db = bancoDeTeste()
  const pasta = mkdtempSync(join(tmpdir(), 'estudio-midia-auto-'))
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

describe('regras da mídia automática', () => {
  it('aceita só licenças livres para uso no vídeo', () => {
    expect(licencaAceita('Public domain', false)).toEqual({ aceita: true, exigeCredito: false })
    expect(licencaAceita('CC0', false)).toEqual({ aceita: true, exigeCredito: false })
    expect(licencaAceita('CC BY 4.0', false)).toEqual({ aceita: true, exigeCredito: true })
    expect(licencaAceita('CC BY-SA 4.0', false).aceita).toBe(false)
    expect(licencaAceita('CC BY-SA 4.0', true).aceita).toBe(true)
    expect(licencaAceita('CC BY-NC 2.0', true).aceita).toBe(false)
    expect(licencaAceita('CC BY-ND 3.0', true).aceita).toBe(false)
    expect(licencaAceita('Fair use', true).aceita).toBe(false)
  })

  it('termos de busca e prompt seguros', () => {
    expect(termosDeBusca('Ponto 1: chips de IA', 'Mercado de semicondutores')).toBe('chips mercado semicondutores')
    const p = promptDaCena({ titulo: 'Abertura', visual: 'Fábrica de chips com robôs', narracao: 'texto', estilo: '', formato: '9:16' })
    expect(p).toMatch(/Fábrica de chips/)
    expect(p).toMatch(/vertical/)
    expect(p).toMatch(/sem pessoas reais identificáveis/)
  })

  it('reconhece o tipo do arquivo pelo conteúdo', () => {
    expect(extensaoPeloConteudo(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe('.jpg')
    expect(extensaoPeloConteudo(Buffer.from('MZ executável'))).toBeNull()
    expect(extensaoPeloConteudo(Buffer.from('<html>'))).toBeNull()
  })

  it('encaixa cada cena na duração da sua narração e estica o que pertence a ela', () => {
    const e = estadoInicial(ROTEIRO, '16:9')
    expect(textosDasCenas(e).map((c) => c.titulo)).toEqual(['Abertura', 'Conclusão'])
    const r = retemporizarComNarracao(e, [
      { cena: 0, recursoId: 10, duracao: 5 },
      { cena: 1, recursoId: 11, duracao: 3 }
    ])
    expect(intervaloCena(r, 0)).toEqual({ inicio: 0, fim: 5.4 })
    expect(intervaloCena(r, 1)!.inicio).toBe(5.4)
    expect(r.clips.filter((c) => c.faixa === 'narracao').map((c) => [c.recursoId, c.inicio, c.duracao])).toEqual([
      [10, 0, 5],
      [11, 5.4, 3]
    ])
    // As legendas continuam dentro da cena e na mesma ordem.
    const legendas0 = r.clips.filter((c) => c.faixa === 'legendas' && c.cena === 0)
    expect(Math.max(...legendas0.map((c) => c.inicio + c.duracao))).toBeLessThanOrEqual(5.41)
  })

  it('créditos entram na descrição; mídia sintética gera aviso na descrição e no controle de qualidade', () => {
    const d = gerarDescricao({ resumo: 'Resumo.', formato: '16:9', duracaoSeg: 60, capitulos: [], fontes: [], links: [], tags: [], creditos: ['Wikimedia Commons: Fulano (CC BY 4.0) https://commons.wikimedia.org/x'], sintetico: { imagens: true, voz: true } })
    expect(d.texto).toMatch(/Créditos das imagens e vídeos\n- Wikimedia Commons: Fulano \(CC BY 4\.0\)/)
    expect(d.avisos.join(' ')).toMatch(/Conteúdo alterado ou sintético/)
    const midia = { id: 1, nome: 'x.jpg', situacaoLicenca: 'gerado_ia', licenca: 'Gerada por IA', origem: 'Imagem gerada por IA — FLUX', urlOrigem: '', existe: true }
    const dados: DadosQualidade = {
      arquivoExiste: true,
      tamanhoBytes: 1000,
      sonda: null,
      esperado: { duracao: 10, largura: 1920, altura: 1080, temAudio: false },
      silencios: null,
      pretos: null,
      legendas: [],
      narracaoFim: null,
      cenasSemVisual: [],
      midias: [midia],
      fontesAnexadas: 1,
      roteiroAprovado: true,
      revisaoRenderizada: 1,
      revisaoAtual: 1
    }
    const itens = avaliarQualidade(dados)
    expect(itens.find((i) => i.codigo === 'conteudo_sintetico')?.nivel).toBe('aviso')
  })

  it('lê a duração de um WAV pelo cabeçalho', () => {
    const wav = Buffer.alloc(44 + 32000)
    wav.write('RIFF', 0)
    wav.write('WAVE', 8)
    wav.write('fmt ', 12)
    wav.writeUInt32LE(16, 16)
    wav.writeUInt32LE(32000, 28) // bytes por segundo
    wav.write('data', 36)
    wav.writeUInt32LE(32000, 40)
    expect(duracaoWav(wav)).toBe(1)
  })
})

describe.skipIf(!windows)('voz do Windows (real)', () => {
  it('lista as vozes e gera fala em português', async () => {
    const pasta = mkdtempSync(join(tmpdir(), 'estudio-voz-'))
    const vozes = await listarVozesWindows(pasta)
    expect(vozes.length).toBeGreaterThan(0)
    const r = await sintetizar(PREFERENCIA_MIDIA_PADRAO.voz, 'Olá! Este é um teste da narração.', join(pasta, 'teste.wav'), pasta)
    expect(r.duracao).toBeGreaterThan(0.5)
    expect(readFileSync(join(pasta, 'teste.wav')).subarray(0, 4).toString()).toBe('RIFF')
  }, 60_000)

  it('produz a narração da edição inteira em 1 chamada, com proveniência e cenas ajustadas', async () => {
    const ctx = contexto()
    const p = projetoDeTeste(ctx.db)
    const rot = roteiroDeTeste(ctx.db, p, { conteudo: ROTEIRO })
    const ed = criarEdicao(ctx.db, rot.id, '16:9')
    const passos: number[] = []
    const r = await produzirMidias(ctx, ed.id, { narracao: true, imagens: false }, (pct) => passos.push(pct))
    expect(r.relatorio[0]).toMatch(/Narração gerada em 2 cena\(s\)/)
    const midias = listarMidia(ctx.db, { projetoId: p, roteiroId: rot.id })
    expect(midias).toHaveLength(2)
    expect(midias.every((m) => m.categoria === 'audio' && m.situacaoLicenca === 'gerado_ia' && m.origem.startsWith('Narração sintética'))).toBe(true)
    const e = obterEdicao(ctx.db, ed.id).estado
    const narr = e.clips.filter((c) => c.faixa === 'narracao')
    expect(narr).toHaveLength(2)
    expect(intervaloCena(e, 1)!.inicio).toBeCloseTo(narr[0]!.duracao + 0.4, 2)
    expect(passos.at(-1)).toBe(100)
    // Rodar de novo não duplica a narração.
    const r2 = await produzirMidias(ctx, ed.id, { narracao: true, imagens: false })
    expect(r2.relatorio[0]).toMatch(/já tem narração/)
  }, 120_000)
})
