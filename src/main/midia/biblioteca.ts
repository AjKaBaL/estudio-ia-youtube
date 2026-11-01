import { createHash } from 'node:crypto'
import { copyFileSync, createReadStream, existsSync, mkdirSync, openSync, readSync, closeSync, statSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { type Banco, agoraIso, executar, todos, um } from '../db/conexao'
import { ErroApp, naoEncontrado } from '../erros'
import { alertasLicenca, type CategoriaMidia, type SituacaoLicenca } from '@shared/midia'
import type { RecursoMidia } from '@shared/tipos'

/**
 * Biblioteca de mídia (Etapa 11). Arquivos são copiados para a pasta do aplicativo e
 * nunca executados. O tipo é conferido pelo conteúdo do arquivo (assinatura), não só pela extensão.
 */

interface TipoAceito {
  categoria: CategoriaMidia
  mime: string
  limite: number
  confere: (cabecalho: Buffer) => boolean
}

const MB = 1024 * 1024
const ascii = (b: Buffer, ini: number, fim: number): string => b.subarray(ini, fim).toString('latin1')
const ftyp = (b: Buffer): boolean => ascii(b, 4, 8) === 'ftyp'
const ebml = (b: Buffer): boolean => b.readUInt32BE(0) === 0x1a45dfa3
const textoUtf8 = (b: Buffer): boolean => !b.subarray(0, 512).includes(0)

export const TIPOS_ACEITOS: Record<string, TipoAceito> = {
  '.mp4': { categoria: 'video', mime: 'video/mp4', limite: 8192 * MB, confere: ftyp },
  '.mov': { categoria: 'video', mime: 'video/quicktime', limite: 8192 * MB, confere: ftyp },
  '.m4v': { categoria: 'video', mime: 'video/mp4', limite: 8192 * MB, confere: ftyp },
  '.webm': { categoria: 'video', mime: 'video/webm', limite: 8192 * MB, confere: ebml },
  '.mkv': { categoria: 'video', mime: 'video/x-matroska', limite: 8192 * MB, confere: ebml },
  '.mp3': { categoria: 'audio', mime: 'audio/mpeg', limite: 1024 * MB, confere: (b) => ascii(b, 0, 3) === 'ID3' || (b[0] === 0xff && (b[1]! & 0xe0) === 0xe0) },
  '.wav': { categoria: 'audio', mime: 'audio/wav', limite: 2048 * MB, confere: (b) => ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WAVE' },
  '.m4a': { categoria: 'audio', mime: 'audio/mp4', limite: 1024 * MB, confere: ftyp },
  '.ogg': { categoria: 'audio', mime: 'audio/ogg', limite: 1024 * MB, confere: (b) => ascii(b, 0, 4) === 'OggS' },
  '.png': { categoria: 'imagem', mime: 'image/png', limite: 50 * MB, confere: (b) => b.readUInt32BE(0) === 0x89504e47 },
  '.jpg': { categoria: 'imagem', mime: 'image/jpeg', limite: 50 * MB, confere: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  '.jpeg': { categoria: 'imagem', mime: 'image/jpeg', limite: 50 * MB, confere: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  '.webp': { categoria: 'imagem', mime: 'image/webp', limite: 50 * MB, confere: (b) => ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP' },
  '.gif': { categoria: 'imagem', mime: 'image/gif', limite: 50 * MB, confere: (b) => ascii(b, 0, 4) === 'GIF8' },
  '.srt': { categoria: 'legenda', mime: 'application/x-subrip', limite: 5 * MB, confere: textoUtf8 },
  '.vtt': { categoria: 'legenda', mime: 'text/vtt', limite: 5 * MB, confere: (b) => textoUtf8(b) && ascii(b, b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf ? 3 : 0, 12).startsWith('WEBVTT') }
}

function lerCabecalho(caminho: string): Buffer {
  const fd = openSync(caminho, 'r')
  try {
    const b = Buffer.alloc(512)
    const n = readSync(fd, b, 0, 512, 0)
    return b.subarray(0, n)
  } finally {
    closeSync(fd)
  }
}

/** Confere tipo, tamanho e assinatura. Executáveis são recusados mesmo com extensão de mídia. */
export function validarArquivo(caminho: string): TipoAceito & { tamanho: number } {
  const ext = extname(caminho).toLowerCase()
  const tipo = TIPOS_ACEITOS[ext]
  if (!tipo) throw new ErroApp('tipo_midia', `Formato não aceito (${ext || 'sem extensão'}). Aceitos: ${Object.keys(TIPOS_ACEITOS).join(', ')}.`)
  const st = statSync(caminho)
  if (!st.isFile()) throw new ErroApp('tipo_midia', 'Não é um arquivo.')
  if (st.size === 0) throw new ErroApp('tipo_midia', 'Arquivo vazio.')
  if (st.size > tipo.limite) throw new ErroApp('tipo_midia', `Arquivo maior que o limite para ${tipo.categoria} (${Math.round(tipo.limite / MB)} MB).`)
  const cab = lerCabecalho(caminho)
  if (cab.length >= 2 && cab[0] === 0x4d && cab[1] === 0x5a) throw new ErroApp('tipo_midia', 'O arquivo é um programa (executável) e foi recusado.')
  if (cab.length < 12 && tipo.categoria !== 'legenda') throw new ErroApp('tipo_midia', 'Arquivo muito pequeno ou corrompido.')
  if (!tipo.confere(cab)) throw new ErroApp('tipo_midia', `O conteúdo não corresponde à extensão ${ext}. O arquivo pode estar corrompido ou ser de outro tipo.`)
  return { ...tipo, tamanho: st.size }
}

function hashArquivo(caminho: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256')
    createReadStream(caminho)
      .on('data', (d) => h.update(d))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', reject)
  })
}

type Linha = Omit<RecursoMidia, 'arquivoExiste' | 'alertas'>

const SELECT = `
  SELECT id, projeto_id AS projetoId, roteiro_id AS roteiroId, cena, tipo AS categoria, caminho, nome_original AS nomeOriginal,
    tamanho_bytes AS tamanhoBytes, sha256, mime, origem, autor, url_origem AS urlOrigem, licenca, situacao_licenca AS situacaoLicenca,
    obtido_em AS obtidoEm, duracao_seg AS duracaoSeg, largura, altura, criado_em AS criadoEm
  FROM recursos_midia`

function completar(l: Linha): RecursoMidia {
  return { ...l, arquivoExiste: existsSync(l.caminho), alertas: alertasLicenca(l) }
}

export function listarMidia(db: Banco, f: { projetoId: number; roteiroId: number | null }): RecursoMidia[] {
  return todos<Linha>(db, `${SELECT} WHERE projeto_id = :p ${f.roteiroId ? 'AND (roteiro_id = :r OR roteiro_id IS NULL)' : ''} ORDER BY id DESC`, {
    p: f.projetoId,
    ...(f.roteiroId ? { r: f.roteiroId } : {})
  }).map(completar)
}

export function obterMidia(db: Banco, id: number): RecursoMidia {
  const l = um<Linha>(db, `${SELECT} WHERE id = :id`, { id })
  if (!l) throw naoEncontrado('Mídia')
  return completar(l)
}

/** Copia o arquivo para a pasta do projeto, com nome pelo hash; recusa duplicata no mesmo projeto. */
export async function importarMidia(
  db: Banco,
  pastaMidia: string,
  d: { projetoId: number; roteiroId: number | null; caminho: string; situacaoLicenca: SituacaoLicenca }
): Promise<RecursoMidia> {
  const tipo = validarArquivo(d.caminho)
  const sha = await hashArquivo(d.caminho)
  const existente = um<{ id: number }>(db, 'SELECT id FROM recursos_midia WHERE projeto_id = :p AND sha256 = :s', { p: d.projetoId, s: sha })
  if (existente) throw new ErroApp('duplicado', `Este arquivo já está na biblioteca (mídia nº ${existente.id}).`)
  const pasta = join(pastaMidia, String(d.projetoId))
  mkdirSync(pasta, { recursive: true })
  const destino = join(pasta, `${sha}${extname(d.caminho).toLowerCase()}`)
  if (!existsSync(destino)) copyFileSync(d.caminho, destino)
  const { id } = executar(
    db,
    `INSERT INTO recursos_midia (projeto_id, roteiro_id, tipo, caminho, nome_original, tamanho_bytes, sha256, mime, situacao_licenca, obtido_em, criado_em)
     VALUES (:p, :r, :tipo, :caminho, :nome, :tam, :sha, :mime, :sit, :t, :t)`,
    { p: d.projetoId, r: d.roteiroId, tipo: tipo.categoria, caminho: destino, nome: basename(d.caminho).slice(0, 255), tam: tipo.tamanho, sha, mime: tipo.mime, sit: d.situacaoLicenca, t: agoraIso() }
  )
  return obterMidia(db, id)
}

export function atualizarMidia(
  db: Banco,
  d: { id: number; roteiroId: number | null; cena: string; origem: string; autor: string; urlOrigem: string; licenca: string; situacaoLicenca: SituacaoLicenca; obtidoEm: string | null }
): RecursoMidia {
  if (d.roteiroId !== null) {
    const rot = um<{ p: number }>(db, 'SELECT projeto_id AS p FROM roteiros WHERE id = :id', { id: d.roteiroId })
    if (!rot || rot.p !== obterMidia(db, d.id).projetoId) throw new ErroApp('projeto_diferente', 'O roteiro pertence a outro projeto.')
  }
  const r = executar(
    db,
    `UPDATE recursos_midia SET roteiro_id = :r, cena = :cena, origem = :origem, autor = :autor, url_origem = :url, licenca = :licenca,
       situacao_licenca = :sit, obtido_em = :obtido WHERE id = :id`,
    { id: d.id, r: d.roteiroId, cena: d.cena, origem: d.origem, autor: d.autor, url: d.urlOrigem, licenca: d.licenca, sit: d.situacaoLicenca, obtido: d.obtidoEm }
  )
  if (r.changes === 0) throw naoEncontrado('Mídia')
  return obterMidia(db, d.id)
}

/** Remove só o registro se a mídia não estiver em uso em nenhum projeto de edição. O arquivo copiado é preservado. */
export function removerMidia(db: Banco, id: number): void {
  const usos = todos<{ estado: string; nome: string }>(db, 'SELECT estado, nome FROM projetos_edicao')
  const emUso = usos.filter((u) => (JSON.parse(u.estado) as { clips: { recursoId: number | null }[] }).clips.some((c) => c.recursoId === id))
  if (emUso.length) throw new ErroApp('midia_em_uso', `A mídia está em uso em: ${emUso.map((u) => u.nome).join(', ')}.`)
  if (executar(db, 'DELETE FROM recursos_midia WHERE id = :id', { id }).changes === 0) throw naoEncontrado('Mídia')
}

/** Confere a biblioteca: arquivos ausentes, duplicados entre projetos e licenças não registradas. */
export function verificarBiblioteca(db: Banco, projetoId: number): { ausentes: number[]; duplicados: number[][]; semLicenca: number[]; total: number } {
  const lista = listarMidia(db, { projetoId, roteiroId: null })
  const porHash = new Map<string, number[]>()
  for (const r of todos<{ id: number; sha256: string }>(db, 'SELECT id, sha256 FROM recursos_midia WHERE sha256 IS NOT NULL')) {
    porHash.set(r.sha256, [...(porHash.get(r.sha256) ?? []), r.id])
  }
  return {
    total: lista.length,
    ausentes: lista.filter((r) => !r.arquivoExiste).map((r) => r.id),
    duplicados: [...porHash.values()].filter((ids) => ids.length > 1 && ids.some((i) => lista.some((r) => r.id === i))),
    semLicenca: lista.filter((r) => r.alertas.length > 0 && r.situacaoLicenca !== 'gerado_ia').map((r) => r.id)
  }
}

/**
 * Registra um arquivo produzido pelo app (voz sintética, imagem baixada ou gerada) com a proveniência completa.
 * Se o mesmo arquivo já estiver na biblioteca, reaproveita o registro (sem duplicar).
 */
export async function registrarArquivoGerado(
  db: Banco,
  pastaMidia: string,
  caminho: string,
  m: { projetoId: number; roteiroId: number | null; cena: string; origem: string; autor: string; urlOrigem: string; licenca: string; situacaoLicenca: SituacaoLicenca; duracaoSeg?: number | null }
): Promise<RecursoMidia> {
  let id: number
  try {
    id = (await importarMidia(db, pastaMidia, { projetoId: m.projetoId, roteiroId: m.roteiroId, caminho, situacaoLicenca: m.situacaoLicenca })).id
  } catch (e) {
    const dup = e instanceof ErroApp && e.codigo === 'duplicado' ? Number(/nº (\d+)/.exec(e.message)?.[1]) : NaN
    if (!Number.isFinite(dup)) throw e
    id = dup
  }
  executar(
    db,
    `UPDATE recursos_midia SET cena = :cena, origem = :origem, autor = :autor, url_origem = :url, licenca = :licenca, situacao_licenca = :sit,
       duracao_seg = COALESCE(:dur, duracao_seg) WHERE id = :id`,
    { id, cena: m.cena.slice(0, 200), origem: m.origem.slice(0, 300), autor: m.autor.slice(0, 300), url: m.urlOrigem.slice(0, 2000), licenca: m.licenca.slice(0, 300), sit: m.situacaoLicenca, dur: m.duracaoSeg ?? null }
  )
  return obterMidia(db, id)
}
