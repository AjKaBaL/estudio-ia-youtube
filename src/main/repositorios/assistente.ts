import { type Banco, um } from '../db/conexao'
import { lerConfig, gravarConfig } from './configuracoes'
import { lerOpcoesPesquisa } from './pesquisa'
import { ETAPAS_ASSISTENTE, type EtapaAssistente } from '@shared/schemas'
import type { EstadoAssistente, EtapaAssistenteEstado } from '@shared/tipos'

/**
 * Assistente de configuração inicial. A situação de cada etapa é calculada a partir dos dados reais
 * (projeto criado, fontes cadastradas, FFmpeg encontrado...). Só as etapas que dependem de leitura
 * ("revisei a agenda", "entendi a IA") ficam guardadas como revisadas.
 */

interface Salvo {
  revisadas: EtapaAssistente[]
  concluido: boolean
  dispensado: boolean
}
const CHAVE = 'assistente'

function ler(db: Banco): Salvo {
  const s = lerConfig<Partial<Salvo>>(db, CHAVE) ?? {}
  return {
    revisadas: (s.revisadas ?? []).filter((e): e is EtapaAssistente => (ETAPAS_ASSISTENTE as readonly string[]).includes(e)),
    concluido: s.concluido ?? false,
    dispensado: s.dispensado ?? false
  }
}

export function salvarAssistente(db: Banco, d: { revisada?: EtapaAssistente; desfazer?: EtapaAssistente; concluido?: boolean; dispensado?: boolean }): void {
  const s = ler(db)
  const revisadas = new Set(s.revisadas)
  if (d.revisada) revisadas.add(d.revisada)
  if (d.desfazer) revisadas.delete(d.desfazer)
  gravarConfig(db, CHAVE, { revisadas: [...revisadas], concluido: d.concluido ?? s.concluido, dispensado: d.dispensado ?? s.dispensado })
}

/** O que só o processo principal sabe fora do banco (ferramentas, cofre do YouTube, backups em disco). */
export interface SituacaoExterna {
  ffmpeg: boolean
  youtube: 'nao_configurado' | 'desconectado' | 'conectado' | 'erro'
  backups: number
}

const n = (db: Banco, sql: string): number => um<{ n: number }>(db, sql)?.n ?? 0

export function estadoAssistente(db: Banco, ext: SituacaoExterna): EstadoAssistente {
  const s = ler(db)
  const rev = (e: EtapaAssistente): boolean => s.revisadas.includes(e)
  const projetos = n(db, 'SELECT COUNT(*) AS n FROM projetos WHERE arquivado_em IS NULL')
  const projetoId = um<{ id: number }>(db, 'SELECT id FROM projetos WHERE arquivado_em IS NULL ORDER BY id LIMIT 1')?.id ?? null
  const fontes = n(db, 'SELECT COUNT(*) AS n FROM fontes_pesquisa WHERE ativo = 1')
  const termos = lerOpcoesPesquisa(db).termosMonitorados.length
  const preferencia = lerConfig(db, 'render_preferencia') !== null

  const etapa = (feito: boolean, detalhe: string, opcional = false): EtapaAssistenteEstado => ({ feito, detalhe, opcional })
  const etapas: Record<EtapaAssistente, EtapaAssistenteEstado> = {
    boasvindas: etapa(rev('boasvindas'), rev('boasvindas') ? 'Lido' : 'Comece por aqui'),
    projeto: etapa(projetos > 0, projetos > 0 ? `${projetos} projeto(s) criado(s)` : 'Nenhum projeto ainda'),
    pesquisa: etapa(fontes > 0, `${fontes} fonte(s) ativa(s) · ${termos} termo(s) monitorado(s)`),
    agenda: etapa(rev('agenda'), rev('agenda') ? 'Revisada' : 'Usando o padrão (1 longo + 3 Shorts por semana), ainda não revisada'),
    ia: etapa(rev('ia'), rev('ia') ? 'Revisada' : 'Padrão: somente local, sem gastos'),
    video: etapa(ext.ffmpeg && preferencia, `${ext.ffmpeg ? 'FFmpeg encontrado' : 'FFmpeg não encontrado'} · ${preferencia ? 'resolução padrão escolhida' : 'resolução padrão não escolhida'}`),
    youtube: etapa(
      ext.youtube === 'conectado' || rev('youtube'),
      { conectado: 'Conta conectada', desconectado: 'Credenciais guardadas, falta conectar a conta', nao_configurado: rev('youtube') ? 'Deixado para depois' : 'Não configurado', erro: 'Erro na conexão' }[ext.youtube],
      true
    ),
    backup: etapa(ext.backups > 0 && rev('backup'), ext.backups > 0 ? `${ext.backups} backup(s) guardado(s)` : 'Nenhum backup ainda')
  }
  const obrigatorias = ETAPAS_ASSISTENTE.filter((e) => !etapas[e].opcional)
  return {
    concluido: s.concluido,
    dispensado: s.dispensado,
    etapas,
    projetoId,
    concluidas: obrigatorias.filter((e) => etapas[e].feito).length,
    obrigatorias: obrigatorias.length
  }
}
