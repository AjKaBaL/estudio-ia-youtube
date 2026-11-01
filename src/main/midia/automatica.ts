import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Contexto } from '../contexto'
import { um } from '../db/conexao'
import { registrarEvento } from '../db/eventos'
import { lerConfig } from '../repositorios/configuracoes'
import { obterRoteiro } from '../repositorios/roteiros'
import { executarRoteado } from '../ia/roteador'
import { listarMidia, registrarArquivoGerado } from './biblioteca'
import { corrigirEstado, obterEdicao, salvarEdicao } from './edicao'
import { baixarMidia, buscarPexels, buscarPixabay, buscarWikimedia, buscarWikimediaVideos, gerarImagem, type ResultadoMidia } from './imagens'
import { gerarTrilha } from './trilha'
import { fraseDoCartao, gerarCartao, tituloDoCartao } from './cartoes'
import { preencherMetadados } from './producao'
import { instalarPiper, piperInstalado, sintetizar } from './voz'
import { adicionarClip, duracaoTotal, intervaloCena, montarAutomaticamente, retemporizarComNarracao, textosDasCenas, type EstadoEdicao } from '@shared/edicao'
import { INFO_FONTE_IMAGEM, INFO_GERADOR, PREFERENCIA_MIDIA_PADRAO, preferenciaMidiaSchema, promptDaCena, termosDeBusca, type PreferenciaMidia } from '@shared/geracaoMidia'

/**
 * Produção automática das mídias de uma edição, em um clique:
 * 1. narração por voz sintética, cena por cena (cada cena passa a durar o tempo real da fala);
 * 2. para cada cena sem imagem: busca com licença livre (Wikimedia, Pexels, Pixabay) e, se nada servir, imagem gerada por IA;
 * 3. montagem automática na linha do tempo.
 * Tudo fica na biblioteca com origem, autor e licença; o resultado entra no histórico da edição (dá para desfazer).
 */

export const CHAVE_PREFERENCIA = 'midia.automatica'
/** Desligado nos testes: nunca baixa nem instala nada no computador durante os testes. */
export const instaladorVoz = { ativo: !process.env.VITEST }
export const chaveServico = (s: string): string => `midia:${s}`

export function lerPreferenciaMidia(ctx: Pick<Contexto, 'db'>): PreferenciaMidia {
  const r = preferenciaMidiaSchema.safeParse(lerConfig(ctx.db, CHAVE_PREFERENCIA))
  return r.success ? r.data : PREFERENCIA_MIDIA_PADRAO
}

export interface ProgressoProducao {
  (percentual: number, etapa: string, detalhe?: string): void
}

/** Termos em inglês para o Wikimedia (acervo principalmente em inglês), se alguma IA estiver disponível. */
async function traduzirTermos(ctx: Contexto, termos: string[], sinal: AbortSignal): Promise<string[]> {
  if (!termos.length) return termos
  const r = await executarRoteado(
    ctx.db,
    ctx.cofre,
    'escrever',
    (provedorId) => ({
      provedorId,
      finalidade: 'Traduzir termos de busca de imagens',
      sistema: 'Traduza cada termo de busca de imagens para inglês (2 a 4 palavras, sem nomes de pessoas). Responda só JSON: {"termos":["..."]}, na mesma ordem.',
      maxTokens: 400,
      partes: [{ rotulo: 'TERMOS', texto: termos.map((t, i) => `${i + 1}. ${t}`).join('\n') }]
    }),
    {
      temperatura: 0,
      json: true,
      sinal,
      validar: (texto) => {
        const v = (JSON.parse(texto.replace(/^```(?:json)?\s*|```\s*$/g, '')) as { termos?: unknown }).termos
        if (!Array.isArray(v) || v.length !== termos.length || !v.every((x) => typeof x === 'string')) throw new Error('formato')
        return v.map((x) => String(x).slice(0, 80))
      }
    }
  ).catch(() => null)
  return r?.ok ? r.valor : termos
}

function visuaisDoRoteiro(ctx: Contexto, roteiroId: number): Map<string, string> {
  const v = um<{ estrutura: string | null }>(ctx.db, 'SELECT v.estrutura FROM roteiro_versoes v JOIN roteiros r ON r.id = v.roteiro_id AND v.numero = r.versao_atual WHERE r.id = :id', { id: roteiroId })
  try {
    const cenas = (JSON.parse(v?.estrutura ?? 'null') as { cenas?: { titulo: string; visual: string }[] } | null)?.cenas ?? []
    return new Map(cenas.map((c) => [c.titulo.trim().toLowerCase(), c.visual]))
  } catch {
    return new Map()
  }
}

const temVisual = (e: EstadoEdicao, indice: number): boolean => {
  const iv = intervaloCena(e, indice)
  return !!iv && e.clips.some((c) => c.faixa === 'video' && c.recursoId !== null && c.inicio < iv.fim - 0.05 && c.inicio + c.duracao > iv.inicio + 0.05)
}

export async function produzirMidias(
  ctx: Contexto,
  edicaoId: number,
  op: { narracao: boolean; imagens: boolean },
  aoProgredir: ProgressoProducao = () => undefined,
  sinal: AbortSignal = new AbortController().signal
): Promise<{ relatorio: string[]; revisao: number }> {
  const ed = obterEdicao(ctx.db, edicaoId)
  const roteiro = obterRoteiro(ctx.db, ed.roteiroId)
  const pref = lerPreferenciaMidia(ctx)
  const relatorio: string[] = []
  const temp = join(ctx.pastaMidia, 'temporario', `producao-${edicaoId}-${Date.now()}`)
  const pastaFerramentas = join(ctx.pastaDados, 'ferramentas')
  mkdirSync(temp, { recursive: true })
  const base = { projetoId: roteiro.projetoId, roteiroId: roteiro.id }
  let estado = ed.estado
  try {
    // 1) Narração por voz sintética, cena por cena.
    if (op.narracao && estado.clips.some((c) => c.faixa === 'narracao')) relatorio.push('A edição já tem narração: a voz sintética não foi gerada (remova a narração atual para gerar de novo).')
    else if (op.narracao) {
      // Voz neural: na primeira narração o app instala o Piper sozinho (assinaturas conferidas); se não der, usa a reserva.
      if (pref.voz.motor === 'piper' && !piperInstalado(pastaFerramentas) && process.platform === 'win32' && instaladorVoz.ativo) {
        try {
          await instalarPiper(pastaFerramentas, (pct, etapa) => aoProgredir(Math.round(pct * 0.1), etapa, 'Instalando a voz neural (uma vez só)'))
          relatorio.push('Voz neural Piper instalada.')
        } catch (e) {
          relatorio.push(`A voz neural não pôde ser instalada agora (${e instanceof Error ? e.message : 'erro'}); usada a voz do Windows.`)
        }
      }
      const cenas = textosDasCenas(estado).filter((c) => c.texto)
      const narracoes: { cena: number; recursoId: number; duracao: number }[] = []
      let descricaoVoz = ''
      for (const [i, c] of cenas.entries()) {
        if (sinal.aborted) throw new Error('Cancelado.')
        aoProgredir(Math.round((i / cenas.length) * 40), 'Gerando a narração', `Cena ${i + 1} de ${cenas.length}: ${c.titulo}`)
        const arq = join(temp, `narracao-cena-${i + 1}.wav`)
        const v = await sintetizar(pref.voz, c.texto, arq, pastaFerramentas)
        descricaoVoz = v.descricao
        const m = await registrarArquivoGerado(ctx.db, ctx.pastaMidia, arq, {
          ...base,
          cena: c.titulo,
          origem: `Narração sintética — ${v.descricao}`,
          autor: 'Gerado no aplicativo',
          urlOrigem: '',
          licenca: 'Voz sintética gerada no aplicativo',
          situacaoLicenca: 'gerado_ia',
          duracaoSeg: v.duracao
        })
        narracoes.push({ cena: c.indice, recursoId: m.id, duracao: v.duracao })
      }
      if (narracoes.length) {
        estado = retemporizarComNarracao(estado, narracoes)
        relatorio.push(`Narração gerada em ${narracoes.length} cena(s) (${descricaoVoz}); cada cena foi ajustada à duração da fala.`)
      }
    }

    // 2) Imagens e vídeos para as cenas sem visual: busca com licença livre e, se preciso, geração por IA.
    if (op.imagens) {
      const pendentes = estado.cenas.filter((c) => !temVisual(estado, c.indice))
      const textos = new Map(textosDasCenas(estado).map((c) => [c.indice, c.texto]))
      const visuais = visuaisDoRoteiro(ctx, roteiro.id)
      // Consultas da mais específica para a mais ampla: só o título da cena, título + tema, e o tema do vídeo.
      const consultas = pendentes.map((c) => [...new Set([termosDeBusca(c.titulo, ''), termosDeBusca(c.titulo, roteiro.titulo).split(' ').slice(0, 3).join(' '), termosDeBusca(roteiro.titulo, '')].filter(Boolean))])
      const planas = consultas.flat()
      const traduzidas = pref.busca.fontes.includes('wikimedia') ? await traduzirTermos(ctx, planas, sinal) : planas
      const emIngles = new Map(planas.map((q, i) => [q, traduzidas[i] ?? q]))
      const jaUsadas = new Set(listarMidia(ctx.db, base).map((m) => m.urlOrigem).filter(Boolean))
      const orientacao = estado.formato === '9:16' ? 'vertical' : 'horizontal'
      const chave = (s: string): string | null => ctx.cofre.obter(chaveServico(s))
      let buscadas = 0
      let geradas = 0
      let cartoes = 0
      /** Busca e baixa até "limite" mídias do tipo pedido para a cena, nas fontes em ordem. Devolve quantas obteve. */
      const buscarEBaixar = async (i: number, cena: { titulo: string }, tipo: 'imagem' | 'video', limite: number): Promise<number> => {
        let obtidas = 0
        for (const fonte of pref.busca.fontes) {
          if (obtidas >= limite) break
          const info = INFO_FONTE_IMAGEM[fonte]
          const k = info.exigeChave ? chave(fonte) : ''
          if (info.exigeChave && !k) continue
          let achados: ResultadoMidia[] = []
          try {
            for (const consulta of consultas[i]!) {
              const q = fonte === 'wikimedia' ? (emIngles.get(consulta) ?? consulta) : consulta
              achados =
                fonte === 'wikimedia'
                  ? tipo === 'video'
                    ? await buscarWikimediaVideos(q, limite + 2, pref.busca.aceitarCompartilhaIgual, orientacao)
                    : await buscarWikimedia(q, limite + 3, pref.busca.aceitarCompartilhaIgual, orientacao)
                  : fonte === 'pexels'
                    ? await buscarPexels(q, k!, limite + 3, tipo, orientacao)
                    : await buscarPixabay(q, k!, limite + 3, tipo, orientacao)
              achados = achados.filter((x) => !jaUsadas.has(x.urlPagina))
              if (achados.length) break
            }
          } catch (e) {
            relatorio.push(`${info.nome}: busca falhou (${e instanceof Error ? e.message : 'erro'}).`)
            continue
          }
          for (const r of achados) {
            if (obtidas >= limite) break
            try {
              const d = await baixarMidia(r)
              const arq = join(temp, `busca-${i}-${tipo}-${obtidas}${d.ext}`)
              writeFileSync(arq, d.bytes)
              const m = await registrarArquivoGerado(ctx.db, ctx.pastaMidia, arq, {
                ...base,
                cena: cena.titulo,
                origem: `${info.nome}: ${r.titulo}`.slice(0, 300),
                autor: r.autor,
                urlOrigem: r.urlPagina,
                licenca: r.licenca,
                situacaoLicenca: 'licenciado',
                duracaoSeg: r.duracaoSeg
              })
              const f = ctx.ferramentas()
              if (f) await preencherMetadados(ctx.db, m.id, f).catch(() => undefined)
              jaUsadas.add(r.urlPagina)
              obtidas++
            } catch {
              // arquivo indisponível ou inválido: tenta o próximo resultado
            }
          }
        }
        return obtidas
      }
      let videosObtidos = 0
      for (const [i, cena] of pendentes.entries()) {
        if (sinal.aborted) throw new Error('Cancelado.')
        const pct = 40 + Math.round((i / Math.max(1, pendentes.length)) * 50)
        aoProgredir(pct, 'Buscando vídeos e imagens com licença livre', `Cena ${i + 1} de ${pendentes.length}: ${cena.titulo}`)
        // Cenas alternadas abrem com um vídeo; uma foto (ou cartão) completa o tempo que o vídeo não cobrir.
        const querVideo = pref.video.videos && (pref.busca.preferirVideos || i % 2 === 1)
        const videos = querVideo ? await buscarEBaixar(i, cena, 'video', 1) : 0
        videosObtidos += videos
        const fotos = await buscarEBaixar(i, cena, 'imagem', pref.busca.porCena)
        let obtidas = videos + fotos
        buscadas += obtidas
        const k = chave(pref.geracao.gerador)
        if (pref.geracao.ativa && (obtidas === 0 || pref.geracao.sempre) && k) {
          aoProgredir(pct, 'Gerando imagem com IA', `Cena ${i + 1} de ${pendentes.length}: ${cena.titulo}`)
          try {
            const prompt = promptDaCena({ titulo: cena.titulo, visual: visuais.get(cena.titulo.trim().toLowerCase()) ?? '', narracao: textos.get(cena.indice) ?? '', estilo: pref.geracao.estilo, formato: estado.formato })
            const g = await gerarImagem(pref.geracao.gerador, prompt, estado.formato, k, pref.geracao.contaCloudflare, sinal)
            const arq = join(temp, `gerada-${i}${g.ext}`)
            writeFileSync(arq, g.bytes)
            const m = await registrarArquivoGerado(ctx.db, ctx.pastaMidia, arq, {
              ...base,
              cena: cena.titulo,
              origem: `Imagem gerada por IA — ${g.modelo}. Prompt: ${prompt}`.slice(0, 300),
              autor: 'Gerada por IA',
              urlOrigem: '',
              licenca: `Gerada por IA (${INFO_GERADOR[pref.geracao.gerador].nome}); confira os termos do serviço`,
              situacaoLicenca: 'gerado_ia'
            })
            const f = ctx.ferramentas()
            if (f) await preencherMetadados(ctx.db, m.id, f).catch(() => undefined)
            obtidas++
            geradas++
          } catch (e) {
            relatorio.push(`Cena “${cena.titulo}”: a geração de imagem falhou (${e instanceof Error ? e.message : 'erro'}).`)
          }
        }
        // Último recurso, sem chave e sem internet: cartão gráfico com o título e a frase-chave da cena
        // (também completa cenas que só ganharam um vídeo curto, para não sobrar tela preta).
        const f = ctx.ferramentas()
        if ((obtidas === 0 || (videos > 0 && obtidas === videos)) && pref.geracao.cartoes && f) {
          try {
            const arq = await gerarCartao(f, { titulo: cena.titulo, frase: fraseDoCartao(textos.get(cena.indice) ?? ''), formato: estado.formato, indice: i, pasta: join(temp, `cartao-${i}`) })
            await registrarArquivoGerado(ctx.db, ctx.pastaMidia, arq, {
              ...base,
              cena: cena.titulo,
              origem: 'Cartão gráfico criado pelo aplicativo (título e frase da cena)',
              autor: 'Estúdio IA YouTube',
              urlOrigem: '',
              licenca: 'Criado no aplicativo',
              situacaoLicenca: 'criado_usuario'
            })
            obtidas++
            cartoes++
          } catch (e) {
            relatorio.push(`Cena “${cena.titulo}”: o cartão gráfico falhou (${e instanceof Error ? e.message : 'erro'}).`)
          }
        }
        if (obtidas === 0) relatorio.push(`Cena “${cena.titulo}”: ficou sem imagem${!f ? ' (instale o FFmpeg para o app criar cartões gráficos)' : ''}.`)
      }
      if (pendentes.length) relatorio.unshift(`${buscadas} mídia(s) com licença livre (${videosObtidos} vídeo(s)), ${geradas} imagem(ns) gerada(s) por IA e ${cartoes} cartão(ões) gráfico(s) para ${pendentes.length} cena(s).`)
    }

    // 3) Acabamento: título de cada cena na tela e trilha sonora em todo vídeo.
    if (pref.video.titulos && !estado.clips.some((c) => c.faixa === 'textos')) {
      for (const c of estado.cenas) {
        const iv = intervaloCena(estado, c.indice)
        const titulo = tituloDoCartao(c.titulo)
        if (!iv || iv.fim - iv.inicio < 2.5 || !titulo || /^(in[ií]cio|fontes?)$/i.test(titulo) || titulo.startsWith('#')) continue
        estado = adicionarClip(estado, { faixa: 'textos', recursoId: null, inicio: iv.inicio + 0.3, duracao: Math.min(3, iv.fim - iv.inicio - 0.5), corteInicio: 0, volume: 1, fadeIn: 0, fadeOut: 0, texto: titulo.slice(0, 80), cena: c.indice })
      }
    }
    const ff = ctx.ferramentas()
    const temTrilha = estado.clips.some((c) => c.faixa === 'audio') || listarMidia(ctx.db, base).some((m) => m.categoria === 'audio' && m.cena.toLowerCase() === 'trilha' && m.roteiroId === roteiro.id)
    if (pref.video.trilha && !temTrilha && ff) {
      aoProgredir(92, 'Compondo a trilha sonora')
      try {
        const tr = await gerarTrilha(ff, duracaoTotal(estado) + 1, roteiro.id, join(temp, 'trilha'))
        await registrarArquivoGerado(ctx.db, ctx.pastaMidia, tr.arquivo, {
          ...base,
          cena: 'trilha',
          origem: `Trilha sonora original composta pelo aplicativo (estilo ${tr.estilo})`,
          autor: 'Estúdio IA YouTube',
          urlOrigem: '',
          licenca: 'Criada no aplicativo',
          situacaoLicenca: 'criado_usuario',
          duracaoSeg: duracaoTotal(estado) + 1
        })
        relatorio.push(`Trilha sonora original (estilo ${tr.estilo}) composta para o vídeo.`)
      } catch (e) {
        relatorio.push(`A trilha sonora não pôde ser composta (${e instanceof Error ? e.message : 'erro'}).`)
      }
    }

    // 4) Montagem na linha do tempo (as mídias marcadas com o nome da cena vão para a cena certa).
    aoProgredir(96, 'Montando a linha do tempo')
    const midias = listarMidia(ctx.db, base)
      .map((m) => ({ id: m.id, categoria: m.categoria, cena: m.cena, nome: m.nomeOriginal, duracaoSeg: m.duracaoSeg }))
      .sort((a, b) => Number(b.categoria === 'video') - Number(a.categoria === 'video') || a.id - b.id)
    const montagem = montarAutomaticamente(estado, midias)
    relatorio.push(...montagem.relatorio)
    const corrigida = corrigirEstado(ctx.db, montagem.estado)
    relatorio.push(...corrigida.correcoes)
    const salvo = salvarEdicao(ctx.db, ed.id, ed.revisao, corrigida.estado)
    registrarEvento(ctx.db, 'info', 'midia', `Mídias produzidas para a edição nº ${edicaoId}: ${relatorio[0] ?? ''}`.slice(0, 500))
    aoProgredir(100, 'Concluído')
    return { relatorio, revisao: salvo.revisao }
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
}
