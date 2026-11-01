import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { YouTubeNaoConfigurado } from '@estudio/youtube'
import type { Contexto } from '../contexto'
import { criarBackup } from '../db/backup'
import { despachar } from '../ipc/despachar'
import { argumentosRender } from '../midia/ffmpeg'
import { GerenciadorProducao } from '../midia/producao'
import { GerenciadorPesquisas } from '../pesquisa/executor'
import { GerenciadorEnvio } from '../youtube/publicacao'
import { estadoAssistente } from '../repositorios/assistente'
import { adicionarFontePesquisa } from '../repositorios/pesquisa'
import { adicionarClip, estadoInicial } from '@shared/edicao'
import {
  OPCOES_RENDER_RECOMENDADAS,
  PRESETS_RENDER,
  custoRelativo,
  estimarBytesRender,
  presetsDoFormato,
  recomendarRender,
  taxaMaximaMbps,
  type FonteVisual
} from '@shared/midia'
import { bancoDeTeste, cofreDeTeste, projetoDeTeste } from './auxiliares'

const pastas: string[] = []
afterEach(() => {
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true })
})

const video = (largura: number, altura: number, fps: number | null = 30): FonteVisual => ({ categoria: 'video', largura, altura, fps })
const imagem = (largura: number, altura: number): FonteVisual => ({ categoria: 'imagem', largura, altura, fps: null })

describe('presets até 4K', () => {
  it('cada formato tem 720p, 1080p, 1440p e 4K com as dimensões corretas', () => {
    expect(presetsDoFormato('16:9').map((p) => [PRESETS_RENDER[p].largura, PRESETS_RENDER[p].altura])).toEqual([
      [1280, 720],
      [1920, 1080],
      [2560, 1440],
      [3840, 2160]
    ])
    expect(presetsDoFormato('9:16').map((p) => [PRESETS_RENDER[p].largura, PRESETS_RENDER[p].altura])).toEqual([
      [720, 1280],
      [1080, 1920],
      [1440, 2560],
      [2160, 3840]
    ])
  })

  it('teto de taxa segue as referências do YouTube, com folga pela qualidade', () => {
    expect(taxaMaximaMbps('16:9-1080p', { fps: 30, qualidade: 'padrao', velocidade: 'equilibrada' })).toBe(8)
    expect(taxaMaximaMbps('16:9-2160p', { fps: 60, qualidade: 'padrao', velocidade: 'equilibrada' })).toBe(60)
    expect(taxaMaximaMbps('16:9-2160p', OPCOES_RENDER_RECOMENDADAS)).toBe(60)
    // 10 minutos em 4K "alta" 30 q/s: (60 Mbps + 256 kbps) × 600 s / 8 ≈ 4,5 GB no máximo.
    expect(estimarBytesRender('16:9-2160p', OPCOES_RENDER_RECOMENDADAS, 600)).toBe(Math.ceil((600 * 60.256 * 1_000_000) / 8))
    expect(custoRelativo('16:9-1080p', OPCOES_RENDER_RECOMENDADAS)).toBe(1)
    expect(custoRelativo('16:9-2160p', { ...OPCOES_RENDER_RECOMENDADAS, fps: 60 })).toBe(8)
  })

  it('comando 4K usa as opções escolhidas: quadros/s, qualidade, velocidade, teto de taxa e ampliação lanczos', () => {
    let e = estadoInicial('## Cena\n\nTexto da cena com algumas palavras.', '16:9')
    e = adicionarClip(e, { faixa: 'video', recursoId: 1, inicio: 0, duracao: 3, corteInicio: 0, volume: 1, fadeIn: 0, fadeOut: 0, texto: '', cena: 0 })
    const recursos = new Map([[1, { id: 1, caminho: 'C:\\m\\a.mp4', categoria: 'video' as const }]])
    const args = argumentosRender(e, recursos, '16:9-2160p', 'video.mp4', { temLegendas: false, temTextos: false, render: { fps: 60, qualidade: 'maxima', velocidade: 'lenta' } })
    const valor = (op: string): string | undefined => args[args.indexOf(op) + 1]
    expect(valor('-r')).toBe('60')
    expect(valor('-crf')).toBe('17')
    expect(valor('-preset')).toBe('slow')
    expect(valor('-maxrate')).toBe('150000k')
    expect(valor('-bufsize')).toBe('300000k')
    expect(valor('-g')).toBe('30')
    expect(valor('-b:a')).toBe('320k')
    expect(valor('-filter_complex')).toContain('scale=3840:2160:force_original_aspect_ratio=decrease:flags=lanczos')
    expect(valor('-filter_complex')).toContain('fps=60')
    // Sem opções, vale o recomendado (30 q/s, alta, equilibrada).
    const padrao = argumentosRender(e, recursos, '16:9-1080p', 'v.mp4', { temLegendas: false, temTextos: false })
    expect(padrao[padrao.indexOf('-r') + 1]).toBe('30')
    expect(padrao[padrao.indexOf('-preset') + 1]).toBe('medium')
  })
})

describe('recomendação de resolução (regras, sem IA)', () => {
  it('vídeo longo: acompanha a melhor mídia sem ampliar, até 4K', () => {
    expect(recomendarRender('16:9', [video(3840, 2160), imagem(1920, 1080)]).preset).toBe('16:9-2160p')
    expect(recomendarRender('16:9', [video(2560, 1440)]).preset).toBe('16:9-1440p')
    expect(recomendarRender('16:9', [video(1920, 1080)]).preset).toBe('16:9-1080p')
    // Vídeo vertical 4K num projeto horizontal: conta o lado menor.
    expect(recomendarRender('16:9', [video(2160, 3840)]).preset).toBe('16:9-2160p')
  })
  it('nunca abaixo de 1080p em vídeo longo e 1080p quando não há informação', () => {
    const r = recomendarRender('16:9', [video(1280, 720)])
    expect(r.preset).toBe('16:9-1080p')
    expect(r.motivos.join(' ')).toMatch(/mínimo recomendado/)
    expect(recomendarRender('16:9', []).preset).toBe('16:9-1080p')
    expect(recomendarRender('16:9', [{ categoria: 'video', largura: null, altura: null, fps: null }]).motivos.join(' ')).toMatch(/sem resolução conhecida/)
  })
  it('Shorts: 1080p mesmo com material 4K; 720p se tudo for pequeno', () => {
    const r = recomendarRender('9:16', [video(3840, 2160)])
    expect(r.preset).toBe('9:16-1080p')
    expect(r.avisos['9:16-2160p']?.join(' ')).toMatch(/pouco ganho/)
    expect(recomendarRender('9:16', [imagem(640, 640)]).preset).toBe('9:16-720p')
  })
  it('quadros por segundo seguem os vídeos de origem', () => {
    expect(recomendarRender('16:9', [video(1920, 1080, 59.94)]).opcoes.fps).toBe(60)
    expect(recomendarRender('16:9', [video(1920, 1080, 23.976)]).opcoes.fps).toBe(24)
    expect(recomendarRender('16:9', [video(1920, 1080, 25)]).opcoes.fps).toBe(25)
    expect(recomendarRender('16:9', [video(1920, 1080, 30), video(1920, 1080, 24)]).opcoes.fps).toBe(30)
    expect(recomendarRender('16:9', [imagem(1920, 1080)]).opcoes.fps).toBe(30)
  })
  it('avisa quando a resolução escolhida amplia mídias menores', () => {
    const r = recomendarRender('16:9', [video(3840, 2160), imagem(1280, 720)])
    expect(r.avisos['16:9-2160p']?.join(' ')).toMatch(/1 mídia\(s\) têm resolução menor/)
    expect(r.avisos['16:9-2160p']?.join(' ')).toMatch(/4K demora/)
    expect(r.avisos['16:9-720p']).toBeUndefined()
  })
})

function contexto(): Contexto {
  const db = bancoDeTeste()
  const pasta = mkdtempSync(join(tmpdir(), 'estudio-assist-'))
  pastas.push(pasta)
  return {
    db,
    cofre: cofreDeTeste(),
    pastaMidia: join(pasta, 'midia'),
    pastaRender: join(pasta, 'render'),
    producao: new GerenciadorProducao(db, join(pasta, 'render'), () => null),
    ferramentas: () => null,
    pesquisas: new GerenciadorPesquisas(db, {
      buscar: async () => {
        throw new Error('rede desativada em teste')
      },
      agora: () => new Date()
    }),
    versaoApp: '0.0.0-teste',
    pastaDados: pasta,
    pastaBackups: join(pasta, 'backups'),
    youtube: new YouTubeNaoConfigurado(),
    envios: new GerenciadorEnvio(db, cofreDeTeste(), () => new YouTubeNaoConfigurado()),
    abrirNavegador: async () => undefined,
    plataforma: { salvarTexto: vi.fn(async () => null), abrirPasta: vi.fn(async () => undefined), escolherArquivos: vi.fn(async () => []), mostrarNoExplorador: vi.fn() }
  }
}

describe('preferência de vídeo e renderização pela IPC', () => {
  it('guarda a preferência e recusa valores fora das opções', async () => {
    const ctx = contexto()
    const padrao = await despachar('render:preferencia', undefined, ctx)
    expect(padrao).toMatchObject({ ok: true, dados: { modo: 'recomendado', longo: '1080p', short: '1080p' } })
    const nova = { modo: 'fixo', longo: '2160p', short: '1080p', opcoes: { fps: 60, qualidade: 'alta', velocidade: 'rapida' } }
    expect(await despachar('render:salvarPreferencia', nova, ctx)).toMatchObject({ ok: true })
    expect(await despachar('render:preferencia', undefined, ctx)).toMatchObject({ ok: true, dados: nova })
    expect(await despachar('render:salvarPreferencia', { ...nova, opcoes: { ...nova.opcoes, fps: 50 } }, ctx)).toMatchObject({ ok: false })
    expect(await despachar('render:salvarPreferencia', { ...nova, longo: '8K' }, ctx)).toMatchObject({ ok: false })
  })
  it('renderizar sem opções usa o recomendado; preset inexistente é recusado', async () => {
    const ctx = contexto()
    expect(await despachar('producao:renderizar', { edicaoId: 1, preset: '16:9-4320p' }, ctx)).toMatchObject({ ok: false })
    // Sem FFmpeg a recusa vem do gerenciador, depois da validação aceitar a entrada sem "opcoes".
    expect(await despachar('producao:renderizar', { edicaoId: 1, preset: '16:9-2160p' }, ctx)).toMatchObject({ ok: false, erro: { mensagem: expect.stringMatching(/FFmpeg não encontrado/) } })
  })
})

describe('assistente de primeiros passos', () => {
  it('a situação vem dos dados reais e as etapas de leitura ficam registradas', async () => {
    const ctx = contexto()
    const ext = { ffmpeg: false, youtube: 'nao_configurado' as const, backups: 0 }
    const inicio = estadoAssistente(ctx.db, ext)
    expect(inicio.concluidas).toBe(0)
    expect(inicio.obrigatorias).toBe(7)
    expect(inicio.etapas.youtube.opcional).toBe(true)
    expect(inicio.projetoId).toBeNull()

    const proj = projetoDeTeste(ctx.db)
    adicionarFontePesquisa(ctx.db, { projetoId: proj, tipo: 'rss', nome: 'Blog', url: 'https://exemplo.invalid/feed' })
    await despachar('assistente:salvar', { revisada: 'boasvindas' }, ctx)
    await despachar('assistente:salvar', { revisada: 'agenda' }, ctx)
    await despachar('assistente:salvar', { revisada: 'ia' }, ctx)
    await despachar('render:salvarPreferencia', { modo: 'recomendado', longo: '1080p', short: '1080p', opcoes: OPCOES_RENDER_RECOMENDADAS }, ctx)
    let s = estadoAssistente(ctx.db, ext)
    expect(s.projetoId).toBe(proj)
    expect(['boasvindas', 'projeto', 'pesquisa', 'agenda', 'ia'].every((e) => s.etapas[e as keyof typeof s.etapas].feito)).toBe(true)
    // Vídeo só conta com o FFmpeg encontrado; backup só com backup real.
    expect(s.etapas.video.feito).toBe(false)
    s = estadoAssistente(ctx.db, { ...ext, ffmpeg: true })
    expect(s.etapas.video.feito).toBe(true)
    await despachar('assistente:salvar', { revisada: 'backup' }, ctx)
    expect(estadoAssistente(ctx.db, { ...ext, ffmpeg: true }).etapas.backup.feito).toBe(false)
    criarBackup(ctx.db, ctx.pastaBackups, 'manual')
    s = estadoAssistente(ctx.db, { ffmpeg: true, youtube: 'nao_configurado', backups: 1 })
    expect(s.concluidas).toBe(7)
    expect(s.etapas.youtube.feito).toBe(false)

    const pela_ipc = await despachar('assistente:salvar', { concluido: true }, ctx)
    expect(pela_ipc).toMatchObject({ ok: true, dados: { concluido: true } })
    expect(await despachar('assistente:salvar', { revisada: 'inexistente' }, ctx)).toMatchObject({ ok: false })
  })
})
