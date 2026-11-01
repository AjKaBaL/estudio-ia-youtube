import { join } from 'node:path'
import type { Contexto } from './contexto'
import { instalarPiper } from './midia/voz'
import { CHAVE_PREFERENCIA, lerPreferenciaMidia } from './midia/automatica'
import { criarBackup } from './db/backup'
import { registrarEvento } from './db/eventos'
import { gravarConfig, lerConfig } from './repositorios/configuracoes'
import { salvarAssistente } from './repositorios/assistente'
import { lerPolitica, salvarPolitica, adicionarDoCatalogo } from './ia/central'
import { lerEditorial, salvarEditorial } from './repositorios/editorial'
import { aplicarPadroesPesquisa, restaurarFontesPadrao } from './repositorios/pesquisa'
import { criarProjeto, listarProjetos } from './repositorios/projetos'
import { localizarFerramentas } from './midia/ffmpeg'
import { baixarModeloOllama, caminhoWingetLinks, garantirOllamaRodando, instalarPacote, modelosOllama, MODELO_OLLAMA_PADRAO, ollamaInstalado, ollamaRespondendo } from './instaladores'
import { CATALOGO_IA, escolherModelo } from '@shared/catalogoIa'
import { aplicarFrequencia, horaPrincipal } from '@shared/editorial'
import { PREFERENCIA_RENDER_PADRAO } from '@shared/midia'
import { PRESETS_AGENDA, type AcaoRapida, type ProgressoInstalacao } from '@shared/configRapida'

/**
 * Configurações de um clique: cada botão aplica o recomendado de uma etapa inteira (e marca a etapa como feita).
 * Nada aqui publica, gasta dinheiro ou envia dados: são só ajustes locais. YouTube e chaves de IA
 * continuam exigindo a sua conta (o app não cria contas).
 */

export const DESCRICAO_PADRAO = 'Canal sobre tecnologia, inteligência artificial e negócios da inovação, explicado de forma clara para quem quer entender o impacto prático das novidades.'

function projeto(ctx: Contexto): string {
  if (listarProjetos(ctx.db).length) return 'Projeto do canal já existia.'
  criarProjeto(ctx.db, { nome: 'Meu canal', descricao: DESCRICAO_PADRAO })
  aplicarPadroesPesquisa(ctx.db)
  return 'Projeto “Meu canal” criado (renomeie em Configurações › Projetos quando quiser).'
}

function pesquisa(ctx: Contexto): string {
  const [p] = listarProjetos(ctx.db)
  if (!p) return projeto(ctx) + ' ' + pesquisa(ctx)
  aplicarPadroesPesquisa(ctx.db)
  const n = restaurarFontesPadrao(ctx.db, p.id)
  salvarAssistente(ctx.db, { revisada: 'pesquisa' })
  return n ? `${n} fonte(s) padrão adicionada(s).` : 'Fontes e termos padrão já estavam aplicados.'
}

function agenda(ctx: Contexto, preset: keyof typeof PRESETS_AGENDA): string {
  const alvo = PRESETS_AGENDA[preset]
  let cfg = lerEditorial(ctx.db)
  cfg = aplicarFrequencia(cfg, 'longo', alvo.longo, horaPrincipal(cfg.agenda.formatos.longo, '18:00'))
  cfg = aplicarFrequencia(cfg, 'short', alvo.short, horaPrincipal(cfg.agenda.formatos.short, '18:00'))
  // Pesquisa diária às 08:00 olhando 7 dias: o recomendado para alimentar a pauta sem excesso.
  cfg = { ...cfg, pesquisa: { ...cfg.pesquisa, frequencia: 'diaria', horario: '08:00', periodo: '7d' } }
  salvarEditorial(ctx.db, cfg)
  salvarAssistente(ctx.db, { revisada: 'agenda' })
  return `Agenda: ${alvo.longo} vídeo(s) longo(s) e ${alvo.short} Short(s) por semana; pesquisa diária às 08:00.`
}

function ia(ctx: Contexto, modo: 'hibrido' | 'local'): string {
  const atual = lerPolitica(ctx.db)
  salvarPolitica(ctx.db, {
    ...atual,
    modo,
    gratuitosAutomaticos: modo === 'hibrido',
    revisaoInterna: { automatica: true, outroModelo: true },
    // Pagas continuam bloqueadas: teto zero até você decidir o contrário.
    tetoMensal: atual.tetoMensal ?? 0,
    tetoPorExecucao: atual.tetoPorExecucao ?? 0
  })
  salvarAssistente(ctx.db, { revisada: 'ia' })
  return modo === 'hibrido'
    ? 'IA híbrida ligada: o app escolhe entre o PC e as IAs gratuitas; revisão interna automática. Agora cadastre as IAs (cole as chaves) ou instale o Ollama.'
    : 'IA somente local: nada sai do computador.'
}

function video(ctx: Contexto): string {
  if (lerConfig(ctx.db, 'render_preferencia') === null) gravarConfig(ctx.db, 'render_preferencia', PREFERENCIA_RENDER_PADRAO)
  return ctx.ferramentas() ? 'Vídeo: preferência recomendada (automática, até 4K conforme as mídias) aplicada.' : 'Vídeo: preferência recomendada aplicada. Falta o FFmpeg (use “Instalar FFmpeg”).'
}

/** Aplica uma ação de um clique e devolve o que foi feito, em frases curtas. */
export function aplicarRapido(ctx: Contexto, acao: Exclude<AcaoRapida, 'instalar_ollama' | 'instalar_ffmpeg'>): string[] {
  const feitas: string[] = []
  switch (acao) {
    case 'projeto':
      feitas.push(projeto(ctx))
      break
    case 'pesquisa':
      feitas.push(pesquisa(ctx))
      break
    case 'agenda_leve':
    case 'agenda_medio':
    case 'agenda_intenso':
      feitas.push(agenda(ctx, acao.slice(7) as keyof typeof PRESETS_AGENDA))
      break
    case 'ia_hibrido':
      feitas.push(ia(ctx, 'hibrido'))
      break
    case 'ia_local':
      feitas.push(ia(ctx, 'local'))
      break
    case 'video':
      feitas.push(video(ctx))
      break
    case 'tudo':
      salvarAssistente(ctx.db, { revisada: 'boasvindas' })
      feitas.push(projeto(ctx), pesquisa(ctx), agenda(ctx, 'leve'), ia(ctx, 'hibrido'), video(ctx))
      criarBackup(ctx.db, ctx.pastaBackups, 'manual')
      salvarAssistente(ctx.db, { revisada: 'backup' })
      feitas.push('Primeiro backup criado.')
      break
  }
  registrarEvento(ctx.db, 'info', 'configuracao', `Configuração de um clique (${acao}): ${feitas.join(' ')}`.slice(0, 1000))
  return feitas
}

let instalando = false
let progresso: ProgressoInstalacao | null = null

/** Situação da instalação em andamento (ou da última), consultada pela tela para a barra de progresso. */
export function progressoInstalacao(): ProgressoInstalacao | null {
  return progresso
}

function marcar(p: Partial<ProgressoInstalacao> & Pick<ProgressoInstalacao, 'etapa'>): void {
  const anterior = progresso?.percentual ?? 0
  // A barra nunca volta: o total do download cresce quando o Ollama anuncia novas partes do modelo.
  const percentual = Math.min(100, Math.max(anterior, p.percentual ?? anterior))
  progresso = { pacote: progresso?.pacote ?? 'ollama', iniciadoEm: progresso?.iniciadoEm ?? new Date().toISOString(), detalhe: '', ativo: true, ...p, percentual }
}

/** Faixas da barra: instalar 0–20%, abrir 20–25%, baixar o modelo 25–97%, cadastrar 97–100%. */
async function comProgresso<T>(pacote: ProgressoInstalacao['pacote'], fn: () => Promise<T>): Promise<T> {
  if (instalando) throw new Error('Já existe uma instalação em andamento.')
  instalando = true
  progresso = { pacote, etapa: 'Preparando a instalação', percentual: 0, detalhe: '', ativo: true, iniciadoEm: new Date().toISOString() }
  try {
    const r = await fn()
    marcar({ etapa: 'Concluído', percentual: 100, ativo: false, detalhe: typeof r === 'string' ? r : '' })
    return r
  } catch (e) {
    marcar({ etapa: 'Erro', ativo: false, detalhe: e instanceof Error ? e.message : String(e) })
    throw e
  } finally {
    instalando = false
  }
}

const mb = (b: number): string => `${(b / 1024 / 1024).toFixed(0)} MB`

/**
 * Ollama em 1 clique, em qualquer situação: instala se faltar, abre se estiver fechado,
 * baixa um modelo leve se não houver nenhum que sirva, e cadastra como IA do PC.
 * Nada disso pede para o usuário abrir o PowerShell.
 */
export function instalarOllama(ctx: Contexto): Promise<string> {
  return comProgresso('ollama', async () => {
    if (!(await ollamaRespondendo())) {
      if (!ollamaInstalado()) {
        marcar({ etapa: 'Instalando o Ollama (instalador oficial do Windows)', percentual: 1 })
        await instalarPacote('ollama', undefined, (pct) => marcar({ etapa: 'Instalando o Ollama (instalador oficial do Windows)', percentual: Math.round(pct * 0.2), detalhe: `${pct}% do instalador` }))
      }
      marcar({ etapa: 'Abrindo o Ollama', percentual: 20 })
      await garantirOllamaRodando()
    }
    const item = CATALOGO_IA.find((c) => c.id === 'ollama')!
    if (!escolherModelo(item, await modelosOllama())) {
      marcar({ etapa: `Baixando o modelo ${MODELO_OLLAMA_PADRAO} (cerca de 2,5 GB)`, percentual: 25 })
      await baixarModeloOllama(MODELO_OLLAMA_PADRAO, (d) => {
        const frac = d.total > 0 ? d.baixados / d.total : 0
        marcar({ etapa: `Baixando o modelo ${MODELO_OLLAMA_PADRAO} (cerca de 2,5 GB)`, percentual: 25 + Math.round(frac * 72), detalhe: d.total > 0 ? `${mb(d.baixados)} de ${mb(d.total)}` : d.status })
      })
    }
    marcar({ etapa: 'Cadastrando como IA do PC', percentual: 97 })
    const r = await adicionarDoCatalogo(ctx.db, ctx.cofre, 'ollama', null)
    registrarEvento(ctx.db, 'info', 'configuracao', `Ollama instalado com o modelo ${MODELO_OLLAMA_PADRAO}.`)
    return r.mensagem
  })
}

/** Piper (voz neural offline): baixa com assinatura conferida e passa a ser a voz padrão. */
export function instalarPiperRapido(ctx: Contexto): Promise<string> {
  return comProgresso('piper', async () => {
    await instalarPiper(join(ctx.pastaDados, 'ferramentas'), (pct, etapa) => marcar({ etapa, percentual: pct }))
    const pref = lerPreferenciaMidia(ctx)
    gravarConfig(ctx.db, CHAVE_PREFERENCIA, { ...pref, voz: { ...pref.voz, motor: 'piper' } })
    registrarEvento(ctx.db, 'info', 'configuracao', 'Piper (voz neural pt-BR) instalado.')
    return 'Voz neural instalada e escolhida como padrão da narração.'
  })
}

export async function instalarFfmpeg(ctx: Contexto): Promise<string> {
  if (ctx.ferramentas()) return 'O FFmpeg já está instalado.'
  return comProgresso('ffmpeg', async () => {
    marcar({ etapa: 'Instalando o FFmpeg (instalador oficial do Windows)', percentual: 1 })
    await instalarPacote('ffmpeg', undefined, (pct) => marcar({ etapa: 'Instalando o FFmpeg (instalador oficial do Windows)', percentual: Math.max(1, Math.round(pct * 0.95)), detalhe: `${pct}% do instalador` }))
    const exe = caminhoWingetLinks('ffmpeg.exe')
    const f = exe ? localizarFerramentas(exe) : null
    if (!f) return 'O FFmpeg foi instalado. Feche e abra o aplicativo para ele ser encontrado.'
    gravarConfig(ctx.db, 'midia.ffmpeg', f.ffmpeg)
    registrarEvento(ctx.db, 'info', 'configuracao', 'FFmpeg instalado pelo winget.')
    return 'FFmpeg instalado e configurado.'
  })
}
