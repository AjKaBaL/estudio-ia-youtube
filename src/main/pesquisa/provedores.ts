import { analisarFeed, analisarPagina, robotsPermite, type ItemExtraido } from './analisadores'
import { correspondeConsulta, type Consulta } from './pontuacao'
import { comRepeticao, ErroRede, type buscarSeguro } from './rede'

/**
 * Interface comum dos provedores de pesquisa. Cada adaptador é independente: trocar ou
 * acrescentar um provedor não exige mudar o executor nem a interface do aplicativo.
 */

export interface FonteConfigurada {
  id: number
  tipo: 'rss' | 'url'
  nome: string
  url: string
}

export interface ResultadoBruto extends ItemExtraido {
  fonteId: number | null
  fonteNome: string
}

export interface ContextoProvedor {
  consulta: Consulta
  fontes: FonteConfigurada[]
  sinal: AbortSignal
  buscar: typeof buscarSeguro
  registrar: (fonte: string, nivel: 'info' | 'aviso' | 'erro', mensagem: string) => void
  aoConcluirFonte: (fonte: FonteConfigurada, ok: boolean, status: string) => void
  limites: { itensPorFonte: number; tempoPorFonteMs: number; tamanhoMaximo: number }
}

export interface EstadoProvedor {
  configurado: boolean
  mensagem: string
}

export interface ProvedorPesquisa {
  id: string
  nome: string
  descricao: string
  exigeChave: boolean
  estado(fontes: FonteConfigurada[]): EstadoProvedor
  executar(ctx: ContextoProvedor): Promise<ResultadoBruto[]>
}

function mensagemErro(e: unknown): string {
  if (e instanceof ErroRede) return e.message
  return 'Falha ao processar a fonte.'
}

/** Feeds RSS/Atom públicos adicionados pelo usuário; filtra os itens pela consulta. */
export const provedorRss: ProvedorPesquisa = {
  id: 'rss',
  nome: 'Feeds RSS/Atom',
  descricao: 'Lê feeds públicos que você adicionar e filtra os itens pelas palavras-chave.',
  exigeChave: false,
  estado: (fontes) => {
    const n = fontes.filter((f) => f.tipo === 'rss').length
    return n ? { configurado: true, mensagem: `${n} feed(s) ativo(s).` } : { configurado: false, mensagem: 'Nenhum feed adicionado.' }
  },
  async executar(ctx) {
    const saida: ResultadoBruto[] = []
    for (const f of ctx.fontes.filter((x) => x.tipo === 'rss')) {
      if (ctx.sinal.aborted) break
      try {
        const r = await comRepeticao(
          () => ctx.buscar(f.url, { sinal: ctx.sinal, tempoLimiteMs: ctx.limites.tempoPorFonteMs, tamanhoMaximo: ctx.limites.tamanhoMaximo }),
          3,
          1000,
          ctx.sinal
        )
        const { itens } = analisarFeed(r.corpo, r.urlFinal)
        const filtrados = itens.filter((i) => correspondeConsulta(ctx.consulta, `${i.titulo} ${i.trecho}`)).slice(0, ctx.limites.itensPorFonte)
        ctx.registrar(f.nome, 'info', `${itens.length} item(ns) lidos, ${filtrados.length} correspondem à consulta.`)
        saida.push(...filtrados.map((i) => ({ ...i, fonteId: f.id, fonteNome: f.nome })))
        ctx.aoConcluirFonte(f, true, `OK (${itens.length} itens)`)
      } catch (e) {
        ctx.registrar(f.nome, 'erro', mensagemErro(e))
        ctx.aoConcluirFonte(f, false, mensagemErro(e))
      }
    }
    return saida
  }
}

/** Páginas adicionadas pelo usuário: lê só metadados e um trecho, respeitando o robots.txt. */
export const provedorUrls: ProvedorPesquisa = {
  id: 'urls',
  nome: 'Páginas adicionadas',
  descricao: 'Lê título, autor, data e um trecho curto de páginas que você indicar. Respeita robots.txt; não contorna login nem paywall.',
  exigeChave: false,
  estado: (fontes) => {
    const n = fontes.filter((f) => f.tipo === 'url').length
    return n ? { configurado: true, mensagem: `${n} página(s) ativa(s).` } : { configurado: false, mensagem: 'Nenhuma página adicionada.' }
  },
  async executar(ctx) {
    const saida: ResultadoBruto[] = []
    const robotsCache = new Map<string, string | null>()
    for (const f of ctx.fontes.filter((x) => x.tipo === 'url')) {
      if (ctx.sinal.aborted) break
      try {
        const u = new URL(f.url)
        if (!robotsCache.has(u.origin)) {
          try {
            const r = await ctx.buscar(`${u.origin}/robots.txt`, { sinal: ctx.sinal, tempoLimiteMs: 8000, tamanhoMaximo: 256 * 1024, tiposPermitidos: ['text/plain'] })
            robotsCache.set(u.origin, r.corpo)
          } catch {
            robotsCache.set(u.origin, null) // sem robots.txt acessível: leitura permitida
          }
        }
        const robots = robotsCache.get(u.origin)
        if (robots && !robotsPermite(robots, u.pathname + u.search)) {
          ctx.registrar(f.nome, 'aviso', 'O site não permite leitura automática desta página (robots.txt). Nada foi lido.')
          ctx.aoConcluirFonte(f, false, 'Bloqueado por robots.txt')
          continue
        }
        const r = await comRepeticao(
          () => ctx.buscar(f.url, { sinal: ctx.sinal, tempoLimiteMs: ctx.limites.tempoPorFonteMs, tamanhoMaximo: ctx.limites.tamanhoMaximo, tiposPermitidos: ['text/html', 'application/xhtml+xml'] }),
          2,
          1000,
          ctx.sinal
        )
        const p = analisarPagina(r.corpo, r.urlFinal)
        saida.push({ titulo: p.titulo, url: p.canonica || r.urlFinal, autor: p.autor, publicadaEm: p.publicadaEm, trecho: p.trecho, fonteId: f.id, fonteNome: f.nome })
        ctx.registrar(f.nome, 'info', 'Metadados lidos.')
        ctx.aoConcluirFonte(f, true, 'OK')
      } catch (e) {
        ctx.registrar(f.nome, 'erro', mensagemErro(e))
        ctx.aoConcluirFonte(f, false, mensagemErro(e))
      }
    }
    return saida
  }
}

/**
 * Provedor de busca web por API. Exige chave do usuário e por isso aparece como não configurado
 * até que ele a adicione voluntariamente no cofre de credenciais.
 */
export const provedorBuscaApi: ProvedorPesquisa = {
  id: 'busca_api',
  nome: 'Busca web por API (com chave)',
  descricao: 'Serviços de busca web costumam exigir chave e podem ter limites ou cobrança. Nenhum é usado sem sua configuração.',
  exigeChave: true,
  estado: () => ({ configurado: false, mensagem: 'Não configurado: requer chave adicionada por você.' }),
  async executar() {
    return []
  }
}

export const PROVEDORES: readonly ProvedorPesquisa[] = [provedorRss, provedorUrls, provedorBuscaApi]
