import { z } from 'zod'
import type { TipoFonte, TipoVideo } from './dominio'

/**
 * Avaliação de pautas por regras fixas e critérios configuráveis (Etapa 6).
 * Não prevê visualizações: só organiza critérios editoriais para ajudar na escolha.
 */

export const pesosSchema = z.object({
  atualidade: z.number().min(0).max(10),
  relevancia: z.number().min(0).max(10),
  confiabilidade: z.number().min(0).max(10),
  nicho: z.number().min(0).max(10),
  diversidade: z.number().min(0).max(10),
  narrativa: z.number().min(0).max(10),
  penalidadeRiscoAlto: z.number().min(0).max(50),
  penalidadeRiscoMedio: z.number().min(0).max(50),
  penalidadeSemelhanca: z.number().min(0).max(50)
})
export type PesosPlanejador = z.infer<typeof pesosSchema>

export const PESOS_PADRAO: PesosPlanejador = {
  atualidade: 3,
  relevancia: 2,
  confiabilidade: 2,
  nicho: 1.5,
  diversidade: 1,
  narrativa: 1,
  penalidadeRiscoAlto: 15,
  penalidadeRiscoMedio: 5,
  penalidadeSemelhanca: 10
}

export const ROTULO_FATOR: Record<keyof Omit<PesosPlanejador, `penalidade${string}`>, string> = {
  atualidade: 'Atualidade',
  relevancia: 'Relevância das fontes',
  confiabilidade: 'Confiabilidade aproximada',
  nicho: 'Relação com o nicho',
  diversidade: 'Diversidade de fontes',
  narrativa: 'Potencial de narrativa (sua avaliação)'
}

export interface FontePreliminar {
  dominio: string
  tipoFonte: TipoFonte
  publicadaEm: string | null
  relevancia: number
  confiabilidade: number
  nicho: number
  alertaInjecao: boolean
}

export interface Semelhante {
  tipo: 'roteiro' | 'pauta'
  id: number
  titulo: string
  similaridade: number
}

export interface Risco {
  codigo: 'sem_fontes' | 'fonte_unica' | 'baixa_confiabilidade' | 'repetido' | 'direitos' | 'injecao' | 'sem_data'
  nivel: 'alto' | 'medio' | 'baixo'
  mensagem: string
}

export interface Fator {
  chave: string
  rotulo: string
  valor: number
  peso: number
  contribuicao: number
  explicacao: string
}

export interface AvaliacaoPauta {
  atualidade: { rotulo: string; janela: string; maisRecente: string | null }
  riscos: Risco[]
  complexidade: { nivel: 1 | 2 | 3; rotulo: string; motivo: string }
  custo: { rotulo: 'Baixo' | 'Médio' | 'Alto'; motivo: string }
  tipoSugerido: { tipo: TipoVideo; motivo: string; definidoPeloUsuario: boolean }
  pontuacao: { total: number; fatores: Fator[]; penalidades: { motivo: string; pontos: number }[]; aviso: string }
  semelhantes: Semelhante[]
  recomendacao: string | null
}

const PLATAFORMAS_MIDIA = ['youtube.com', 'youtu.be', 'tiktok.com', 'instagram.com', 'vimeo.com', 'twitch.tv', 'spotify.com']

const pct = (n: number): string => `${Math.round(n * 100)}%`
const media = (l: number[]): number => (l.length ? l.reduce((a, b) => a + b, 0) / l.length : 0)

export function avaliarPauta(
  p: { tipoSugerido: TipoVideo | null; potencialNarrativa: number | null; resumo: string },
  fontes: readonly FontePreliminar[],
  semelhantes: readonly Semelhante[],
  pesos: PesosPlanejador,
  agora: Date
): AvaliacaoPauta {
  const dominios = new Set(fontes.map((f) => f.dominio))
  const datas = fontes.map((f) => f.publicadaEm).filter((d): d is string => !!d).sort()
  const maisRecente = datas.at(-1) ?? null
  const idadeDias = maisRecente ? Math.max(0, (agora.getTime() - new Date(maisRecente).getTime()) / 86_400_000) : null

  // Atualidade e janela temporal.
  let atualidadeValor = 0.3
  let atualidade: AvaliacaoPauta['atualidade'] = { rotulo: 'Sem data', janela: 'Sem data nas fontes: confira se o assunto ainda está atual.', maisRecente }
  if (idadeDias !== null) {
    if (idadeDias <= 2) {
      atualidadeValor = 1
      atualidade = { rotulo: 'Muito atual', janela: 'Janela curta: faz mais sentido publicar nos próximos dias.', maisRecente }
    } else if (idadeDias <= 14) {
      atualidadeValor = 0.75
      atualidade = { rotulo: 'Atual', janela: 'Janela de algumas semanas.', maisRecente }
    } else if (idadeDias <= 60) {
      atualidadeValor = 0.45
      atualidade = { rotulo: 'Recente', janela: 'Pode precisar de um ângulo novo ou atualização.', maisRecente }
    } else {
      atualidadeValor = 0.2
      atualidade = { rotulo: 'Antigo ou atemporal', janela: 'Funciona melhor como tema explicativo, não como notícia.', maisRecente }
    }
  }

  // Riscos.
  const riscos: Risco[] = []
  if (fontes.length === 0) riscos.push({ codigo: 'sem_fontes', nivel: 'alto', mensagem: 'Nenhuma fonte preliminar: a informação ainda não tem sustentação.' })
  else if (dominios.size === 1) riscos.push({ codigo: 'fonte_unica', nivel: 'medio', mensagem: 'Apenas um site como fonte: confirme com fontes independentes.' })
  const confMedia = media(fontes.map((f) => f.confiabilidade))
  if (fontes.length && confMedia < 0.5) riscos.push({ codigo: 'baixa_confiabilidade', nivel: 'medio', mensagem: `Confiabilidade média aproximada baixa (${pct(confMedia)}).` })
  const maisParecido = semelhantes[0]
  if (maisParecido && maisParecido.similaridade >= 0.5) {
    riscos.push({
      codigo: 'repetido',
      nivel: maisParecido.similaridade >= 0.75 ? 'alto' : 'medio',
      mensagem: `Parecido com o ${maisParecido.tipo} “${maisParecido.titulo}” (${pct(maisParecido.similaridade)} de semelhança).`
    })
  }
  if (fontes.some((f) => f.tipoFonte === 'rede_social' || PLATAFORMAS_MIDIA.some((d) => f.dominio === d || f.dominio.endsWith(`.${d}`)))) {
    riscos.push({ codigo: 'direitos', nivel: 'medio', mensagem: 'Há fontes de redes sociais ou plataformas de vídeo: não reutilize trechos, imagens ou áudio sem licença.' })
  }
  if (fontes.some((f) => f.alertaInjecao)) riscos.push({ codigo: 'injecao', nivel: 'medio', mensagem: 'Uma fonte contém texto com instruções suspeitas; trate-a com cautela.' })
  if (fontes.length && datas.length < fontes.length) riscos.push({ codigo: 'sem_data', nivel: 'baixo', mensagem: 'Algumas fontes não informam data de publicação.' })

  // Tipo sugerido, complexidade e custo.
  const tipoSugerido: AvaliacaoPauta['tipoSugerido'] = p.tipoSugerido
    ? { tipo: p.tipoSugerido, motivo: 'Definido por você.', definidoPeloUsuario: true }
    : dominios.size >= 3 || p.resumo.length > 400
      ? { tipo: 'longo', motivo: 'Várias fontes ou assunto amplo: cabe em um vídeo explicativo.', definidoPeloUsuario: false }
      : { tipo: 'short', motivo: 'Poucas fontes e ideia única: cabe em um Short.', definidoPeloUsuario: false }
  const tecnico = fontes.some((f) => f.tipoFonte === 'estudo' || f.tipoFonte === 'documentacao')
  const nivel = Math.min(3, 1 + (tipoSugerido.tipo === 'longo' ? 1 : 0) + (tecnico || dominios.size >= 5 ? 1 : 0)) as 1 | 2 | 3
  const complexidade = {
    nivel,
    rotulo: ['Baixa', 'Média', 'Alta'][nivel - 1]!,
    motivo: [tipoSugerido.tipo === 'longo' ? 'vídeo longo' : 'Short', tecnico ? 'fontes técnicas/estudos' : null, dominios.size >= 5 ? 'muitas fontes para cruzar' : null].filter(Boolean).join(', ')
  }
  const custo: AvaliacaoPauta['custo'] =
    nivel === 1
      ? { rotulo: 'Baixo', motivo: 'Estimativa de tempo e recursos de produção (não é valor em dinheiro).' }
      : nivel === 2
        ? { rotulo: 'Médio', motivo: 'Estimativa de tempo e recursos de produção (não é valor em dinheiro).' }
        : { rotulo: 'Alto', motivo: 'Estimativa de tempo e recursos de produção (não é valor em dinheiro).' }

  // Pontuação explicável.
  const valores = {
    atualidade: { v: atualidadeValor, e: atualidade.rotulo },
    relevancia: { v: fontes.length ? media(fontes.map((f) => f.relevancia)) : 0, e: fontes.length ? `média de ${fontes.length} fonte(s)` : 'sem fontes' },
    confiabilidade: { v: fontes.length ? confMedia : 0, e: fontes.length ? 'média aproximada por domínio' : 'sem fontes' },
    nicho: { v: fontes.length ? media(fontes.map((f) => f.nicho)) : 0, e: 'termos do nicho nas fontes' },
    diversidade: { v: Math.min(1, dominios.size / 3), e: `${dominios.size} site(s) diferente(s)` },
    narrativa: { v: p.potencialNarrativa ? (p.potencialNarrativa - 1) / 4 : 0.5, e: p.potencialNarrativa ? `nota ${p.potencialNarrativa} de 5` : 'não avaliado (neutro)' }
  }
  const somaPesos = Object.keys(valores).reduce((s, k) => s + pesos[k as keyof typeof valores], 0) || 1
  const fatores: Fator[] = (Object.keys(valores) as (keyof typeof valores)[]).map((k) => {
    const contribuicao = (100 * pesos[k] * valores[k].v) / somaPesos
    return { chave: k, rotulo: ROTULO_FATOR[k], valor: valores[k].v, peso: pesos[k], contribuicao, explicacao: `${pct(valores[k].v)} — ${valores[k].e}` }
  })
  const penalidades: { motivo: string; pontos: number }[] = []
  for (const r of riscos) {
    if (r.codigo === 'repetido') continue
    if (r.nivel === 'alto') penalidades.push({ motivo: r.mensagem, pontos: pesos.penalidadeRiscoAlto })
    if (r.nivel === 'medio') penalidades.push({ motivo: r.mensagem, pontos: pesos.penalidadeRiscoMedio })
  }
  if (maisParecido && maisParecido.similaridade >= 0.5) penalidades.push({ motivo: 'Tema semelhante a conteúdo anterior', pontos: pesos.penalidadeSemelhanca })
  const bruto = fatores.reduce((s, f) => s + f.contribuicao, 0) - penalidades.reduce((s, x) => s + x.pontos, 0)

  return {
    atualidade,
    riscos,
    complexidade,
    custo,
    tipoSugerido,
    pontuacao: {
      total: Math.max(0, Math.min(100, Math.round(bruto))),
      fatores,
      penalidades,
      aviso: 'Pontuação estimada a partir de critérios configuráveis. Não prevê visualizações nem resultado do vídeo.'
    },
    semelhantes: [...semelhantes],
    recomendacao:
      maisParecido && maisParecido.similaridade >= 0.5
        ? `Tema próximo de “${maisParecido.titulo}”. Temas recorrentes podem ser úteis: diferencie com um ângulo, exemplo ou pergunta nova.`
        : null
  }
}
