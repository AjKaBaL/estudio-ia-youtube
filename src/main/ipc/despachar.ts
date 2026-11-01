import { ZodError } from 'zod'
import type { Contexto } from '../contexto'
import { registrarEvento } from '../db/eventos'
import { ErroApp } from '../erros'
import { manipuladores, type Manipuladores } from './manipuladores'
import { canalPermitido, type Canal } from '@shared/canais'
import { ENTRADAS, type Saidas } from '@shared/ipc'
import type { Resposta } from '@shared/tipos'

function mensagemValidacao(e: ZodError): string {
  const p = e.issues[0]
  if (!p) return 'Dados inválidos.'
  const campo = p.path.length ? `${p.path.join('.')}: ` : ''
  return `Dados inválidos — ${campo}${p.message}`
}

/**
 * Ponto único por onde passa toda chamada da interface:
 * confere a lista permitida, valida a entrada, executa e devolve erro amigável sem expor detalhes internos.
 */
export async function despachar(
  canal: unknown,
  entrada: unknown,
  ctx: Contexto,
  tabela: Manipuladores = manipuladores
): Promise<Resposta<unknown>> {
  if (!canalPermitido(canal)) {
    registrarEvento(ctx.db, 'aviso', 'ipc', `Canal recusado: ${String(canal).slice(0, 60)}`)
    return { ok: false, erro: { codigo: 'canal_negado', mensagem: 'Operação não permitida.' } }
  }
  try {
    const validada = ENTRADAS[canal].parse(entrada)
    const fn = tabela[canal] as (e: unknown, c: Contexto) => Saidas[Canal] | Promise<Saidas[Canal]>
    return { ok: true, dados: await fn(validada, ctx) }
  } catch (e) {
    if (e instanceof ZodError) return { ok: false, erro: { codigo: 'validacao', mensagem: mensagemValidacao(e) } }
    if (e instanceof ErroApp) return { ok: false, erro: { codigo: e.codigo, mensagem: e.message } }
    const texto = e instanceof Error ? e.message : String(e)
    if (/UNIQUE constraint failed: calendario_entradas/.test(texto)) {
      return { ok: false, erro: { codigo: 'duplicado', mensagem: 'Este roteiro já está agendado.' } }
    }
    if (/FOREIGN KEY constraint failed/.test(texto)) {
      return { ok: false, erro: { codigo: 'referencia', mensagem: 'O item relacionado não existe mais. Atualize a tela.' } }
    }
    registrarEvento(ctx.db, 'erro', canal, texto)
    return { ok: false, erro: { codigo: 'interno', mensagem: 'Ocorreu um erro inesperado. Os detalhes foram registrados em Configurações › Registro de eventos.' } }
  }
}
