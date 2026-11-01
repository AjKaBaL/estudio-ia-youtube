import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { LinhaMetrica, MetadadosEnvio, SituacaoEnvio, YouTubeGateway } from '@estudio/youtube'
import { YouTubeNaoConfigurado } from '@estudio/youtube'
import { rodadaAgendador } from '../agendador'
import { executar, um } from '../db/conexao'
import * as agenda from '../repositorios/agenda'
import { listarTarefas } from '../repositorios/tarefas'
import { lerEditorial, salvarEditorial } from '../repositorios/editorial'
import * as r from '../repositorios/roteiros'
import * as dossie from '../repositorios/dossie'
import * as fila from '../producao/fila'
import * as derivados from '../producao/derivados'
import * as metricas from '../producao/metricas'
import * as pub from '../youtube/publicacao'
import { bancoDeTeste, cofreDeTeste, projetoDeTeste, roteiroDeTeste } from './auxiliares'
import type { Banco } from '../db/conexao'

/** YouTube falso em memória: registra envios e permite simular queda no meio. */
class YouTubeFalso extends YouTubeNaoConfigurado implements YouTubeGateway {
  recebidos = 0
  sessoes = 0
  cairEm: number | null = null
  metas: MetadadosEnvio[] = []
  override async iniciarEnvio(meta: MetadadosEnvio): Promise<string> {
    this.metas.push(meta)
    this.sessoes++
    this.recebidos = 0
    return `https://www.googleapis.com/upload/youtube/v3/videos?upload_id=s${this.sessoes}`
  }
  override async consultarEnvio(_s: string, tamanho: number): Promise<SituacaoEnvio> {
    return this.recebidos >= tamanho ? { concluido: true, bytesRecebidos: tamanho, videoId: 'vid-1' } : { concluido: false, bytesRecebidos: this.recebidos, videoId: null }
  }
  override async enviarPartes(_s: string, _c: string, tamanho: number, desde: number, aoProgredir: (b: number) => void): Promise<SituacaoEnvio> {
    for (let p = desde; p < tamanho; p += 10) {
      if (this.cairEm !== null && p >= this.cairEm) {
        this.cairEm = null
        throw new Error('rede caiu')
      }
      this.recebidos = Math.min(tamanho, p + 10)
      aoProgredir(this.recebidos)
    }
    return { concluido: true, bytesRecebidos: tamanho, videoId: 'vid-1' }
  }
  override async statusVideo(id: string) {
    return { id, statusEnvio: 'processed', privacidade: this.metas.at(-1)?.privacidade ?? 'private', publicarEm: null, motivoRejeicao: null, visualizacoes: 10 }
  }
  override async metricas(_i: string, _f: string, ids: string[]): Promise<LinhaMetrica[]> {
    return ids.map((videoId) => ({ videoId, visualizacoes: 120, minutosAssistidos: 50, duracaoMediaSeg: 60, percentualMedioAssistido: 20, inscritosGanhos: 2 }))
  }
}

/** Roteiro aprovado, projeto de edição, renderização concluída (arquivo de teste) e QC aprovado. */
function prontoParaPublicar(db: Banco, opcoes: { qcAprovado?: boolean; conteudoArquivo?: string } = {}) {
  const p = projetoDeTeste(db)
  const rot = roteiroDeTeste(db, p, { titulo: 'Vídeo de teste', conteudo: '## Bloco\n\nTexto.' })
  r.alterarStatus(db, rot.id, 'aprovado')
  const pasta = mkdtempSync(join(tmpdir(), 'pub-'))
  const arquivo = join(pasta, 'video.mp4')
  writeFileSync(arquivo, opcoes.conteudoArquivo ?? 'x'.repeat(95))
  const t = '2026-10-31T00:00:00.000Z'
  const ed = executar(db, "INSERT INTO projetos_edicao (roteiro_id, nome, formato, estado, criado_em, atualizado_em) VALUES (:r, 'E', '16:9', '{\"versaoModelo\":1,\"formato\":\"16:9\",\"cenas\":[],\"clips\":[]}', :t, :t)", { r: rot.id, t }).id
  const render = executar(db, "INSERT INTO renderizacoes (edicao_id, revisao, preset, arquivo, status, criado_em) VALUES (:e, 1, '16:9-720p', :a, 'concluida', :t)", { e: ed, a: arquivo, t }).id
  executar(db, "INSERT INTO relatorios_qualidade (renderizacao_id, itens, bloqueadores, avisos, aprovado, criado_em, atualizado_em) VALUES (:r, '[]', 0, 0, :ok, :t, :t)", { r: render, ok: opcoes.qcAprovado === false ? 0 : 1, t })
  return { p, rot, render, arquivo }
}

const campos = (extra: Partial<pub.CamposPublicacao> = {}): pub.CamposPublicacao => ({
  titulo: 'Vídeo de teste',
  descricao: 'Descrição',
  tags: ['ia'],
  categoriaId: '28',
  playlistId: null,
  privacidade: 'private',
  publicarEm: null,
  feitoParaCriancas: false,
  conteudoSintetico: false,
  miniaturaRecursoId: null,
  ...extra
})

describe('publicação segura no YouTube', () => {
  it('pré-requisitos, aprovação obrigatória, envio privado e status final', async () => {
    const db = bancoDeTeste()
    const cofre = cofreDeTeste()
    const yt = new YouTubeFalso()
    const env = new pub.GerenciadorEnvio(db, cofre, () => yt)
    const { render, rot } = prontoParaPublicar(db)
    const p = pub.prepararPublicacao(db, render)
    expect(p.privacidade).toBe('private') // privado por padrão
    expect(pub.lerOpcoesYouTube(db).aprovacaoObrigatoria).toBe(true)
    expect(() => pub.aprovarPublicacao(db, p.id, false)).toThrow(/feito para crianças/)
    pub.atualizarPublicacao(db, p.id, campos())
    expect(() => env.validarParaEnvio(p.id)).toThrow(/Aprove a publicação/)
    pub.aprovarPublicacao(db, p.id, false)
    const enviada = await env.enviar(p.id)
    expect(enviada).toMatchObject({ status: 'processando', videoId: 'vid-1', videoUrl: 'https://www.youtube.com/watch?v=vid-1' })
    expect(yt.metas[0]).toMatchObject({ privacidade: 'private', feitoParaCriancas: false })
    const final = await env.atualizarStatus(p.id)
    expect(final.status).toBe('concluida')
    expect(r.obterRoteiro(db, rot.id).status).toBe('aprovado') // privado não marca como publicado
    expect(cofre.possui(`youtube:sessao:${p.id}`)).toBe(false)
  })

  it('público exige confirmação explícita; editar desfaz a aprovação', () => {
    const db = bancoDeTeste()
    const { render } = prontoParaPublicar(db)
    const p = pub.prepararPublicacao(db, render)
    pub.atualizarPublicacao(db, p.id, campos({ privacidade: 'public' }))
    expect(() => pub.aprovarPublicacao(db, p.id, false)).toThrow(/confirmação explícita/)
    expect(pub.aprovarPublicacao(db, p.id, true)).toMatchObject({ status: 'aprovada', aprovacaoPublica: true })
    expect(pub.atualizarPublicacao(db, p.id, campos({ titulo: 'Outro' })).status).toBe('rascunho')
  })

  it('bloqueia sem QC aprovado e com roteiro fora de "aprovado"', () => {
    const db = bancoDeTeste()
    const { render, rot } = prontoParaPublicar(db, { qcAprovado: false })
    const p = pub.prepararPublicacao(db, render)
    pub.atualizarPublicacao(db, p.id, campos())
    r.alterarStatus(db, rot.id, 'em_revisao')
    const pend = pub.pendenciasPublicacao(db, pub.obterPublicacao(db, p.id))
    expect(pend.join(' ')).toMatch(/roteiro não está aprovado/)
    expect(pend.join(' ')).toMatch(/controle de qualidade/)
  })

  it('falha de rede no meio: retoma do ponto confirmado; reinício do app deixa o envio pausado', async () => {
    const db = bancoDeTeste()
    const cofre = cofreDeTeste()
    const yt = new YouTubeFalso()
    yt.cairEm = 50
    const env = new pub.GerenciadorEnvio(db, cofre, () => yt)
    const { render } = prontoParaPublicar(db)
    const p = pub.prepararPublicacao(db, render)
    pub.atualizarPublicacao(db, p.id, campos())
    pub.aprovarPublicacao(db, p.id, false)
    const falhou = await env.enviar(p.id)
    expect(falhou.status).toBe('erro')
    expect(cofre.possui(`youtube:sessao:${p.id}`)).toBe(true)
    executar(db, "UPDATE publicacoes SET status = 'enviando' WHERE id = :id", { id: p.id })
    pub.recuperarEnvios(db) // simula reabrir o app
    expect(pub.obterPublicacao(db, p.id).status).toBe('pausada')
    const ok = await env.enviar(p.id)
    expect(ok.status).toBe('processando')
    expect(yt.sessoes).toBe(1) // retomou a mesma sessão, sem novo envio
  })

  it('impede envio duplicado do mesmo arquivo e mais de uma publicação ativa por renderização', async () => {
    const db = bancoDeTeste()
    const env = new pub.GerenciadorEnvio(db, cofreDeTeste(), () => new YouTubeFalso())
    const a = prontoParaPublicar(db, { conteudoArquivo: 'mesmo-conteudo' })
    const p1 = pub.prepararPublicacao(db, a.render)
    expect(pub.prepararPublicacao(db, a.render).id).toBe(p1.id) // não cria outra ativa
    pub.atualizarPublicacao(db, p1.id, campos())
    pub.aprovarPublicacao(db, p1.id, false)
    await env.enviar(p1.id)
    const b = prontoParaPublicar(db, { conteudoArquivo: 'mesmo-conteudo' })
    const p2 = pub.prepararPublicacao(db, b.render)
    pub.atualizarPublicacao(db, p2.id, campos())
    pub.aprovarPublicacao(db, p2.id, false)
    await expect(env.enviar(p2.id)).rejects.toThrow(/já foi enviado/)
  })
})

describe('fila de produção e semana fictícia', () => {
  const AGORA = new Date('2026-11-02T12:00:00Z') // segunda

  it('1 longo e 3 Shorts: pendências, atraso, bloqueio de publicação, pausa, prioridade e reagendamento', () => {
    const db = bancoDeTeste()
    const p = projetoDeTeste(db)
    const cfg = lerEditorial(db)
    const criar = (tipo: 'longo' | 'short', data: string, status: 'rascunho' | 'em_revisao' | 'aprovado') => {
      const rot = roteiroDeTeste(db, p, { tipoVideo: tipo, titulo: `${tipo} ${data}` })
      if (status !== 'rascunho') r.alterarStatus(db, rot.id, status)
      return agenda.agendar(db, cfg, { projetoId: p, roteiroId: rot.id, titulo: rot.titulo, tipoVideo: tipo, data, hora: '18:00', notas: '' }, AGORA)
    }
    const s1 = criar('short', '2026-11-03', 'rascunho')
    criar('short', '2026-11-05', 'em_revisao')
    criar('short', '2026-11-07', 'aprovado')
    criar('longo', '2026-11-08', 'aprovado')
    const itens = fila.montarFila(db, AGORA)
    expect(itens).toHaveLength(4)
    const atrasado = itens.find((i) => i.id === s1.id)!
    expect(atrasado.atrasado).toBe(true) // roteiro deveria estar pronto 3 dias antes
    expect(itens.find((i) => i.titulo.includes('11-05'))!.bloqueiaPublicacao).toBe(true) // em revisão
    expect(itens.find((i) => i.tipoVideo === 'longo')!.pendencias).toContain('Sem projeto de edição.')
    fila.pausarItem(db, s1.id, true)
    fila.priorizarItem(db, s1.id, 5)
    const depois = fila.montarFila(db, AGORA)
    expect(depois[0]).toMatchObject({ id: s1.id, pausado: true, prioridade: 5 })
    agenda.reagendar(db, cfg, s1.id, '2026-11-10', '18:00', AGORA)
    expect(fila.montarFila(db, AGORA).find((i) => i.id === s1.id)!.inicioUtc).toBe('2026-11-10T21:00:00.000Z')
  })

  it('pausa global: nenhuma tarefa automática é criada; vale após reiniciar; ao retomar nada se acumula', () => {
    const db = bancoDeTeste()
    rodadaAgendador(db, new Date('2026-11-01T10:00:00Z'))
    fila.definirPausaGlobal(db, true)
    rodadaAgendador(db, new Date('2026-11-01T11:01:00Z')) // horário de pesquisa às 08:00 SP
    expect(listarTarefas(db)).toEqual([])
    expect(fila.automacaoPausada(db)).toBe(true) // persistido no banco
    fila.definirPausaGlobal(db, false)
    rodadaAgendador(db, new Date('2026-11-01T12:00:00Z'))
    expect(listarTarefas(db)).toEqual([])
    rodadaAgendador(db, new Date('2026-11-02T11:01:00Z'))
    expect(listarTarefas(db).map((t) => t.status)).toEqual(['pendente'])
  })
})

describe('Shorts derivados', () => {
  it('usa frases inteiras de um bloco e registra o Short como conteúdo próprio ligado ao longo', () => {
    const db = bancoDeTeste()
    const p = projetoDeTeste(db)
    const bloco = 'A agência publicou uma norma nova para sistemas de inteligência artificial. Ela cria regras de transparência para empresas. As empresas terão um prazo para se adaptar às exigências. O texto também prevê fiscalização e multas em caso de descumprimento.'
    const longo = roteiroDeTeste(db, p, { tipoVideo: 'longo', conteudo: `# T\n\n## Abertura\n\nOi.\n\n## Bloco 1 — A norma\n\n${bloco} [Fontes: F1]\n[Visual: x]\n\n## Conclusão\n\nFim.\n\n## Fontes\nF1. X — https://x.com\n` })
    const ideias = derivados.ideiasParaShorts(db, longo.id)
    expect(ideias.map((i) => i.chave)).toEqual(['cena:A norma'])
    expect(ideias[0]!.texto).toBe(bloco)
    const curto = derivados.criarShortDerivado(db, longo.id, 'cena:A norma')
    expect(curto).toMatchObject({ tipoVideo: 'short', status: 'rascunho' })
    expect(curto.conteudo).toContain('A agência publicou uma norma nova para sistemas de inteligência artificial.')
    expect(curto.conteudo).not.toContain('[Fontes')
    expect(um(db, 'SELECT origem_roteiro_id AS o FROM roteiros WHERE id = :id', { id: curto.id })).toEqual({ o: longo.id })
    expect(r.listarVersoes(db, curto.id)[0]!.resumoAlteracoes).toMatch(/derivado/)
    expect(() => derivados.ideiasParaShorts(db, curto.id)).toThrow(/vídeo longo/)
  })

  it('afirmações verificadas podem virar ideia de Short', () => {
    const db = bancoDeTeste()
    const longo = roteiroDeTeste(db, projetoDeTeste(db), { tipoVideo: 'longo' })
    dossie.criarAfirmacao(db, { pautaId: null, roteiroId: longo.id }, { texto: 'A norma cria regras de transparência para empresas de tecnologia.', natureza: 'fato', relevante: false, temaRapido: false, observacoes: '' })
    const a = dossie.relatorio(db, { pautaId: null, roteiroId: longo.id }).afirmacoes[0]!
    dossie.vincularNovaFonte(db, a.id, { titulo: 'Oficial', url: 'https://www.gov.br/x', autor: '', tipoFonte: 'oficial', publicadaEm: null, acessadaEm: '2026-10-30' }, { trecho: 't', papel: 'primaria', posicao: 'sustenta' })
    expect(derivados.ideiasParaShorts(db, longo.id).some((i) => i.origem === 'afirmacao')).toBe(true)
  })
})

describe('métricas e relatório semanal', () => {
  it('sem dados autorizados: estado claro e sugestão nenhuma inventada', () => {
    const db = bancoDeTeste()
    const rel = metricas.gerarRelatorioSemanal(db, '2026-11-04')
    expect(rel.conteudo.observacoes[0]).toMatch(/Ainda não há métricas/)
    expect(rel.sugestoes).toEqual([])
    expect(metricas.relatorioSemanalMarkdown(rel)).toContain('Limitações')
  })

  it('coleta pelo gateway, compara com a mediana do formato e registra sugestões pendentes', async () => {
    const db = bancoDeTeste()
    const env = new pub.GerenciadorEnvio(db, cofreDeTeste(), () => new YouTubeFalso())
    const { render } = prontoParaPublicar(db)
    const p = pub.prepararPublicacao(db, render)
    pub.atualizarPublicacao(db, p.id, campos())
    pub.aprovarPublicacao(db, p.id, false)
    await env.enviar(p.id)
    executar(db, "UPDATE publicacoes SET enviado_em = '2026-10-20T10:00:00.000Z' WHERE id = :id", { id: p.id })
    expect((await metricas.coletarMetricas(db, new YouTubeFalso(), new Date('2026-11-04T12:00:00Z'))).coletados).toBe(1)
    const painel = metricas.painelMetricas(db, { de: null, ate: null, tipo: null }, new Date('2026-11-04T12:00:00Z'))
    expect(painel.linhas[0]).toMatchObject({ visualizacoes: 120, percentualMedio: 20, diasDesdePublicacao: 15, relacaoComMediana: 1 })
    expect(painel.limitacoes.join(' ')).toMatch(/Impressões e taxa de cliques/)
    const rel = metricas.gerarRelatorioSemanal(db, '2026-10-21', new Date('2026-11-04T12:00:00Z'))
    expect(rel.conteudo.publicados).toHaveLength(1)
    expect(rel.conteudo.observacoes.join(' ')).toMatch(/comparações são frágeis/)
    const sug = rel.sugestoes.find((s) => s.tipo === 'narrativa')!
    expect(sug.status).toBe('pendente')
    metricas.decidirSugestao(db, sug.id, true)
    expect(metricas.listarSugestoes(db, rel.id).find((s) => s.id === sug.id)!.status).toBe('aceita')
    // Aceitar não altera a agenda nem as regras editoriais.
    expect(lerEditorial(db)).toEqual(lerEditorial(bancoDeTeste()))
    salvarEditorial(db, lerEditorial(db))
  })
})
