import { abrirBanco, type Banco } from '../db/conexao'
import { migrar } from '../db/migracoes'
import { criarProjeto } from '../repositorios/projetos'
import { roteiroNovoSchema } from '@shared/schemas'
import { criarRoteiro } from '../repositorios/roteiros'
import type { RoteiroCompleto } from '@shared/tipos'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Cofre } from '../ia/cofre'

/** Cofre com cifra de teste (inverte bytes) numa pasta temporária. Nunca usado no aplicativo real. */
export function cofreDeTeste(disponivel = true): Cofre {
  const pasta = mkdtempSync(join(tmpdir(), 'estudio-cofre-'))
  return new Cofre(join(pasta, 'credenciais.bin'), {
    disponivel: () => disponivel,
    cifrar: (t) => Buffer.from(t, 'utf8').reverse(),
    decifrar: (d) => Buffer.from(d).reverse().toString('utf8')
  })
}

/** Banco em memória já migrado, para testes. */
export function bancoDeTeste(): Banco {
  const db = abrirBanco(':memory:')
  migrar(db)
  return db
}

export function projetoDeTeste(db: Banco, nome = 'Canal de teste'): number {
  return criarProjeto(db, { nome, descricao: '' }).id
}

export function roteiroDeTeste(db: Banco, projetoId: number, extra: Partial<Record<string, unknown>> = {}): RoteiroCompleto {
  return criarRoteiro(db, roteiroNovoSchema.parse({ projetoId, titulo: 'Roteiro', tipoVideo: 'longo', ...extra }))
}
