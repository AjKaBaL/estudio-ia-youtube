import { copyFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { YouTubeNaoConfigurado } from '@estudio/youtube'
import type { Contexto } from '../contexto'
import { criarBackup } from '../db/backup'
import { abrirBanco, type Banco } from '../db/conexao'
import { migrar } from '../db/migracoes'
import { despachar } from '../ipc/despachar'
import { GerenciadorProducao } from '../midia/producao'
import { GerenciadorPesquisas, type DependenciasPesquisa } from '../pesquisa/executor'
import { ErroRede } from '../pesquisa/rede'
import { GerenciadorEnvio } from '../youtube/publicacao'
import { cofreDeTeste } from './auxiliares'

const RSS = `<rss><channel><title>Fonte oficial de teste</title>
<item><title>Agência publica regras para inteligência artificial</title><link>https://www.gov.br/regras-ia</link>
<pubDate>${new Date(Date.now() - 86_400_000).toUTCString()}</pubDate><description>A agência publicou regras para inteligência artificial em serviços públicos.</description></item>
</channel></rss>`

function contexto(db: Banco, internet: 'ok' | 'fora' = 'ok'): Contexto {
  const cofre = cofreDeTeste()
  const deps: DependenciasPesquisa = {
    agora: () => new Date(),
    buscar: async (url) => {
      if (internet === 'fora') throw new ErroRede('conexao', 'Não foi possível conectar ao servidor.')
      return { urlFinal: url, status: 200, tipoConteudo: 'application/rss+xml', corpo: RSS, cabecalhos: {} }
    }
  }
  return {
    db,
    cofre,
    versaoApp: 'teste',
    pastaDados: 'C:/t',
    pastaBackups: 'C:/t/b',
    pastaMidia: 'C:/t/m',
    pastaRender: 'C:/t/r',
    youtube: new YouTubeNaoConfigurado(),
    pesquisas: new GerenciadorPesquisas(db, deps),
    producao: new GerenciadorProducao(db, 'C:/t/r', () => null),
    ferramentas: () => null,
    envios: new GerenciadorEnvio(db, cofre, () => new YouTubeNaoConfigurado()),
    abrirNavegador: async () => undefined,
    plataforma: { salvarTexto: vi.fn(async () => null), abrirPasta: vi.fn(async () => undefined), escolherArquivos: vi.fn(async () => []), mostrarNoExplorador: vi.fn() }
  }
}

/** Chama a IPC como a interface faria e devolve os dados (ou falha o teste com a mensagem). */
async function ipc<T = unknown>(ctx: Contexto, canal: string, entrada?: unknown): Promise<T> {
  const r = await despachar(canal, entrada, ctx)
  if (!r.ok) throw new Error(`${canal}: ${r.erro.mensagem}`)
  return r.dados as T
}

async function esperarPesquisa(ctx: Contexto): Promise<void> {
  for (let i = 0; i < 200 && ctx.pesquisas.emAndamento() !== null; i++) await new Promise((r) => setTimeout(r, 10))
}

describe('fluxo de ponta a ponta (sem FFmpeg e sem conta do YouTube)', () => {
  it('pauta → pesquisa → fontes → verificação → roteiro → revisão → agenda → edição → persistência', async () => {
    const pasta = mkdtempSync(join(tmpdir(), 'fluxo-'))
    const arquivo = join(pasta, 'dados.sqlite')
    let db = abrirBanco(arquivo)
    migrar(db)
    let ctx = contexto(db)

    const projeto = await ipc<{ id: number }>(ctx, 'projetos:criar', { nome: 'Canal de teste' })
    await ipc(ctx, 'pesquisa:adicionarFonte', { projetoId: projeto.id, tipo: 'rss', nome: 'Oficial', url: 'https://feeds.exemplo.invalid/rss' })
    // 2. Pesquisa
    const { id: execId } = await ipc<{ id: number }>(ctx, 'pesquisa:iniciar', { projetoId: projeto.id, consulta: 'inteligência artificial' })
    await esperarPesquisa(ctx)
    const ex = await ipc<{ status: string; resultados: { id: number; url: string }[] }>(ctx, 'pesquisa:execucao', { id: execId })
    expect(ex.status).toBe('concluida')
    // 1 e 3. Pauta a partir do resultado e fontes consultáveis (URL real do resultado)
    const pauta = await ipc<{ id: number; fontes: { url: string }[] }>(ctx, 'pautas:deResultados', { projetoId: projeto.id, resultadoIds: [ex.resultados[0]!.id] })
    expect(pauta.fontes[0]!.url).toBe('https://www.gov.br/regras-ia')
    await ipc(ctx, 'pautas:alterarStatus', { id: pauta.id, status: 'aprovada' })
    // 4. Verificação
    await ipc(ctx, 'dossie:criarAfirmacao', { alvo: { pautaId: pauta.id }, texto: 'A agência publicou regras para inteligência artificial em serviços públicos.', natureza: 'fato' })
    const dossie = await ipc<{ afirmacoes: { id: number }[] }>(ctx, 'dossie:obter', { pautaId: pauta.id })
    await ipc(ctx, 'dossie:vincularResultado', { afirmacaoId: dossie.afirmacoes[0]!.id, resultadoId: ex.resultados[0]!.id, trecho: 'A agência publicou regras...', papel: 'primaria', posicao: 'sustenta' })
    // 5. Roteiro (modo estruturado, sem IA)
    const g = await ipc<{ roteiroId: number; status: string }>(ctx, 'geracao:gerar', { pedido: { pautaId: pauta.id, tipo: 'longo' } })
    expect(g.status).toBe('pronto_revisao')
    // 6. Revisão: pedir correção, editar, aprovar nova versão
    await ipc(ctx, 'revisao:solicitarCorrecoes', { id: g.roteiroId, tipo: 'editorial', comentario: 'Reescrever a abertura.' })
    const rot = await ipc<{ versaoAtual: number; conteudo: string; titulo: string; tema: string; tipoVideo: string; notas: string; dataPrevista: null; palavrasChave: string[] }>(ctx, 'roteiros:obter', { id: g.roteiroId })
    await ipc(ctx, 'roteiros:salvar', { ...rot, id: g.roteiroId, versaoBase: rot.versaoAtual, conteudo: rot.conteudo.replace('[Rascunho estruturado: reescreva a abertura com suas palavras.]', 'Vamos entender o que muda.') })
    await ipc(ctx, 'revisao:aprovarFactual', { id: g.roteiroId, comentario: 'Fonte oficial conferida.' })
    await ipc(ctx, 'revisao:aprovarEditorial', { id: g.roteiroId })
    const painel = await ipc<{ roteiro: { status: string; versaoAtual: number } }>(ctx, 'revisao:aprovarProducao', { id: g.roteiroId })
    expect(painel.roteiro).toMatchObject({ status: 'aprovado', versaoAtual: 2 })
    // 7. Fila/agenda
    const domingo = new Date(Date.now() + 7 * 86_400_000)
    while (domingo.getUTCDay() !== 0) domingo.setUTCDate(domingo.getUTCDate() + 1)
    await ipc(ctx, 'agenda:agendar', { projetoId: projeto.id, roteiroId: g.roteiroId, titulo: 'Vídeo', tipoVideo: 'longo', data: domingo.toISOString().slice(0, 10), hora: '18:00' })
    const fila = await ipc<{ pendencias: string[] }[]>(ctx, 'fila:itens')
    expect(fila[0]!.pendencias).toContain('Sem projeto de edição.')
    // 8. Edição: projeto criado; renderização bloqueada sem FFmpeg (limitação conhecida)
    const ed = await ipc<{ id: number }>(ctx, 'edicao:criar', { roteiroId: g.roteiroId })
    const render = await despachar('producao:renderizar', { edicaoId: ed.id, preset: '16:9-720p' }, ctx)
    expect(render).toMatchObject({ ok: false, erro: { codigo: 'sem_ffmpeg' } })
    // 11. Métricas sem conta: estado claro, nada inventado
    expect((await ipc<{ linhas: unknown[] }>(ctx, 'metricas:painel', {})).linhas).toEqual([])
    expect(await despachar('metricas:coletar', undefined, ctx)).toMatchObject({ ok: true, dados: { coletados: 0 } })

    // 12. Fechar e abrir: tudo persiste
    db.close()
    db = abrirBanco(arquivo)
    expect(migrar(db)).toEqual([])
    ctx = contexto(db)
    expect((await ipc<{ status: string }>(ctx, 'roteiros:obter', { id: g.roteiroId })).status).toBe('aprovado')
    expect(await ipc<unknown[]>(ctx, 'edicao:listar')).toHaveLength(1)
    expect(await ipc<unknown[]>(ctx, 'pesquisa:execucoes', { projetoId: projeto.id })).toHaveLength(1)
    expect((await ipc<{ historico: unknown[] }>(ctx, 'revisao:painel', { id: g.roteiroId })).historico.length).toBeGreaterThanOrEqual(4)

    // Backup e restauração: restaurar a cópia recupera os dados depois de uma exclusão.
    const b = criarBackup(db, join(pasta, 'backups'), 'manual')
    await ipc(ctx, 'roteiros:excluir', { id: g.roteiroId })
    db.close()
    copyFileSync(join(pasta, 'backups', b.arquivo), arquivo)
    db = abrirBanco(arquivo)
    ctx = contexto(db)
    expect((await ipc<{ titulo: string }>(ctx, 'roteiros:obter', { id: g.roteiroId })).titulo).toBeTruthy()
    db.close()
  })
})

describe('casos de falha', () => {
  async function preparar(internet: 'ok' | 'fora') {
    const db = abrirBanco(':memory:')
    migrar(db)
    const ctx = contexto(db, internet)
    const projeto = await ipc<{ id: number }>(ctx, 'projetos:criar', { nome: 'P' })
    await ipc(ctx, 'pesquisa:adicionarFonte', { projetoId: projeto.id, tipo: 'rss', nome: 'F', url: 'https://feeds.exemplo.invalid/rss' })
    return { ctx, projeto }
  }

  it('internet indisponível: pesquisa termina com erro explicado por fonte', async () => {
    const { ctx, projeto } = await preparar('fora')
    const { id } = await ipc<{ id: number }>(ctx, 'pesquisa:iniciar', { projetoId: projeto.id, consulta: 'ia' })
    await esperarPesquisa(ctx)
    const ex = await ipc<{ status: string; registros: { nivel: string }[] }>(ctx, 'pesquisa:execucao', { id })
    expect(ex.status).toBe('erro')
    expect(ex.registros.some((r) => r.nivel === 'erro')).toBe(true)
  })
  it('pesquisa sem resultados: concluída com zero resultados', async () => {
    const { ctx, projeto } = await preparar('ok')
    const { id } = await ipc<{ id: number }>(ctx, 'pesquisa:iniciar', { projetoId: projeto.id, consulta: 'assunto inexistente xyz' })
    await esperarPesquisa(ctx)
    expect(await ipc(ctx, 'pesquisa:execucao', { id })).toMatchObject({ status: 'concluida', totalResultados: 0 })
  })
  it('fonte inválida é recusada', async () => {
    const { ctx, projeto } = await preparar('ok')
    for (const url of ['ftp://x.com/feed', 'http://192.168.0.1/feed', 'não é url']) {
      const r = await despachar('pesquisa:adicionarFonte', { projetoId: projeto.id, tipo: 'rss', nome: 'X', url }, ctx)
      if (url.startsWith('http://192')) continue // endereço interno é recusado no momento da conexão (anti-SSRF), não no cadastro
      expect(r).toMatchObject({ ok: false, erro: { codigo: 'validacao' } })
    }
  })
  it('serviço de IA não configurado: biblioteca e modo estruturado continuam funcionando; provedor inexistente é recusado', async () => {
    const { ctx, projeto } = await preparar('ok')
    expect((await ipc<unknown[]>(ctx, 'roteiros:buscar', {}))).toEqual([])
    const pauta = await ipc<{ id: number }>(ctx, 'pautas:criar', { projetoId: projeto.id, titulo: 'Pauta' })
    await ipc(ctx, 'pautas:alterarStatus', { id: pauta.id, status: 'aprovada' })
    const r = await despachar('geracao:planejar', { pautaId: pauta.id, tipo: 'short', provedorId: 99 }, ctx)
    expect(r).toMatchObject({ ok: false, erro: { codigo: 'nao_encontrado' } })
    expect((await ipc<{ status: string }>(ctx, 'geracao:gerar', { pedido: { pautaId: pauta.id, tipo: 'short' } })).status).toBe('precisa_verificacao')
  })
  it('YouTube não conectado: publicação e métricas mostram estado claro', async () => {
    const { ctx } = await preparar('ok')
    expect((await ipc<{ status: { estado: string } }>(ctx, 'youtube:painel')).status.estado).toBe('nao_configurado')
    expect(await despachar('youtube:canais', undefined, ctx)).toMatchObject({ ok: false, erro: { codigo: 'youtube_validacao' } })
  })
})
