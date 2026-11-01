import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'

/**
 * Cofre de credenciais (Etapa 10). As chaves ficam num arquivo separado do banco,
 * criptografadas pelo Windows (DPAPI, via safeStorage do Electron). Nunca vão para a interface,
 * para o banco ou para os registros de eventos.
 */

export interface Cifra {
  disponivel(): boolean
  cifrar(texto: string): Buffer
  decifrar(dados: Buffer): string
}

export class Cofre {
  constructor(
    private readonly arquivo: string,
    private readonly cifra: Cifra
  ) {}

  private ler(): Record<string, string> {
    if (!existsSync(this.arquivo)) return {}
    try {
      const bruto = JSON.parse(readFileSync(this.arquivo, 'utf8')) as unknown
      return bruto && typeof bruto === 'object' ? (bruto as Record<string, string>) : {}
    } catch {
      return {}
    }
  }

  private gravar(dados: Record<string, string>): void {
    const temporario = `${this.arquivo}.tmp`
    writeFileSync(temporario, JSON.stringify(dados), { encoding: 'utf8', mode: 0o600 })
    renameSync(temporario, this.arquivo)
  }

  disponivel(): boolean {
    return this.cifra.disponivel()
  }

  guardar(chave: string, segredo: string): void {
    if (!this.cifra.disponivel()) throw new Error('A criptografia do Windows não está disponível; a chave não foi salva.')
    const dados = this.ler()
    dados[chave] = this.cifra.cifrar(segredo).toString('base64')
    this.gravar(dados)
  }

  /** Uso interno do processo principal, apenas no momento da chamada ao provedor. */
  obter(chave: string): string | null {
    const v = this.ler()[chave]
    if (!v) return null
    try {
      return this.cifra.decifrar(Buffer.from(v, 'base64'))
    } catch {
      return null
    }
  }

  possui(chave: string): boolean {
    return Boolean(this.ler()[chave])
  }

  remover(chave: string): void {
    const dados = this.ler()
    if (chave in dados) this.gravar(Object.fromEntries(Object.entries(dados).filter(([k]) => k !== chave)))
  }
}
