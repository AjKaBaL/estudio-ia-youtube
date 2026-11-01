import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { type Banco, agoraIso, executar, um } from '../db/conexao'
import { ErroApp, naoEncontrado } from '../erros'
import { CORES_MINIATURA, FONTES_MINIATURA, MINIATURA, quebrarLinhas, tamanhoFonte, type FonteMiniatura, type OpcoesMiniatura } from '@shared/miniatura'
import type { QuadroCandidato, RecursoMidia } from '@shared/tipos'
import { importarMidia, obterMidia } from './biblioteca'
import { executarFerramenta, type Ferramentas } from './ffmpeg'
import { obterRenderizacao } from './producao'
import { obterEdicao } from './edicao'

/**
 * Criação de miniaturas (Etapa: publicação). Mesmas regras do restante da mídia:
 * argumentos em lista, sem shell; textos vão para arquivos (textfile) e a fonte é copiada
 * para a pasta de trabalho, assim nenhum texto do usuário entra no filtro do FFmpeg.
 */

export type FonteImagem = { tipo: 'quadro'; renderizacaoId: number; tempo: number } | { tipo: 'imagem'; recursoId: number }

const num = (n: number): string => (Math.round(n * 1000) / 1000).toString()

/** Procura o arquivo da fonte nas fontes do Windows; cai para outra fonte instalada se faltar. */
export function localizarFonte(fonte: FonteMiniatura, pastaFontes = join(process.env.WINDIR ?? 'C:\\Windows', 'Fonts')): string {
  const ordem = [fonte, ...(Object.keys(FONTES_MINIATURA) as FonteMiniatura[]).filter((f) => f !== fonte)]
  for (const f of ordem) {
    for (const arq of FONTES_MINIATURA[f].arquivos) {
      const c = join(pastaFontes, arq)
      if (existsSync(c)) return c
    }
  }
  throw new ErroApp('sem_fonte', 'Nenhuma fonte compatível foi encontrada em C:\\Windows\\Fonts.')
}

/** Filtro de vídeo da miniatura. Só números e nomes fixos de arquivo (texto.txt, selo.txt, fonte.ttf). */
export function filtroMiniatura(o: OpcoesMiniatura, linhas: string[], temSelo: boolean): string {
  const W = MINIATURA.largura
  const H = MINIATURA.altura
  const cor = `0x${CORES_MINIATURA[o.cor].hex}`
  const fs = tamanhoFonte(o.modelo, linhas, o.fonte)
  const texto = `drawtext=fontfile=fonte.ttf:textfile=texto.txt:expansion=none:fontcolor=${cor}:fontsize=${fs}:line_spacing=${Math.round(fs * 0.12)}`
  const partes = [`scale=${W}:${H}:force_original_aspect_ratio=increase:flags=lanczos`, `crop=${W}:${H}`, 'setsar=1']
  if (o.modelo === 'faixa') {
    partes.push('drawbox=x=0:y=ih*0.6:w=iw:h=ih*0.4:color=black@0.62:t=fill')
    partes.push(`${texto}:borderw=5:bordercolor=black:x=56:y=h*0.6+(h*0.4-text_h)/2`)
  } else if (o.modelo === 'lateral') {
    partes.push('drawbox=x=0:y=0:w=iw*0.58:h=ih:color=black@0.58:t=fill')
    partes.push(`${texto}:borderw=4:bordercolor=black:x=56:y=(h-text_h)/2`)
  } else {
    partes.push(`${texto}:borderw=9:bordercolor=black:shadowx=6:shadowy=6:shadowcolor=black@0.6:x=(w-text_w)/2:y=(h-text_h)/2`)
  }
  if (temSelo) partes.push('drawtext=fontfile=fonte.ttf:textfile=selo.txt:expansion=none:fontcolor=white:fontsize=52:box=1:boxcolor=0xE00000@0.95:boxborderw=16:x=56:y=48')
  return partes.join(',')
}

function caminhoDaFonte(db: Banco, f: FonteImagem): { caminho: string; tempo: number | null; projetoId: number; roteiroId: number | null; descricao: string } {
  if (f.tipo === 'imagem') {
    const m = obterMidia(db, f.recursoId)
    if (m.categoria !== 'imagem' && m.categoria !== 'video') throw new ErroApp('validacao', 'Escolha uma imagem ou um vídeo da biblioteca.')
    if (!existsSync(m.caminho)) throw new ErroApp('midia_ausente', 'O arquivo desta mídia não foi encontrado.')
    return { caminho: m.caminho, tempo: m.categoria === 'video' ? 1 : null, projetoId: m.projetoId, roteiroId: m.roteiroId, descricao: `mídia nº ${m.id} (${m.nomeOriginal})` }
  }
  const r = obterRenderizacao(db, f.renderizacaoId)
  if (r.status !== 'concluida' || !existsSync(r.arquivo)) throw new ErroApp('render_incompleta', 'Use uma renderização concluída.')
  const ed = um<{ roteiroId: number; projetoId: number }>(
    db,
    'SELECT e.roteiro_id AS roteiroId, r.projeto_id AS projetoId FROM projetos_edicao e JOIN roteiros r ON r.id = e.roteiro_id WHERE e.id = :id',
    { id: r.edicaoId }
  )
  if (!ed) throw naoEncontrado('Projeto de edição')
  const limpo = quadroLimpo(db, r.edicaoId, r.arquivo, f.tempo)
  return { ...limpo, projetoId: ed.projetoId, roteiroId: ed.roteiroId, descricao: `quadro em ${num(f.tempo)} s da renderização nº ${r.id}` }
}

/**
 * Quadro sem legendas nem textos: usa a mídia original da cena naquele instante (vídeo no ponto certo ou imagem).
 * Se não houver mídia visual ali (ou o arquivo sumiu), usa o vídeo renderizado.
 */
export function quadroLimpo(db: Banco, edicaoId: number, arquivoRender: string, tempo: number): { caminho: string; tempo: number | null } {
  const ed = obterEdicao(db, edicaoId)
  const clip = ed.estado.clips.find((c) => c.faixa === 'video' && c.recursoId !== null && tempo >= c.inicio && tempo < c.inicio + c.duracao)
  const m = clip ? um<{ caminho: string; tipo: string }>(db, 'SELECT caminho, tipo FROM recursos_midia WHERE id = :id', { id: clip.recursoId }) : undefined
  if (clip && m && existsSync(m.caminho)) {
    if (m.tipo === 'imagem') return { caminho: m.caminho, tempo: null }
    if (m.tipo === 'video') return { caminho: m.caminho, tempo: Math.max(0, clip.corteInicio + (tempo - clip.inicio)) }
  }
  return { caminho: arquivoRender, tempo: Math.max(0, tempo) }
}

/** Gera a miniatura na pasta indicada e devolve o caminho do JPG (até 2 MB, como o YouTube exige). */
export async function gerarArquivoMiniatura(db: Banco, f: Ferramentas, fonte: FonteImagem, o: OpcoesMiniatura, pasta: string): Promise<{ arquivo: string; bytes: number; origem: ReturnType<typeof caminhoDaFonte> }> {
  const origem = caminhoDaFonte(db, fonte)
  rmSync(pasta, { recursive: true, force: true })
  mkdirSync(pasta, { recursive: true })
  const { linhas } = quebrarLinhas(o.texto, o.modelo, o.maiusculas)
  const selo = o.selo.trim().slice(0, 14)
  writeFileSync(join(pasta, 'texto.txt'), linhas.join('\n') || ' ', 'utf8')
  if (selo) writeFileSync(join(pasta, 'selo.txt'), o.maiusculas ? selo.toLocaleUpperCase('pt-BR') : selo, 'utf8')
  copyFileSync(localizarFonte(o.fonte), join(pasta, 'fonte.ttf'))
  const filtro = filtroMiniatura(o, linhas, Boolean(selo))
  for (const q of [3, 6, 10]) {
    const args = ['-hide_banner', '-nostdin', '-y', ...(origem.tempo !== null ? ['-ss', num(origem.tempo)] : []), '-i', origem.caminho, '-frames:v', '1', '-vf', filtro, '-q:v', String(q), 'miniatura.jpg']
    const r = await executarFerramenta(f.ffmpeg, args, { cwd: pasta, tempoLimiteMs: 60_000 })
    if (r.codigo !== 0) throw new ErroApp('miniatura_falhou', `O FFmpeg não conseguiu gerar a miniatura: ${r.stderr.split(/\r?\n/).filter(Boolean).at(-1) ?? 'erro desconhecido'}`)
    const arquivo = join(pasta, 'miniatura.jpg')
    const bytes = statSync(arquivo).size
    if (bytes <= MINIATURA.maxBytes) return { arquivo, bytes, origem }
  }
  throw new ErroApp('miniatura_grande', 'A miniatura ficou maior que 2 MB mesmo com compressão. Tente outra imagem.')
}

/** Prévia em data URL (não entra na biblioteca). */
export async function previaMiniatura(db: Banco, f: Ferramentas, fonte: FonteImagem, o: OpcoesMiniatura, pastaTrabalho: string): Promise<{ dataUrl: string; bytes: number; linhasCortadas: boolean }> {
  const g = await gerarArquivoMiniatura(db, f, fonte, o, join(pastaTrabalho, 'previa'))
  return { dataUrl: `data:image/jpeg;base64,${readFileSync(g.arquivo).toString('base64')}`, bytes: g.bytes, linhasCortadas: quebrarLinhas(o.texto, o.modelo, o.maiusculas).cortado }
}

/** Gera a miniatura definitiva, guarda na biblioteca (origem registrada) e, se pedido, liga à publicação. */
export async function salvarMiniatura(
  db: Banco,
  f: Ferramentas,
  fonte: FonteImagem,
  o: OpcoesMiniatura,
  pastas: { trabalho: string; midia: string },
  publicacaoId: number | null
): Promise<RecursoMidia> {
  const g = await gerarArquivoMiniatura(db, f, fonte, o, join(pastas.trabalho, `final-${Date.now()}`))
  let recurso: RecursoMidia
  try {
    recurso = await importarMidia(db, pastas.midia, { projetoId: g.origem.projetoId, roteiroId: g.origem.roteiroId, caminho: g.arquivo, situacaoLicenca: 'criado_usuario' })
  } catch (e) {
    // A mesma miniatura já existe (mesmo conteúdo): reaproveita.
    const existente = e instanceof ErroApp && e.codigo === 'duplicado' ? Number(/nº (\d+)/.exec(e.message)?.[1]) : NaN
    if (!Number.isInteger(existente)) throw e
    recurso = obterMidia(db, existente)
  } finally {
    rmSync(dirname(g.arquivo), { recursive: true, force: true })
  }
  executar(db, "UPDATE recursos_midia SET cena = 'Miniatura', origem = :o, largura = 1280, altura = 720 WHERE id = :id", {
    id: recurso.id,
    o: `Miniatura gerada no app a partir de ${g.origem.descricao}. Confira a licença da imagem de origem.`.slice(0, 300)
  })
  if (publicacaoId !== null) definirMiniaturaPublicacao(db, publicacaoId, recurso.id)
  return obterMidia(db, recurso.id)
}

/** Troca a miniatura de uma publicação editável; desfaz a aprovação, como qualquer outra edição. */
export function definirMiniaturaPublicacao(db: Banco, publicacaoId: number, recursoId: number | null): void {
  const r = executar(
    db,
    `UPDATE publicacoes SET miniatura_recurso_id = :m, status = CASE WHEN status = 'aprovada' THEN 'rascunho' ELSE status END,
       aprovada_em = CASE WHEN status = 'aprovada' THEN NULL ELSE aprovada_em END, atualizado_em = :t
     WHERE id = :id AND status IN ('rascunho','aprovada','erro')`,
    { id: publicacaoId, m: recursoId, t: agoraIso() }
  )
  if (r.changes === 0) throw new ErroApp('publicacao_travada', 'Não é possível trocar a miniatura durante ou depois do envio.')
}

const PONTOS = [0.08, 0.24, 0.4, 0.56, 0.72, 0.88]

/**
 * Extrai 6 quadros pequenos do vídeo renderizado para escolher a miniatura. O sugerido é o de JPG maior:
 * mais detalhe e cor (evita quadros pretos, lisos ou de transição), uma regra simples e previsível.
 */
export async function quadrosCandidatos(db: Banco, f: Ferramentas, renderizacaoId: number): Promise<QuadroCandidato[]> {
  const r = obterRenderizacao(db, renderizacaoId)
  if (r.status !== 'concluida' || !existsSync(r.arquivo)) throw new ErroApp('render_incompleta', 'Use uma renderização concluída.')
  const conf = r.conferencia ? (JSON.parse(r.conferencia) as { duracao?: number | null }) : {}
  const duracao = conf.duracao ?? 0
  if (!duracao) throw new ErroApp('sem_duracao', 'A duração do vídeo não é conhecida; renderize de novo.')
  const pasta = pastaQuadros(r.arquivo)
  mkdirSync(pasta, { recursive: true })
  const lista: QuadroCandidato[] = []
  for (const [i, p] of PONTOS.entries()) {
    const arq = join(pasta, `q-${i}.jpg`)
    const tempo = Math.round(duracao * p * 100) / 100
    if (!existsSync(arq)) {
      // Mesmo quadro limpo que a miniatura final vai usar, recortado em 16:9.
      const q = quadroLimpo(db, r.edicaoId, r.arquivo, tempo)
      const vf = 'scale=384:216:force_original_aspect_ratio=increase,crop=384:216'
      await executarFerramenta(f.ffmpeg, ['-hide_banner', '-nostdin', '-y', ...(q.tempo !== null ? ['-ss', num(q.tempo)] : []), '-i', q.caminho, '-frames:v', '1', '-vf', vf, '-q:v', '4', arq], { tempoLimiteMs: 60_000 })
    }
    if (existsSync(arq)) lista.push({ indice: i, tempo, bytes: statSync(arq).size, sugerido: false })
  }
  const melhor = lista.reduce<QuadroCandidato | null>((m, q) => (!m || q.bytes > m.bytes ? q : m), null)
  if (melhor) melhor.sugerido = true
  return lista
}

export const pastaQuadros = (arquivoRender: string): string => join(dirname(arquivoRender), 'quadros')
