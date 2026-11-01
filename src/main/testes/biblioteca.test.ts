import { mkdtempSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { abrirBanco } from '../db/conexao'
import { BACKUPS_MANTIDOS, criarBackup, listarBackups } from '../db/backup'
import { MIGRACOES, migrar, versaoAtual } from '../db/migracoes'
import { exportarJson, exportarMarkdown, exportarTxt, nomeArquivo } from '../exportacao'
import { gravarConfig } from '../repositorios/configuracoes'
import * as pautas from '../repositorios/pautas'
import { excluirProjeto } from '../repositorios/projetos'
import * as r from '../repositorios/roteiros'
import { filtroRoteirosSchema, pautaNovaSchema, roteiroNovoSchema } from '@shared/schemas'
import { bancoDeTeste, projetoDeTeste, roteiroDeTeste } from './auxiliares'

const filtro = (f: Record<string, unknown> = {}) => filtroRoteirosSchema.parse(f)
const pastas: string[] = []
function pastaTemp(): string {
  const p = mkdtempSync(join(tmpdir(), 'estudio-teste-'))
  pastas.push(p)
  return p
}
afterEach(() => {
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true })
})

describe('migrações', () => {
  it('aplica todas em ordem e não reaplica', () => {
    const db = abrirBanco(':memory:')
    expect(migrar(db)).toEqual(MIGRACOES.map((m) => m.versao))
    expect(migrar(db)).toEqual([])
    expect(versaoAtual(db)).toBe(MIGRACOES.at(-1)!.versao)
  })
  it('recusa banco de versão mais nova', () => {
    const db = abrirBanco(':memory:')
    db.exec('PRAGMA user_version = 999')
    expect(() => migrar(db)).toThrow(/versão mais nova/)
  })
})

describe('biblioteca de roteiros', () => {
  it('guarda vários roteiros ao mesmo tempo e busca por título sem acento, tema, palavra-chave e conteúdo', () => {
    const db = bancoDeTeste()
    const p = projetoDeTeste(db)
    roteiroDeTeste(db, p, { titulo: 'Inteligência artificial no varejo', tema: 'IA', palavrasChave: ['varejo', 'IA'] })
    roteiroDeTeste(db, p, { titulo: 'Chips quânticos', tema: 'Hardware', tipoVideo: 'short', conteudo: 'Fala sobre qubits' })
    roteiroDeTeste(db, p, { titulo: 'Startups de energia', tema: 'Negócios', palavrasChave: ['energia'] })
    expect(r.buscarRoteiros(db, filtro())).toHaveLength(3)
    expect(r.buscarRoteiros(db, filtro({ texto: 'inteligencia' })).map((x) => x.titulo)).toEqual(['Inteligência artificial no varejo'])
    expect(r.buscarRoteiros(db, filtro({ texto: 'QUBITS' }))).toHaveLength(1)
    expect(r.buscarRoteiros(db, filtro({ texto: 'hardware' }))).toHaveLength(1)
    expect(r.buscarRoteiros(db, filtro({ palavraChave: 'Energia' })).map((x) => x.titulo)).toEqual(['Startups de energia'])
    expect(r.buscarRoteiros(db, filtro({ tipoVideo: 'short' }))).toHaveLength(1)
    expect(r.buscarRoteiros(db, filtro({ texto: '100%' }))).toHaveLength(0) // curinga escapado
  })

  it('filtra por status e data, e ordena', () => {
    const db = bancoDeTeste()
    const p = projetoDeTeste(db)
    const a = roteiroDeTeste(db, p, { titulo: 'B', dataPrevista: '2026-12-10' })
    roteiroDeTeste(db, p, { titulo: 'A', dataPrevista: '2026-11-05' })
    roteiroDeTeste(db, p, { titulo: 'C' })
    r.alterarStatus(db, a.id, 'em_revisao')
    expect(r.buscarRoteiros(db, filtro({ status: 'em_revisao' })).map((x) => x.titulo)).toEqual(['B'])
    expect(r.buscarRoteiros(db, filtro({ ordem: 'titulo_asc' })).map((x) => x.titulo)).toEqual(['A', 'B', 'C'])
    expect(r.buscarRoteiros(db, filtro({ ordem: 'prevista_asc' })).map((x) => x.titulo)).toEqual(['A', 'B', 'C'])
    expect(r.buscarRoteiros(db, filtro({ campoData: 'prevista', dataDe: '2026-12-01', dataAte: '2026-12-31' })).map((x) => x.titulo)).toEqual(['B'])
  })

  it('mantém versões anteriores e resume as diferenças', () => {
    const db = bancoDeTeste()
    const p = projetoDeTeste(db)
    const v1 = roteiroDeTeste(db, p, { titulo: 'Original', conteudo: 'linha 1\nlinha 2' })
    const v2 = r.salvarRoteiro(db, { ...v1, conteudo: 'linha 1\nlinha 2 alterada\nlinha 3', versaoBase: 1 })
    expect(v2.versaoAtual).toBe(2)
    const v3 = r.renomearRoteiro(db, v1.id, 'Novo título')
    expect(v3.versaoAtual).toBe(3)
    const versoes = r.listarVersoes(db, v1.id)
    expect(versoes.map((v) => v.numero)).toEqual([3, 2, 1])
    expect(versoes[1]!.resumoAlteracoes).toMatch(/\+2 \/ −1 linhas/)
    expect(versoes[0]!.resumoAlteracoes).toMatch(/Título: "Original" → "Novo título"/)
    expect(r.obterVersao(db, v1.id, 1).conteudo).toBe('linha 1\nlinha 2')
    // Mudança só de notas não cria versão nova.
    expect(r.salvarRoteiro(db, { ...v3, notas: 'obs', versaoBase: 3 }).versaoAtual).toBe(3)
  })

  it('impede sobrescrever alterações feitas em outro lugar', () => {
    const db = bancoDeTeste()
    const v1 = roteiroDeTeste(db, projetoDeTeste(db))
    r.salvarRoteiro(db, { ...v1, conteudo: 'nova', versaoBase: 1 })
    expect(() => r.salvarRoteiro(db, { ...v1, conteudo: 'antiga', versaoBase: 1 })).toThrow(/alterado em outro lugar/)
  })

  it('duplica com fontes, arquiva, restaura e exclui', () => {
    const db = bancoDeTeste()
    const p = projetoDeTeste(db)
    const o = roteiroDeTeste(db, p, { titulo: 'Base', palavrasChave: ['x'] })
    r.adicionarFonte(db, { roteiroId: o.id, titulo: 'Fonte', url: 'https://exemplo.org/a', autor: '', tipoFonte: 'oficial', publicadaEm: null, acessadaEm: '2026-10-30', notas: '' })
    const c = r.duplicarRoteiro(db, o.id)
    expect(c.titulo).toBe('Cópia de Base')
    expect(c.fontes).toHaveLength(1)
    expect(c.palavrasChave).toEqual(['x'])
    expect(r.listarVersoes(db, c.id)[0]!.resumoAlteracoes).toMatch(/Duplicado do roteiro/)

    r.arquivarRoteiro(db, o.id, true)
    expect(r.buscarRoteiros(db, filtro()).map((x) => x.id)).toEqual([c.id])
    expect(r.buscarRoteiros(db, filtro({ situacao: 'arquivados' })).map((x) => x.id)).toEqual([o.id])
    r.arquivarRoteiro(db, o.id, false)
    expect(r.buscarRoteiros(db, filtro())).toHaveLength(2)

    r.excluirRoteiro(db, o.id)
    expect(() => r.obterRoteiro(db, o.id)).toThrow(/não encontrado/)
    expect(r.obterRoteiro(db, c.id).fontes).toHaveLength(1) // a cópia não é afetada
  })

  it('registra comentários de revisão por versão', () => {
    const db = bancoDeTeste()
    const o = roteiroDeTeste(db, projetoDeTeste(db))
    const c = r.comentar(db, o.id, 'Revisar a introdução')
    expect(c.comentarios[0]).toMatchObject({ versaoNumero: 1, texto: 'Revisar a introdução', resolvidoEm: null })
    r.resolverComentario(db, c.comentarios[0]!.id)
    expect(r.obterRoteiro(db, o.id).comentarios[0]!.resolvidoEm).not.toBeNull()
  })

  it('não exclui projeto com conteúdo', () => {
    const db = bancoDeTeste()
    const p = projetoDeTeste(db)
    roteiroDeTeste(db, p)
    expect(() => excluirProjeto(db, p)).toThrow(/Exclua ou mova/)
  })

  it('persiste após fechar e reabrir o banco em arquivo', () => {
    const arquivo = join(pastaTemp(), 'dados.sqlite')
    const db = abrirBanco(arquivo)
    migrar(db)
    const p = projetoDeTeste(db)
    for (let i = 1; i <= 5; i++) roteiroDeTeste(db, p, { titulo: `Roteiro ${i}` })
    const um = r.buscarRoteiros(db, filtro({ texto: 'Roteiro 3' }))[0]!
    r.alterarStatus(db, um.id, 'aprovado')
    db.close()

    const reaberto = abrirBanco(arquivo)
    expect(migrar(reaberto)).toEqual([])
    expect(r.buscarRoteiros(reaberto, filtro())).toHaveLength(5)
    expect(r.obterRoteiro(reaberto, um.id).status).toBe('aprovado')
    reaberto.close()
  })
})

describe('pautas', () => {
  it('cria, filtra e exclui sem apagar roteiros ligados', () => {
    const db = bancoDeTeste()
    const p = projetoDeTeste(db)
    const a = pautas.criarPauta(db, pautaNovaSchema.parse({ projetoId: p, titulo: 'Agentes de IA', tema: 'IA', palavrasChave: ['agentes'] }))
    const rot = r.criarRoteiro(db, roteiroNovoSchema.parse({ projetoId: p, titulo: 'R', tipoVideo: 'short', pautaId: a.id }))
    expect(pautas.listarPautas(db, { texto: 'agentes', status: null })).toHaveLength(1)
    pautas.atualizarPauta(db, { ...a, status: 'aprovada' })
    expect(pautas.listarPautas(db, { texto: '', status: 'aprovada' })).toHaveLength(1)
    pautas.excluirPauta(db, a.id)
    expect(r.obterRoteiro(db, rot.id).pautaId).toBeNull()
  })
})

describe('exportação', () => {
  it('gera TXT, Markdown e JSON com fontes e versões', () => {
    const db = bancoDeTeste()
    const o = roteiroDeTeste(db, projetoDeTeste(db), { titulo: 'IA *generativa*', conteudo: 'Texto do roteiro', palavrasChave: ['ia'] })
    const comFonte = r.adicionarFonte(db, { roteiroId: o.id, titulo: 'Relatório', url: 'https://exemplo.org/r', autor: 'Fulana', tipoFonte: 'estudo', publicadaEm: '2026-10-01', acessadaEm: '2026-10-30', notas: '' })
    expect(exportarTxt(comFonte)).toContain('FONTES\r\n1. Relatório — https://exemplo.org/r')
    const md = exportarMarkdown(comFonte)
    expect(md).toContain('# IA \\*generativa\\*')
    expect(md).toContain('[Relatório](<https://exemplo.org/r>)')
    const json = JSON.parse(exportarJson(comFonte, [r.obterVersao(db, o.id, 1)], '0.1.0'))
    expect(json.formato).toBe('estudio-ia-youtube/roteiro')
    expect(json.versoes).toHaveLength(1)
    expect(json.roteiro.fontes[0].autor).toBe('Fulana')
  })
  it('cria nomes de arquivo seguros para o Windows', () => {
    expect(nomeArquivo('IA: o que é? <teste>', 'md')).toBe('IA-o-que-e-teste.md')
    expect(nomeArquivo('CON', 'txt')).toBe('roteiro.txt')
    expect(nomeArquivo('../../segredo', 'txt')).toBe('segredo.txt')
    expect(nomeArquivo('a\\b', 'txt')).toBe('ab.txt')
  })
})

describe('configurações e backup', () => {
  it('recusa gravar credenciais nas configurações comuns', () => {
    const db = bancoDeTeste()
    expect(() => gravarConfig(db, 'openai.apiKey', 'x')).toThrow(/Credenciais/)
    expect(() => gravarConfig(db, 'youtube_token', 'x')).toThrow(/Credenciais/)
    expect(() => gravarConfig(db, 'ui.estado', { tela: 'x' })).not.toThrow()
  })
  it('cria backup consistente e mantém apenas os mais recentes', () => {
    const pasta = pastaTemp()
    const db = abrirBanco(join(pasta, 'dados.sqlite'))
    migrar(db)
    roteiroDeTeste(db, projetoDeTeste(db))
    const b = criarBackup(db, join(pasta, 'backups'), 'manual')
    expect(existsSync(join(pasta, 'backups', b.arquivo))).toBe(true)
    const copia = abrirBanco(join(pasta, 'backups', b.arquivo))
    expect(r.buscarRoteiros(copia, filtro())).toHaveLength(1)
    copia.close()
    for (let i = 0; i < BACKUPS_MANTIDOS + 3; i++) criarBackup(db, join(pasta, 'backups'), 'manual')
    expect(listarBackups(join(pasta, 'backups')).length).toBe(BACKUPS_MANTIDOS)
    db.close()
  })
})
