/** Conversões de data/hora com fuso horário IANA, usando apenas a API Intl (sem bibliotecas). */

export interface PartesLocais {
  ano: number
  mes: number // 1-12
  dia: number
  hora: number
  minuto: number
  diaSemana: number // 0 = domingo
}

const cacheFormatadores = new Map<string, Intl.DateTimeFormat>()

function formatador(fuso: string): Intl.DateTimeFormat {
  let f = cacheFormatadores.get(fuso)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: fuso,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short'
    })
    cacheFormatadores.set(fuso, f)
  }
  return f
}

const DIAS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function fusoValido(fuso: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: fuso })
    return true
  } catch {
    return false
  }
}

export function partesNoFuso(instante: Date, fuso: string): PartesLocais {
  const partes = formatador(fuso).formatToParts(instante)
  const valor = (tipo: string): string => partes.find((p) => p.type === tipo)?.value ?? '0'
  return {
    ano: Number(valor('year')),
    mes: Number(valor('month')),
    dia: Number(valor('day')),
    hora: Number(valor('hour')),
    minuto: Number(valor('minute')),
    diaSemana: DIAS_EN.indexOf(valor('weekday'))
  }
}

/** Diferença (ms) entre o horário local do fuso e UTC naquele instante. */
function deslocamento(instante: Date, fuso: string): number {
  const p = partesNoFuso(instante, fuso)
  const comoUtc = Date.UTC(p.ano, p.mes - 1, p.dia, p.hora, p.minuto)
  const semSegundos = Math.floor(instante.getTime() / 60000) * 60000
  return comoUtc - semSegundos
}

/** Converte data local ("AAAA-MM-DD") + hora ("HH:MM") de um fuso para o instante UTC. */
export function localParaUtc(data: string, hora: string, fuso: string): Date {
  const [ano, mes, dia] = data.split('-').map(Number)
  const [h, m] = hora.split(':').map(Number)
  const ingenuo = Date.UTC(ano ?? 0, (mes ?? 1) - 1, dia ?? 1, h ?? 0, m ?? 0)
  // Duas passagens resolvem a maioria das transições de horário de verão.
  let utc = ingenuo - deslocamento(new Date(ingenuo), fuso)
  utc = ingenuo - deslocamento(new Date(utc), fuso)
  return new Date(utc)
}

export function dataLocal(instante: Date, fuso: string): string {
  const p = partesNoFuso(instante, fuso)
  return `${p.ano}-${String(p.mes).padStart(2, '0')}-${String(p.dia).padStart(2, '0')}`
}

export function horaLocal(instante: Date, fuso: string): string {
  const p = partesNoFuso(instante, fuso)
  return `${String(p.hora).padStart(2, '0')}:${String(p.minuto).padStart(2, '0')}`
}

/** Soma dias a uma data de calendário "AAAA-MM-DD" (independente de fuso). */
export function somarDias(data: string, dias: number): string {
  const [a, m, d] = data.split('-').map(Number)
  const t = new Date(Date.UTC(a ?? 0, (m ?? 1) - 1, (d ?? 1) + dias))
  return t.toISOString().slice(0, 10)
}

export function diaSemanaDeData(data: string): number {
  const [a, m, d] = data.split('-').map(Number)
  return new Date(Date.UTC(a ?? 0, (m ?? 1) - 1, d ?? 1)).getUTCDay()
}

/** Segunda-feira da semana (seg–dom) que contém a data. */
export function inicioSemana(data: string): string {
  const dia = diaSemanaDeData(data)
  return somarDias(data, dia === 0 ? -6 : 1 - dia)
}
