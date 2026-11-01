/** Vocabulário da biblioteca de mídia (Etapa 11). */

export const SITUACOES_LICENCA = ['criado_usuario', 'gerado_ia', 'licenciado', 'dominio_publico_verificar', 'nao_verificado'] as const
export type SituacaoLicenca = (typeof SITUACOES_LICENCA)[number]
export const ROTULO_LICENCA: Record<SituacaoLicenca, string> = {
  criado_usuario: 'Criado por você',
  gerado_ia: 'Gerado por IA',
  licenciado: 'Licenciado',
  dominio_publico_verificar: 'Domínio público (verificar)',
  nao_verificado: 'Uso ainda não verificado'
}

export const CATEGORIAS_MIDIA = ['video', 'audio', 'imagem', 'legenda'] as const
export type CategoriaMidia = (typeof CATEGORIAS_MIDIA)[number]
export const ROTULO_CATEGORIA_MIDIA: Record<CategoriaMidia, string> = { video: 'Vídeo', audio: 'Áudio', imagem: 'Imagem', legenda: 'Legenda' }

/** Alertas de proveniência: nunca presumir que mídia da internet pode ser reutilizada livremente. */
export function alertasLicenca(r: { situacaoLicenca: SituacaoLicenca; licenca: string; origem: string; urlOrigem: string }): string[] {
  const a: string[] = []
  if (r.situacaoLicenca === 'nao_verificado') a.push('Uso ainda não verificado: confirme a licença antes de publicar.')
  if (r.situacaoLicenca === 'licenciado' && !r.licenca.trim()) a.push('Marcado como licenciado, mas a licença/condições não foram registradas.')
  if (r.situacaoLicenca === 'dominio_publico_verificar') a.push('Domínio público precisa de verificação da fonte e da data.')
  if (!r.origem.trim() && !r.urlOrigem.trim() && r.situacaoLicenca !== 'criado_usuario') a.push('Origem não registrada.')
  if (r.situacaoLicenca === 'gerado_ia') a.push('Gerado por IA: verifique se o YouTube exige rótulo de conteúdo sintético realista.')
  return a
}

// ------------------------------------------------------------------ renderização (até 4K)

export const RESOLUCOES = ['720p', '1080p', '1440p', '2160p'] as const
export type Resolucao = (typeof RESOLUCOES)[number]

/**
 * Taxas de bits de referência para envio ao YouTube (SDR, H.264), em Mbps, para 24–30 e 48–60 quadros/s.
 * Usadas como teto da taxa de bits (com folga conforme a qualidade) e para estimar o tamanho do arquivo.
 */
export const RESOLUCAO_INFO: Record<Resolucao, { curta: number; nome: string; mbps30: number; mbps60: number }> = {
  '720p': { curta: 720, nome: 'HD 720p', mbps30: 5, mbps60: 7.5 },
  '1080p': { curta: 1080, nome: 'Full HD 1080p', mbps30: 8, mbps60: 12 },
  '1440p': { curta: 1440, nome: 'QHD 1440p (2K)', mbps30: 16, mbps60: 24 },
  '2160p': { curta: 2160, nome: 'UHD 2160p (4K)', mbps30: 40, mbps60: 60 }
}

export const PRESETS_RENDER = {
  '16:9-720p': { formato: '16:9', resolucao: '720p', largura: 1280, altura: 720, rotulo: 'Vídeo longo 720p (1280×720)' },
  '16:9-1080p': { formato: '16:9', resolucao: '1080p', largura: 1920, altura: 1080, rotulo: 'Vídeo longo 1080p (1920×1080)' },
  '16:9-1440p': { formato: '16:9', resolucao: '1440p', largura: 2560, altura: 1440, rotulo: 'Vídeo longo 1440p/2K (2560×1440)' },
  '16:9-2160p': { formato: '16:9', resolucao: '2160p', largura: 3840, altura: 2160, rotulo: 'Vídeo longo 4K (3840×2160)' },
  '9:16-720p': { formato: '9:16', resolucao: '720p', largura: 720, altura: 1280, rotulo: 'Short 720p (720×1280)' },
  '9:16-1080p': { formato: '9:16', resolucao: '1080p', largura: 1080, altura: 1920, rotulo: 'Short 1080p (1080×1920)' },
  '9:16-1440p': { formato: '9:16', resolucao: '1440p', largura: 1440, altura: 2560, rotulo: 'Short 1440p/2K (1440×2560)' },
  '9:16-2160p': { formato: '9:16', resolucao: '2160p', largura: 2160, altura: 3840, rotulo: 'Short 4K (2160×3840)' }
} as const
export type PresetRender = keyof typeof PRESETS_RENDER
export const presetsDoFormato = (formato: '16:9' | '9:16'): PresetRender[] => (Object.keys(PRESETS_RENDER) as PresetRender[]).filter((p) => PRESETS_RENDER[p].formato === formato)

export const FPS_RENDER = [24, 25, 30, 60] as const
export type FpsRender = (typeof FPS_RENDER)[number]
export const QUALIDADES_RENDER = {
  padrao: { crf: 23, fatorTaxa: 1, audioKbps: 192, rotulo: 'Padrão (arquivos menores)' },
  alta: { crf: 20, fatorTaxa: 1.5, audioKbps: 256, rotulo: 'Alta (recomendada)' },
  maxima: { crf: 17, fatorTaxa: 2.5, audioKbps: 320, rotulo: 'Máxima (arquivos bem maiores)' }
} as const
export type QualidadeRender = keyof typeof QUALIDADES_RENDER
export const VELOCIDADES_RENDER = {
  rapida: { x264: 'veryfast', fatorTempo: 0.5, rotulo: 'Rápida (um pouco menos eficiente)' },
  equilibrada: { x264: 'medium', fatorTempo: 1, rotulo: 'Equilibrada (recomendada)' },
  lenta: { x264: 'slow', fatorTempo: 2, rotulo: 'Lenta (arquivo um pouco menor, demora mais)' }
} as const
export type VelocidadeRender = keyof typeof VELOCIDADES_RENDER

export interface OpcoesRender {
  fps: FpsRender
  qualidade: QualidadeRender
  velocidade: VelocidadeRender
}
export const OPCOES_RENDER_RECOMENDADAS: OpcoesRender = { fps: 30, qualidade: 'alta', velocidade: 'equilibrada' }

/** Teto de taxa de bits do vídeo (Mbps) para o preset e as opções. */
export function taxaMaximaMbps(preset: PresetRender, o: OpcoesRender): number {
  const r = RESOLUCAO_INFO[PRESETS_RENDER[preset].resolucao]
  return (o.fps > 30 ? r.mbps60 : r.mbps30) * QUALIDADES_RENDER[o.qualidade].fatorTaxa
}

/** Tamanho máximo esperado do arquivo (o real costuma ser menor). */
export function estimarBytesRender(preset: PresetRender, o: OpcoesRender, duracaoSeg: number): number {
  const mbps = taxaMaximaMbps(preset, o) + QUALIDADES_RENDER[o.qualidade].audioKbps / 1000
  return Math.ceil((duracaoSeg * mbps * 1_000_000) / 8)
}

/**
 * Tempo relativo de renderização (1 = 1080p 30 q/s equilibrada). Só serve para comparar opções:
 * o tempo real depende do computador.
 */
export function custoRelativo(preset: PresetRender, o: OpcoesRender): number {
  const p = PRESETS_RENDER[preset]
  return Math.round(((p.largura * p.altura) / (1920 * 1080)) * (o.fps / 30) * VELOCIDADES_RENDER[o.velocidade].fatorTempo * 10) / 10
}

export interface FonteVisual {
  largura: number | null
  altura: number | null
  fps: number | null
  categoria: 'video' | 'imagem'
}

export interface RecomendacaoRender {
  preset: PresetRender
  opcoes: OpcoesRender
  motivos: string[]
  /** Avisos de cada preset do formato (ampliação de mídias, tempo, tamanho). */
  avisos: Partial<Record<PresetRender, string[]>>
}

const lado = (f: FonteVisual): number | null => (f.largura && f.altura ? Math.min(f.largura, f.altura) : null)

/** Recomendação determinística: não amplia além da melhor mídia, Shorts em 1080p, quadros/s da fonte. */
export function recomendarRender(formato: '16:9' | '9:16', fontes: FonteVisual[]): RecomendacaoRender {
  const motivos: string[] = []
  const lados = fontes.map(lado).filter((x): x is number => x !== null)
  const maior = lados.length ? Math.max(...lados) : null
  const semInfo = fontes.length - lados.length

  let res: Resolucao
  if (formato === '9:16') {
    res = maior !== null && maior < 1000 ? '720p' : '1080p'
    motivos.push(
      res === '1080p'
        ? 'Shorts são vistos no celular: 1080×1920 é o padrão recomendado e renderiza muito mais rápido que 2K/4K.'
        : 'As mídias deste Short são menores que 1080p; 720×1280 evita ampliar demais as imagens.'
    )
  } else if (maior === null) {
    res = '1080p'
    motivos.push('A resolução das mídias ainda não é conhecida; 1080p é o ponto de partida seguro para vídeos longos.')
  } else {
    // A maior resolução que a melhor mídia suporta sem ampliar (com 5% de tolerância), nunca abaixo de 1080p.
    const cabe = [...RESOLUCOES].reverse().find((r) => RESOLUCAO_INFO[r].curta <= maior * 1.05) ?? '720p'
    res = RESOLUCAO_INFO[cabe].curta < 1080 ? '1080p' : cabe
    if (RESOLUCAO_INFO[cabe].curta < 1080) {
      motivos.push(`A melhor mídia do projeto tem ${maior}p no lado menor. Mesmo com mídias menores, 1080p é o mínimo recomendado para vídeos longos (elas serão ampliadas).`)
    } else {
      motivos.push(`A melhor mídia do projeto tem ${maior}p no lado menor; ${RESOLUCAO_INFO[res].nome} aproveita esse detalhe sem ampliar além dele.`)
    }
    if (res === '1440p' || res === '2160p') motivos.push('Envios em 2K/4K costumam receber compressão de melhor qualidade no YouTube, inclusive para quem assiste em 1080p.')
  }
  if (semInfo > 0) motivos.push(`${semInfo} mídia(s) sem resolução conhecida não entraram no cálculo.`)

  const fpsVideos = fontes.filter((f) => f.categoria === 'video' && f.fps).map((f) => f.fps!)
  let fps: FpsRender = 30
  if (fpsVideos.some((x) => x >= 48)) {
    fps = 60
    motivos.push('Há vídeo gravado a 60 quadros/s; manter 60 preserva a fluidez do movimento (renderização mais lenta).')
  } else if (fpsVideos.length && fpsVideos.every((x) => Math.abs(x - 24) < 0.5 || Math.abs(x - 23.976) < 0.1)) {
    fps = 24
    motivos.push('Os vídeos foram gravados a 24 quadros/s; manter 24 evita trepidação.')
  } else if (fpsVideos.length && fpsVideos.every((x) => Math.abs(x - 25) < 0.5)) {
    fps = 25
    motivos.push('Os vídeos foram gravados a 25 quadros/s; manter 25 evita trepidação.')
  } else {
    motivos.push('30 quadros/s é o padrão para vídeos com narração, telas e imagens.')
  }
  const opcoes: OpcoesRender = { ...OPCOES_RENDER_RECOMENDADAS, fps }

  const avisos: Partial<Record<PresetRender, string[]>> = {}
  for (const p of presetsDoFormato(formato)) {
    const a: string[] = []
    const curta = RESOLUCAO_INFO[PRESETS_RENDER[p].resolucao].curta
    const menores = lados.filter((l) => l * 1.05 < curta).length
    if (menores) a.push(`${menores} mídia(s) têm resolução menor e serão ampliadas (ampliar não cria detalhe novo).`)
    if (PRESETS_RENDER[p].resolucao === '2160p') a.push('4K demora bem mais para renderizar e gera arquivos grandes; confira o espaço em disco.')
    if (formato === '9:16' && curta > 1080) a.push('Para Shorts, resoluções acima de 1080p aumentam o tempo e o arquivo com pouco ganho visível no celular.')
    if (a.length) avisos[p] = a
  }
  return { preset: `${formato}-${res}` as PresetRender, opcoes, motivos, avisos }
}

/** Preferência guardada nas configurações (escolhida no assistente ou em Configurações). */
export interface PreferenciaRender {
  modo: 'recomendado' | 'fixo'
  longo: Resolucao
  short: Resolucao
  opcoes: OpcoesRender
}
export const PREFERENCIA_RENDER_PADRAO: PreferenciaRender = { modo: 'recomendado', longo: '1080p', short: '1080p', opcoes: OPCOES_RENDER_RECOMENDADAS }
