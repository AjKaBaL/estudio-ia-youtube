import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { ErroApp } from '../erros'

/**
 * Arquivo "client_secret_….json" que o Google Cloud oferece para baixar ao criar o ID do cliente OAuth.
 * Importar evita copiar e colar o ID e a chave à mão. O conteúdo vai direto para o cofre criptografado;
 * o arquivo original não é alterado nem apagado (o usuário é orientado a apagá-lo).
 */

const TAMANHO_MAXIMO = 64 * 1024
const PADRAO_NOME = /^client_secret_.*\.json$/i
const DIAS_RECENTE = 30

export interface ArquivoClienteEncontrado {
  caminho: string
  nome: string
  modificadoEm: string
}

export function lerArquivoCliente(caminho: string): { clientId: string; clientSecret: string } {
  let dados: unknown
  try {
    if (statSync(caminho).size > TAMANHO_MAXIMO) throw new Error('grande')
    dados = JSON.parse(readFileSync(caminho, 'utf8'))
  } catch {
    throw new ErroApp('arquivo_invalido', 'Não foi possível ler o arquivo. Escolha o arquivo .json baixado na tela do ID do cliente OAuth.')
  }
  const d = dados as { installed?: { client_id?: unknown; client_secret?: unknown }; web?: unknown }
  if (!d.installed && d.web) {
    throw new ErroApp('tipo_cliente', 'Este arquivo é de um cliente do tipo “Aplicativo da Web”. No Google Cloud, crie um ID do cliente do tipo “App para computador” e baixe o arquivo dele.')
  }
  const id = typeof d.installed?.client_id === 'string' ? d.installed.client_id.trim() : ''
  const segredo = typeof d.installed?.client_secret === 'string' ? d.installed.client_secret.trim() : ''
  if (!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(id) || !segredo || segredo.length > 200) {
    throw new ErroApp('arquivo_invalido', 'O arquivo não contém um ID do cliente OAuth válido do Google.')
  }
  return { clientId: id, clientSecret: segredo }
}

/** Procura na pasta Downloads o client_secret_….json mais recente (últimos 30 dias). Só lê nomes e datas. */
export function procurarArquivoCliente(pasta: string | undefined, agora = new Date()): ArquivoClienteEncontrado | null {
  if (!pasta) return null
  let nomes: string[]
  try {
    nomes = readdirSync(pasta).filter((n) => PADRAO_NOME.test(n))
  } catch {
    return null
  }
  const limite = agora.getTime() - DIAS_RECENTE * 86_400_000
  const achados = nomes
    .map((nome) => {
      try {
        const s = statSync(join(pasta, nome))
        return s.isFile() && s.size <= TAMANHO_MAXIMO ? { caminho: join(pasta, nome), nome, t: s.mtimeMs } : null
      } catch {
        return null
      }
    })
    .filter((x): x is { caminho: string; nome: string; t: number } => x !== null && x.t >= limite)
    .sort((a, b) => b.t - a.t)
  const a = achados[0]
  return a ? { caminho: a.caminho, nome: a.nome, modificadoEm: new Date(a.t).toISOString() } : null
}
