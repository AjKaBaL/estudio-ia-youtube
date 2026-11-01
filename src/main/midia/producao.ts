import { existsSync, mkdirSync, statSync, statfsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { type Banco, agoraIso, executar, todos, um } from '../db/conexao'
import { registrarEvento } from '../db/eventos'
import { ErroApp, naoEncontrado } from '../erros'
import { relatorio } from '../repositorios/dossie'
import { obterRoteiro } from '../repositorios/roteiros'
import { duracaoTotal, gerarSrt, intervaloCena, type EstadoEdicao } from '@shared/edicao'
import {
  OPCOES_RENDER_RECOMENDADAS,
  PREFERENCIA_RENDER_PADRAO,
  PRESETS_RENDER,
  estimarBytesRender,
  recomendarRender,
  type OpcoesRender,
  type PreferenciaRender,
  type PresetRender
} from '@shared/midia'
import { lerConfig } from '../repositorios/configuracoes'
import { avaliarQualidade, situacaoQualidade, type DadosQualidade, type Excecao, type ItemQualidade } from '@shared/qualidade'
import type { DadosRecomendacao, RelatorioQualidade, Renderizacao } from '@shared/tipos'
import { obterEdicao, corrigirEstado } from './edicao'
import { arquivosApresentador } from './apresentador'
import { ESTILO_VIDEO_PADRAO, preferenciaMidiaSchema } from '@shared/geracaoMidia'
import {
  argumentosRender,
  executarFerramenta,
  interpretarPretos,
  interpretarSilencios,
  interpretarSonda,
  lerProgresso,
  type Ferramentas,
  type EstiloRender,
  type RecursoParaRender
} from './ffmpeg'

/** Renderização com progresso/cancelamento e controle de qualidade (Etapas 11 e 12). */

const SELECT_RENDER = `
  SELECT id, edicao_id AS edicaoId, revisao, preset, opcoes, arquivo, status, progresso, mensagem, conferencia, iniciada_em AS iniciadaEm,
    concluida_em AS concluidaEm, criado_em AS criadoEm FROM renderizacoes`

export function listarRenderizacoes(db: Banco, edicaoId: number): Renderizacao[] {
  return todos<Renderizacao>(db, `${SELECT_RENDER} WHERE edicao_id = :e ORDER BY id DESC`, { e: edicaoId })
}

export function obterRenderizacao(db: Banco, id: number): Renderizacao {
  const r = um<Renderizacao>(db, `${SELECT_RENDER} WHERE id = :id`, { id })
  if (!r) throw naoEncontrado('Renderização')
  return r
}

/** Acabamento escolhido em Mídia automática (movimento, transições, apresentador). */
export function estiloDoProjeto(db: Banco, pastaApresentador: string): EstiloRender {
  const r = preferenciaMidiaSchema.safeParse(lerConfig(db, 'midia.automatica'))
  const v = r.success ? r.data.video : ESTILO_VIDEO_PADRAO
  return { movimento: v.movimento, transicoes: v.transicoes, apresentador: v.apresentador ? { pngs: arquivosApresentador(pastaApresentador), lado: v.lado } : null }
}

function recursosDoEstado(db: Banco, estado: EstadoEdicao): Map<number, RecursoParaRender & { nome: string }> {
  const ids = [...new Set(estado.clips.map((c) => c.recursoId).filter((x): x is number => x !== null))]
  const mapa = new Map<number, RecursoParaRender & { nome: string }>()
  for (const id of ids) {
    const r = um<{ caminho: string; tipo: RecursoParaRender['categoria']; nome: string; largura: number | null; altura: number | null; origem: string }>(
      db,
      'SELECT caminho, tipo, nome_original AS nome, largura, altura, origem FROM recursos_midia WHERE id = :id',
      { id }
    )
    // Cartões gráficos têm texto para ler: ficam parados.
    if (r) mapa.set(id, { id, caminho: r.caminho, categoria: r.tipo, nome: r.nome, largura: r.largura, altura: r.altura, estatico: r.origem.startsWith('Cartão gráfico') })
  }
  return mapa
}

/** Espaço necessário: tamanho máximo esperado com folga de 50% para arquivos temporários. */
export function estimarBytes(preset: PresetRender, duracaoSeg: number, opcoes: OpcoesRender = OPCOES_RENDER_RECOMENDADAS): number {
  return Math.ceil(estimarBytesRender(preset, opcoes, duracaoSeg) * 1.5)
}

function espacoLivre(pasta: string): number {
  try {
    mkdirSync(pasta, { recursive: true })
    const s = statfsSync(pasta)
    return s.bavail * s.bsize
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

/** Lê e guarda largura, altura, duração e quadros/s de uma mídia (só vídeo e imagem; precisa do FFprobe). */
export async function preencherMetadados(db: Banco, id: number, f: Ferramentas): Promise<void> {
  const r = um<{ caminho: string; tipo: string }>(db, 'SELECT caminho, tipo FROM recursos_midia WHERE id = :id', { id })
  if (!r || (r.tipo !== 'video' && r.tipo !== 'imagem' && r.tipo !== 'audio') || !existsSync(r.caminho)) return
  const s = await sondar(f, r.caminho)
  if (!s) return
  executar(db, 'UPDATE recursos_midia SET largura = :l, altura = :a, duracao_seg = :d, fps = :f WHERE id = :id', {
    id,
    l: s.video?.largura || null,
    a: s.video?.altura || null,
    d: r.tipo === 'imagem' ? null : s.duracao || null,
    f: r.tipo === 'video' ? (s.video?.fps ?? null) : null
  })
}

/** Formato (16:9 ou 9:16) do projeto de edição de uma renderização. */
export function formatoDaRenderizacao(db: Banco, renderizacaoId: number): '16:9' | '9:16' {
  return obterEdicao(db, obterRenderizacao(db, renderizacaoId).edicaoId).estado.formato
}

/** Recomendação de resolução/quadros por segundo para um projeto de edição, a partir das mídias usadas. */
export async function recomendacaoParaEdicao(db: Banco, edicaoId: number, f: Ferramentas | null, pastaRender: string): Promise<DadosRecomendacao> {
  const ed = obterEdicao(db, edicaoId)
  const ids = [...new Set(ed.estado.clips.filter((c) => c.faixa === 'video' && c.recursoId !== null).map((c) => c.recursoId!))]
  const fontes: DadosRecomendacao['fontes'] = []
  for (const id of ids) {
    let m = um<{ tipo: string; largura: number | null; altura: number | null; fps: number | null; nome: string }>(db, 'SELECT tipo, largura, altura, fps, nome_original AS nome FROM recursos_midia WHERE id = :id', { id })
    if (!m || (m.tipo !== 'video' && m.tipo !== 'imagem')) continue
    if (m.largura === null && f) {
      await preencherMetadados(db, id, f)
      m = um(db, 'SELECT tipo, largura, altura, fps, nome_original AS nome FROM recursos_midia WHERE id = :id', { id })!
    }
    fontes.push({ categoria: m.tipo as 'video' | 'imagem', largura: m.largura, altura: m.altura, fps: m.fps, nome: m.nome })
  }
  const recomendacao = recomendarRender(ed.estado.formato, fontes)
  const preferencia = { ...PREFERENCIA_RENDER_PADRAO, ...(lerConfig<PreferenciaRender>(db, 'render_preferencia') ?? {}) }
  const sugerido =
    preferencia.modo === 'fixo'
      ? { preset: `${ed.estado.formato}-${ed.estado.formato === '9:16' ? preferencia.short : preferencia.longo}` as PresetRender, opcoes: preferencia.opcoes }
      : { preset: recomendacao.preset, opcoes: recomendacao.opcoes }
  const livre = espacoLivre(pastaRender)
  return { recomendacao, preferencia, sugerido, duracaoSeg: Math.max(1, duracaoTotal(ed.estado)), livreBytes: Number.isFinite(livre) ? livre : null, fontes }
}

export class GerenciadorProducao {
  private ativa: { id: number; controle: AbortController } | null = null

  constructor(
    private readonly db: Banco,
    private readonly pastaRender: string,
    private readonly ferramentas: () => Ferramentas | null
  ) {}

  emAndamento(): number | null {
    return this.ativa?.id ?? null
  }

  iniciar(edicaoId: number, preset: PresetRender, opcoes: OpcoesRender = OPCOES_RENDER_RECOMENDADAS): { id: number; termino: Promise<void> } {
    const f = this.ferramentas()
    if (!f) throw new ErroApp('sem_ffmpeg', 'FFmpeg não encontrado. Instale-o (veja Configurações › Dados e backup › Ferramentas) e tente de novo.')
    if (this.ativa) throw new ErroApp('ocupado', 'Já existe uma renderização em andamento.')
    const bruto = obterEdicao(this.db, edicaoId)
    // Sobreposições e buracos entre imagens nunca chegam ao vídeo: corrigidos aqui, sem perguntar.
    const ed = { ...bruto, estado: corrigirEstado(this.db, bruto.estado).estado }
    const recursos = recursosDoEstado(this.db, ed.estado)
    const faltando = ed.estado.clips.filter((c) => c.recursoId !== null && (!recursos.has(c.recursoId) || !existsSync(recursos.get(c.recursoId)!.caminho)))
    if (faltando.length) throw new ErroApp('midia_ausente', `${faltando.length} clipe(s) usam mídia ausente. Corrija antes de renderizar.`)
    const total = Math.max(1, duracaoTotal(ed.estado))
    if (PRESETS_RENDER[preset].formato !== ed.estado.formato) throw new ErroApp('validacao', 'A resolução escolhida não corresponde ao formato do projeto.')
    if (espacoLivre(this.pastaRender) < estimarBytes(preset, total, opcoes)) throw new ErroApp('sem_espaco', 'Espaço em disco insuficiente para a renderização. Libere espaço e tente de novo.')

    const t = agoraIso()
    const id = executar(this.db, "INSERT INTO renderizacoes (edicao_id, revisao, preset, opcoes, arquivo, status, iniciada_em, criado_em) VALUES (:e, :r, :p, :o, '', 'em_andamento', :t, :t)", {
      e: edicaoId,
      r: ed.revisao,
      p: preset,
      o: JSON.stringify(opcoes),
      t
    }).id
    const pasta = join(this.pastaRender, String(id))
    mkdirSync(pasta, { recursive: true })
    const legendas = gerarSrt(ed.estado, 'legendas')
    const textos = gerarSrt(ed.estado, 'textos')
    if (legendas) writeFileSync(join(pasta, 'legendas.srt'), legendas, 'utf8')
    if (textos) writeFileSync(join(pasta, 'textos.srt'), textos, 'utf8')
    const arquivo = join(pasta, 'video.mp4')
    executar(this.db, 'UPDATE renderizacoes SET arquivo = :a WHERE id = :id', { id, a: arquivo })
    const estilo = estiloDoProjeto(this.db, join(this.pastaRender, 'apresentador'))
    const args = argumentosRender(ed.estado, recursos, preset, 'video.mp4', { temLegendas: Boolean(legendas), temTextos: Boolean(textos), render: opcoes, estilo })
    // Vídeos longos com apresentador geram uma lista de filtros grande: vai para arquivo (limite de comando do Windows).
    const i = args.indexOf('-filter_complex')
    if (i >= 0 && args[i + 1]!.length > 6000) {
      writeFileSync(join(pasta, 'filtros.txt'), args[i + 1]!, 'utf8')
      args.splice(i, 2, '-/filter_complex', 'filtros.txt')
    }
    const controle = new AbortController()
    this.ativa = { id, controle }
    let ultimo = 0
    const termino = executarFerramenta(f.ffmpeg, args, {
      cwd: pasta,
      sinal: controle.signal,
      aoProgredir: (trecho) => {
        const p = lerProgresso(trecho, total)
        if (p !== null && p - ultimo >= 0.01) {
          ultimo = p
          executar(this.db, 'UPDATE renderizacoes SET progresso = :p WHERE id = :id', { id, p })
        }
      }
    })
      .then(async (r) => {
        if (r.cancelado) return this.finalizar(id, 'cancelada', 'Cancelada pelo usuário.', null)
        if (r.codigo !== 0) {
          registrarEvento(this.db, 'erro', 'render', r.stderr.split(/\r?\n/).filter(Boolean).slice(-3).join(' | '))
          return this.finalizar(id, 'erro', 'O FFmpeg terminou com erro. Detalhes no registro de eventos.', null)
        }
        // Conferência do arquivo final.
        const sonda = await sondar(f, arquivo)
        const conf = { existe: existsSync(arquivo), duracao: sonda?.duracao ?? null, esperado: total, video: sonda?.video ?? null, audio: sonda?.audio ?? null }
        const ok = conf.existe && sonda !== null && Math.abs((sonda?.duracao ?? 0) - total) <= Math.max(1, total * 0.03)
        this.finalizar(id, ok ? 'concluida' : 'erro', ok ? 'Renderização concluída e conferida.' : 'O arquivo final não passou na conferência.', conf)
      })
      .finally(() => {
        if (this.ativa?.id === id) this.ativa = null
      })
    return { id, termino }
  }

  private finalizar(id: number, status: string, mensagem: string, conferencia: unknown): void {
    executar(this.db, 'UPDATE renderizacoes SET status = :s, mensagem = :m, conferencia = :c, concluida_em = :t, progresso = CASE WHEN :s = \'concluida\' THEN 1 ELSE progresso END WHERE id = :id', {
      id,
      s: status,
      m: mensagem,
      c: conferencia === null ? null : JSON.stringify(conferencia),
      t: agoraIso()
    })
  }

  cancelar(id: number): boolean {
    if (this.ativa?.id !== id) return false
    this.ativa.controle.abort()
    return true
  }
}

export async function sondar(f: Ferramentas, arquivo: string): Promise<ReturnType<typeof interpretarSonda> | null> {
  const chunks: string[] = []
  const r = await executarFerramenta(f.ffprobe, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', arquivo], { aoProgredir: (t) => chunks.push(t), tempoLimiteMs: 60_000 })
  if (r.codigo !== 0) return null
  try {
    return interpretarSonda(chunks.join(''))
  } catch {
    return null
  }
}

/** Ao abrir o app: renderizações interrompidas pelo fechamento ficam marcadas como erro. */
export function recuperarRenderizacoes(db: Banco): void {
  executar(db, "UPDATE renderizacoes SET status = 'erro', mensagem = 'Interrompida porque o aplicativo foi fechado.' WHERE status = 'em_andamento'")
}

// ------------------------------------------------------------------ controle de qualidade

/** Reúne os dados do arquivo e do projeto; sem FFmpeg, as medições de mídia ficam como "não verificadas". */
export async function coletarDadosQualidade(
  db: Banco,
  renderId: number,
  f: Ferramentas | null,
  pastaCapturas: string | null,
  aoProgredir: (percentual: number, etapa: string) => void = () => undefined
): Promise<{ dados: DadosQualidade; capturas: string[] }> {
  const rend = obterRenderizacao(db, renderId)
  const ed = obterEdicao(db, rend.edicaoId)
  const roteiro = obterRoteiro(db, ed.roteiroId)
  const preset = PRESETS_RENDER[rend.preset as PresetRender]
  const recursos = recursosDoEstado(db, ed.estado)
  const existe = Boolean(rend.arquivo) && existsSync(rend.arquivo)
  aoProgredir(2, 'Lendo o arquivo renderizado')
  const sonda = existe && f ? await sondar(f, rend.arquivo) : null
  let silencios: DadosQualidade['silencios'] = null
  let pretos: DadosQualidade['pretos'] = null
  const capturas: string[] = []
  if (existe && f && sonda) {
    // Faixas da barra: silêncio 5–50%, tela preta 50–90%, capturas 90–98% (pelo tempo já analisado do vídeo).
    const faixa = (de: number, ate: number, etapa: string) => (t: string) => {
      const p = lerProgresso(t, sonda.duracao)
      if (p !== null) aoProgredir(de + Math.round(p * (ate - de)), etapa)
    }
    aoProgredir(5, 'Procurando silêncios longos')
    const sil = await executarFerramenta(f.ffmpeg, ['-hide_banner', '-nostdin', '-i', rend.arquivo, '-af', 'silencedetect=noise=-50dB:d=2', '-vn', '-progress', 'pipe:1', '-nostats', '-f', 'null', '-'], {
      tempoLimiteMs: 600_000,
      aoProgredir: faixa(5, 50, 'Procurando silêncios longos')
    })
    silencios = interpretarSilencios(sil.stderr)
    aoProgredir(50, 'Procurando telas pretas')
    const pre = await executarFerramenta(f.ffmpeg, ['-hide_banner', '-nostdin', '-i', rend.arquivo, '-vf', 'blackdetect=d=1:pix_th=0.10:pic_th=0.8', '-an', '-progress', 'pipe:1', '-nostats', '-f', 'null', '-'], {
      tempoLimiteMs: 600_000,
      aoProgredir: faixa(50, 90, 'Procurando telas pretas')
    })
    pretos = interpretarPretos(pre.stderr)
    if (pastaCapturas) {
      mkdirSync(pastaCapturas, { recursive: true })
      const pontos = [0.1, 0.5, 0.9].map((x) => x * sonda.duracao)
      for (const [i, t] of pontos.entries()) {
        aoProgredir(90 + i * 3, 'Capturando quadros para conferência')
        const nome = `quadro-${i + 1}.jpg`
        const r = await executarFerramenta(f.ffmpeg, ['-hide_banner', '-nostdin', '-y', '-ss', t.toFixed(2), '-i', rend.arquivo, '-frames:v', '1', '-q:v', '4', join(pastaCapturas, nome)], { tempoLimiteMs: 60_000 })
        if (r.codigo === 0) capturas.push(nome)
      }
    }
  }
  const narracao = ed.estado.clips.filter((c) => c.faixa === 'narracao')
  const dossie = relatorio(db, { pautaId: null, roteiroId: roteiro.id })
  const dados: DadosQualidade = {
    arquivoExiste: existe,
    tamanhoBytes: existe ? statSync(rend.arquivo).size : 0,
    sonda,
    esperado: { duracao: Math.max(1, duracaoTotal(ed.estado)), largura: preset.largura, altura: preset.altura, temAudio: ed.estado.clips.some((c) => (c.faixa === 'audio' || c.faixa === 'narracao') && c.recursoId !== null) },
    silencios,
    pretos,
    legendas: ed.estado.clips.filter((c) => c.faixa === 'legendas').sort((a, b) => a.inicio - b.inicio).map((c) => ({ inicio: c.inicio, fim: c.inicio + c.duracao, texto: c.texto })),
    narracaoFim: narracao.length ? Math.max(...narracao.map((c) => c.inicio + c.duracao)) : null,
    cenasSemVisual: ed.estado.cenas
      .filter((cena) => {
        const iv = intervaloCena(ed.estado, cena.indice)
        return iv && !ed.estado.clips.some((c) => c.faixa === 'video' && c.recursoId !== null && c.inicio < iv.fim && c.inicio + c.duracao > iv.inicio)
      })
      .map((c) => c.titulo),
    midias: [...recursos.values()].map((r) => {
      const m = um<{ situacao: string; licenca: string; origem: string; url: string }>(db, 'SELECT situacao_licenca AS situacao, licenca, origem, url_origem AS url FROM recursos_midia WHERE id = :id', { id: r.id })!
      return { id: r.id, nome: r.nome, situacaoLicenca: m.situacao, licenca: m.licenca, origem: m.origem, urlOrigem: m.url, existe: existsSync(r.caminho) }
    }),
    fontesAnexadas: roteiro.fontes.length + dossie.resumo.prontas,
    roteiroAprovado: roteiro.status === 'aprovado' || roteiro.status === 'publicado',
    revisaoRenderizada: rend.revisao,
    revisaoAtual: ed.revisao
  }
  return { dados, capturas }
}

type LinhaRelatorio = { id: number; renderizacaoId: number; itens: string; bloqueadores: number; avisos: number; excecoes: string; aprovado: number; pastaCapturas: string | null; capturas: string; criadoEm: string }
const paraRelatorio = (l: LinhaRelatorio): RelatorioQualidade => ({
  ...l,
  itens: JSON.parse(l.itens) as ItemQualidade[],
  excecoes: JSON.parse(l.excecoes) as Excecao[],
  capturas: JSON.parse(l.capturas) as string[],
  aprovado: Boolean(l.aprovado)
})

export function salvarRelatorio(db: Banco, renderId: number, itens: ItemQualidade[], pastaCapturas: string | null, capturas: string[]): RelatorioQualidade {
  const s = situacaoQualidade(itens, [])
  const t = agoraIso()
  const { id } = executar(
    db,
    `INSERT INTO relatorios_qualidade (renderizacao_id, itens, bloqueadores, avisos, aprovado, pasta_capturas, capturas, criado_em, atualizado_em)
     VALUES (:r, :i, :b, :a, :ok, :p, :c, :t, :t)`,
    { r: renderId, i: JSON.stringify(itens), b: s.bloqueadores, a: itens.filter((x) => x.nivel === 'aviso').length, ok: s.aprovado ? 1 : 0, p: pastaCapturas, c: JSON.stringify(capturas), t }
  )
  return obterRelatorio(db, id)
}

export function obterRelatorio(db: Banco, id: number): RelatorioQualidade {
  const l = um<LinhaRelatorio>(
    db,
    'SELECT id, renderizacao_id AS renderizacaoId, itens, bloqueadores, avisos, excecoes, aprovado, pasta_capturas AS pastaCapturas, capturas, criado_em AS criadoEm FROM relatorios_qualidade WHERE id = :id',
    { id }
  )
  if (!l) throw naoEncontrado('Relatório de qualidade')
  return paraRelatorio(l)
}

export function relatoriosDaRenderizacao(db: Banco, renderId: number): RelatorioQualidade[] {
  return todos<LinhaRelatorio>(
    db,
    'SELECT id, renderizacao_id AS renderizacaoId, itens, bloqueadores, avisos, excecoes, aprovado, pasta_capturas AS pastaCapturas, capturas, criado_em AS criadoEm FROM relatorios_qualidade WHERE renderizacao_id = :r ORDER BY id DESC',
    { r: renderId }
  ).map(paraRelatorio)
}

/** Aceita explicitamente um AVISO (nunca um bloqueador), com justificativa registrada. */
export function aceitarExcecao(db: Banco, relatorioId: number, codigo: string, justificativa: string): RelatorioQualidade {
  const r = obterRelatorio(db, relatorioId)
  const item = r.itens.find((i) => i.codigo === codigo)
  if (!item) throw naoEncontrado('Item do relatório')
  if (item.nivel !== 'aviso') throw new ErroApp('bloqueador', 'Bloqueadores não podem ser aceitos como exceção: corrija o problema e rode o controle de novo.')
  if (!justificativa.trim()) throw new ErroApp('validacao', 'Explique por que o aviso pode ser aceito.')
  const excecoes = [...r.excecoes.filter((e) => e.codigo !== codigo), { codigo, justificativa: justificativa.slice(0, 500), aceitaEm: agoraIso() }]
  const s = situacaoQualidade(r.itens, excecoes)
  executar(db, 'UPDATE relatorios_qualidade SET excecoes = :e, aprovado = :ok, atualizado_em = :t WHERE id = :id', { id: relatorioId, e: JSON.stringify(excecoes), ok: s.aprovado ? 1 : 0, t: agoraIso() })
  return obterRelatorio(db, relatorioId)
}

export { avaliarQualidade }
