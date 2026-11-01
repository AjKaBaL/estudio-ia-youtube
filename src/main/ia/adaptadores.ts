import type { AdaptadorLlm, ProvedorIaConfig } from '@shared/ia'
import { requisitarJson } from './http'

/**
 * Adaptadores de modelo de linguagem com interface padronizada: trocar de fornecedor
 * não exige mudar o gerador de roteiros nem a interface do aplicativo.
 */

export interface PedidoLlm {
  sistema: string
  usuario: string
  maxTokens: number
  temperatura: number
  json: boolean
}

export interface RespostaLlm {
  texto: string
  tokensEntrada: number | null
  tokensSaida: number | null
}

export interface Adaptador {
  id: AdaptadorLlm
  gerar(pedido: PedidoLlm, cfg: ProvedorIaConfig, chave: string | null, sinal: AbortSignal): Promise<RespostaLlm>
  testar(cfg: ProvedorIaConfig, chave: string | null, sinal: AbortSignal): Promise<string>
  /** Modelos disponíveis agora no fornecedor (para escolher sem digitar nomes). */
  listarModelos(cfg: ProvedorIaConfig, chave: string | null, sinal: AbortSignal, urlModelos?: string): Promise<string[]>
}

/**
 * Adaptador SIMULADO, claramente identificado: não chama nenhuma IA.
 * Devolve um JSON de teste no formato pedido, com todos os textos marcados como [SIMULADO].
 */
export const adaptadorSimulado: Adaptador = {
  id: 'simulado',
  async gerar(pedido) {
    const ids = [...new Set([...pedido.usuario.matchAll(/\[A(\d+)\]/g)].map((m) => Number(m[1])))]
    const short = /TIPO:\s*short/i.test(pedido.usuario)
    const cenas = (short ? ids.slice(0, 1) : ids.slice(0, 4)).map((id, i) => ({
      titulo: `[SIMULADO] Bloco ${i + 1}`,
      narracao: `[SIMULADO] Texto de teste para a afirmação A${id}.`,
      visual: '[SIMULADO] Sugestão visual de teste.',
      textoNaTela: '',
      afirmacoes: [id]
    }))
    const resposta = {
      titulo: '[SIMULADO] Título de teste',
      promessa: '[SIMULADO] Promessa de teste.',
      abertura: '[SIMULADO] Abertura de teste que apresenta a pergunta.',
      cenas: cenas.length ? cenas : [{ titulo: '[SIMULADO] Bloco único', narracao: '[SIMULADO] Sem afirmações no dossiê.', visual: '', textoNaTela: '', afirmacoes: [] }],
      conclusao: '[SIMULADO] Conclusão de teste.',
      sugestoes: { titulos: ['[SIMULADO] Opção de título'], descricao: '[SIMULADO] Descrição de teste.', miniatura: '[SIMULADO] Ideia de miniatura.' }
    }
    return { texto: JSON.stringify(resposta), tokensEntrada: Math.ceil(pedido.usuario.length / 4), tokensSaida: 200 }
  },
  async testar() {
    return 'Adaptador simulado pronto (não usa IA real).'
  },
  async listarModelos() {
    return ['simulado']
  }
}

/** Remove o "raciocínio" que alguns modelos escrevem antes da resposta (<think>…</think>). */
export function semPensamento(texto: string): string {
  return texto.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^[\s\S]*?<\/think>/i, '').trim()
}

export const adaptadorOllama: Adaptador = {
  id: 'ollama',
  async gerar(pedido, cfg, _chave, sinal) {
    const r = await requisitarJson(`${cfg.urlBase.replace(/\/$/, '')}/api/chat`, {
      local: true,
      sinal,
      tempoLimiteMs: 600_000,
      corpo: {
        model: cfg.modelo,
        stream: false,
        // Modelos que "pensam" (ex.: qwen3) respondem direto; o contexto maior evita cortar dossiês e roteiros longos.
        think: false,
        ...(pedido.json ? { format: 'json' } : {}),
        options: { num_predict: pedido.maxTokens, temperature: pedido.temperatura, num_ctx: 8192 },
        messages: [
          { role: 'system', content: pedido.sistema },
          { role: 'user', content: pedido.usuario }
        ]
      }
    })
    const d = r.dados as { message?: { content?: unknown }; prompt_eval_count?: number; eval_count?: number }
    if (typeof d?.message?.content !== 'string') throw new Error('Resposta inesperada do Ollama.')
    return { texto: semPensamento(d.message.content), tokensEntrada: d.prompt_eval_count ?? null, tokensSaida: d.eval_count ?? null }
  },
  async testar(cfg, _chave, sinal) {
    const r = await requisitarJson(`${cfg.urlBase.replace(/\/$/, '')}/api/tags`, { local: true, sinal, tempoLimiteMs: 10_000 })
    const modelos = ((r.dados as { models?: { name?: string }[] })?.models ?? []).map((m) => m.name).filter(Boolean)
    if (cfg.modelo && !modelos.includes(cfg.modelo)) return `Conectado, mas o modelo “${cfg.modelo}” não foi encontrado. Modelos instalados: ${modelos.join(', ') || 'nenhum'}.`
    return `Conectado. Modelos instalados: ${modelos.join(', ') || 'nenhum'}.`
  },
  async listarModelos(cfg, _chave, sinal) {
    const r = await requisitarJson(`${cfg.urlBase.replace(/\/$/, '')}/api/tags`, { local: true, sinal, tempoLimiteMs: 10_000 })
    return ((r.dados as { models?: { name?: unknown }[] })?.models ?? []).map((m) => m.name).filter((n): n is string => typeof n === 'string')
  }
}

export const adaptadorOpenAiCompativel: Adaptador = {
  id: 'openai_compativel',
  async gerar(pedido, cfg, chave, sinal) {
    if (!chave) throw new Error('Chave do provedor não configurada.')
    const r = await requisitarJson(`${cfg.urlBase.replace(/\/$/, '')}/chat/completions`, {
      local: false,
      sinal,
      tempoLimiteMs: 300_000,
      cabecalhos: { Authorization: `Bearer ${chave}` },
      corpo: {
        model: cfg.modelo,
        max_tokens: pedido.maxTokens,
        temperature: pedido.temperatura,
        ...(pedido.json ? { response_format: { type: 'json_object' } } : {}),
        messages: [
          { role: 'system', content: pedido.sistema },
          { role: 'user', content: pedido.usuario }
        ]
      }
    })
    const d = r.dados as { choices?: { message?: { content?: unknown } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } }
    const texto = d?.choices?.[0]?.message?.content
    if (typeof texto !== 'string') throw new Error('Resposta inesperada do provedor.')
    return { texto: semPensamento(texto), tokensEntrada: d.usage?.prompt_tokens ?? null, tokensSaida: d.usage?.completion_tokens ?? null }
  },
  async testar(cfg, chave, sinal) {
    if (!chave) throw new Error('Chave do provedor não configurada.')
    await requisitarJson(`${cfg.urlBase.replace(/\/$/, '')}/models`, { local: false, sinal, tempoLimiteMs: 15_000, cabecalhos: { Authorization: `Bearer ${chave}` } })
    return 'Conectado (lista de modelos acessível). O teste não gera texto e não deve ter custo.'
  },
  async listarModelos(cfg, chave, sinal, urlModelos) {
    if (!chave) throw new Error('Chave do provedor não configurada.')
    const r = await requisitarJson(urlModelos ?? `${cfg.urlBase.replace(/\/$/, '')}/models`, { local: false, sinal, tempoLimiteMs: 20_000, cabecalhos: { Authorization: `Bearer ${chave}` } })
    // Formato OpenAI ({data:[{id}]}) ou lista simples ([{id}]), como no catálogo do GitHub.
    const d = r.dados as { data?: { id?: unknown }[] } | { id?: unknown }[] | null
    const lista = Array.isArray(d) ? d : (d?.data ?? [])
    return lista.map((m) => (typeof m?.id === 'string' ? m.id.replace(/^models\//, '') : null)).filter((n): n is string => n !== null).slice(0, 500)
  }
}

export const ADAPTADORES: Record<AdaptadorLlm, Adaptador> = {
  simulado: adaptadorSimulado,
  ollama: adaptadorOllama,
  openai_compativel: adaptadorOpenAiCompativel
}
