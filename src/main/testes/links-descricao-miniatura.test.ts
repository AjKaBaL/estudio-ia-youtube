import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { executar, type Banco } from '../db/conexao'
import { despachar } from '../ipc/despachar'
import { filtroMiniatura, localizarFonte } from '../midia/miniaturas'
import { salvarLink, listarLinks } from '../repositorios/links'
import * as pub from '../youtube/publicacao'
import { adicionarClip, estadoInicial, montarAutomaticamente, type MidiaParaMontagem } from '@shared/edicao'
import { OPCOES_MINIATURA_PADRAO, quebrarLinhas, tamanhoFonte, textoSugerido } from '@shared/miniatura'
import { capitulosValidos, formatarTempo, gerarDescricao, hashtags, LIMITE_DESCRICAO_BYTES, type EntradaDescricao } from '@shared/publicacao'
import { bancoDeTeste, projetoDeTeste, roteiroDeTeste } from './auxiliares'

const pastas: string[] = []
const pastaTemp = (): string => {
  const p = mkdtempSync(join(tmpdir(), 'estudio-ldm-'))
  pastas.push(p)
  return p
}
afterEach(() => {
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true })
})

const entrada = (extra: Partial<EntradaDescricao> = {}): EntradaDescricao => ({
  resumo: 'Como a IA está mudando o varejo.',
  formato: '16:9',
  duracaoSeg: 300,
  capitulos: [
    { inicio: 0, titulo: 'Abertura' },
    { inicio: 40, titulo: 'O que mudou' },
    { inicio: 160, titulo: 'Conclusão' }
  ],
  fontes: [{ titulo: 'Relatório oficial', url: 'https://exemplo.invalid/relatorio' }],
  links: [],
  tags: ['inteligência artificial', 'varejo', 'negócios', 'tecnologia'],
  ...extra
})

describe('descrição automática (regras, sem IA)', () => {
  it('monta resumo, capítulos, fontes e até 3 hashtags sem acento', () => {
    const d = gerarDescricao(entrada())
    expect(d.texto.startsWith('Como a IA está mudando o varejo.')).toBe(true)
    expect(d.texto).toContain('Capítulos\n00:00 Abertura\n00:40 O que mudou\n02:40 Conclusão')
    expect(d.texto).toContain('Fontes\n- Relatório oficial: https://exemplo.invalid/relatorio')
    expect(d.hashtags).toEqual(['#inteligenciaArtificial', '#varejo', '#negocios'])
    expect(d.texto.trimEnd().endsWith('#inteligenciaArtificial #varejo #negocios')).toBe(true)
    expect(d.avisos).toEqual([])
  })

  it('capítulos seguem as regras do YouTube: começa em 00:00, mínimo 3, cada um com 10 s', () => {
    expect(capitulosValidos([{ inicio: 3, titulo: 'A' }, { inicio: 20, titulo: 'B' }, { inicio: 25, titulo: 'curta' }, { inicio: 40, titulo: 'C' }], 100).capitulos).toEqual([
      { inicio: 0, titulo: 'A' },
      { inicio: 20, titulo: 'B' },
      { inicio: 40, titulo: 'C' }
    ])
    // O último capítulo com menos de 10 s sai; sobram 2 → nenhum capítulo, com o motivo.
    const r = capitulosValidos([{ inicio: 0, titulo: 'A' }, { inicio: 15, titulo: 'B' }, { inicio: 28, titulo: 'C' }], 32)
    expect(r.capitulos).toEqual([])
    expect(r.motivo).toMatch(/pelo menos 3/)
    expect(gerarDescricao(entrada({ formato: '9:16' })).texto).not.toContain('Capítulos')
    expect(formatarTempo(3725)).toBe('1:02:05')
  })

  it('agrupa links por tipo, avisa sobre afiliado e lembra da promoção paga', () => {
    const d = gerarDescricao(
      entrada({
        links: [
          { nome: 'Microfone', url: 'https://loja.invalid/mic', categoria: 'afiliado', descricao: 'cupom CANAL10' },
          { nome: 'Instagram', url: 'https://instagram.invalid/canal', categoria: 'rede_social', descricao: '' },
          { nome: 'Marca X', url: 'https://marca.invalid', categoria: 'patrocinio', descricao: '' }
        ]
      })
    )
    const iRede = d.texto.indexOf('Redes sociais\n- Instagram: https://instagram.invalid/canal')
    const iAfil = d.texto.indexOf('Links de afiliado\n- Microfone (cupom CANAL10): https://loja.invalid/mic')
    expect(iRede).toBeGreaterThan(0)
    expect(iAfil).toBeGreaterThan(iRede)
    expect(d.texto).toContain('o canal pode receber uma comissão')
    expect(d.avisos.join(' ')).toMatch(/promoção paga/)
    expect(gerarDescricao(entrada({ links: [{ nome: 'X', url: 'https://x.invalid', categoria: 'rede_social', descricao: '' }] })).texto).not.toContain('comissão')
  })

  it('respeita 5000 bytes, encurtando fontes primeiro, e troca < > por aspas angulares', () => {
    const fontes = Array.from({ length: 200 }, (_, i) => ({ titulo: `Fonte número ${i} com um título razoavelmente longo`, url: `https://exemplo.invalid/fonte/${i}` }))
    const d = gerarDescricao(entrada({ fontes, resumo: 'Use <tags> com cuidado' }))
    expect(new TextEncoder().encode(d.texto).length).toBeLessThanOrEqual(LIMITE_DESCRICAO_BYTES)
    expect(d.texto).toContain('Use ‹tags› com cuidado')
    expect(d.texto).toMatch(/\(mais \d+ fonte\(s\) no dossiê do vídeo\)/)
    expect(d.avisos.join(' ')).toMatch(/só \d+ de 200 fontes/)
  })

  it('hashtags ignoram repetidas e termos curtos ou longos demais', () => {
    expect(hashtags(['IA', 'i.a.', 'a', 'Visão Computacional', 'x'.repeat(50)])).toEqual(['#ia', '#visaoComputacional'])
  })
})

describe('miniaturas: texto e comando seguros', () => {
  it('quebra o texto em linhas que cabem e corta o excesso com reticências', () => {
    expect(quebrarLinhas('o futuro da inteligência artificial nas empresas brasileiras', 'faixa', true)).toEqual({ linhas: ['O FUTURO DA', 'INTELIGÊNCIA…'], cortado: true })
    const r = quebrarLinhas('IA no varejo', 'destaque', false)
    expect(r).toEqual({ linhas: ['IA no varejo'], cortado: false })
    const longo = quebrarLinhas('uma frase muito longa que não cabe em duas linhas de jeito nenhum', 'faixa', false)
    expect(longo.linhas.length).toBe(2)
    expect(longo.linhas.every((l) => l.length <= 22)).toBe(true)
    expect(longo.linhas[1]!.endsWith('…')).toBe(true)
  })
  it('tamanho da fonte cabe na largura e respeita o teto do modelo', () => {
    expect(tamanhoFonte('destaque', ['IA'], 'arial')).toBe(150)
    const fs = tamanhoFonte('faixa', ['X'.repeat(22)], 'arial')
    expect(fs * 22 * 0.68).toBeLessThanOrEqual(1168)
    expect(tamanhoFonte('faixa', ['X'.repeat(22)], 'impact')).toBeGreaterThan(fs)
    expect(textoSugerido('IA no varejo: o que muda em 2027', 'faixa')).toBe('IA no varejo')
  })
  it('o filtro do FFmpeg nunca contém o texto do usuário (vai por arquivo)', () => {
    const o = { ...OPCOES_MINIATURA_PADRAO, texto: "x:y,'z';drawtext=evil", selo: 'NOVO' }
    for (const modelo of ['faixa', 'lateral', 'destaque'] as const) {
      const f = filtroMiniatura({ ...o, modelo }, quebrarLinhas(o.texto, modelo, true).linhas, true)
      expect(f).not.toContain('evil')
      expect(f).toContain('textfile=texto.txt')
      expect(f).toContain('textfile=selo.txt')
      expect(f).toContain('expansion=none')
      expect(f).toContain('fontfile=fonte.ttf')
      expect(f.startsWith('scale=1280:720:force_original_aspect_ratio=increase')).toBe(true)
    }
  })
  it('localiza a fonte pedida ou uma substituta', () => {
    const pasta = pastaTemp()
    expect(() => localizarFonte('arial', pasta)).toThrow(/Nenhuma fonte/)
    writeFileSync(join(pasta, 'impact.ttf'), 'x')
    expect(localizarFonte('arial', pasta)).toBe(join(pasta, 'impact.ttf'))
    writeFileSync(join(pasta, 'arialbd.ttf'), 'x')
    expect(localizarFonte('arial', pasta)).toBe(join(pasta, 'arialbd.ttf'))
  })
})

describe('montagem automática do editor', () => {
  const ROTEIRO = '## Abertura\n\nPrimeira frase da abertura com várias palavras para durar.\n\n## Meio\n\nTexto do meio do vídeo com bastante conteúdo.\n\n## Fim\n\nFrase final.'
  const m = (id: number, categoria: MidiaParaMontagem['categoria'], cena = '', duracaoSeg: number | null = null, nome = `m${id}`): MidiaParaMontagem => ({ id, categoria, cena, nome, duracaoSeg })

  it('usa mídias marcadas com o nome da cena, depois as livres, e posiciona narração e trilha', () => {
    const e = estadoInicial(ROTEIRO, '16:9')
    const r = montarAutomaticamente(e, [m(1, 'imagem'), m(2, 'imagem', 'Meio'), m(3, 'audio', 'narração', 12), m(4, 'audio', '', 300, 'trilha calma.mp3'), m(5, 'imagem', 'Miniatura')])
    const video = r.estado.clips.filter((c) => c.faixa === 'video')
    const porCena = (i: number): number[] => video.filter((c) => c.cena === i).map((c) => c.recursoId!)
    expect(porCena(1)).toEqual([2]) // marcada com "Meio"
    expect(porCena(0)).toEqual([1]) // primeira livre
    expect(video.some((c) => c.recursoId === 5)).toBe(false) // miniaturas não entram no vídeo
    expect(r.relatorio.join(' ')).toMatch(/Cena “Fim”: nenhuma mídia disponível/)
    const narr = r.estado.clips.find((c) => c.faixa === 'narracao')!
    expect(narr).toMatchObject({ recursoId: 3, inicio: 0, duracao: 12 })
    const trilha = r.estado.clips.find((c) => c.faixa === 'audio')!
    expect(trilha).toMatchObject({ recursoId: 4, volume: 0.15, fadeIn: 1 })
  })

  it('vídeo curto ocupa só a própria duração e a cena é completada pela mídia seguinte', () => {
    const e = estadoInicial(ROTEIRO, '16:9')
    const cena0 = e.clips.filter((c) => c.cena === 0)
    const fim0 = Math.max(...cena0.map((c) => c.inicio + c.duracao))
    const r = montarAutomaticamente(e, [m(1, 'video', 'Abertura', 1), m(2, 'imagem', 'Abertura')])
    const clips = r.estado.clips.filter((c) => c.faixa === 'video' && c.cena === 0)
    expect(clips.map((c) => c.recursoId)).toEqual([1, 2])
    expect(clips[0]!.duracao).toBe(1)
    expect(clips[1]!.inicio + clips[1]!.duracao).toBeCloseTo(fim0, 2)
  })

  it('não mexe em cenas já montadas e informa quando não há nada a fazer', () => {
    let e = estadoInicial('## Única\n\nTexto.', '16:9')
    e = adicionarClip(e, { faixa: 'video', recursoId: 9, inicio: 0, duracao: 3, corteInicio: 0, volume: 1, fadeIn: 0, fadeOut: 0, texto: '', cena: 0 })
    e = adicionarClip(e, { faixa: 'narracao', recursoId: 8, inicio: 0, duracao: 3, corteInicio: 0, volume: 1, fadeIn: 0, fadeOut: 0, texto: '', cena: null })
    const r = montarAutomaticamente(e, [m(1, 'imagem')])
    expect(r.estado.clips.filter((c) => c.faixa === 'video').map((c) => c.recursoId)).toEqual([9])
    expect(r.relatorio).toEqual(['Nada a fazer: todas as cenas já têm imagem e as faixas de áudio já estão montadas.'])
  })
})

/** Roteiro aprovado com fontes, projeto de edição com 3 cenas e renderização concluída. */
function publicacaoPronta(db: Banco): { projeto: number; render: number } {
  const projeto = projetoDeTeste(db)
  const rot = roteiroDeTeste(db, projeto, { titulo: 'IA no varejo', tema: 'Como a IA está mudando o varejo.', palavrasChave: ['ia', 'varejo'], conteudo: '## A\n\nx' })
  const pasta = pastaTemp()
  mkdirSync(pasta, { recursive: true })
  const arquivo = join(pasta, 'video.mp4')
  writeFileSync(arquivo, 'x')
  const estado = {
    versaoModelo: 1,
    formato: '16:9',
    cenas: [
      { indice: 0, titulo: 'Abertura' },
      { indice: 1, titulo: 'Desenvolvimento' },
      { indice: 2, titulo: 'Conclusão' }
    ],
    clips: [0, 1, 2].map((i) => ({ id: `c${i}`, faixa: 'legendas', recursoId: null, inicio: i * 30, duracao: 30, corteInicio: 0, volume: 1, fadeIn: 0, fadeOut: 0, texto: 't', cena: i }))
  }
  const t = '2026-10-31T00:00:00.000Z'
  const ed = executar(db, "INSERT INTO projetos_edicao (roteiro_id, nome, formato, estado, criado_em, atualizado_em) VALUES (:r, 'E', '16:9', :e, :t, :t)", { r: rot.id, e: JSON.stringify(estado), t }).id
  const render = executar(db, "INSERT INTO renderizacoes (edicao_id, revisao, preset, arquivo, status, criado_em) VALUES (:e, 1, '16:9-1080p', :a, 'concluida', :t)", { e: ed, a: arquivo, t }).id
  return { projeto, render }
}

describe('links cadastrados e publicação', () => {
  it('cadastro valida o endereço, separa global de projeto e a publicação usa os links "incluir sempre"', async () => {
    const db = bancoDeTeste()
    const { projeto, render } = publicacaoPronta(db)
    const outro = projetoDeTeste(db, 'Outro canal')
    const ctx = { db } as unknown as Parameters<typeof despachar>[2]
    expect(await despachar('links:salvar', { nome: 'Ruim', url: 'javascript:alert(1)', categoria: 'site' }, ctx)).toMatchObject({ ok: false })
    expect(await despachar('links:salvar', { nome: 'X', url: 'https://x.invalid', categoria: 'inexistente' }, ctx)).toMatchObject({ ok: false })
    const insta = salvarLink(db, { projetoId: null, nome: 'Instagram', url: 'https://instagram.invalid/canal', categoria: 'rede_social', descricao: '', padrao: true, ativo: true })
    salvarLink(db, { projetoId: projeto, nome: 'Microfone', url: 'https://loja.invalid/mic', categoria: 'afiliado', descricao: '', padrao: false, ativo: true })
    salvarLink(db, { projetoId: outro, nome: 'Do outro canal', url: 'https://outro.invalid', categoria: 'site', descricao: '', padrao: true, ativo: true })
    salvarLink(db, { projetoId: null, nome: 'Promo antiga', url: 'https://promo.invalid', categoria: 'produto', descricao: '', padrao: true, ativo: false })
    expect(listarLinks(db, projeto).map((l) => l.nome)).toEqual(['Instagram', 'Promo antiga', 'Microfone'])

    const p = pub.prepararPublicacao(db, render)
    expect(p.links).toEqual([insta.id])
    expect(p.descricao).toContain('Como a IA está mudando o varejo.')
    expect(p.descricao).toContain('Capítulos\n00:00 Abertura\n00:30 Desenvolvimento\n01:00 Conclusão')
    expect(p.descricao).toContain('Redes sociais\n- Instagram: https://instagram.invalid/canal')
    expect(p.descricao).not.toContain('Do outro canal')
    expect(p.descricao).not.toContain('Promo antiga')
    expect(p.descricao).toContain('#ia #varejo')

    const micro = listarLinks(db, projeto).find((l) => l.nome === 'Microfone')!
    const d = pub.gerarDescricaoPublicacao(db, p.id, [insta.id, micro.id], ['ia'])
    expect(d.texto).toContain('Links de afiliado\n- Microfone: https://loja.invalid/mic')
    expect(d.texto).toContain('comissão')
    expect(pub.obterPublicacao(db, p.id).links).toEqual([insta.id, micro.id])
  })
})
