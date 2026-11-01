import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import * as midia from '../midia/biblioteca'
import * as edicaoRepo from '../midia/edicao'
import { executarFerramenta, localizarFerramentas, type Ferramentas } from '../midia/ffmpeg'
import { GerenciadorProducao, coletarDadosQualidade, obterRenderizacao, recomendacaoParaEdicao, sondar } from '../midia/producao'
import * as miniaturas from '../midia/miniaturas'
import * as pub from '../youtube/publicacao'
import { GerenciadorEnvio } from '../youtube/publicacao'
import { GerenciadorPesquisas } from '../pesquisa/executor'
import { despachar } from '../ipc/despachar'
import type { Contexto } from '../contexto'
import type { Publicacao } from '@shared/tipos'
import { YouTubeNaoConfigurado } from '@estudio/youtube'
import { MINIATURA, OPCOES_MINIATURA_PADRAO } from '@shared/miniatura'
import { adicionarClip, duracaoTotal, type EstadoEdicao } from '@shared/edicao'
import { avaliarQualidade } from '@shared/qualidade'
import type { Banco } from '../db/conexao'
import { bancoDeTeste, cofreDeTeste, projetoDeTeste, roteiroDeTeste } from './auxiliares'

// Teste opcional com o FFmpeg real instalado. Rode com: FFMPEG_REAL=1 npx vitest run render-real
// (caminho alternativo: FFMPEG_CAMINHO=C:\...\ffmpeg.exe). As mídias de entrada são geradas pelo próprio FFmpeg.
const ferramentas: Ferramentas | null = process.env.FFMPEG_REAL ? localizarFerramentas(process.env.FFMPEG_CAMINHO ?? null) : null

const pastas: string[] = []
const pastaTemp = (): string => {
  const p = mkdtempSync(join(tmpdir(), 'estudio-render-'))
  pastas.push(p)
  return p
}
afterAll(() => {
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true })
})

const TECNICOS = ['arquivo', 'duracao', 'resolucao', 'audio', 'silencio', 'tela_preta', 'legendas', 'narracao', 'midias', 'licencas']
const ROTEIRO = `# Teste\n\nFormato: Vídeo longo\n\n## Abertura\n\nEsta é a primeira frase da abertura do vídeo de teste.\n\n## Conclusão\n\nE esta é a frase final do vídeo de teste.\n`

async function gerar(f: Ferramentas, args: string[]): Promise<void> {
  const r = await executarFerramenta(f.ffmpeg, ['-hide_banner', '-nostdin', '-y', ...args], { tempoLimiteMs: 60_000 })
  if (r.codigo !== 0) throw new Error(r.stderr.slice(-500))
}

/** Gera vídeo colorido, imagem e narração (tom) e importa na biblioteca com licença própria. */
async function prepararMidias(f: Ferramentas, db: Banco, projetoId: number): Promise<{ video: number; imagem: number; voz: number }> {
  const origem = pastaTemp()
  await gerar(f, ['-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30:d=20', '-pix_fmt', 'yuv420p', join(origem, 'clipe.mp4')])
  await gerar(f, ['-f', 'lavfi', '-i', 'testsrc=s=800x800', '-frames:v', '1', join(origem, 'foto.png')])
  await gerar(f, ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=30', join(origem, 'voz.wav')])
  const destino = pastaTemp()
  const imp = (nome: string): Promise<{ id: number }> => midia.importarMidia(db, destino, { projetoId, roteiroId: null, caminho: join(origem, nome), situacaoLicenca: 'criado_usuario' })
  return { video: (await imp('clipe.mp4')).id, imagem: (await imp('foto.png')).id, voz: (await imp('voz.wav')).id }
}

function montar(e: EstadoEdicao, m: { video: number; imagem: number; voz: number }, comBuraco: boolean): EstadoEdicao {
  const total = duracaoTotal(e)
  const meio = total / 2
  const base = { corteInicio: 0, volume: 1, fadeIn: 0, fadeOut: 0, texto: '', cena: 0 }
  e = adicionarClip(e, { ...base, faixa: 'video', recursoId: m.video, inicio: 0, duracao: comBuraco ? 1 : meio })
  e = adicionarClip(e, { ...base, faixa: 'video', recursoId: m.imagem, inicio: meio, duracao: total - meio, cena: 1 })
  return adicionarClip(e, { ...base, faixa: 'narracao', recursoId: m.voz, inicio: 0, duracao: total, fadeOut: 0.5 })
}

async function cenario(formato: '16:9' | '9:16', comBuraco = false): Promise<{ db: Banco; edicaoId: number; total: number }> {
  const f = ferramentas!
  const db = bancoDeTeste()
  const proj = projetoDeTeste(db)
  const m = await prepararMidias(f, db, proj)
  const ed = edicaoRepo.criarEdicao(db, roteiroDeTeste(db, proj, { conteudo: ROTEIRO, tipoVideo: formato === '9:16' ? 'short' : 'longo' }).id, formato)
  const estado = montar(ed.estado, m, comBuraco)
  edicaoRepo.salvarEdicao(db, ed.id, ed.revisao, estado)
  return { db, edicaoId: ed.id, total: duracaoTotal(estado) }
}

describe.skipIf(!ferramentas)('renderização real com FFmpeg (opcional)', () => {
  it('renderiza 16:9 720p, confere o arquivo e o controle de qualidade não encontra problemas técnicos', async () => {
    const { db, edicaoId, total } = await cenario('16:9')
    const ger = new GerenciadorProducao(db, pastaTemp(), () => ferramentas)
    const { id, termino } = ger.iniciar(edicaoId, '16:9-720p')
    await termino
    const r = obterRenderizacao(db, id)
    expect(r.mensagem).toBe('Renderização concluída e conferida.')
    expect(r.status).toBe('concluida')
    expect(r.progresso).toBe(1)
    const conf = JSON.parse(r.conferencia!) as { duracao: number; video: { largura: number; altura: number; codec: string }; audio: { codec: string; canais: number } }
    expect(conf.video).toMatchObject({ largura: 1280, altura: 720, codec: 'h264', fps: 30 })
    expect(conf.audio).toEqual({ codec: 'aac', canais: 2 })
    expect(Math.abs(conf.duracao - total)).toBeLessThan(0.5)

    const capturas = pastaTemp()
    const passos: { pct: number; etapa: string }[] = []
    const q = await coletarDadosQualidade(db, id, ferramentas, capturas, (pct, etapa) => passos.push({ pct, etapa }))
    // Progresso do controle de qualidade: passa pelas etapas e chega perto do fim.
    expect(passos.some((p) => p.etapa.includes('silêncios'))).toBe(true)
    expect(passos.some((p) => p.etapa.includes('telas pretas'))).toBe(true)
    expect(Math.max(...passos.map((p) => p.pct))).toBeGreaterThanOrEqual(90)
    expect(q.dados.silencios).toEqual([])
    expect(q.dados.pretos).toEqual([])
    expect(q.capturas).toEqual(['quadro-1.jpg', 'quadro-2.jpg', 'quadro-3.jpg'])
    expect(q.capturas.every((c) => existsSync(join(capturas, c)))).toBe(true)
    const bloqueios = avaliarQualidade(q.dados).filter((i) => i.nivel === 'bloqueador').map((i) => i.codigo)
    expect(bloqueios.filter((c) => TECNICOS.includes(c))).toEqual([])
    // O roteiro de teste não foi aprovado nem tem fontes: o QC precisa continuar bloqueando a publicação.
    expect(bloqueios).toEqual(expect.arrayContaining(['roteiro', 'fontes']))
  }, 180_000)

  it('renderiza Short 9:16 720p com a resolução vertical correta', async () => {
    const { db, edicaoId } = await cenario('9:16')
    const { id, termino } = new GerenciadorProducao(db, pastaTemp(), () => ferramentas).iniciar(edicaoId, '9:16-720p')
    await termino
    const r = obterRenderizacao(db, id)
    expect(r.status).toBe('concluida')
    expect((JSON.parse(r.conferencia!) as { video: { largura: number; altura: number } }).video).toMatchObject({ largura: 720, altura: 1280 })
  }, 180_000)

  it('o QC real detecta tela preta provocada por um buraco na trilha de vídeo', async () => {
    const { db, edicaoId } = await cenario('16:9', true)
    const { id, termino } = new GerenciadorProducao(db, pastaTemp(), () => ferramentas).iniciar(edicaoId, '16:9-720p')
    await termino
    const q = await coletarDadosQualidade(db, id, ferramentas, null)
    expect(q.dados.pretos!.length).toBeGreaterThan(0)
    expect(avaliarQualidade(q.dados).some((i) => i.codigo === 'tela_preta')).toBe(true)
  }, 180_000)

  it('renderiza em 4K (3840×2160) a 60 quadros/s com as opções escolhidas', async () => {
    const { db, edicaoId, total } = await cenario('16:9')
    const opcoes = { fps: 60, qualidade: 'padrao', velocidade: 'rapida' } as const
    const { id, termino } = new GerenciadorProducao(db, pastaTemp(), () => ferramentas).iniciar(edicaoId, '16:9-2160p', opcoes)
    await termino
    const r = obterRenderizacao(db, id)
    expect(r.mensagem).toBe('Renderização concluída e conferida.')
    expect(JSON.parse(r.opcoes)).toEqual(opcoes)
    const conf = JSON.parse(r.conferencia!) as { duracao: number; video: { largura: number; altura: number; fps: number } }
    expect(conf.video).toMatchObject({ largura: 3840, altura: 2160, fps: 60 })
    expect(Math.abs(conf.duracao - total)).toBeLessThan(0.5)
    const q = await coletarDadosQualidade(db, id, ferramentas, null)
    expect(avaliarQualidade(q.dados).filter((i) => i.nivel === 'bloqueador' && TECNICOS.includes(i.codigo))).toEqual([])
  }, 600_000)

  it('lê a resolução e os quadros/s das mídias e recomenda pela melhor delas', async () => {
    const { db, edicaoId } = await cenario('16:9')
    const rec = await recomendacaoParaEdicao(db, edicaoId, ferramentas, pastaTemp())
    expect(rec.fontes.map((f) => [f.categoria, f.largura, f.altura])).toEqual(
      expect.arrayContaining([
        ['video', 640, 360],
        ['imagem', 800, 800]
      ])
    )
    expect(rec.fontes.find((f) => f.categoria === 'video')?.fps).toBe(30)
    // A melhor mídia tem 800p no lado menor: o mínimo de 1080p para vídeos longos vale.
    expect(rec.recomendacao.preset).toBe('16:9-1080p')
    expect(rec.livreBytes).toBeGreaterThan(0)
  }, 120_000)

  it('cancelamento interrompe o FFmpeg e marca a renderização como cancelada', async () => {
    const { db, edicaoId } = await cenario('16:9')
    const ger = new GerenciadorProducao(db, pastaTemp(), () => ferramentas)
    const { id, termino } = ger.iniciar(edicaoId, '16:9-1080p')
    expect(ger.cancelar(id)).toBe(true)
    await termino
    expect(obterRenderizacao(db, id).status).toBe('cancelada')
    expect(ger.emAndamento()).toBeNull()
  }, 60_000)
})

describe.skipIf(!ferramentas)('miniaturas reais com FFmpeg (opcional)', () => {
  async function renderPronto(): Promise<{ db: Banco; render: number }> {
    const { db, edicaoId } = await cenario('16:9')
    const { id, termino } = new GerenciadorProducao(db, pastaTemp(), () => ferramentas).iniciar(edicaoId, '16:9-720p')
    await termino
    return { db, render: id }
  }

  it('extrai 6 quadros candidatos, gera prévia e salva miniatura 1280×720 ligada à publicação', async () => {
    const { db, render } = await renderPronto()
    const quadros = await miniaturas.quadrosCandidatos(db, ferramentas!, render)
    expect(quadros).toHaveLength(6)
    expect(quadros.filter((q) => q.sugerido)).toHaveLength(1)
    expect(quadros.every((q) => existsSync(join(miniaturas.pastaQuadros(obterRenderizacao(db, render).arquivo), `q-${q.indice}.jpg`)))).toBe(true)

    const fonte = { tipo: 'quadro' as const, renderizacaoId: render, tempo: quadros.find((q) => q.sugerido)!.tempo }
    const trabalho = pastaTemp()
    for (const modelo of ['faixa', 'lateral', 'destaque'] as const) {
      const previa = await miniaturas.previaMiniatura(db, ferramentas!, fonte, { ...OPCOES_MINIATURA_PADRAO, modelo, texto: 'IA no varejo: 50% mais rápido', selo: 'novo' }, trabalho)
      expect(previa.dataUrl.startsWith('data:image/jpeg;base64,')).toBe(true)
      expect(previa.bytes).toBeLessThanOrEqual(MINIATURA.maxBytes)
    }

    const p = pub.prepararPublicacao(db, render)
    const recurso = await miniaturas.salvarMiniatura(db, ferramentas!, fonte, { ...OPCOES_MINIATURA_PADRAO, texto: 'Teste de miniatura' }, { trabalho, midia: pastaTemp() }, p.id)
    expect(recurso).toMatchObject({ categoria: 'imagem', cena: 'Miniatura', situacaoLicenca: 'criado_usuario', largura: 1280, altura: 720 })
    expect(recurso.origem).toMatch(/Miniatura gerada no app a partir de quadro/)
    const sonda = await sondar(ferramentas!, recurso.caminho)
    expect(sonda?.video).toMatchObject({ largura: 1280, altura: 720 })
    expect(pub.obterPublicacao(db, p.id).miniaturaRecursoId).toBe(recurso.id)
    // A mesma miniatura de novo reaproveita o registro em vez de duplicar.
    const de_novo = await miniaturas.salvarMiniatura(db, ferramentas!, fonte, { ...OPCOES_MINIATURA_PADRAO, texto: 'Teste de miniatura' }, { trabalho, midia: dirname(dirname(recurso.caminho)) }, null)
    expect(de_novo.id).toBe(recurso.id)
  }, 300_000)

  it('ao preparar a publicação, cria descrição e miniatura automáticas (vídeo longo)', async () => {
    const { db, render } = await renderPronto()
    const ctx = contextoReal(db)
    const r = await despachar('publicacoes:preparar', { renderizacaoId: render }, ctx)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const dados = r.dados as Publicacao
    expect(dados.miniaturaRecursoId).not.toBeNull()
    // O vídeo de teste tem só ~8 s: sem capítulos, mas com o resumo do roteiro.
    expect(dados.descricao).not.toContain('Capítulos')
    const m = midia.obterMidia(db, dados.miniaturaRecursoId!)
    expect(m).toMatchObject({ categoria: 'imagem', largura: 1280, altura: 720 })
  }, 300_000)
})

function contextoReal(db: Banco): Contexto {
  const pasta = pastaTemp()
  return {
    db,
    cofre: cofreDeTeste(),
    pastaMidia: join(pasta, 'midia'),
    pastaRender: join(pasta, 'render'),
    producao: new GerenciadorProducao(db, join(pasta, 'render'), () => ferramentas),
    ferramentas: () => ferramentas,
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
    plataforma: { salvarTexto: async () => null, abrirPasta: async () => undefined, escolherArquivos: async () => [], mostrarNoExplorador: () => undefined }
  }
}
