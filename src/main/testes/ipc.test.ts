import { describe, expect, it, vi } from 'vitest'
import { YouTubeNaoConfigurado } from '@estudio/youtube'
import { GerenciadorEnvio } from '../youtube/publicacao'
import type { Contexto } from '../contexto'
import { listarEventos, higienizar } from '../db/eventos'
import { despachar } from '../ipc/despachar'
import { GerenciadorPesquisas } from '../pesquisa/executor'
import { cofreDeTeste } from './auxiliares'
import { GerenciadorProducao } from '../midia/producao'
import { manipuladores } from '../ipc/manipuladores'
import { CANAIS } from '@shared/canais'
import { ENTRADAS } from '@shared/ipc'
import { bancoDeTeste } from './auxiliares'

function contexto(): Contexto {
  const db = bancoDeTeste()
  return {
    db,
    cofre: cofreDeTeste(),
    pastaMidia: 'C:/teste/midia',
    pastaRender: 'C:/teste/render',
    producao: new GerenciadorProducao(db, 'C:/teste/render', () => null),
    ferramentas: () => null,
    pesquisas: new GerenciadorPesquisas(db, { buscar: async () => { throw new Error('rede desativada em teste') }, agora: () => new Date() }),
    versaoApp: '0.0.0-teste',
    pastaDados: 'C:/teste',
    pastaBackups: 'C:/teste/backups',
    youtube: new YouTubeNaoConfigurado(),
    envios: new GerenciadorEnvio(db, cofreDeTeste(), () => new YouTubeNaoConfigurado()),
    abrirNavegador: async () => undefined,
    plataforma: { salvarTexto: vi.fn(async () => 'C:/Users/x/Documents/roteiro.md'), abrirPasta: vi.fn(async () => undefined), escolherArquivos: vi.fn(async () => []), mostrarNoExplorador: vi.fn() }
  }
}

describe('IPC', () => {
  it('toda operação da lista permitida tem validação e manipulador', () => {
    expect(Object.keys(ENTRADAS).sort()).toEqual([...CANAIS].sort())
    expect(Object.keys(manipuladores).sort()).toEqual([...CANAIS].sort())
  })

  it('recusa canal fora da lista e registra o evento', async () => {
    const ctx = contexto()
    const r = await despachar('fs:lerArquivo', { caminho: 'C:/Windows' }, ctx)
    expect(r).toEqual({ ok: false, erro: { codigo: 'canal_negado', mensagem: 'Operação não permitida.' } })
    expect(listarEventos(ctx.db)[0]!.categoria).toBe('ipc')
  })

  it('valida a entrada antes de executar', async () => {
    const ctx = contexto()
    const r = await despachar('projetos:criar', { nome: '' }, ctx)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.erro.codigo).toBe('validacao')
    const r2 = await despachar('roteiros:obter', { id: "1; DROP TABLE roteiros" }, ctx)
    expect(r2.ok).toBe(false)
    const r3 = await despachar('roteiros:adicionarFonte', { roteiroId: 1, titulo: 'x', url: 'javascript:alert(1)', acessadaEm: '2026-10-30' }, ctx)
    expect(r3.ok).toBe(false)
  })

  it('devolve mensagem amigável para erros de regra de negócio', async () => {
    const ctx = contexto()
    const r = await despachar('roteiros:obter', { id: 99 }, ctx)
    expect(r).toMatchObject({ ok: false, erro: { codigo: 'nao_encontrado' } })
  })

  it('fluxo completo: projeto, roteiro, visão geral e exportação', async () => {
    const ctx = contexto()
    const p = await despachar('projetos:criar', { nome: 'Canal' }, ctx)
    if (!p.ok) throw new Error('falhou')
    const id = (p.dados as { id: number }).id
    const rot = await despachar('roteiros:criar', { projetoId: id, titulo: 'Teste', tipoVideo: 'short' }, ctx)
    expect(rot.ok).toBe(true)
    // Sem dossiê, a revisão editorial é bloqueada (Etapa 7).
    const bloqueado = await despachar('roteiros:alterarStatus', { id: 1, status: 'em_revisao' }, ctx)
    expect(bloqueado).toMatchObject({ ok: false, erro: { codigo: 'dossie_vazio' } })
    await despachar('dossie:criarAfirmacao', { alvo: { roteiroId: 1 }, texto: 'O órgão X publicou a norma Y.', natureza: 'fato' }, ctx)
    const pendente = await despachar('roteiros:alterarStatus', { id: 1, status: 'em_revisao' }, ctx)
    expect(pendente).toMatchObject({ ok: false, erro: { codigo: 'verificacao_pendente' } })
    const vinc = await despachar(
      'dossie:vincularNovaFonte',
      { afirmacaoId: 1, trecho: 'Norma Y publicada.', papel: 'primaria', posicao: 'sustenta', titulo: 'Diário oficial', url: 'https://www.gov.br/norma-y', tipoFonte: 'oficial', acessadaEm: '2026-10-30' },
      ctx
    )
    expect(vinc.ok ? 'ok' : vinc.erro.mensagem).toBe('ok')
    const liberado = await despachar('roteiros:alterarStatus', { id: 1, status: 'em_revisao' }, ctx)
    expect(liberado.ok ? 'ok' : liberado.erro.mensagem).toBe('ok')
    const v = await despachar('visaoGeral:obter', undefined, ctx)
    if (!v.ok) throw new Error('falhou')
    const vg = v.dados as { aguardandoRevisao: unknown[]; servicos: { nome: string; estado: string }[] }
    expect(vg.aguardandoRevisao).toHaveLength(1)
    expect(vg.servicos.find((s) => s.nome === 'YouTube')?.estado).toBe('nao_configurado')
    const ex = await despachar('roteiros:exportar', { id: 1, formato: 'md' }, ctx)
    expect(ex).toEqual({ ok: true, dados: { salvo: true, arquivo: 'roteiro.md' } })
  })
})

describe('higienização de logs', () => {
  it('remove tokens, chaves e e-mails', () => {
    const t = higienizar('Authorization: Bearer abc123 token=xyz api_key="segredo" ya29.' + 'a'.repeat(40) + ' fulano@exemplo.com')
    expect(t).not.toMatch(/abc123|xyz|segredo|aaaa|fulano@/)
  })
})
