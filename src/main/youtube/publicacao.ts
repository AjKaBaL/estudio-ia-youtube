import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { ErroYouTube, type YouTubeGateway } from '@estudio/youtube'
import { type Banco, agoraIso, executar, todos, um } from '../db/conexao'
import { registrarEvento } from '../db/eventos'
import { ErroApp, naoEncontrado } from '../erros'
import type { Cofre } from '../ia/cofre'
import { obterRenderizacao, relatoriosDaRenderizacao } from '../midia/producao'
import { gravarConfig, lerConfig } from '../repositorios/configuracoes'
import { obterRoteiro } from '../repositorios/roteiros'
import type { Publicacao } from '@shared/tipos'
import { obterEdicao } from '../midia/edicao'
import { linksPadrao, obterLink } from '../repositorios/links'
import { duracaoTotal, intervaloCena } from '@shared/edicao'
import { gerarDescricao, type DescricaoGerada } from '@shared/publicacao'
import { ehAgregador } from '../pesquisa/aprofundar'
import { urlCanonica } from '../pesquisa/pontuacao'

/**
 * Publicação segura (Etapa 13): aprovação obrigatória por padrão, privado por padrão,
 * pré-requisitos impostos pelo código, envio retomável e prevenção de duplicidade.
 */

const CHAVE_OPCOES = 'youtube.opcoes'
export interface OpcoesYouTube {
  aprovacaoObrigatoria: boolean
}
export function lerOpcoesYouTube(db: Banco): OpcoesYouTube {
  const o = lerConfig<Partial<OpcoesYouTube>>(db, CHAVE_OPCOES)
  return { aprovacaoObrigatoria: o?.aprovacaoObrigatoria ?? true }
}
export function salvarOpcoesYouTube(db: Banco, o: OpcoesYouTube): OpcoesYouTube {
  gravarConfig(db, CHAVE_OPCOES, o)
  return o
}

type Linha = Omit<Publicacao, 'tags' | 'links' | 'feitoParaCriancas' | 'conteudoSintetico' | 'aprovacaoPublica'> & { tags: string; links: string; feitoParaCriancas: number | null; conteudoSintetico: number; aprovacaoPublica: number }
const SELECT = `
  SELECT p.id, p.renderizacao_id AS renderizacaoId, p.roteiro_id AS roteiroId, r.titulo AS roteiroTitulo, p.id_operacao AS idOperacao, p.titulo, p.descricao, p.tags, p.links,
    p.categoria_id AS categoriaId, p.playlist_id AS playlistId, p.privacidade, p.publicar_em AS publicarEm, p.feito_para_criancas AS feitoParaCriancas,
    p.conteudo_sintetico AS conteudoSintetico, p.miniatura_recurso_id AS miniaturaRecursoId, p.status, p.aprovada_em AS aprovadaEm,
    p.aprovacao_publica AS aprovacaoPublica, p.tamanho, p.bytes_enviados AS bytesEnviados, p.video_id AS videoId, p.video_url AS videoUrl,
    p.enviado_em AS enviadoEm, p.mensagem, p.criado_em AS criadoEm, p.atualizado_em AS atualizadoEm
  FROM publicacoes p JOIN roteiros r ON r.id = p.roteiro_id`

const paraPublicacao = (l: Linha): Publicacao => ({
  ...l,
  tags: JSON.parse(l.tags) as string[],
  links: JSON.parse(l.links) as number[],
  feitoParaCriancas: l.feitoParaCriancas === null ? null : Boolean(l.feitoParaCriancas),
  conteudoSintetico: Boolean(l.conteudoSintetico),
  aprovacaoPublica: Boolean(l.aprovacaoPublica)
})

export function listarPublicacoes(db: Banco): Publicacao[] {
  return todos<Linha>(db, `${SELECT} ORDER BY p.id DESC`).map(paraPublicacao)
}

export function obterPublicacao(db: Banco, id: number): Publicacao {
  const l = um<Linha>(db, `${SELECT} WHERE p.id = :id`, { id })
  if (!l) throw naoEncontrado('Publicação')
  return paraPublicacao(l)
}

/** Cria um rascunho a partir de uma renderização (título/descrição sugeridos a partir do roteiro, editáveis). */
export function prepararPublicacao(db: Banco, renderizacaoId: number): Publicacao {
  const render = obterRenderizacao(db, renderizacaoId)
  const ativa = um<{ id: number }>(db, "SELECT id FROM publicacoes WHERE renderizacao_id = :r AND status NOT IN ('cancelada','erro')", { r: renderizacaoId })
  if (ativa) return obterPublicacao(db, ativa.id)
  const ed = um<{ roteiroId: number }>(db, 'SELECT roteiro_id AS roteiroId FROM projetos_edicao WHERE id = :id', { id: render.edicaoId })
  if (!ed) throw naoEncontrado('Projeto de edição')
  const roteiro = obterRoteiro(db, ed.roteiroId)
  // Descrição automática com os links marcados como "incluir sempre"; continua editável e exige aprovação.
  const links = linksPadrao(db, roteiro.projetoId).map((l) => l.id)
  const tags = roteiro.palavrasChave.slice(0, 15)
  const descricao = descricaoPara(db, renderizacaoId, links, tags).texto
  const t = agoraIso()
  const { id } = executar(
    db,
    `INSERT INTO publicacoes (renderizacao_id, roteiro_id, id_operacao, titulo, descricao, tags, links, criado_em, atualizado_em)
     VALUES (:r, :rot, :op, :titulo, :desc, :tags, :links, :t, :t)`,
    { r: renderizacaoId, rot: roteiro.id, op: randomUUID(), titulo: limparTitulo(roteiro.titulo), desc: descricao, tags: JSON.stringify(tags), links: JSON.stringify(links), t }
  )
  return obterPublicacao(db, id)
}

const limparTitulo = (t: string): string => t.replace(/</g, '‹').replace(/>/g, '›').slice(0, 100)

/** Primeiro parágrafo de texto do roteiro (sem títulos e marcações), cortado numa frase, como resumo. */
export function resumoDoRoteiro(tema: string, conteudo: string): string {
  if (tema.trim()) return tema.trim()
  const paragrafo = conteudo
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.replace(/\[[^\]]*\]/g, '').trim())
    .find((p) => p && !p.startsWith('#') && !/^Formato:/i.test(p))
  if (!paragrafo) return ''
  if (paragrafo.length <= 300) return paragrafo
  const corte = paragrafo.slice(0, 300)
  const fim = Math.max(corte.lastIndexOf('. '), corte.lastIndexOf('! '), corte.lastIndexOf('? '))
  return fim > 80 ? corte.slice(0, fim + 1) : `${corte.trimEnd()}…`
}

/** Monta a descrição a partir do roteiro, dos capítulos do projeto de edição, das fontes e dos links escolhidos. */
export function descricaoPara(db: Banco, renderizacaoId: number, linkIds: number[], tags: string[]): DescricaoGerada {
  const render = obterRenderizacao(db, renderizacaoId)
  const ed = obterEdicao(db, render.edicaoId)
  const roteiro = obterRoteiro(db, ed.roteiroId)
  const links = linkIds
    .map((id) => {
      try {
        return obterLink(db, id)
      } catch {
        return null
      }
    })
    .filter((l): l is NonNullable<typeof l> => l !== null && l.ativo && (l.projetoId === null || l.projetoId === roteiro.projetoId))
  return gerarDescricao({
    resumo: resumoDoRoteiro(roteiro.tema, roteiro.conteudo),
    formato: ed.estado.formato,
    duracaoSeg: duracaoTotal(ed.estado),
    capitulos: ed.estado.cenas.map((c) => ({ inicio: intervaloCena(ed.estado, c.indice)?.inicio ?? 0, titulo: c.titulo })),
    fontes: fontesDoVideo(db, roteiro),
    links,
    tags,
    ...midiasDoVideo(db, ed.estado.clips.map((c) => c.recursoId).filter((x): x is number => x !== null))
  })
}

/**
 * Matérias em que o vídeo se baseia, com o endereço da própria matéria: fontes do roteiro, as citadas no dossiê e as
 * notícias da pauta. Links de agregador (Google Notícias) ficam de fora, porque não levam à matéria.
 */
function fontesDoVideo(db: Banco, roteiro: { id: number; pautaId: number | null; fontes: { titulo: string; url: string }[] }): { titulo: string; url: string }[] {
  const doDossie = todos<{ titulo: string; url: string }>(
    db,
    `SELECT f.titulo, f.url FROM afirmacao_fontes af JOIN fontes f ON f.id = af.fonte_id JOIN afirmacoes a ON a.id = af.afirmacao_id
     WHERE (a.roteiro_id = :r OR a.pauta_id = :p) AND a.decisao IS NOT 'remover' GROUP BY f.id ORDER BY MIN(af.criado_em)`,
    { r: roteiro.id, p: roteiro.pautaId }
  )
  const daPauta = roteiro.pautaId
    ? todos<{ titulo: string; url: string }>(
        db,
        'SELECT r.titulo, r.url FROM pauta_resultados pr JOIN resultados_pesquisa r ON r.id = pr.resultado_id WHERE pr.pauta_id = :p ORDER BY r.pontuacao DESC',
        { p: roteiro.pautaId }
      )
    : []
  const vistas = new Set<string>()
  return [...roteiro.fontes, ...doDossie, ...daPauta].filter((f) => {
    const c = urlCanonica(f.url)
    if (ehAgregador(f.url) || vistas.has(c)) return false
    vistas.add(c)
    return true
  }).map((f) => ({ titulo: f.titulo, url: f.url }))
}

/** Créditos (autor, licença e endereço) das mídias de terceiros e se há mídia sintética no vídeo. */
function midiasDoVideo(db: Banco, ids: number[]): { creditos: string[]; sintetico: { imagens: boolean; voz: boolean } } {
  const unicos = [...new Set(ids)]
  if (!unicos.length) return { creditos: [], sintetico: { imagens: false, voz: false } }
  const lista = todos<{ tipo: string; origem: string; autor: string; licenca: string; url: string; situacao: string }>(
    db,
    `SELECT tipo, origem, autor, licenca, url_origem AS url, situacao_licenca AS situacao FROM recursos_midia WHERE id IN (${unicos.map((_, i) => `:i${i}`).join(',')})`,
    Object.fromEntries(unicos.map((id, i) => [`i${i}`, id]))
  )
  const creditos = lista
    .filter((m) => (m.situacao === 'licenciado' || m.situacao === 'dominio_publico_verificar') && m.autor.trim() && m.url)
    .map((m) => `${m.origem.split(':')[0]}: ${m.autor} (${m.licenca}) ${m.url}`.slice(0, 300))
    .slice(0, 30)
  return {
    creditos,
    sintetico: { imagens: lista.some((m) => m.situacao === 'gerado_ia' && m.tipo !== 'audio'), voz: lista.some((m) => m.situacao === 'gerado_ia' && m.tipo === 'audio') }
  }
}

/** Gera a descrição para a tela (o texto vai para o formulário; nada é salvo além da escolha de links). */
export function gerarDescricaoPublicacao(db: Banco, id: number, linkIds: number[], tags: string[]): DescricaoGerada {
  const p = obterPublicacao(db, id)
  if (!['rascunho', 'aprovada', 'erro'].includes(p.status)) throw new ErroApp('publicacao_travada', 'Não é possível alterar a descrição durante ou depois do envio.')
  executar(db, 'UPDATE publicacoes SET links = :l WHERE id = :id', { id, l: JSON.stringify(linkIds) })
  return descricaoPara(db, p.renderizacaoId, linkIds, tags)
}

export interface CamposPublicacao {
  titulo: string
  descricao: string
  tags: string[]
  categoriaId: string
  playlistId: string | null
  privacidade: 'private' | 'unlisted' | 'public'
  publicarEm: string | null
  feitoParaCriancas: boolean | null
  conteudoSintetico: boolean
  miniaturaRecursoId: number | null
}

/** Editar depois de aprovada desfaz a aprovação (precisa aprovar de novo). */
export function atualizarPublicacao(db: Banco, id: number, c: CamposPublicacao): Publicacao {
  const p = obterPublicacao(db, id)
  if (!['rascunho', 'aprovada', 'erro'].includes(p.status)) throw new ErroApp('publicacao_travada', 'Não é possível editar durante ou depois do envio.')
  executar(
    db,
    `UPDATE publicacoes SET titulo = :titulo, descricao = :descricao, tags = :tags, categoria_id = :cat, playlist_id = :pl, privacidade = :priv,
       publicar_em = :pub, feito_para_criancas = :kids, conteudo_sintetico = :sint, miniatura_recurso_id = :mini,
       status = CASE WHEN status = 'aprovada' THEN 'rascunho' ELSE status END, aprovada_em = NULL, aprovacao_publica = 0, atualizado_em = :t
     WHERE id = :id`,
    {
      id,
      titulo: c.titulo,
      descricao: c.descricao,
      tags: JSON.stringify(c.tags),
      cat: c.categoriaId,
      pl: c.playlistId,
      priv: c.privacidade,
      pub: c.publicarEm,
      kids: c.feitoParaCriancas === null ? null : c.feitoParaCriancas ? 1 : 0,
      sint: c.conteudoSintetico ? 1 : 0,
      mini: c.miniaturaRecursoId,
      t: agoraIso()
    }
  )
  return obterPublicacao(db, id)
}

/** Pré-requisitos verificados pelo código antes de aprovar e de enviar. */
export function pendenciasPublicacao(db: Banco, p: Publicacao, agora = new Date()): string[] {
  const pend: string[] = []
  const roteiro = obterRoteiro(db, p.roteiroId)
  if (roteiro.status !== 'aprovado' && roteiro.status !== 'publicado') pend.push('O roteiro não está aprovado para produção.')
  const render = obterRenderizacao(db, p.renderizacaoId)
  if (render.status !== 'concluida' || !existsSync(render.arquivo)) pend.push('A renderização não está concluída ou o arquivo não existe.')
  const qc = relatoriosDaRenderizacao(db, p.renderizacaoId)[0]
  if (!qc) pend.push('Falta executar o controle de qualidade desta renderização.')
  else if (!qc.aprovado) pend.push('O controle de qualidade tem bloqueadores ou avisos não aceitos.')
  if (p.feitoParaCriancas === null) pend.push('Informe se o vídeo é ou não "feito para crianças" (declaração obrigatória no YouTube).')
  if (!p.titulo.trim() || p.titulo.length > 100 || /[<>]/.test(p.titulo)) pend.push('Título deve ter de 1 a 100 caracteres, sem < ou >.')
  if (Buffer.byteLength(p.descricao, 'utf8') > 5000 || /[<>]/.test(p.descricao)) pend.push('Descrição deve ter até 5000 bytes, sem < ou >.')
  if (p.tags.join(',').length > 500) pend.push('As tags somam mais de 500 caracteres.')
  if (p.publicarEm) {
    if (new Date(p.publicarEm).getTime() <= agora.getTime() + 15 * 60_000) pend.push('A data de publicação agendada precisa estar no futuro (pelo menos 15 min).')
    if (p.privacidade !== 'private') pend.push('Para agendar, o vídeo deve ficar privado até a data (o YouTube publica automaticamente).')
  }
  return pend
}

export function aprovarPublicacao(db: Banco, id: number, confirmarPublico: boolean): Publicacao {
  const p = obterPublicacao(db, id)
  if (p.status !== 'rascunho') throw new ErroApp('fluxo', 'Só rascunhos podem ser aprovados.')
  const pend = pendenciasPublicacao(db, p)
  if (pend.length) throw new ErroApp('pendencias', pend.join(' '))
  if (p.privacidade === 'public' && !confirmarPublico) throw new ErroApp('confirmar_publico', 'Publicação pública exige confirmação explícita.')
  executar(db, "UPDATE publicacoes SET status = 'aprovada', aprovada_em = :t, aprovacao_publica = :pub, atualizado_em = :t WHERE id = :id", { id, t: agoraIso(), pub: p.privacidade === 'public' ? 1 : 0 })
  registrarEvento(db, 'info', 'publicacao', `Publicação nº ${id} aprovada (${p.privacidade}).`)
  return obterPublicacao(db, id)
}

export function cancelarPublicacao(db: Banco, cofre: Cofre, id: number): Publicacao {
  const p = obterPublicacao(db, id)
  if (['enviando', 'processando', 'concluida'].includes(p.status)) throw new ErroApp('fluxo', 'Não é possível cancelar durante ou depois do envio.')
  executar(db, "UPDATE publicacoes SET status = 'cancelada', atualizado_em = :t WHERE id = :id", { id, t: agoraIso() })
  cofre.remover(`youtube:sessao:${id}`)
  return obterPublicacao(db, id)
}

function hashArquivo(caminho: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256')
    createReadStream(caminho).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject)
  })
}

/** Envio com estado persistido: retoma de onde parou (inclusive depois de fechar o app). */
export class GerenciadorEnvio {
  private ativa: { id: number; controle: AbortController } | null = null

  constructor(
    private readonly db: Banco,
    private readonly cofre: Cofre,
    private readonly youtube: () => YouTubeGateway
  ) {}

  emAndamento(): number | null {
    return this.ativa?.id ?? null
  }

  /** Regras verificadas antes de qualquer envio (lança erro com o motivo). */
  validarParaEnvio(id: number): Publicacao {
    if (this.ativa) throw new ErroApp('ocupado', 'Já existe um envio em andamento.')
    const p = obterPublicacao(this.db, id)
    const opcoes = lerOpcoesYouTube(this.db)
    const podeComecar = opcoes.aprovacaoObrigatoria ? ['aprovada', 'pausada', 'erro'] : ['rascunho', 'aprovada', 'pausada', 'erro']
    if (!podeComecar.includes(p.status)) throw new ErroApp('fluxo', opcoes.aprovacaoObrigatoria ? 'Aprove a publicação antes de enviar.' : 'Esta publicação não pode ser enviada agora.')
    if (p.status === 'erro' && !p.aprovadaEm && opcoes.aprovacaoObrigatoria) throw new ErroApp('fluxo', 'Aprove a publicação antes de enviar.')
    const pend = pendenciasPublicacao(this.db, p)
    if (pend.length) throw new ErroApp('pendencias', pend.join(' '))
    if (p.privacidade === 'public' && !p.aprovacaoPublica) throw new ErroApp('confirmar_publico', 'A publicação pública precisa de aprovação explícita.')
    return p
  }

  async enviar(id: number): Promise<Publicacao> {
    const p = this.validarParaEnvio(id)

    const render = obterRenderizacao(this.db, p.renderizacaoId)
    const tamanho = statSync(render.arquivo).size
    const sha = await hashArquivo(render.arquivo)
    const jaEnviado = um<{ id: number; video: string }>(this.db, "SELECT id, video_id AS video FROM publicacoes WHERE sha256 = :s AND status IN ('processando','concluida') AND id <> :id", { s: sha, id })
    if (jaEnviado) throw new ErroApp('duplicado', `Este mesmo arquivo já foi enviado (publicação nº ${jaEnviado.id}, vídeo ${jaEnviado.video}).`)

    const controle = new AbortController()
    this.ativa = { id, controle }
    const t = agoraIso()
    executar(this.db, "UPDATE publicacoes SET status = 'enviando', tamanho = :tam, sha256 = :sha, mensagem = NULL, atualizado_em = :t WHERE id = :id", { id, tam: tamanho, sha, t })
    const yt = this.youtube()
    const chaveSessao = `youtube:sessao:${id}`
    try {
      let sessao = this.cofre.obter(chaveSessao)
      let desde = 0
      if (sessao) {
        const s = await yt.consultarEnvio(sessao, tamanho).catch((e: unknown) => {
          if (e instanceof ErroYouTube && e.tipo === 'nao_encontrado') return null
          throw e
        })
        if (s?.concluido) return this.concluir(id, s.videoId)
        if (s) desde = s.bytesRecebidos
        else sessao = null
      }
      if (!sessao) {
        sessao = await yt.iniciarEnvio(
          { titulo: p.titulo, descricao: p.descricao, tags: p.tags, categoriaId: p.categoriaId, privacidade: p.privacidade, publicarEm: p.publicarEm, feitoParaCriancas: p.feitoParaCriancas!, conteudoSintetico: p.conteudoSintetico },
          tamanho,
          'video/mp4'
        )
        this.cofre.guardar(chaveSessao, sessao) // endereço da sessão é tratado como segredo
      }
      let ultimo = desde
      const r = await yt.enviarPartes(sessao, render.arquivo, tamanho, desde, (bytes) => {
        if (bytes - ultimo >= 1024 * 1024 || bytes === tamanho) {
          ultimo = bytes
          executar(this.db, 'UPDATE publicacoes SET bytes_enviados = :b WHERE id = :id', { id, b: bytes })
        }
      }, controle.signal)
      if (r.concluido) return this.concluir(id, r.videoId)
      executar(this.db, "UPDATE publicacoes SET status = 'pausada', bytes_enviados = :b, mensagem = 'Envio pausado. Pode ser retomado.', atualizado_em = :t WHERE id = :id", { id, b: r.bytesRecebidos, t: agoraIso() })
      return obterPublicacao(this.db, id)
    } catch (e) {
      const msg = e instanceof ErroYouTube ? e.message : controle.signal.aborted ? 'Envio pausado.' : 'Falha de rede durante o envio. Pode ser retomado.'
      executar(this.db, "UPDATE publicacoes SET status = :s, mensagem = :m, atualizado_em = :t WHERE id = :id", { id, s: controle.signal.aborted ? 'pausada' : 'erro', m: msg, t: agoraIso() })
      registrarEvento(this.db, 'erro', 'publicacao', `Publicação nº ${id}: ${msg}`)
      return obterPublicacao(this.db, id)
    } finally {
      this.ativa = null
    }
  }

  private async concluir(id: number, videoId: string | null): Promise<Publicacao> {
    this.cofre.remover(`youtube:sessao:${id}`)
    executar(
      this.db,
      "UPDATE publicacoes SET status = 'processando', video_id = :v, video_url = :u, enviado_em = :t, bytes_enviados = tamanho, mensagem = 'Enviado. O YouTube está processando o vídeo.', atualizado_em = :t WHERE id = :id",
      { id, v: videoId, u: videoId ? `https://www.youtube.com/watch?v=${videoId}` : null, t: agoraIso() }
    )
    const p = obterPublicacao(this.db, id)
    if (p.miniaturaRecursoId && videoId) {
      const m = um<{ caminho: string; mime: string }>(this.db, 'SELECT caminho, mime FROM recursos_midia WHERE id = :id', { id: p.miniaturaRecursoId })
      if (m) {
        await this.youtube()
          .definirMiniatura(videoId, m.caminho, m.mime)
          .catch((e: unknown) => executar(this.db, 'UPDATE publicacoes SET mensagem = :m WHERE id = :id', { id, m: `Vídeo enviado, mas a miniatura não foi aceita: ${e instanceof Error ? e.message : 'erro'}` }))
      }
    }
    return obterPublicacao(this.db, id)
  }

  pausar(id: number): boolean {
    if (this.ativa?.id !== id) return false
    this.ativa.controle.abort()
    return true
  }

  /** Consulta o processamento no YouTube e conclui o registro. */
  async atualizarStatus(id: number): Promise<Publicacao> {
    const p = obterPublicacao(this.db, id)
    if (!p.videoId) return p
    const s = await this.youtube().statusVideo(p.videoId)
    if (!s) {
      executar(this.db, "UPDATE publicacoes SET mensagem = 'O vídeo não foi encontrado no YouTube (pode ter sido removido).', atualizado_em = :t WHERE id = :id", { id, t: agoraIso() })
    } else if (s.statusEnvio === 'processed' || s.statusEnvio === 'uploaded') {
      executar(this.db, "UPDATE publicacoes SET status = 'concluida', mensagem = :m, atualizado_em = :t WHERE id = :id", {
        id,
        m: `No YouTube: ${s.privacidade}${s.publicarEm ? `, publicação agendada para ${s.publicarEm}` : ''}.`,
        t: agoraIso()
      })
      if (s.privacidade === 'public') executar(this.db, "UPDATE roteiros SET status = 'publicado', atualizado_em = :t WHERE id = :id", { id: p.roteiroId, t: agoraIso() })
    } else if (s.statusEnvio === 'rejected' || s.statusEnvio === 'failed') {
      executar(this.db, "UPDATE publicacoes SET status = 'erro', mensagem = :m, atualizado_em = :t WHERE id = :id", { id, m: `O YouTube recusou o vídeo${s.motivoRejeicao ? `: ${s.motivoRejeicao}` : ''}.`, t: agoraIso() })
    }
    return obterPublicacao(this.db, id)
  }
}

/** Ao abrir o app: envios interrompidos ficam pausados (retomáveis). */
export function recuperarEnvios(db: Banco): void {
  executar(db, "UPDATE publicacoes SET status = 'pausada', mensagem = 'Interrompido porque o aplicativo foi fechado. Pode ser retomado.' WHERE status = 'enviando'")
}
