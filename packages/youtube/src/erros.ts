/** Classificação dos erros da API em mensagens úteis (cota, autorização, verificação, política...). */

export type TipoErroYouTube = 'quota' | 'autorizacao' | 'verificacao' | 'politica' | 'rede' | 'nao_encontrado' | 'validacao' | 'outro'

export class ErroYouTube extends Error {
  constructor(
    readonly tipo: TipoErroYouTube,
    mensagem: string,
    readonly status?: number
  ) {
    super(mensagem)
    this.name = 'ErroYouTube'
  }
}

const MOTIVOS: Record<string, { tipo: TipoErroYouTube; mensagem: string }> = {
  quotaExceeded: { tipo: 'quota', mensagem: 'A cota diária da API do YouTube foi atingida. Tente de novo depois que a cota for renovada (veja o Console do Google Cloud).' },
  rateLimitExceeded: { tipo: 'quota', mensagem: 'Muitas solicitações em pouco tempo. Aguarde alguns minutos.' },
  uploadLimitExceeded: { tipo: 'quota', mensagem: 'O canal atingiu o limite de envios do YouTube por enquanto.' },
  forbidden: { tipo: 'autorizacao', mensagem: 'A conta não tem permissão para esta ação.' },
  insufficientPermissions: { tipo: 'autorizacao', mensagem: 'Permissão insuficiente: reconecte a conta concedendo a permissão necessária.' },
  authError: { tipo: 'autorizacao', mensagem: 'Autorização inválida ou expirada. Reconecte a conta.' },
  youtubeSignupRequired: { tipo: 'autorizacao', mensagem: 'A conta Google não tem um canal do YouTube.' },
  forbiddenPrivacySetting: { tipo: 'verificacao', mensagem: 'A privacidade escolhida não é permitida para este projeto de API. Projetos não verificados/auditados podem ficar restritos a vídeos privados.' },
  invalidPublishAt: { tipo: 'validacao', mensagem: 'Data de publicação agendada inválida (precisa ser futura e o vídeo privado).' },
  invalidTitle: { tipo: 'validacao', mensagem: 'Título inválido para o YouTube.' },
  invalidDescription: { tipo: 'validacao', mensagem: 'Descrição inválida para o YouTube.' },
  invalidTags: { tipo: 'validacao', mensagem: 'Tags inválidas para o YouTube.' },
  invalidCategoryId: { tipo: 'validacao', mensagem: 'Categoria inválida.' },
  videoNotFound: { tipo: 'nao_encontrado', mensagem: 'Vídeo não encontrado no YouTube.' },
  playlistNotFound: { tipo: 'nao_encontrado', mensagem: 'Playlist não encontrada.' }
}

export function classificarErro(status: number, corpo: string): ErroYouTube {
  let motivo = ''
  let texto = ''
  try {
    const d = JSON.parse(corpo) as { error?: { errors?: { reason?: string }[]; message?: string; status?: string } | string; error_description?: string }
    if (typeof d.error === 'string') {
      motivo = d.error
      texto = d.error_description ?? ''
    } else {
      motivo = d.error?.errors?.[0]?.reason ?? d.error?.status ?? ''
      texto = d.error?.message ?? ''
    }
  } catch {
    /* corpo não é JSON */
  }
  const conhecido = MOTIVOS[motivo]
  if (conhecido) return new ErroYouTube(conhecido.tipo, conhecido.mensagem, status)
  if (motivo === 'invalid_grant') return new ErroYouTube('autorizacao', 'A autorização foi revogada ou expirou. Conecte a conta novamente.', status)
  if (status === 401) return new ErroYouTube('autorizacao', 'Autorização inválida ou expirada. Reconecte a conta.', status)
  if (status === 403 && /audit|verif/i.test(texto)) return new ErroYouTube('verificacao', 'O projeto de API precisa de verificação/auditoria do Google para esta ação.', status)
  if (status === 403 && /policy|terms/i.test(texto)) return new ErroYouTube('politica', 'Ação recusada pelas políticas do YouTube.', status)
  if (status === 404) return new ErroYouTube('nao_encontrado', 'Recurso não encontrado no YouTube.', status)
  if (status >= 500) return new ErroYouTube('rede', 'O YouTube está com instabilidade. Tente de novo mais tarde.', status)
  // Mensagem do Google truncada e sem dados sensíveis (a API não devolve tokens em erros).
  return new ErroYouTube('outro', `O YouTube recusou a solicitação (${status})${texto ? `: ${texto.slice(0, 200)}` : ''}.`, status)
}
