import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { duracaoTotal, type EstadoEdicao } from '@shared/edicao'
import { planoApresentador, type TrechoApresentador } from '@shared/apresentador'
import { OPCOES_RENDER_RECOMENDADAS, PRESETS_RENDER, QUALIDADES_RENDER, VELOCIDADES_RENDER, taxaMaximaMbps, type OpcoesRender, type PresetRender } from '@shared/midia'

/**
 * Integração com FFmpeg/FFprobe (Etapas 11 e 12).
 * - Comandos montados como LISTA de argumentos e executados sem shell: nada é concatenado em texto de comando.
 * - Nenhum valor vem de roteiros ou páginas: caminhos são os da biblioteca do app; textos vão para arquivos SRT.
 * - FFmpeg não é distribuído com o app: o usuário instala (ver documentação) e o app o localiza.
 */

export interface Ferramentas {
  ffmpeg: string
  ffprobe: string
}

/** Procura ffmpeg/ffprobe no caminho configurado ou no PATH do Windows (sem shell). */
export function localizarFerramentas(configurado: string | null): Ferramentas | null {
  let ffmpeg = configurado
  if (!ffmpeg) {
    const r = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', ['ffmpeg'], { encoding: 'utf8', windowsHide: true, timeout: 5000 })
    ffmpeg = r.status === 0 ? (r.stdout.split(/\r?\n/).find(Boolean)?.trim() ?? null) : null
  }
  if (!ffmpeg || !/ffmpeg(\.exe)?$/i.test(ffmpeg) || !existsSync(ffmpeg)) return null
  // O ffprobe acompanha o ffmpeg na mesma pasta.
  const ffprobe = ffmpeg.replace(/ffmpeg(\.exe)?$/i, (m) => m.replace(/ffmpeg/i, 'ffprobe'))
  return existsSync(ffprobe) ? { ffmpeg, ffprobe } : null
}

export function versaoFfmpeg(f: Ferramentas): string | null {
  const r = spawnSync(f.ffmpeg, ['-hide_banner', '-version'], { encoding: 'utf8', windowsHide: true, timeout: 10_000 })
  return r.status === 0 ? (r.stdout.split(/\r?\n/)[0] ?? null) : null
}

// ------------------------------------------------------------------ montagem do comando de renderização

export interface RecursoParaRender {
  id: number
  caminho: string
  categoria: 'video' | 'audio' | 'imagem' | 'legenda'
  largura?: number | null
  altura?: number | null
  /** Imagem para ler (cartão com texto): fica parada, sem zoom nem deslocamento. */
  estatico?: boolean
}

/** Acabamento do vídeo: movimento nas fotos, transições entre cenas e apresentador animado. */
export interface EstiloRender {
  movimento: boolean
  transicoes: boolean
  /** Arquivos PNG das poses ("pose-aberta"/"pose-fechada" → caminho) e o canto onde ele fica. */
  apresentador: { pngs: Record<string, string>; lado: 'direita' | 'esquerda' } | null
}

const par = (n: number): number => Math.max(2, Math.round(n / 2) * 2)

/** Junta trechos seguidos com a mesma pose (e preenche pequenos intervalos), para expressões menores. */
export function mesclarTrechos(trechos: TrechoApresentador[]): TrechoApresentador[] {
  const saida: TrechoApresentador[] = []
  for (const tr of trechos) {
    const u = saida.at(-1)
    if (u && u.pose === tr.pose && u.destaque === tr.destaque && u.lado === tr.lado && !tr.entrada && tr.inicio - u.fim < 0.6) u.fim = Math.max(u.fim, tr.fim)
    else if (u && tr.inicio - u.fim < 0.6) {
      u.fim = tr.inicio // sem buraco: o apresentador não some entre uma frase e outra
      saida.push({ ...tr })
    } else saida.push({ ...tr })
  }
  return saida
}

/**
 * Movimento de foto (sem deixar a imagem parada): zoom e deslocamento suaves, com 5 padrões alternados.
 * Fotos com proporção muito diferente do vídeo ganham efeito parallax: fundo desfocado que se aproxima
 * devagar e a foto inteira à frente, deslizando no sentido contrário. Devolve a cadeia SEM o rótulo final.
 */
export function filtroMovimento(entrada: number, r: RecursoParaRender, W: number, H: number, fps: number, dur: number, k: number): string {
  const D = Math.max(1, Math.round(dur * fps))
  const fator = W > 1920 ? 1.5 : 2 // imagem maior que a saída evita tremido no zoom
  const BW = par(W * fator)
  const BH = par(H * fator)
  const centro = { x: 'iw/2-iw/zoom/2', y: 'ih/2-ih/zoom/2' }
  const padroes = [
    { z: `1+0.14*on/${D}`, ...centro },
    { z: `1.14-0.14*on/${D}`, ...centro },
    { z: '1.12', x: `(iw-iw/zoom)*on/${D}`, y: centro.y },
    { z: '1.12', x: `(iw-iw/zoom)*(1-on/${D})`, y: centro.y },
    { z: `1.08+0.06*on/${D}`, x: centro.x, y: `(ih-ih/zoom)*(1-on/${D})` }
  ]
  const m = padroes[k % padroes.length]!
  const proporcao = r.largura && r.altura ? r.largura / r.altura / (W / H) : 1
  if (proporcao > 0.8 && proporcao < 1.25) {
    return `[${entrada}:v]scale=${BW}:${BH}:force_original_aspect_ratio=increase:flags=lanczos,crop=${BW}:${BH},zoompan=z='${m.z}':x='${m.x}':y='${m.y}':d=${D}:s=${W}x${H}:fps=${fps},setsar=1`
  }
  const s = `m${entrada}`
  const amplitude = Math.round(W * 0.04) * (k % 2 === 0 ? 1 : -1)
  return [
    `[${entrada}:v]split=2[${s}a][${s}b]`,
    `[${s}a]scale=${par(W / 2)}:${par(H / 2)}:force_original_aspect_ratio=increase,crop=${par(W / 2)}:${par(H / 2)},boxblur=14:2,zoompan=z='1+0.1*on/${D}':x='${centro.x}':y='${centro.y}':d=${D}:s=${W}x${H}:fps=${fps},eq=brightness=-0.12:saturation=0.8,setsar=1[${s}f]`,
    `[${s}b]scale=${par(W * 0.9)}:${par(H * 0.88)}:force_original_aspect_ratio=decrease:flags=lanczos,loop=loop=${D - 1}:size=1:start=0,setpts=N/${fps}/TB[${s}p]`,
    `[${s}f][${s}p]overlay=x='(W-w)/2+${amplitude}*(t/${dur.toFixed(3)}-0.5)':y='(H-h)/2':eval=frame`
  ].join(';')
}

const num = (n: number): string => (Math.round(n * 1000) / 1000).toString()

/**
 * Monta os argumentos do FFmpeg para o projeto. Legendas e textos são lidos de arquivos SRT
 * gravados na pasta de trabalho (cwd), referenciados por nome simples — sem caminhos no filtro.
 */
export function argumentosRender(
  estado: EstadoEdicao,
  recursos: Map<number, RecursoParaRender>,
  preset: PresetRender,
  saida: string,
  opcoes: { temLegendas: boolean; temTextos: boolean; render?: OpcoesRender; estilo?: EstiloRender }
): string[] {
  const p = PRESETS_RENDER[preset]
  if (p.formato !== estado.formato) throw new Error(`O preset ${preset} não corresponde ao formato do projeto (${estado.formato}).`)
  const total = Math.max(1, duracaoTotal(estado))
  const W = p.largura
  const H = p.altura
  const o = opcoes.render ?? OPCOES_RENDER_RECOMENDADAS
  const fps = o.fps
  const q = QUALIDADES_RENDER[o.qualidade]
  const teto = taxaMaximaMbps(preset, o)
  const args: string[] = ['-hide_banner', '-nostdin', '-y']
  const filtros: string[] = []
  let entrada = 0

  // Trilha visual: segmentos em sequência, com preto nos intervalos vazios.
  const visuais = estado.clips.filter((c) => c.faixa === 'video' && c.recursoId !== null).sort((a, b) => a.inicio - b.inicio)
  const segmentos: string[] = []
  let t = 0
  const preto = (d: number): void => {
    args.push('-f', 'lavfi', '-t', num(d), '-i', `color=c=black:s=${W}x${H}:r=${fps}`)
    filtros.push(`[${entrada}:v]setsar=1,format=yuv420p[v${segmentos.length}]`)
    segmentos.push(`[v${segmentos.length}]`)
    entrada++
  }
  const estilo = opcoes.estilo
  const validos = visuais.filter((c) => {
    const r = recursos.get(c.recursoId!)
    return r && (r.categoria === 'video' || r.categoria === 'imagem')
  })
  let fotos = 0
  validos.forEach((c, idx) => {
    const r = recursos.get(c.recursoId!)!
    const inicio = Math.max(c.inicio, t)
    if (inicio > t + 0.01) preto(inicio - t)
    const dur = c.inicio + c.duracao - inicio
    if (dur <= 0.05) return
    let cadeia: string
    if (r.categoria === 'imagem' && estilo?.movimento && !r.estatico) {
      args.push('-i', r.caminho) // um quadro: o zoompan gera todos os quadros do trecho
      cadeia = filtroMovimento(entrada, r, W, H, fps, dur, fotos++)
    } else if (r.categoria === 'imagem') {
      args.push('-loop', '1', '-t', num(dur), '-i', r.caminho)
      cadeia = `[${entrada}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps}`
    } else {
      args.push('-ss', num(c.corteInicio + (inicio - c.inicio)), '-t', num(dur), '-i', r.caminho)
      // Com acabamento, o vídeo preenche a tela (sem faixas pretas); sem, mantém o enquadramento original.
      cadeia = estilo?.movimento
        ? `[${entrada}:v]scale=${W}:${H}:force_original_aspect_ratio=increase:flags=lanczos,crop=${W}:${H},setsar=1,fps=${fps}`
        : `[${entrada}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps}`
    }
    // Transição suave (escurece e clareia) só na troca de cena, para não piscar a cada imagem.
    const extras: string[] = []
    if (estilo?.transicoes && dur > 1.2) {
      if (idx > 0 && validos[idx - 1]!.cena !== c.cena) extras.push(`fade=t=in:st=0:d=0.35`)
      if (idx < validos.length - 1 && validos[idx + 1]!.cena !== c.cena) extras.push(`fade=t=out:st=${num(dur - 0.35)}:d=0.35`)
    }
    filtros.push(`${cadeia},${[...extras, 'format=yuv420p', `trim=duration=${num(dur)}`, 'setpts=PTS-STARTPTS'].join(',')}[v${segmentos.length}]`)
    segmentos.push(`[v${segmentos.length}]`)
    entrada++
    t = inicio + dur
  })
  if (t < total - 0.01) preto(total - t)
  filtros.push(`${segmentos.join('')}concat=n=${segmentos.length}:v=1:a=0[vbase]`)
  let rotuloVideo = '[vbase]'
  const ap = estilo?.apresentador ?? null
  // Medidas em unidades do SRT (384×288, escaladas para o quadro), pensadas para o texto do gerarSrt caber em 2 linhas.
  // 16:9: o apresentador circula pelos dois lados na altura das legendas, que se afastam das laterais só o que ele ocupa.
  // 9:16: as legendas sobem acima do apresentador e usam a largura toda.
  const vertical = estado.formato === '9:16'
  const margemLado = ap && !vertical ? ',MarginR=80,MarginL=80' : ''
  if (opcoes.temLegendas) {
    filtros.push(`${rotuloVideo}subtitles=legendas.srt:force_style='FontName=Arial,FontSize=${vertical ? 11 : 16},Outline=2,MarginV=${vertical ? (ap ? 130 : 70) : 30}${margemLado}'[vleg]`)
    rotuloVideo = '[vleg]'
  }
  if (opcoes.temTextos) {
    filtros.push(`${rotuloVideo}subtitles=textos.srt:force_style='FontName=Arial,FontSize=22,Bold=1,Alignment=8,Outline=2,MarginV=40'[vtxt]`)
    rotuloVideo = '[vtxt]'
  }

  // Apresentador: uma camada por pose (boca aberta/fechada alternando enquanto fala), balançando de leve.
  if (ap) {
    const plano = mesclarTrechos(planoApresentador(estado, total, ap.lado))
    const alturas = { normal: par(H * (vertical ? 0.2 : 0.3)), destaque: par(H * (vertical ? 0.28 : 0.42)) }
    const margem = Math.round(H * 0.025)
    const base = vertical ? `H-h-${Math.round(H * 0.15)}` : `H-h-${margem}`
    const deriva = Math.round(W * 0.012)
    // Posição por trecho: lado da cena, entrada deslizando pela lateral (0,45 s) e um leve vaivém, como quem caminha.
    const posicao = (p: TrechoApresentador): string => {
      const base = p.lado === 'direita' ? `W-w-${margem}` : `${margem}`
      const entra = p.entrada ? `${p.lado === 'direita' ? '+' : '-'}(w+${margem})*max(0,1-(t-${num(p.inicio)})/0.45)` : ''
      return `${base}${entra}+${deriva}*sin(2*PI*(t-${num(p.inicio)})/4)`
    }
    let n = 0
    for (const pose of [...new Set(plano.map((p) => p.pose))]) {
      for (const [destaque, lado] of [[false, 'direita'], [true, 'direita'], [false, 'esquerda'], [true, 'esquerda']] as const) {
        const trechos = plano.filter((p) => p.pose === pose && p.destaque === destaque && p.lado === lado)
        if (!trechos.length) continue
        const quando = trechos.map((p) => `between(t,${num(p.inicio)},${num(p.fim)})`).join('+')
        for (const boca of ['fechada', 'aberta'] as const) {
          // Do lado esquerdo usa o desenho espelhado (aponta para o conteúdo, com o "IA" legível).
          const espelhado = lado === 'esquerda' ? ap.pngs[`${pose}-${boca}-esq`] : undefined
          const png = espelhado ?? ap.pngs[`${pose}-${boca}`]
          if (!png) continue
          args.push('-loop', '1', '-framerate', String(fps), '-t', num(total), '-i', png)
          const fala = boca === 'aberta' ? 'lt(mod(t,0.36),0.18)' : 'gte(mod(t,0.36),0.18)'
          const rotulo = `[ap${n}]`
          filtros.push(`[${entrada}:v]scale=-2:${destaque ? alturas.destaque : alturas.normal}:flags=lanczos${lado === 'esquerda' && !espelhado ? ',hflip' : ''},format=rgba${rotulo}`)
          const x = trechos.reduceRight((resto, p) => `if(between(t,${num(p.inicio)},${num(p.fim)}),${posicao(p)},${resto})`, '0')
          filtros.push(`${rotuloVideo}${rotulo}overlay=x='${x}':y='${base}+${Math.round(H * 0.006)}*sin(2*PI*t/1.5)':eval=frame:enable='(${quando})*${fala}'[vap${n}]`)
          rotuloVideo = `[vap${n}]`
          entrada++
          n++
        }
      }
    }
  }

  // Áudio: narração e trilhas posicionadas no tempo, com volume e fades.
  const audios = estado.clips.filter((c) => (c.faixa === 'audio' || c.faixa === 'narracao') && c.recursoId !== null)
  const rotulosAudio: string[] = []
  for (const c of audios) {
    const r = recursos.get(c.recursoId!)
    if (!r || (r.categoria !== 'audio' && r.categoria !== 'video')) continue
    args.push('-ss', num(c.corteInicio), '-t', num(c.duracao), '-i', r.caminho)
    const atraso = Math.round(c.inicio * 1000)
    const partes = [`atrim=0:${num(c.duracao)}`, 'asetpts=PTS-STARTPTS', `volume=${num(c.volume)}`]
    if (c.fadeIn > 0) partes.push(`afade=t=in:st=0:d=${num(c.fadeIn)}`)
    if (c.fadeOut > 0) partes.push(`afade=t=out:st=${num(Math.max(0, c.duracao - c.fadeOut))}:d=${num(c.fadeOut)}`)
    partes.push(`adelay=${atraso}|${atraso}`)
    filtros.push(`[${entrada}:a]${partes.join(',')}[a${rotulosAudio.length}]`)
    rotulosAudio.push(`[a${rotulosAudio.length}]`)
    entrada++
  }
  if (rotulosAudio.length) {
    filtros.push(`${rotulosAudio.join('')}amix=inputs=${rotulosAudio.length}:normalize=0:dropout_transition=0,apad[aout]`)
  } else {
    args.push('-f', 'lavfi', '-t', num(total), '-i', 'anullsrc=r=48000:cl=stereo')
    filtros.push(`[${entrada}:a]anull[aout]`)
    entrada++
  }

  args.push(
    '-filter_complex', filtros.join(';'),
    '-map', rotuloVideo, '-map', '[aout]',
    '-c:v', 'libx264', '-preset', VELOCIDADES_RENDER[o.velocidade].x264, '-crf', String(q.crf),
    '-maxrate', `${Math.round(teto * 1000)}k`, '-bufsize', `${Math.round(teto * 2000)}k`, // teto de taxa com base nas referências do YouTube
    '-g', String(Math.round(fps / 2)), '-bf', '2', // quadro-chave a cada meio segundo
    '-pix_fmt', 'yuv420p', '-r', String(fps),
    '-c:a', 'aac', '-b:a', `${q.audioKbps}k`, '-ar', '48000', '-ac', '2', // narração mono também sai em estéreo
    '-t', num(total), '-movflags', '+faststart',
    '-progress', 'pipe:1', '-nostats',
    saida
  )
  return args
}

/** Lê "out_time_ms=..." da saída de -progress e devolve a fração concluída (0–1). */
export function lerProgresso(trecho: string, totalSeg: number): number | null {
  const m = [...trecho.matchAll(/out_time_(?:ms|us)=(\d+)/g)].at(-1)
  if (!m) return null
  return Math.min(1, Number(m[1]) / 1_000_000 / Math.max(totalSeg, 0.001))
}

export interface ResultadoExecucao {
  codigo: number | null
  stderr: string
  cancelado: boolean
}

/** Executa sem shell, com cancelamento e tempo limite. A saída de erro é guardada só no final (limitada). */
export function executarFerramenta(exe: string, args: string[], op: { cwd?: string; sinal?: AbortSignal; aoProgredir?: (trecho: string) => void; tempoLimiteMs?: number }): Promise<ResultadoExecucao> {
  return new Promise((resolve) => {
    const proc = spawn(exe, args, { cwd: op.cwd, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    let cancelado = false
    const parar = (): void => {
      cancelado = true
      proc.kill()
    }
    op.sinal?.addEventListener('abort', parar, { once: true })
    const limite = op.tempoLimiteMs ? setTimeout(parar, op.tempoLimiteMs) : null
    proc.stdout.on('data', (d: Buffer) => op.aoProgredir?.(d.toString('utf8')))
    proc.stderr.on('data', (d: Buffer) => {
      stderr = (stderr + d.toString('utf8')).slice(-20_000)
    })
    proc.on('error', (e) => {
      if (limite) clearTimeout(limite)
      resolve({ codigo: -1, stderr: e.message, cancelado })
    })
    proc.on('close', (codigo) => {
      if (limite) clearTimeout(limite)
      resolve({ codigo, stderr, cancelado })
    })
  })
}

// ------------------------------------------------------------------ leitura de resultados (Etapa 12)

export interface Sonda {
  duracao: number
  video: { largura: number; altura: number; codec: string; fps: number | null } | null
  audio: { codec: string; canais: number } | null
}

/** "30000/1001" → 29.97; valores vazios, zero ou absurdos → null. */
function fracao(s: string | undefined): number | null {
  const m = s?.match(/^(\d+)\/(\d+)$/)
  if (!m || Number(m[2]) === 0) return null
  const v = Number(m[1]) / Number(m[2])
  return v > 0 && v <= 240 ? Math.round(v * 1000) / 1000 : null
}

export function interpretarSonda(json: string): Sonda {
  const d = JSON.parse(json) as { format?: { duration?: string }; streams?: { codec_type?: string; width?: number; height?: number; codec_name?: string; channels?: number; avg_frame_rate?: string; r_frame_rate?: string }[] }
  const v = d.streams?.find((s) => s.codec_type === 'video')
  const a = d.streams?.find((s) => s.codec_type === 'audio')
  return {
    duracao: Number(d.format?.duration ?? 0),
    video: v ? { largura: v.width ?? 0, altura: v.height ?? 0, codec: v.codec_name ?? '', fps: fracao(v.avg_frame_rate) ?? fracao(v.r_frame_rate) } : null,
    audio: a ? { codec: a.codec_name ?? '', canais: a.channels ?? 0 } : null
  }
}

/** Intervalos de silêncio (silencedetect) a partir da saída de erro do FFmpeg. */
export function interpretarSilencios(stderr: string): { inicio: number; fim: number }[] {
  const saida: { inicio: number; fim: number }[] = []
  let inicio: number | null = null
  for (const l of stderr.split(/\r?\n/)) {
    const s = l.match(/silence_start:\s*(-?[\d.]+)/)
    if (s) inicio = Math.max(0, Number(s[1]))
    const e = l.match(/silence_end:\s*([\d.]+)/)
    if (e && inicio !== null) {
      saida.push({ inicio, fim: Number(e[1]) })
      inicio = null
    }
  }
  if (inicio !== null) saida.push({ inicio, fim: Number.POSITIVE_INFINITY })
  return saida
}

/** Intervalos de tela preta (blackdetect). */
export function interpretarPretos(stderr: string): { inicio: number; fim: number }[] {
  return [...stderr.matchAll(/black_start:([\d.]+)\s+black_end:([\d.]+)/g)].map((m) => ({ inicio: Number(m[1]), fim: Number(m[2]) }))
}
