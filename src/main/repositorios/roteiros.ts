import { type Banco, type Parametros, agoraIso, executar, normalizarTexto, padraoLike, todos, transacao, um } from '../db/conexao'
import { ErroApp, naoEncontrado } from '../erros'
import { ALVO_ROTEIRO, definirPalavrasChave, separarPalavras } from './palavrasChave'
import { resumirAlteracoes } from '@shared/diff'
import { invalidarAprovacoesSeAlterado } from '../revisao/aprovacoes'
import type { FiltroRoteiros } from '@shared/schemas'
import type { StatusRoteiro, TipoVideo } from '@shared/dominio'
import type { Comentario, Fonte, RoteiroCompleto, RoteiroResumo, Versao, VersaoResumo } from '@shared/tipos'

const COLUNAS_RESUMO = `
  r.id, r.projeto_id AS projetoId, p.nome AS projetoNome, r.titulo, r.tema, r.tipo_video AS tipoVideo,
  r.status, r.data_prevista AS dataPrevista, r.versao_atual AS versaoAtual, r.arquivado_em AS arquivadoEm,
  r.criado_em AS criadoEm, r.atualizado_em AS atualizadoEm,
  (SELECT group_concat(k.termo, char(31)) FROM roteiro_palavras_chave rk
     JOIN palavras_chave k ON k.id = rk.palavra_chave_id WHERE rk.roteiro_id = r.id) AS palavras`

type LinhaResumo = Omit<RoteiroResumo, 'palavrasChave'> & { palavras: string | null }

function paraResumo({ palavras, ...r }: LinhaResumo): RoteiroResumo {
  return { ...r, palavrasChave: separarPalavras(palavras) }
}

// Colunas e ordenações vêm desta lista fixa; nada da interface é concatenado ao SQL.
const ORDEM_SQL: Record<FiltroRoteiros['ordem'], string> = {
  atualizado_desc: 'r.atualizado_em DESC',
  criado_desc: 'r.criado_em DESC',
  titulo_asc: 'r.titulo COLLATE NOCASE ASC',
  prevista_asc: 'r.data_prevista IS NULL, r.data_prevista ASC',
  status_asc: 'r.status ASC, r.atualizado_em DESC'
}
const CAMPO_DATA_SQL: Record<FiltroRoteiros['campoData'], string> = {
  atualizado: 'substr(r.atualizado_em, 1, 10)',
  criado: 'substr(r.criado_em, 1, 10)',
  prevista: 'r.data_prevista'
}

export function buscarRoteiros(db: Banco, f: FiltroRoteiros): RoteiroResumo[] {
  const where: string[] = []
  const p: Parametros = { limite: f.limite }
  if (f.texto) {
    p.like = padraoLike(normalizarTexto(f.texto))
    where.push(`(normalizar(r.titulo) LIKE :like ESCAPE '\\' OR normalizar(r.tema) LIKE :like ESCAPE '\\'
      OR normalizar(r.notas) LIKE :like ESCAPE '\\'
      OR EXISTS (SELECT 1 FROM roteiro_versoes v WHERE v.roteiro_id = r.id AND v.numero = r.versao_atual
                 AND normalizar(v.conteudo) LIKE :like ESCAPE '\\')
      OR EXISTS (SELECT 1 FROM roteiro_palavras_chave rk JOIN palavras_chave k ON k.id = rk.palavra_chave_id
                 WHERE rk.roteiro_id = r.id AND normalizar(k.termo) LIKE :like ESCAPE '\\'))`)
  }
  if (f.palavraChave) {
    p.palavra = normalizarTexto(f.palavraChave)
    where.push(`EXISTS (SELECT 1 FROM roteiro_palavras_chave rk JOIN palavras_chave k ON k.id = rk.palavra_chave_id
                WHERE rk.roteiro_id = r.id AND normalizar(k.termo) = :palavra)`)
  }
  if (f.status) {
    p.status = f.status
    where.push('r.status = :status')
  }
  if (f.tipoVideo) {
    p.tipo = f.tipoVideo
    where.push('r.tipo_video = :tipo')
  }
  if (f.projetoId) {
    p.projeto = f.projetoId
    where.push('r.projeto_id = :projeto')
  }
  if (f.dataDe) {
    p.dataDe = f.dataDe
    where.push(`${CAMPO_DATA_SQL[f.campoData]} >= :dataDe`)
  }
  if (f.dataAte) {
    p.dataAte = f.dataAte
    where.push(`${CAMPO_DATA_SQL[f.campoData]} <= :dataAte`)
  }
  if (f.situacao === 'ativos') where.push('r.arquivado_em IS NULL')
  if (f.situacao === 'arquivados') where.push('r.arquivado_em IS NOT NULL')

  const sql = `SELECT ${COLUNAS_RESUMO} FROM roteiros r JOIN projetos p ON p.id = r.projeto_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY ${ORDEM_SQL[f.ordem]} LIMIT :limite`
  return todos<LinhaResumo>(db, sql, p).map(paraResumo)
}

export function listarPorStatus(db: Banco, status: StatusRoteiro, limite: number): RoteiroResumo[] {
  return todos<LinhaResumo>(
    db,
    `SELECT ${COLUNAS_RESUMO} FROM roteiros r JOIN projetos p ON p.id = r.projeto_id
     WHERE r.status = :status AND r.arquivado_em IS NULL ORDER BY r.atualizado_em ASC LIMIT :limite`,
    { status, limite }
  ).map(paraResumo)
}

export function obterRoteiro(db: Banco, id: number): RoteiroCompleto {
  const r = um<LinhaResumo & { pautaId: number | null; notas: string; conteudo: string }>(
    db,
    `SELECT ${COLUNAS_RESUMO}, r.pauta_id AS pautaId, r.notas, v.conteudo
     FROM roteiros r JOIN projetos p ON p.id = r.projeto_id
     JOIN roteiro_versoes v ON v.roteiro_id = r.id AND v.numero = r.versao_atual
     WHERE r.id = :id`,
    { id }
  )
  if (!r) throw naoEncontrado('Roteiro')
  const fontes = todos<Fonte>(
    db,
    `SELECT f.id, f.titulo, f.url, f.autor, f.tipo_fonte AS tipoFonte, f.publicada_em AS publicadaEm,
       f.acessada_em AS acessadaEm, f.notas
     FROM roteiro_fontes rf JOIN fontes f ON f.id = rf.fonte_id WHERE rf.roteiro_id = :id ORDER BY f.id`,
    { id }
  )
  const comentarios = todos<Comentario>(
    db,
    `SELECT id, versao_numero AS versaoNumero, texto, resolvido_em AS resolvidoEm, criado_em AS criadoEm
     FROM comentarios_revisao WHERE roteiro_id = :id ORDER BY id`,
    { id }
  )
  return { ...paraResumo(r), pautaId: r.pautaId, notas: r.notas, conteudo: r.conteudo, fontes, comentarios }
}

interface DadosRoteiro {
  titulo: string
  tema: string
  tipoVideo: TipoVideo
  notas: string
  dataPrevista: string | null
  palavrasChave: string[]
  conteudo: string
}

export function criarRoteiro(db: Banco, d: DadosRoteiro & { projetoId: number; pautaId: number | null }): RoteiroCompleto {
  return transacao(db, () => {
    if (d.pautaId !== null) {
      const p = um<{ projetoId: number }>(db, 'SELECT projeto_id AS projetoId FROM pautas WHERE id = :id', { id: d.pautaId })
      if (!p) throw naoEncontrado('Pauta')
      if (p.projetoId !== d.projetoId) throw new ErroApp('projeto_diferente', 'A pauta pertence a outro projeto.')
    }
    const agora = agoraIso()
    const { id } = executar(
      db,
      `INSERT INTO roteiros (projeto_id, pauta_id, titulo, tema, tipo_video, notas, data_prevista, criado_em, atualizado_em)
       VALUES (:projetoId, :pautaId, :titulo, :tema, :tipoVideo, :notas, :dataPrevista, :agora, :agora)`,
      {
        projetoId: d.projetoId,
        pautaId: d.pautaId,
        titulo: d.titulo,
        tema: d.tema,
        tipoVideo: d.tipoVideo,
        notas: d.notas,
        dataPrevista: d.dataPrevista,
        agora
      }
    )
    inserirVersao(db, id, 1, d.titulo, d.conteudo, 'Versão inicial')
    definirPalavrasChave(db, ALVO_ROTEIRO, id, d.palavrasChave)
    return obterRoteiro(db, id)
  })
}

function inserirVersao(db: Banco, roteiroId: number, numero: number, titulo: string, conteudo: string, resumo: string): void {
  executar(
    db,
    `INSERT INTO roteiro_versoes (roteiro_id, numero, titulo, conteudo, resumo_alteracoes, criado_em)
     VALUES (:roteiroId, :numero, :titulo, :conteudo, :resumo, :agora)`,
    { roteiroId, numero, titulo, conteudo, resumo, agora: agoraIso() }
  )
}

/** Salva o roteiro. Mudança de título ou texto cria nova versão; a anterior é preservada. */
export function salvarRoteiro(db: Banco, d: DadosRoteiro & { id: number; versaoBase: number }): RoteiroCompleto {
  return transacao(db, () => {
    const atual = obterRoteiro(db, d.id)
    if (atual.versaoAtual !== d.versaoBase) {
      throw new ErroApp(
        'conflito_versao',
        `Este roteiro foi alterado em outro lugar (agora está na versão ${atual.versaoAtual}). Reabra-o antes de salvar.`
      )
    }
    let versao = atual.versaoAtual
    if (atual.titulo !== d.titulo || atual.conteudo !== d.conteudo) {
      versao += 1
      inserirVersao(db, d.id, versao, d.titulo, d.conteudo, resumirAlteracoes(atual, d))
    }
    executar(
      db,
      `UPDATE roteiros SET titulo = :titulo, tema = :tema, tipo_video = :tipoVideo, notas = :notas,
         data_prevista = :dataPrevista, versao_atual = :versao, atualizado_em = :agora WHERE id = :id`,
      {
        id: d.id,
        titulo: d.titulo,
        tema: d.tema,
        tipoVideo: d.tipoVideo,
        notas: d.notas,
        dataPrevista: d.dataPrevista,
        versao,
        agora: agoraIso()
      }
    )
    definirPalavrasChave(db, ALVO_ROTEIRO, d.id, d.palavrasChave)
    if (versao !== atual.versaoAtual) invalidarAprovacoesSeAlterado(db, d.id)
    return obterRoteiro(db, d.id)
  })
}

export function renomearRoteiro(db: Banco, id: number, titulo: string): RoteiroCompleto {
  const r = obterRoteiro(db, id)
  return salvarRoteiro(db, { ...r, titulo, versaoBase: r.versaoAtual })
}

export function duplicarRoteiro(db: Banco, id: number): RoteiroCompleto {
  return transacao(db, () => {
    const o = obterRoteiro(db, id)
    const copia = criarRoteiro(db, { ...o, titulo: `Cópia de ${o.titulo}`.slice(0, 200), pautaId: o.pautaId })
    executar(db, 'UPDATE roteiro_versoes SET resumo_alteracoes = :resumo WHERE roteiro_id = :id AND numero = 1', {
      id: copia.id,
      resumo: `Duplicado do roteiro nº ${o.id} (versão ${o.versaoAtual})`
    })
    executar(db, 'INSERT INTO roteiro_fontes (roteiro_id, fonte_id) SELECT :novo, fonte_id FROM roteiro_fontes WHERE roteiro_id = :id', {
      novo: copia.id,
      id
    })
    return obterRoteiro(db, copia.id)
  })
}

export function arquivarRoteiro(db: Banco, id: number, arquivar: boolean): void {
  const r = executar(db, 'UPDATE roteiros SET arquivado_em = :quando, atualizado_em = :agora WHERE id = :id', {
    id,
    quando: arquivar ? agoraIso() : null,
    agora: agoraIso()
  })
  if (r.changes === 0) throw naoEncontrado('Roteiro')
}

/** Exclusão definitiva (a interface pede confirmação). Versões, vínculos e comentários saem junto. */
export function excluirRoteiro(db: Banco, id: number): void {
  const r = executar(db, 'DELETE FROM roteiros WHERE id = :id', { id })
  if (r.changes === 0) throw naoEncontrado('Roteiro')
}

export function alterarStatus(db: Banco, id: number, status: StatusRoteiro): RoteiroCompleto {
  const r = executar(db, 'UPDATE roteiros SET status = :status, atualizado_em = :agora WHERE id = :id', {
    id,
    status,
    agora: agoraIso()
  })
  if (r.changes === 0) throw naoEncontrado('Roteiro')
  return obterRoteiro(db, id)
}

export function listarVersoes(db: Banco, roteiroId: number): VersaoResumo[] {
  return todos<VersaoResumo>(
    db,
    `SELECT numero, titulo, resumo_alteracoes AS resumoAlteracoes, criado_em AS criadoEm
     FROM roteiro_versoes WHERE roteiro_id = :roteiroId ORDER BY numero DESC`,
    { roteiroId }
  )
}

export function obterVersao(db: Banco, roteiroId: number, numero: number): Versao {
  const v = um<Versao>(
    db,
    `SELECT numero, titulo, conteudo, resumo_alteracoes AS resumoAlteracoes, criado_em AS criadoEm
     FROM roteiro_versoes WHERE roteiro_id = :roteiroId AND numero = :numero`,
    { roteiroId, numero }
  )
  if (!v) throw naoEncontrado('Versão')
  return v
}

export function adicionarFonte(
  db: Banco,
  d: { roteiroId: number; titulo: string; url: string; autor: string; tipoFonte: string; publicadaEm: string | null; acessadaEm: string; notas: string }
): RoteiroCompleto {
  return transacao(db, () => {
    const r = obterRoteiro(db, d.roteiroId)
    const { id } = executar(
      db,
      `INSERT INTO fontes (projeto_id, titulo, url, autor, tipo_fonte, publicada_em, acessada_em, notas, criado_em)
       VALUES (:projetoId, :titulo, :url, :autor, :tipoFonte, :publicadaEm, :acessadaEm, :notas, :agora)`,
      {
        projetoId: r.projetoId,
        titulo: d.titulo,
        url: d.url,
        autor: d.autor,
        tipoFonte: d.tipoFonte,
        publicadaEm: d.publicadaEm,
        acessadaEm: d.acessadaEm,
        notas: d.notas,
        agora: agoraIso()
      }
    )
    executar(db, 'INSERT INTO roteiro_fontes (roteiro_id, fonte_id) VALUES (:r, :f)', { r: d.roteiroId, f: id })
    return obterRoteiro(db, d.roteiroId)
  })
}

/** Remove apenas o vínculo; a fonte continua registrada no projeto. */
export function removerFonte(db: Banco, roteiroId: number, fonteId: number): RoteiroCompleto {
  executar(db, 'DELETE FROM roteiro_fontes WHERE roteiro_id = :r AND fonte_id = :f', { r: roteiroId, f: fonteId })
  return obterRoteiro(db, roteiroId)
}

export function comentar(db: Banco, roteiroId: number, texto: string): RoteiroCompleto {
  const r = obterRoteiro(db, roteiroId)
  executar(
    db,
    'INSERT INTO comentarios_revisao (roteiro_id, versao_numero, texto, criado_em) VALUES (:r, :v, :texto, :agora)',
    { r: roteiroId, v: r.versaoAtual, texto, agora: agoraIso() }
  )
  return obterRoteiro(db, roteiroId)
}

export function resolverComentario(db: Banco, id: number): void {
  const r = executar(db, 'UPDATE comentarios_revisao SET resolvido_em = :agora WHERE id = :id AND resolvido_em IS NULL', {
    id,
    agora: agoraIso()
  })
  if (r.changes === 0) throw naoEncontrado('Comentário pendente')
}

