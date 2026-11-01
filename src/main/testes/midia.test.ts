import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { executar } from '../db/conexao'
import * as midia from '../midia/biblioteca'
import * as edicaoRepo from '../midia/edicao'
import { argumentosRender, interpretarPretos, interpretarSilencios, interpretarSonda, lerProgresso } from '../midia/ffmpeg'
import { GerenciadorProducao, aceitarExcecao, salvarRelatorio } from '../midia/producao'
import {
  adicionarClip,
  ajustarClip,
  cortarClip,
  dividirLegendas,
  duracaoTotal,
  estadoInicial,
  gerarSrt,
  moverClip,
  problemasEstado,
  removerClip,
  reordenarCena,
  intervaloCena,
  type EstadoEdicao
} from '@shared/edicao'
import { avaliarQualidade, situacaoQualidade, type DadosQualidade } from '@shared/qualidade'
import { bancoDeTeste, projetoDeTeste, roteiroDeTeste } from './auxiliares'

const pastas: string[] = []
const pastaTemp = (): string => {
  const p = mkdtempSync(join(tmpdir(), 'estudio-midia-'))
  pastas.push(p)
  return p
}
afterEach(() => {
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true })
})
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)])

describe('biblioteca de mídia', () => {
  it('confere o conteúdo pelo cabeçalho e recusa executáveis disfarçados', () => {
    const p = pastaTemp()
    writeFileSync(join(p, 'ok.png'), PNG)
    writeFileSync(join(p, 'virus.png'), Buffer.concat([Buffer.from('MZ'), Buffer.alloc(64)]))
    writeFileSync(join(p, 'falso.mp4'), Buffer.alloc(64, 7))
    writeFileSync(join(p, 'script.bat'), 'echo oi')
    writeFileSync(join(p, 'leg.srt'), '1\n00:00:00,000 --> 00:00:01,000\nOlá\n')
    expect(midia.validarArquivo(join(p, 'ok.png')).categoria).toBe('imagem')
    expect(() => midia.validarArquivo(join(p, 'virus.png'))).toThrow(/executável/)
    expect(() => midia.validarArquivo(join(p, 'falso.mp4'))).toThrow(/não corresponde/)
    expect(() => midia.validarArquivo(join(p, 'script.bat'))).toThrow(/não aceito/)
    expect(midia.validarArquivo(join(p, 'leg.srt')).categoria).toBe('legenda')
    writeFileSync(join(p, 'leg.vtt'), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('WEBVTT\n\n00:00.000 --> 00:01.000\nOi\n')]))
    expect(midia.validarArquivo(join(p, 'leg.vtt')).categoria).toBe('legenda')
  })

  it('importa copiando para a pasta do app, recusa duplicata, alerta licença e detecta arquivo ausente', async () => {
    const db = bancoDeTeste()
    const proj = projetoDeTeste(db)
    const origem = pastaTemp()
    const destino = pastaTemp()
    writeFileSync(join(origem, 'foto.png'), PNG)
    const r = await midia.importarMidia(db, destino, { projetoId: proj, roteiroId: null, caminho: join(origem, 'foto.png'), situacaoLicenca: 'nao_verificado' })
    expect(r.caminho.startsWith(destino)).toBe(true)
    expect(r.alertas.join(' ')).toMatch(/não verificado/)
    await expect(midia.importarMidia(db, destino, { projetoId: proj, roteiroId: null, caminho: join(origem, 'foto.png'), situacaoLicenca: 'criado_usuario' })).rejects.toThrow(/já está na biblioteca/)
    const at = midia.atualizarMidia(db, { id: r.id, roteiroId: null, cena: 'Abertura', origem: 'Foto própria', autor: 'Eu', urlOrigem: '', licenca: '', situacaoLicenca: 'criado_usuario', obtidoEm: null })
    expect(at.alertas).toEqual([])
    unlinkSync(r.caminho)
    expect(midia.verificarBiblioteca(db, proj).ausentes).toEqual([r.id])
  })

  it('não remove mídia em uso num projeto de edição', async () => {
    const db = bancoDeTeste()
    const proj = projetoDeTeste(db)
    const origem = pastaTemp()
    writeFileSync(join(origem, 'a.png'), PNG)
    const r = await midia.importarMidia(db, pastaTemp(), { projetoId: proj, roteiroId: null, caminho: join(origem, 'a.png'), situacaoLicenca: 'criado_usuario' })
    const ed = edicaoRepo.criarEdicao(db, roteiroDeTeste(db, proj, { conteudo: '## Cena\n\nTexto.' }).id, null)
    edicaoRepo.salvarEdicao(db, ed.id, ed.revisao, adicionarClip(ed.estado, { faixa: 'video', recursoId: r.id, inicio: 0, duracao: 3, corteInicio: 0, volume: 1, fadeIn: 0, fadeOut: 0, texto: '', cena: 0 }))
    expect(() => midia.removerMidia(db, r.id)).toThrow(/em uso/)
  })
})

const ROTEIRO = `# T\n\nFormato: Vídeo longo\n\n## Abertura\n\nPrimeira frase da abertura. Segunda frase da abertura com mais palavras.\n\n## Bloco 1\n\nTexto do bloco um.\n[Visual: algo]\n\n## Conclusão\n\nFim do vídeo.\n\n## Fontes\nF1. X — https://x.com\n`

describe('editor: modelo e operações', () => {
  it('cria cenas a partir do roteiro, ignorando fontes e marcações', () => {
    const e = estadoInicial(ROTEIRO, '16:9')
    expect(e.cenas.map((c) => c.titulo)).toEqual(['Abertura', 'Bloco 1', 'Conclusão'])
    expect(e.clips.every((c) => c.faixa === 'legendas' && !c.texto.includes('Visual') && !c.texto.includes('http'))).toBe(true)
    expect(dividirLegendas('a '.repeat(100)).every((l) => l.length <= 84)).toBe(true)
  })

  it('cortar, mover, ajustar, remover e reordenar cenas', () => {
    let e = estadoInicial(ROTEIRO, '16:9')
    const primeiro = e.clips[0]!
    e = cortarClip(e, primeiro.id, primeiro.inicio + primeiro.duracao / 2)
    expect(e.clips.length).toBe(estadoInicial(ROTEIRO, '16:9').clips.length + 1)
    const segundaParte = e.clips[1]!
    expect(segundaParte.corteInicio).toBeCloseTo(primeiro.duracao / 2, 2)
    e = moverClip(e, segundaParte.id, 10)
    expect(e.clips.find((c) => c.id === segundaParte.id)!.inicio).toBeGreaterThan(10)
    expect(problemasEstado(e, new Set())).toEqual([])
    const terceiro = e.clips[2]!
    expect(problemasEstado(moverClip(e, terceiro.id, -terceiro.inicio), new Set())[0]).toMatch(/sobrepostos/)
    e = removerClip(e, segundaParte.id)
    e = ajustarClip(e, e.clips[0]!.id, { volume: 0.5, fadeIn: 1 })
    expect(e.clips[0]).toMatchObject({ volume: 0.5, fadeIn: 1 })
    expect(() => ajustarClip(e, e.clips[0]!.id, { volume: 9 })).toThrow()

    const base = estadoInicial(ROTEIRO, '16:9')
    const antes0 = intervaloCena(base, 0)!
    const antes1 = intervaloCena(base, 1)!
    const trocado = reordenarCena(base, 0, 1)
    expect(intervaloCena(trocado, 1)!.inicio).toBeCloseTo(antes0.inicio, 3)
    expect(intervaloCena(trocado, 0)!.inicio).toBeCloseTo(antes0.inicio + (antes1.fim - antes1.inicio), 3)
    expect(duracaoTotal(trocado)).toBeCloseTo(duracaoTotal(base), 3)
  })

  it('gera SRT com no máximo duas linhas por legenda, do tamanho que cabe no formato', () => {
    const srt = gerarSrt(estadoInicial(ROTEIRO, '16:9'))
    expect(srt.startsWith('1\n00:00:00,000 --> ')).toBe(true)
    expect(srt.split('\n').filter((l) => l && !/^\d+$/.test(l) && !l.includes('-->')).every((l) => l.length <= 34)).toBe(true)
    // Legenda longa feita à mão (ou de projeto antigo): vira blocos seguidos de até 2 linhas, sem perder texto nem tempo.
    const texto = 'A inteligência artificial já não é mais uma promessa distante na medicina, mas sim uma ferramenta que exige critérios rigorosos de confiança.'
    for (const formato of ['16:9', '9:16'] as const) {
      const longo = gerarSrt({ versaoModelo: 1, formato, cenas: [{ indice: 0, titulo: 'A' }], clips: [{ id: 'x', faixa: 'legendas', recursoId: null, inicio: 2, duracao: 10, corteInicio: 0, volume: 1, fadeIn: 0, fadeOut: 0, texto, cena: 0 }] })
      const blocos = longo.trim().split('\n\n').map((b) => b.split('\n'))
      expect(blocos.length).toBeGreaterThan(1)
      expect(blocos.every((b) => b.length - 2 <= 2 && b.slice(2).every((l) => l.length <= (formato === '9:16' ? 22 : 34)))).toBe(true)
      expect(blocos.flatMap((b) => b.slice(2)).join(' ')).toBe(texto)
      expect(blocos[0]![1]).toMatch(/^00:00:02,000 --> /)
      expect(blocos.at(-1)![1]).toMatch(/--> 00:00:12,000$/)
    }
    expect(dividirLegendas(texto, 22).every((l) => l.length <= 44)).toBe(true)
  })

  it('salva, recusa conflito, guarda cópias e restaura (recuperação após falha)', () => {
    const db = bancoDeTeste()
    const proj = projetoDeTeste(db)
    const ed = edicaoRepo.criarEdicao(db, roteiroDeTeste(db, proj, { conteudo: ROTEIRO, tipoVideo: 'short' }).id, null)
    expect(ed.formato).toBe('9:16')
    const s1 = edicaoRepo.salvarEdicao(db, ed.id, ed.revisao, moverClip(ed.estado, ed.estado.clips[0]!.id, 1))
    expect(() => edicaoRepo.salvarEdicao(db, ed.id, ed.revisao, ed.estado)).toThrow(/outro lugar/)
    edicaoRepo.salvarEdicao(db, ed.id, s1.revisao, removerClip(ed.estado, ed.estado.clips[0]!.id))
    const copias = edicaoRepo.listarSnapshots(db, ed.id)
    expect(copias).toHaveLength(2)
    const restaurado = edicaoRepo.restaurarSnapshot(db, ed.id, copias[1]!.id)
    expect(restaurado.estado.clips.length).toBe(ed.estado.clips.length)
    expect(restaurado.revisao).toBe(4)
  })
})

describe('FFmpeg: comando seguro e leitura de resultados', () => {
  const recursos = new Map([
    [1, { id: 1, caminho: 'C:\\midia\\foto "perigosa" & del C:\\*.png', categoria: 'imagem' as const }],
    [2, { id: 2, caminho: 'C:\\midia\\voz.mp3', categoria: 'audio' as const }]
  ])
  const estado = (): EstadoEdicao => {
    let e = estadoInicial(ROTEIRO, '16:9')
    e = adicionarClip(e, { faixa: 'video', recursoId: 1, inicio: 2, duracao: 3, corteInicio: 0, volume: 1, fadeIn: 0, fadeOut: 0, texto: '', cena: 0 })
    e = adicionarClip(e, { faixa: 'narracao', recursoId: 2, inicio: 0.5, duracao: 4, corteInicio: 0, volume: 0.8, fadeIn: 0.5, fadeOut: 1, texto: '', cena: 0 })
    return e
  }
  it('monta lista de argumentos sem shell; caminhos ficam como um argumento único', () => {
    const args = argumentosRender(estado(), recursos, '16:9-720p', 'video.mp4', { temLegendas: true, temTextos: false })
    expect(args).toContain('C:\\midia\\foto "perigosa" & del C:\\*.png')
    const fc = args[args.indexOf('-filter_complex') + 1]!
    expect(fc).toContain('concat=n=3') // preto + imagem + preto até o fim
    expect(fc).toContain('subtitles=legendas.srt')
    expect(fc).toContain('adelay=500|500')
    expect(fc).toContain('afade=t=out')
    expect(fc).not.toContain('perigosa')
    expect(args.at(-1)).toBe('video.mp4')
    expect(() => argumentosRender(estado(), recursos, '9:16-720p', 'v.mp4', { temLegendas: false, temTextos: false })).toThrow(/formato/)
  })
  it('lê progresso, sonda, silêncios e telas pretas', () => {
    expect(lerProgresso('frame=1\nout_time_ms=5000000\nprogress=continue\n', 10)).toBe(0.5)
    expect(interpretarSonda(JSON.stringify({ format: { duration: '12.5' }, streams: [{ codec_type: 'video', width: 1280, height: 720, codec_name: 'h264', avg_frame_rate: '30000/1001' }, { codec_type: 'audio', codec_name: 'aac', channels: 2 }] }))).toEqual({
      duracao: 12.5,
      video: { largura: 1280, altura: 720, codec: 'h264', fps: 29.97 },
      audio: { codec: 'aac', canais: 2 }
    })
    expect(interpretarSilencios('[silencedetect @ 0x] silence_start: 3.5\n[silencedetect @ 0x] silence_end: 9.0 | silence_duration: 5.5')).toEqual([{ inicio: 3.5, fim: 9 }])
    expect(interpretarPretos('[blackdetect @ 0x] black_start:4 black_end:7.5 black_duration:3.5')).toEqual([{ inicio: 4, fim: 7.5 }])
  })
  it('sem FFmpeg a renderização é recusada com instrução clara', () => {
    const db = bancoDeTeste()
    const ed = edicaoRepo.criarEdicao(db, roteiroDeTeste(db, projetoDeTeste(db), { conteudo: ROTEIRO }).id, null)
    expect(() => new GerenciadorProducao(db, pastaTemp(), () => null).iniciar(ed.id, '16:9-720p')).toThrow(/FFmpeg não encontrado/)
  })
})

describe('controle de qualidade (falhas controladas)', () => {
  const bom = (): DadosQualidade => ({
    arquivoExiste: true,
    tamanhoBytes: 1000,
    sonda: { duracao: 30, video: { largura: 1280, altura: 720 }, audio: { canais: 2 } },
    esperado: { duracao: 30, largura: 1280, altura: 720, temAudio: true },
    silencios: [],
    pretos: [],
    legendas: [{ inicio: 0, fim: 2, texto: 'Olá' }],
    narracaoFim: 28,
    cenasSemVisual: [],
    midias: [{ id: 1, nome: 'a.png', situacaoLicenca: 'criado_usuario', licenca: '', origem: 'própria', urlOrigem: '', existe: true }],
    fontesAnexadas: 2,
    roteiroAprovado: true,
    revisaoRenderizada: 3,
    revisaoAtual: 3
  })
  const bloqueios = (d: DadosQualidade): string[] => avaliarQualidade(d).filter((i) => i.nivel === 'bloqueador').map((i) => i.codigo)

  it('vídeo correto: sem bloqueadores nem avisos (miniatura e metadados ficam para a publicação)', () => {
    const itens = avaliarQualidade(bom())
    expect(bloqueios(bom())).toEqual([])
    expect(itens.filter((i) => i.nivel === 'aviso').map((i) => i.codigo)).toEqual([])
    expect(itens.find((i) => i.codigo === 'miniatura')?.nivel).toBe('ok')
  })
  it('detecta cada falha provocada', () => {
    expect(bloqueios({ ...bom(), arquivoExiste: false, sonda: null })).toContain('arquivo')
    expect(bloqueios({ ...bom(), sonda: { ...bom().sonda!, duracao: 20 } })).toContain('duracao')
    expect(bloqueios({ ...bom(), sonda: { ...bom().sonda!, video: { largura: 720, altura: 1280 } } })).toContain('resolucao')
    expect(bloqueios({ ...bom(), sonda: { ...bom().sonda!, audio: null } })).toContain('audio')
    expect(bloqueios({ ...bom(), silencios: [{ inicio: 0, fim: 30 }] })).toContain('silencio')
    expect(bloqueios({ ...bom(), pretos: [{ inicio: 0, fim: 20 }] })).toContain('tela_preta')
    expect(bloqueios({ ...bom(), legendas: [{ inicio: 29, fim: 33, texto: 'x' }] })).toContain('legendas')
    expect(bloqueios({ ...bom(), narracaoFim: 31 })).toContain('narracao')
    expect(bloqueios({ ...bom(), midias: [{ ...bom().midias[0]!, existe: false }] })).toContain('midias')
    expect(bloqueios({ ...bom(), midias: [{ ...bom().midias[0]!, situacaoLicenca: 'nao_verificado' }] })).toContain('licencas')
    expect(bloqueios({ ...bom(), fontesAnexadas: 0 })).toContain('fontes')
    expect(bloqueios({ ...bom(), roteiroAprovado: false })).toContain('roteiro')
    const avisos = avaliarQualidade({ ...bom(), pretos: [{ inicio: 10, fim: 13 }], silencios: [{ inicio: 5, fim: 12 }], cenasSemVisual: ['Bloco 2'], revisaoAtual: 4 })
      .filter((i) => i.nivel === 'aviso')
      .map((i) => i.codigo)
    expect(avisos).toEqual(expect.arrayContaining(['tela_preta', 'silencio', 'cenas', 'desatualizado']))
  })
  it('aprovação exige zero bloqueadores e avisos aceitos com justificativa registrada', () => {
    const db = bancoDeTeste()
    const proj = projetoDeTeste(db)
    const ed = edicaoRepo.criarEdicao(db, roteiroDeTeste(db, proj, { conteudo: ROTEIRO }).id, null)
    const render = executar(db, "INSERT INTO renderizacoes (edicao_id, revisao, preset, arquivo, status, criado_em) VALUES (:e, 1, '16:9-720p', 'x.mp4', 'concluida', 't')", { e: ed.id }).id
    const comBloqueio = salvarRelatorio(db, render, avaliarQualidade({ ...bom(), fontesAnexadas: 0 }), null, [])
    expect(comBloqueio.aprovado).toBe(false)
    expect(() => aceitarExcecao(db, comBloqueio.id, 'fontes', 'quero publicar')).toThrow(/não podem ser aceitos/)
    expect(salvarRelatorio(db, render, avaliarQualidade(bom()), null, []).aprovado).toBe(true)
    const rel = salvarRelatorio(db, render, avaliarQualidade({ ...bom(), revisaoAtual: 4 }), null, [])
    expect(rel.aprovado).toBe(false)
    expect(() => aceitarExcecao(db, rel.id, 'desatualizado', '')).toThrow(/Explique/)
    const ok = aceitarExcecao(db, rel.id, 'desatualizado', 'A alteração foi só no nome do projeto.')
    expect(ok.aprovado).toBe(true)
    expect(ok.excecoes[0]).toMatchObject({ codigo: 'desatualizado' })
    expect(situacaoQualidade(ok.itens, ok.excecoes)).toMatchObject({ aprovado: true, bloqueadores: 0 })
  })
})
