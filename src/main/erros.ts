/** Erro com mensagem pensada para o usuário. Erros de outros tipos viram mensagem genérica. */
export class ErroApp extends Error {
  constructor(
    readonly codigo: string,
    mensagem: string
  ) {
    super(mensagem)
    this.name = 'ErroApp'
  }
}

export function naoEncontrado(oQue: string): ErroApp {
  return new ErroApp('nao_encontrado', `${oQue} não encontrado(a). Pode ter sido excluído(a).`)
}
