import { FONTES_PADRAO } from '@shared/fontesPadrao'
import { mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { YouTubeNaoConfigurado } from '@estudio/youtube'
import type { Contexto } from '../contexto'
import { despachar } from '../ipc/despachar'
import { GerenciadorProducao } from '../midia/producao'
import { GerenciadorPesquisas } from '../pesquisa/executor'
import { GerenciadorEnvio } from '../youtube/publicacao'
import { lerPolitica } from '../ia/central'
import { lerEditorial } from '../repositorios/editorial'
import { listarFontesPesquisa } from '../repositorios/pesquisa'
import { listarProjetos } from '../repositorios/projetos'
import { lerConfig } from '../repositorios/configuracoes'
import type { EstadoAssistente } from '@shared/tipos'
import { bancoDeTeste, cofreDeTeste } from './auxiliares'

function contexto(): Contexto {
  const db = bancoDeTeste()
  const pasta = mkdtempSync(join(tmpdir(), 'estudio-rapido-'))
  return {
    db,
    cofre: cofreDeTeste(),
    pastaMidia: join(pasta, 'midia'),
    pastaRender: join(pasta, 'render'),
    producao: new GerenciadorProducao(db, join(pasta, 'render'), () => null),
    ferramentas: () => null,
    pesquisas: new GerenciadorPesquisas(db, { buscar: async () => Promise.reject(new Error('rede desativada em teste')), agora: () => new Date() }),
    versaoApp: '0.0.0-teste',
    pastaDados: pasta,
    pastaBackups: join(pasta, 'backups'),
    youtube: new YouTubeNaoConfigurado(),
    envios: new GerenciadorEnvio(db, cofreDeTeste(), () => new YouTubeNaoConfigurado()),
    abrirNavegador: async () => undefined,
    plataforma: { salvarTexto: vi.fn(async () => null), abrirPasta: vi.fn(async () => undefined), escolherArquivos: vi.fn(async () => []), mostrarNoExplorador: vi.fn() }
  }
}

type Resp = { ok: boolean; dados: { mensagens: string[]; estado: EstadoAssistente } }

describe('configuração de um clique', () => {
  it('"tudo" aplica o recomendado em todas as etapas que não dependem de conta', async () => {
    const ctx = contexto()
    const r = (await despachar('rapido:aplicar', { acao: 'tudo' }, ctx)) as Resp
    expect(r.ok).toBe(true)
    const [p] = listarProjetos(ctx.db)
    expect(p!.nome).toBe('Meu canal')
    expect(listarFontesPesquisa(ctx.db, p!.id)).toHaveLength(FONTES_PADRAO.length)
    const ed = lerEditorial(ctx.db)
    expect(ed.agenda.formatos.longo.limiteSemanal).toBe(1)
    expect(ed.agenda.formatos.short.limiteSemanal).toBe(3)
    expect(ed.pesquisa).toMatchObject({ frequencia: 'diaria', horario: '08:00', periodo: '7d' })
    expect(lerPolitica(ctx.db)).toMatchObject({ modo: 'hibrido', gratuitosAutomaticos: true, tetoMensal: 0, revisaoInterna: { automatica: true, outroModelo: true } })
    expect(lerConfig(ctx.db, 'render_preferencia')).not.toBeNull()
    expect(readdirSync(ctx.pastaBackups).length).toBe(1)
    const e = r.dados.estado.etapas
    expect([e.boasvindas.feito, e.projeto.feito, e.pesquisa.feito, e.agenda.feito, e.ia.feito, e.backup.feito]).toEqual([true, true, true, true, true, true])
    expect(e.video.feito).toBe(false) // sem FFmpeg neste teste
    expect(r.dados.mensagens.join(' ')).toMatch(/Falta o FFmpeg/)

    // Repetir não duplica nada.
    await despachar('rapido:aplicar', { acao: 'tudo' }, ctx)
    expect(listarProjetos(ctx.db)).toHaveLength(1)
    expect(listarFontesPesquisa(ctx.db, p!.id)).toHaveLength(FONTES_PADRAO.length)
  })

  it('ritmos prontos e modo local; ação desconhecida é recusada', async () => {
    const ctx = contexto()
    await despachar('rapido:aplicar', { acao: 'agenda_intenso' }, ctx)
    expect(lerEditorial(ctx.db).agenda.formatos.short.limiteSemanal).toBe(7)
    expect(lerEditorial(ctx.db).agenda.formatos.longo.limiteSemanal).toBe(3)
    await despachar('rapido:aplicar', { acao: 'ia_hibrido' }, ctx)
    await despachar('rapido:aplicar', { acao: 'ia_local' }, ctx)
    expect(lerPolitica(ctx.db)).toMatchObject({ modo: 'local', gratuitosAutomaticos: false })
    expect(await despachar('rapido:aplicar', { acao: 'apagar_tudo' }, ctx)).toMatchObject({ ok: false })
    // Instalações não fazem parte do "aplicar": só pelos canais próprios, quando o usuário clica.
    expect(await despachar('rapido:aplicar', { acao: 'instalar_ollama' }, ctx)).toMatchObject({ ok: false })
  })
})

type Est = { ok: boolean; dados: { modo: string; atividades: { tipo: string }[]; avisos: string[]; proximaPesquisa: string | null } }

describe('barra de status e "Trabalhar agora"', () => {
  it('mostra espera, trabalho e pausa, e o botão retoma e dispara a pesquisa', async () => {
    const ctx = contexto()
    const vazio = (await despachar('atividade:estado', undefined, ctx)) as Est
    expect(vazio.dados.modo).toBe('espera')
    expect(vazio.dados.avisos.join(' ')).toMatch(/Nenhum projeto/)
    expect(await despachar('atividade:trabalharAgora', undefined, ctx)).toMatchObject({ ok: false, erro: { mensagem: expect.stringMatching(/Crie o projeto/) } })

    await despachar('rapido:aplicar', { acao: 'tudo' }, ctx)
    const espera = (await despachar('atividade:estado', undefined, ctx)) as Est
    expect(espera.dados).toMatchObject({ modo: 'espera', avisos: [] })
    expect(espera.dados.proximaPesquisa).not.toBeNull()

    await despachar('fila:definirPausaGlobal', { pausada: true }, ctx)
    expect(((await despachar('atividade:estado', undefined, ctx)) as Est).dados.modo).toBe('pausado')

    const r = (await despachar('atividade:trabalharAgora', undefined, ctx)) as { ok: boolean; dados: { mensagem: string; estado: Est['dados'] } }
    expect(r.ok).toBe(true)
    expect(r.dados.mensagem).toMatch(/Tarefas automáticas retomadas\. Pesquisa de novidades iniciada com 24 termo/)
    expect(r.dados.estado.modo).toBe('trabalhando')
    expect(r.dados.estado.atividades[0]!.tipo).toBe('pesquisa')
    // Uma segunda chamada não cria outra pesquisa em paralelo.
    const r2 = (await despachar('atividade:trabalharAgora', undefined, ctx)) as { dados: { mensagem: string } }
    expect(r2.dados.mensagem).toMatch(/Já há uma pesquisa em andamento/)
  })
})

