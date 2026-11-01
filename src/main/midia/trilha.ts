import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { ErroApp } from '../erros'
import { executarFerramenta, type Ferramentas } from './ffmpeg'

/**
 * Trilha sonora original composta pelo próprio app (sem direitos de terceiros, sem chave, sem internet):
 * acordes suaves, baixo, batida leve e um arpejo, sintetizados pelo FFmpeg. Gera um trecho de 8 compassos que se
 * repete sem emenda até a duração do vídeo. Quatro estilos (progressão e andamento) variam de vídeo para vídeo.
 */

interface Estilo {
  nome: string
  bpm: number
  /** Fundamental de cada acorde (Hz, oitava 3) e se é menor. */
  acordes: [number, boolean][]
}

export const ESTILOS_TRILHA: Estilo[] = [
  { nome: 'reflexivo', bpm: 84, acordes: [[110, true], [87.31, false], [130.81, false], [98, false]] }, // Am F C G
  { nome: 'otimista', bpm: 92, acordes: [[130.81, false], [98, false], [110, true], [87.31, false]] }, // C G Am F
  { nome: 'tecnológico', bpm: 80, acordes: [[146.83, true], [116.54, false], [87.31, false], [130.81, false]] }, // Dm Bb F C
  { nome: 'energético', bpm: 96, acordes: [[82.41, true], [130.81, false], [98, false], [146.83, false]] } // Em C G D
]

/** Expressão do aevalsrc (sem aspas simples). Usa st()/ld() para variáveis e só o tempo t. */
export function expressaoTrilha(e: Estilo): { expressao: string; segundos: number } {
  const batida = 60 / e.bpm
  const compasso = batida * 4
  const ciclo = compasso * e.acordes.length
  const f = (v: number): string => v.toFixed(4)
  const escolher = (vals: string[]): string => vals.slice(0, -1).reduceRight((resto, v, i) => `if(eq(ld(0),${i}),${v},${resto})`, vals.at(-1)!)
  const raiz = escolher(e.acordes.map(([r]) => f(r)))
  const terca = escolher(e.acordes.map(([, menor]) => (menor ? '1.1892' : '1.2599')))
  const partes = [
    `st(0,floor(mod(t,${f(ciclo)})/${f(compasso)}))`,
    `st(1,${raiz})`,
    `st(2,${terca})`,
    `st(3,mod(t,${f(batida)}))`,
    `st(4,mod(t,${f(batida * 2)}))`,
    `st(5,mod(t,${f(compasso)}))`,
    `st(6,floor(mod(t,${f(compasso)})/${f(batida / 2)}))`,
    // Pad: tríade com "respiração" no compasso (começa e termina em zero: sem estalos na troca de acorde).
    `st(7,0.05*(sin(2*PI*ld(1)*2*t)+0.8*sin(2*PI*ld(1)*2*ld(2)*t)+0.7*sin(2*PI*ld(1)*3*t)+0.25*sin(2*PI*ld(1)*4*t))*pow(sin(PI*ld(5)/${f(compasso)}),0.6))`,
    `st(8,0.1*sin(2*PI*ld(1)*t)*exp(-2.5*ld(3)))`,
    `st(9,0.14*sin(2*PI*(42+70*exp(-25*ld(4)))*ld(4))*exp(-7*ld(4)))`,
    `st(10,0.016*(2*random(11)-1)*exp(-45*mod(t+${f(batida / 2)},${f(batida)})))`,
    `st(12,0.03*sin(2*PI*ld(1)*4*if(eq(mod(ld(6),3),0),1,if(eq(mod(ld(6),3),1),ld(2),1.4983))*t)*exp(-6*mod(t,${f(batida / 2)})))`,
    'ld(7)+ld(8)+ld(9)+ld(10)+ld(12)'
  ]
  return { expressao: partes.join(';'), segundos: ciclo * 2 }
}

/** Gera a trilha com a duração pedida. O estilo vem da "semente" (ex.: o número do roteiro). */
export async function gerarTrilha(f: Ferramentas, duracao: number, semente: number, pasta: string): Promise<{ arquivo: string; estilo: string }> {
  mkdirSync(pasta, { recursive: true })
  const estilo = ESTILOS_TRILHA[Math.abs(semente) % ESTILOS_TRILHA.length]!
  const { expressao, segundos } = expressaoTrilha(estilo)
  const trecho = join(pasta, `trilha-trecho-${estilo.nome}.wav`)
  const r1 = await executarFerramenta(
    f.ffmpeg,
    ['-hide_banner', '-nostdin', '-y', '-f', 'lavfi', '-i', `aevalsrc=exprs='${expressao}|${expressao}':s=44100:d=${segundos.toFixed(3)}`, '-af', 'highpass=f=35,lowpass=f=9000,aecho=0.8:0.6:90|170:0.22|0.14', trecho],
    { cwd: pasta, tempoLimiteMs: 120_000 }
  )
  if (r1.codigo !== 0 || !existsSync(trecho)) throw new ErroApp('trilha', `Não foi possível compor a trilha. ${r1.stderr.slice(-200)}`)
  const d = Math.max(5, duracao)
  const arquivo = join(pasta, `trilha-${estilo.nome}-${Math.round(d)}s.wav`)
  const r2 = await executarFerramenta(
    f.ffmpeg,
    ['-hide_banner', '-nostdin', '-y', '-stream_loop', '-1', '-i', trecho, '-t', d.toFixed(3), '-af', `afade=t=in:d=2,afade=t=out:st=${Math.max(0, d - 3).toFixed(3)}:d=3,loudnorm=I=-18:TP=-2:LRA=11`, '-ar', '44100', '-ac', '2', arquivo],
    { cwd: pasta, tempoLimiteMs: 300_000 }
  )
  if (r2.codigo !== 0 || !existsSync(arquivo)) throw new ErroApp('trilha', `Não foi possível montar a trilha. ${r2.stderr.slice(-200)}`)
  return { arquivo, estilo: estilo.nome }
}
