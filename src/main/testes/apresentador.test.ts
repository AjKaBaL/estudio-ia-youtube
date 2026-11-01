import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { argumentosRender, executarFerramenta, filtroMovimento, localizarFerramentas, mesclarTrechos, type EstiloRender, type Ferramentas, type RecursoParaRender } from '../midia/ffmpeg'
import { arquivosApresentador } from '../midia/apresentador'
import { gerarTrilha } from '../midia/trilha'
import { escolherPose, planoApresentador, POSES_APRESENTADOR } from '@shared/apresentador'
import { adicionarClip, duracaoTotal, estadoInicial, type EstadoEdicao } from '@shared/edicao'
import { ESTILO_VIDEO_PADRAO, preferenciaMidiaSchema } from '@shared/geracaoMidia'

const ROTEIRO = `# Teste\n\nFormato: Vídeo longo\n\n## Abertura\n\nVocê já se perguntou como a IA mudou o trabalho? Hoje vamos ver isso de perto com calma.\n\n## Dados\n\nEm 2025, 78 por cento das empresas usavam IA em alguma área do negócio todos os dias.\n\n## Cuidado\n\nAtenção: existe risco de vazamento de dados quando a ferramenta não é bem configurada.\n`

const pastas: string[] = []
const pastaTemp = (): string => {
  const p = mkdtempSync(join(tmpdir(), 'estudio-apres-'))
  pastas.push(p)
  return p
}
afterAll(() => {
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true })
})

describe('apresentador: poses pelo texto', () => {
  it('escolhe a pose conforme a frase', () => {
    expect(escolherPose('Você já pensou nisso?')).toBe('pergunta')
    expect(escolherPose('Atenção: há risco de golpe.')).toBe('alerta')
    expect(escolherPose('Foram 3 milhões de usuários.')).toBe('dado')
    expect(escolherPose('A dica é simples: automatize.')).toBe('ideia')
    expect(escolherPose('Talvez isso mude no futuro.')).toBe('pensando')
    expect(escolherPose('Um sucesso incrível para a equipe.')).toBe('comemorando')
    expect(escolherPose('Vamos seguir com o assunto.')).toBe('falando')
    // pergunta vence números; alerta vence números
    expect(escolherPose('Quanto custa 1 hora?')).toBe('pergunta')
    expect(escolherPose('Cuidado com os 5 erros.')).toBe('alerta')
  })
  it('todas as poses têm desenho com boca aberta e fechada', () => {
    const pngs = arquivosApresentador(pastaTemp())
    for (const pose of POSES_APRESENTADOR) {
      expect(existsSync(pngs[`${pose}-aberta`]!)).toBe(true)
      expect(existsSync(pngs[`${pose}-fechada`]!)).toBe(true)
    }
  })
  it('abre cada cena em destaque e segue o texto; mescla trechos sem buracos', () => {
    const e = estadoInicial(ROTEIRO, '16:9')
    const total = duracaoTotal(e)
    const plano = planoApresentador(e, total)
    expect(plano[0]).toMatchObject({ pose: 'apresentando', destaque: true, inicio: 0 })
    expect(plano.some((p) => p.pose === 'pergunta')).toBe(true)
    expect(plano.some((p) => p.pose === 'dado')).toBe(true)
    expect(plano.some((p) => p.pose === 'alerta')).toBe(true)
    expect(plano.filter((p) => p.destaque).length).toBe(3) // uma abertura por cena
    const m = mesclarTrechos(plano)
    for (let i = 1; i < m.length; i++) expect(m[i]!.inicio - m[i - 1]!.fim).toBeLessThan(0.6)
    expect(planoApresentador({ ...e, clips: [] }, 10)).toEqual([{ inicio: 0, fim: 10, pose: 'falando', destaque: false, lado: 'direita', entrada: true }])
    // Circula pelo cenário: cada cena num lado, entrando pela lateral.
    const lados = [...new Set(plano.filter((p) => p.entrada).map((p) => p.lado))]
    expect(lados).toEqual(['direita', 'esquerda'])
  })
  it('preferência antiga sem "video" recebe o acabamento padrão (tudo ligado)', () => {
    const r = preferenciaMidiaSchema.safeParse({
      voz: { motor: 'windows', vozWindows: '', velocidade: 0 },
      busca: { fontes: ['wikimedia'], preferirVideos: false, aceitarCompartilhaIgual: false, porCena: 1 },
      geracao: { ativa: true, gerador: 'pollinations', sempre: false, estilo: 'x', contaCloudflare: '' }
    })
    expect(r.success && r.data.video).toEqual(ESTILO_VIDEO_PADRAO)
  })
})

const estado = (): EstadoEdicao => {
  let e = estadoInicial(ROTEIRO, '16:9')
  const t = duracaoTotal(e) / 3
  const base = { corteInicio: 0, volume: 1, fadeIn: 0, fadeOut: 0, texto: '' }
  e = adicionarClip(e, { ...base, faixa: 'video', recursoId: 1, inicio: 0, duracao: t, cena: 0 })
  e = adicionarClip(e, { ...base, faixa: 'video', recursoId: 2, inicio: t, duracao: t, cena: 1 })
  return adicionarClip(e, { ...base, faixa: 'video', recursoId: 3, inicio: 2 * t, duracao: t, cena: 2 })
}

describe('render com acabamento: argumentos', () => {
  const pngs = Object.fromEntries(POSES_APRESENTADOR.flatMap((p) => [[`${p}-aberta`, `C:\\ap\\${p}-a.png`], [`${p}-fechada`, `C:\\ap\\${p}-f.png`]]))
  const estilo: EstiloRender = { movimento: true, transicoes: true, apresentador: { pngs, lado: 'direita' } }
  const recursos = new Map<number, RecursoParaRender>([
    [1, { id: 1, caminho: 'C:\\m\\larga.jpg', categoria: 'imagem', largura: 3000, altura: 1000 }],
    [2, { id: 2, caminho: 'C:\\m\\normal.jpg', categoria: 'imagem', largura: 1920, altura: 1080 }],
    [3, { id: 3, caminho: 'C:\\m\\clipe.mp4', categoria: 'video', largura: 640, altura: 480 }]
  ])
  it('fotos em movimento (parallax na foto larga), vídeo preenchendo, transições e apresentador', () => {
    const args = argumentosRender(estado(), recursos, '16:9-720p', 'v.mp4', { temLegendas: true, temTextos: false, estilo })
    const fc = args[args.indexOf('-filter_complex') + 1]!
    expect(fc).toContain('zoompan')
    expect(fc).toContain('boxblur') // parallax: fundo desfocado
    expect(fc).toContain('crop=1280:720') // vídeo sem faixas pretas
    expect(fc).toContain('fade=t=in:st=0:d=0.35')
    expect(fc).toContain('MarginR=80,MarginL=80')
    expect(fc).toMatch(/overlay=x='if\(between\(t,[\d.]+,[\d.]+\),W-w-\d+\+\(w\+\d+\)\*max\(0,1-/) // entra deslizando pela direita
    expect(fc).toMatch(/,\d+-\(w\+\d+\)\*max/) // e depois pela esquerda
    expect(fc).toContain('lt(mod(t,0.36),0.18)') // boca abrindo enquanto fala
    expect(args).toContain('C:\\ap\\pergunta-a.png')
    expect(args).toContain('C:\\ap\\apresentando-f.png')
    expect(fc).not.toContain('C:\\') // caminhos nunca entram no filtro
    // sem estilo: comportamento antigo (imagem parada com faixas)
    // Cartão com texto para ler: parado mesmo com movimento ligado.
    const comCartao = new Map(recursos)
    comCartao.set(2, { ...recursos.get(2)!, estatico: true })
    const fcCartao = argumentosRender(estado(), comCartao, '16:9-720p', 'v.mp4', { temLegendas: false, temTextos: false, estilo })
    expect(fcCartao[fcCartao.indexOf('-filter_complex') + 1]!.match(/zoompan/g)!.length).toBe(fc.match(/zoompan/g)!.length - 1)
    const simples = argumentosRender(estado(), recursos, '16:9-720p', 'v.mp4', { temLegendas: false, temTextos: false })
    expect(simples[simples.indexOf('-filter_complex') + 1]).not.toContain('zoompan')
  })
  it('padrões de movimento variam de foto para foto', () => {
    const r = recursos.get(2)!
    const zs = [0, 1, 2, 3, 4].map((k) => filtroMovimento(0, r, 1280, 720, 30, 5, k))
    expect(new Set(zs).size).toBe(5)
  })
})

// Opcional, com FFmpeg real: FFMPEG_REAL=1 npx vitest run apresentador. Com QUADROS_PASTA=..., guarda quadros para olhar.
const ferramentas: Ferramentas | null = process.env.FFMPEG_REAL ? localizarFerramentas(process.env.FFMPEG_CAMINHO ?? null) : null

describe.skipIf(!ferramentas)('render real com apresentador, movimento e trilha (opcional)', () => {
  it('gera o vídeo com som e quadros diferentes ao longo do tempo', async () => {
    const f = ferramentas!
    const pasta = pastaTemp()
    const rodar = async (args: string[], cwd = pasta): Promise<void> => {
      const r = await executarFerramenta(f.ffmpeg, ['-hide_banner', '-nostdin', '-y', ...args], { cwd, tempoLimiteMs: 300_000 })
      if (r.codigo !== 0) throw new Error(r.stderr.slice(-1500))
    }
    await rodar(['-f', 'lavfi', '-i', 'testsrc2=s=1800x600', '-frames:v', '1', 'larga.png'])
    await rodar(['-f', 'lavfi', '-i', 'mandelbrot=s=1920x1080', '-frames:v', '1', 'normal.png'])
    await rodar(['-f', 'lavfi', '-i', 'testsrc=s=640x480:r=30:d=30', '-pix_fmt', 'yuv420p', 'clipe.mp4'])
    await rodar(['-f', 'lavfi', '-i', 'sine=frequency=300:duration=60', 'voz.wav'])
    let e = estado()
    const total = duracaoTotal(e)
    const trilha = await gerarTrilha(f, total + 1, 7, join(pasta, 'trilha'))
    const rec = new Map<number, RecursoParaRender>([
      [1, { id: 1, caminho: join(pasta, 'larga.png'), categoria: 'imagem', largura: 1800, altura: 600 }],
      [2, { id: 2, caminho: join(pasta, 'normal.png'), categoria: 'imagem', largura: 1920, altura: 1080 }],
      [3, { id: 3, caminho: join(pasta, 'clipe.mp4'), categoria: 'video', largura: 640, altura: 480 }],
      [4, { id: 4, caminho: join(pasta, 'voz.wav'), categoria: 'audio' }],
      [5, { id: 5, caminho: trilha.arquivo, categoria: 'audio' }]
    ])
    const base = { corteInicio: 0, fadeIn: 0, fadeOut: 0, texto: '', cena: 0 }
    e = adicionarClip(e, { ...base, faixa: 'narracao', recursoId: 4, inicio: 0, duracao: total, volume: 1 })
    e = adicionarClip(e, { ...base, faixa: 'audio', recursoId: 5, inicio: 0, duracao: total, volume: 0.15 })
    const est: EstiloRender = { movimento: true, transicoes: true, apresentador: { pngs: arquivosApresentador(join(pasta, 'ap')), lado: 'direita' } }
    const args = argumentosRender(e, rec, '16:9-720p', 'video.mp4', { temLegendas: false, temTextos: false, estilo: est })
    await rodar(args.slice(3))
    expect(existsSync(join(pasta, 'video.mp4'))).toBe(true)
    const destino = process.env.QUADROS_PASTA
    if (destino) {
      mkdirSync(destino, { recursive: true })
      for (const s of [0.8, 3, total / 3 + 2, total / 3 + 6, (2 * total) / 3 + 2, total - 1]) {
        await rodar(['-ss', s.toFixed(2), '-i', join(pasta, 'video.mp4'), '-frames:v', '1', join(destino, `quadro-${s.toFixed(1)}.png`)])
      }
    }
  }, 600_000)
})
