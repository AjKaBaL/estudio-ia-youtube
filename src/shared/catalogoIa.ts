import type { AdaptadorLlm } from './ia'

/**
 * Catálogo de IAs que podem ser usadas sem pagar (camadas gratuitas) e da IA local.
 * Endereços conferidos em 31/10/2026. Limites e modelos gratuitos mudam com frequência: por isso o app
 * busca a lista ATUAL de modelos com a sua chave e escolhe um pelas preferências abaixo, e pausa sozinho
 * um provedor quando ele avisa que o limite acabou (erro 429).
 */

export interface ItemCatalogoIa {
  id: string
  nome: string
  adaptador: AdaptadorLlm
  urlBase: string
  /** Onde criar a chave (vazio para a IA local). */
  urlChave: string
  /** Lista de modelos, quando não fica em {urlBase}/models. */
  urlModelos?: string
  /** Trechos de nome de modelo em ordem de preferência; o primeiro que existir na lista é escolhido. */
  preferencias: string[]
  /** Só modelos cujo nome contém este trecho (ex.: ":free" no OpenRouter). */
  exigeNoModelo?: string
  resumo: string
  limites: string
  privacidade: string
  prioridade: number
}

export const CATALOGO_IA: readonly ItemCatalogoIa[] = [
  {
    id: 'ollama',
    nome: 'Ollama (no seu PC)',
    adaptador: 'ollama',
    urlBase: 'http://127.0.0.1:11434',
    urlChave: 'https://ollama.com/download',
    preferencias: ['qwen3', 'gemma3', 'llama3.3', 'llama3.1', 'mistral', 'phi4'],
    resumo: 'Roda no próprio computador: gratuito, sem limite de uso e nada sai da máquina. Mais lento e um pouco menos capaz que as IAs online.',
    limites: 'Sem limite; depende da memória e da placa de vídeo do PC.',
    privacidade: 'Nada é enviado para a internet.',
    prioridade: 5
  },
  {
    id: 'groq',
    nome: 'Groq',
    adaptador: 'openai_compativel',
    urlBase: 'https://api.groq.com/openai/v1',
    urlChave: 'https://console.groq.com/keys',
    preferencias: ['llama-4', 'gpt-oss-120b', 'llama-3.3-70b', 'qwen', 'kimi', 'gpt-oss', 'llama'],
    resumo: 'Muito rápida, com modelos abertos grandes. Bom para escrever e revisar.',
    limites: 'Camada gratuita com limites por minuto e por dia (variam por modelo).',
    privacidade: 'Leia a política de dados do fornecedor antes de usar.',
    prioridade: 1
  },
  {
    id: 'gemini',
    nome: 'Google AI Studio (Gemini)',
    adaptador: 'openai_compativel',
    urlBase: 'https://generativelanguage.googleapis.com/v1beta/openai',
    urlChave: 'https://aistudio.google.com/apikey',
    preferencias: ['gemini-3-flash', 'gemini-2.5-flash', 'flash', 'gemma-3-27b', 'gemini'],
    resumo: 'Modelos Gemini do Google, bons em português e com contexto longo.',
    limites: 'Camada gratuita com limites por minuto e por dia.',
    privacidade: 'Na camada gratuita, o Google pode usar o conteúdo enviado para melhorar seus produtos. Envie só material público (pesquisa e roteiro).',
    prioridade: 2
  },
  {
    id: 'mistral',
    nome: 'Mistral (plano Experiment)',
    adaptador: 'openai_compativel',
    urlBase: 'https://api.mistral.ai/v1',
    urlChave: 'https://console.mistral.ai/api-keys',
    preferencias: ['mistral-medium-latest', 'mistral-small-latest', 'mistral-large-latest', 'mistral'],
    resumo: 'Empresa europeia; modelos bons em vários idiomas.',
    limites: 'Plano gratuito para testes, com limites de uso.',
    privacidade: 'No plano gratuito os dados podem ser usados para treino. Confira a opção de recusa no painel.',
    prioridade: 3
  },
  {
    id: 'cerebras',
    nome: 'Cerebras',
    adaptador: 'openai_compativel',
    urlBase: 'https://api.cerebras.ai/v1',
    urlChave: 'https://cloud.cerebras.ai/',
    preferencias: ['gpt-oss-120b', 'llama-4', 'qwen-3', 'llama-3.3', 'llama'],
    resumo: 'Muito rápida, com modelos abertos.',
    limites: 'Camada gratuita com limites por minuto e por dia.',
    privacidade: 'Leia a política de dados do fornecedor antes de usar.',
    prioridade: 4
  },
  {
    id: 'openrouter',
    nome: 'OpenRouter (modelos gratuitos)',
    adaptador: 'openai_compativel',
    urlBase: 'https://openrouter.ai/api/v1',
    urlChave: 'https://openrouter.ai/settings/keys',
    exigeNoModelo: ':free',
    preferencias: ['gemma-4-31b', 'nemotron-3-ultra', 'gemma', 'nemotron', 'llama', 'qwen'],
    resumo: 'Um só cadastro dá acesso a vários modelos gratuitos (só os terminados em “:free” são usados).',
    limites: 'Modelos gratuitos têm limite diário de pedidos, maior se a conta tiver créditos.',
    privacidade: 'Cada modelo gratuito é servido por um fornecedor diferente; alguns registram os pedidos.',
    prioridade: 6
  },
  {
    id: 'github',
    nome: 'GitHub Models',
    adaptador: 'openai_compativel',
    urlBase: 'https://models.github.ai/inference',
    urlModelos: 'https://models.github.ai/catalog/models',
    urlChave: 'https://github.com/settings/personal-access-tokens',
    preferencias: ['gpt-4.1-mini', 'gpt-4o-mini', 'llama', 'mistral'],
    resumo: 'Modelos de vários fornecedores com a sua conta do GitHub. Use um token “fine-grained” com a permissão “Models: read”.',
    limites: 'Uso gratuito para testes, com limites por minuto e por dia baixos.',
    privacidade: 'Leia a política de dados do GitHub antes de usar.',
    prioridade: 7
  },
  {
    id: 'huggingface',
    nome: 'Hugging Face',
    adaptador: 'openai_compativel',
    urlBase: 'https://router.huggingface.co/v1',
    urlChave: 'https://huggingface.co/settings/tokens',
    preferencias: ['deepseek', 'qwen', 'llama', 'gemma'],
    resumo: 'Acesso a muitos modelos abertos com um token gratuito.',
    limites: 'Créditos gratuitos mensais pequenos; depois disso, é pago.',
    privacidade: 'Leia a política de dados do fornecedor antes de usar.',
    prioridade: 8
  }
]

/** Escolhe o modelo da lista atual do fornecedor pelas preferências do catálogo. */
/** Modelos de áudio, imagem, embeddings, moderação e agentes não servem para escrever texto. */
function soTexto(modelos: readonly string[]): string[] {
  return modelos.filter((m) => !/(embed|whisper|tts|audio|image|imagen|veo|vision-only|guard|moderation|safety|rerank|transcribe|compound|orpheus|live|robotics|computer-use|deep-research|aqa|allam)/i.test(m))
}

/**
 * Modelos reserva do mesmo fornecedor (até `max`), na ordem das preferências: quando o principal esgota a cota
 * do dia, o app passa para o próximo, já que na camada gratuita cada modelo tem a sua própria cota.
 */
export function escolherReservas(item: Pick<ItemCatalogoIa, 'preferencias' | 'exigeNoModelo'>, modelos: readonly string[], principal: string, max = 4): string[] {
  const texto = soTexto(modelos.filter((m) => m !== principal && (!item.exigeNoModelo || m.includes(item.exigeNoModelo))))
  const saida: string[] = []
  for (const pref of item.preferencias) {
    for (const m of texto) if (m.toLowerCase().includes(pref.toLowerCase()) && !saida.includes(m)) saida.push(m)
  }
  return saida.slice(0, max)
}

export function escolherModelo(item: Pick<ItemCatalogoIa, 'preferencias' | 'exigeNoModelo'>, modelos: readonly string[]): string | null {
  const validos = modelos.filter((m) => !item.exigeNoModelo || m.includes(item.exigeNoModelo))
  // Modelos de áudio, imagem, embeddings e moderação não servem para escrever texto.
  const texto = soTexto(validos)
  for (const pref of item.preferencias) {
    const achado = texto.find((m) => m.toLowerCase().includes(pref.toLowerCase()))
    if (achado) return achado
  }
  return texto[0] ?? null
}
