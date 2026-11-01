import type { Banco } from '../db/conexao'
import { registrarEvento } from '../db/eventos'
import { lerConfig, gravarConfig } from './configuracoes'
import { CONFIG_EDITORIAL_PADRAO, alertasCapacidade, configEditorialSchema, type ConfigEditorial } from '@shared/editorial'
import type { ConfigEditorialComAlertas } from '@shared/tipos'

const CHAVE = 'editorial'

/** Lê a configuração editorial; se não existir ou estiver inválida, usa os padrões do canal (sem gravar). */
export function lerEditorial(db: Banco): ConfigEditorial {
  const bruto = lerConfig<unknown>(db, CHAVE)
  if (bruto === null) return CONFIG_EDITORIAL_PADRAO
  const r = configEditorialSchema.safeParse(bruto)
  if (r.success) return r.data
  registrarEvento(db, 'aviso', 'editorial', 'Configuração editorial inválida no banco; usando padrões.')
  return CONFIG_EDITORIAL_PADRAO
}

export function comAlertas(config: ConfigEditorial): ConfigEditorialComAlertas {
  return { config, alertas: alertasCapacidade(config), padrao: CONFIG_EDITORIAL_PADRAO }
}

/** Grava somente após ação explícita do usuário na tela de Configurações. */
export function salvarEditorial(db: Banco, config: ConfigEditorial): ConfigEditorialComAlertas {
  gravarConfig(db, CHAVE, config)
  registrarEvento(db, 'info', 'editorial', 'Configurações editoriais alteradas pelo usuário.')
  return comAlertas(config)
}
