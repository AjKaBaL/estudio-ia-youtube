import { mkdtempSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fraseDoCartao, gerarCartao, quebrar, tituloDoCartao } from '../midia/cartoes'
import { localizarFerramentas } from '../midia/ffmpeg'
import { vi } from 'vitest'
import { YouTubeNaoConfigurado } from '@estudio/youtube'
import type { Contexto } from '../contexto'
import { GerenciadorProducao } from '../midia/producao'
import { GerenciadorPesquisas } from '../pesquisa/executor'
import { GerenciadorEnvio } from '../youtube/publicacao'
import { criarEdicao, obterEdicao } from '../midia/edicao'
import { listarMidia } from '../midia/biblioteca'
import { CHAVE_PREFERENCIA, produzirMidias } from '../midia/automatica'
import { gravarConfig } from '../repositorios/configuracoes'
import { PREFERENCIA_MIDIA_PADRAO } from '@shared/geracaoMidia'
import { bancoDeTeste, cofreDeTeste, projetoDeTeste, roteiroDeTeste } from './auxiliares'

describe('cartões gráficos (regras)', () => {
  it('limpa o título, pega a primeira frase e quebra em linhas', () => {
    expect(tituloDoCartao('Bloco 2 — Participação do Inmetro')).toBe('Participação do Inmetro')
    expect(fraseDoCartao('O Inmetro participou do debate. Depois, outras coisas.')).toBe('O Inmetro participou do debate.')
    expect(quebrar('um dois três quatro cinco seis sete oito', 10, 2)).toEqual(['um dois', 'três…'])
  })
})

const f = process.env.FFMPEG_REAL ? localizarFerramentas(process.env.FFMPEG_CAMINHO ?? null) : null
describe.skipIf(!f)('cartões gráficos (FFmpeg real, opcional)', () => {
  it('gera o cartão em 16:9 e 9:16', async () => {
    const pasta = mkdtempSync(join(tmpdir(), 'estudio-cartao-'))
    for (const formato of ['16:9', '9:16'] as const) {
      const arq = await gerarCartao(f!, { titulo: 'Bloco 2 — Participação do Inmetro no debate sobre IA', frase: 'O Inmetro participou do debate sobre inteligência artificial e inovação em saúde no Rio de Janeiro.', formato, indice: formato === '16:9' ? 0 : 2, pasta: join(pasta, formato.replace(':', 'x')) })
      expect(statSync(arq).size).toBeGreaterThan(20_000)
      console.log(arq)
    }
  }, 60_000)

  it('produção sem nenhuma chave nem internet: toda cena recebe imagem (cartão gráfico)', async () => {
    const db = bancoDeTeste()
    const pasta = mkdtempSync(join(tmpdir(), 'estudio-cartao-prod-'))
    const ctx = {
      db, cofre: cofreDeTeste(), pastaMidia: join(pasta, 'midia'), pastaRender: join(pasta, 'render'), producao: new GerenciadorProducao(db, join(pasta, 'render'), () => f),
      ferramentas: () => f, pesquisas: new GerenciadorPesquisas(db, { buscar: async () => Promise.reject(new Error('rede desativada')), agora: () => new Date() }),
      versaoApp: 't', pastaDados: pasta, pastaBackups: join(pasta, 'b'), youtube: new YouTubeNaoConfigurado(), envios: new GerenciadorEnvio(db, cofreDeTeste(), () => new YouTubeNaoConfigurado()),
      abrirNavegador: async () => undefined, plataforma: { salvarTexto: vi.fn(), abrirPasta: vi.fn(), escolherArquivos: vi.fn(async () => []), mostrarNoExplorador: vi.fn() }
    } as unknown as Contexto
    gravarConfig(db, CHAVE_PREFERENCIA, { ...PREFERENCIA_MIDIA_PADRAO, busca: { ...PREFERENCIA_MIDIA_PADRAO.busca, fontes: [] } })
    const p = projetoDeTeste(db)
    const rot = roteiroDeTeste(db, p, { conteudo: ['# T', '', '## Bloco 1 — Abertura', '', 'A norma de IA foi publicada.', '', '## Bloco 2 — Participação do Inmetro', '', 'O Inmetro participou do debate.'].join(String.fromCharCode(10)) })
    const ed = criarEdicao(db, rot.id, '16:9')
    const r = await produzirMidias(ctx, ed.id, { narracao: false, imagens: true })
    expect(r.relatorio[0]).toMatch(/2 cartão\(ões\) gráfico\(s\) para 2 cena/)
    const e = obterEdicao(db, ed.id).estado
    expect(e.cenas.every((c) => e.clips.some((k) => k.faixa === 'video' && k.recursoId !== null && k.cena === c.indice))).toBe(true)
    const midias = listarMidia(db, { projetoId: p, roteiroId: rot.id })
    expect(midias.some((m) => m.cena === 'trilha' && m.categoria === 'audio')).toBe(true) // trilha original composta pelo app
    expect(midias.filter((m) => m.cena !== 'trilha').every((m) => m.situacaoLicenca === 'criado_usuario' && m.origem.startsWith('Cartão gráfico'))).toBe(true)
  }, 60_000)
})

