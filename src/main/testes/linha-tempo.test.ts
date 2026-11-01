import { describe, expect, it } from 'vitest'
import { adicionarClip, corrigirLinhaDoTempo, duracaoTotal, estadoInicial, montarAutomaticamente, problemasEstado, type EstadoEdicao } from '@shared/edicao'

const ROTEIRO = `# Teste\n\n## Abertura\n\nPrimeira frase da abertura do vídeo de teste para a linha do tempo.\n\n## Bloco 1\n\nSegunda frase do vídeo, no primeiro bloco do roteiro de teste.\n`
const base = { corteInicio: 0, volume: 1, fadeIn: 0, fadeOut: 0, texto: '' }

describe('linha do tempo: correção automática', () => {
  it('apara sobreposições e cobre buracos esticando imagens (como o clipe repetido em 22,4 s)', () => {
    let e: EstadoEdicao = estadoInicial(ROTEIRO, '16:9')
    const total = duracaoTotal(e)
    e = adicionarClip(e, { ...base, faixa: 'video', recursoId: 1, inicio: 0, duracao: total * 0.6, cena: 0 })
    e = adicionarClip(e, { ...base, faixa: 'video', recursoId: 2, inicio: total * 0.4, duracao: total * 0.3, cena: null })
    expect(problemasEstado(e, new Set([1, 2]))[0]).toMatch(/sobrepostos/)
    const r = corrigirLinhaDoTempo(e, new Set([1, 2]))
    expect(problemasEstado(r.estado, new Set([1, 2]))).toEqual([])
    expect(r.correcoes.join(' ')).toMatch(/1 sobreposição.*coberto/)
    const v = r.estado.clips.filter((c) => c.faixa === 'video').sort((a, b) => a.inicio - b.inicio)
    expect(v[0]!.inicio + v[0]!.duracao).toBeCloseTo(v[1]!.inicio, 3)
    expect(v[1]!.inicio + v[1]!.duracao).toBeCloseTo(total, 3) // a última imagem vai até o fim
    // Idempotente: rodar de novo não muda nada.
    expect(corrigirLinhaDoTempo(r.estado, new Set([1, 2])).correcoes).toEqual([])
  })
  it('vídeos não são esticados (ficariam congelados)', () => {
    let e: EstadoEdicao = estadoInicial(ROTEIRO, '16:9')
    e = adicionarClip(e, { ...base, faixa: 'video', recursoId: 5, inicio: 0, duracao: 1, cena: 0 })
    expect(corrigirLinhaDoTempo(e, new Set()).correcoes).toEqual([])
  })
  it('a montagem não repete a mesma mídia em duas cenas', () => {
    const e = estadoInicial(ROTEIRO, '16:9')
    const midias = [
      { id: 1, categoria: 'imagem' as const, cena: 'Abertura', nome: 'a.jpg', duracaoSeg: null },
      { id: 2, categoria: 'imagem' as const, cena: '', nome: 'b.jpg', duracaoSeg: null }
    ]
    const m = montarAutomaticamente(e, midias)
    const ids = m.estado.clips.filter((c) => c.faixa === 'video').map((c) => c.recursoId)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
