import { homedir } from 'node:os'
import { type Banco, agoraIso, executar, todos } from './conexao'

export type NivelEvento = 'info' | 'aviso' | 'erro'

export interface Evento {
  id: number
  nivel: NivelEvento
  categoria: string
  mensagem: string
  criadoEm: string
}

const LIMITE_MENSAGEM = 500
const MANTER_EVENTOS = 5000

/** Remove dados sensíveis antes de gravar: pasta do usuário, possíveis chaves/tokens e e-mails. */
export function higienizar(texto: string): string {
  let t = texto
  const casa = homedir()
  if (casa) t = t.split(casa).join('~')
  t = t
    .replace(/\bbearer\s+\S+/gi, 'Bearer [removido]')
    .replace(/(authorization|bearer|token|api[_-]?key|senha|password|secret)(["'\s:=]+)[^\s"',;]+/gi, '$1$2[removido]')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[removido]')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[e-mail removido]')
  return t.length > LIMITE_MENSAGEM ? `${t.slice(0, LIMITE_MENSAGEM)}…` : t
}

export function registrarEvento(db: Banco, nivel: NivelEvento, categoria: string, mensagem: string): void {
  executar(db, 'INSERT INTO eventos (nivel, categoria, mensagem, criado_em) VALUES (:nivel, :categoria, :mensagem, :agora)', {
    nivel,
    categoria: higienizar(categoria).slice(0, 60),
    mensagem: higienizar(mensagem),
    agora: agoraIso()
  })
  executar(db, 'DELETE FROM eventos WHERE id <= (SELECT MAX(id) FROM eventos) - :manter', { manter: MANTER_EVENTOS })
}

export function listarEventos(db: Banco, limite = 100): Evento[] {
  return todos<Evento>(
    db,
    'SELECT id, nivel, categoria, mensagem, criado_em AS criadoEm FROM eventos ORDER BY id DESC LIMIT :limite',
    { limite }
  )
}
