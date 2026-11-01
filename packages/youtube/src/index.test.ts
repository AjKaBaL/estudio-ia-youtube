import http from 'node:http'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { criarYouTubeGateway, ErroYouTube, ESCOPOS, YouTubeNaoConfigurado, type ClienteHttp, type Segredos } from './index'
import { TAMANHO_PARTE } from './gateway'

/** Cofre em memória (apenas para testes). */
function segredosMemoria(): Segredos & { dados: Map<string, string> } {
  const dados = new Map<string, string>()
  return { dados, obter: (k) => dados.get(k) ?? null, guardar: (k, v) => void dados.set(k, v), remover: (k) => void dados.delete(k) }
}

/** Simula os servidores do Google. Nunca acessa a internet. */
function googleSimulado(opcoes: { falharNaParte?: number; quota?: boolean } = {}) {
  const chamadas: { metodo: string; url: string; cabecalhos: Record<string, string> }[] = []
  let recebidos = 0
  let partes = 0
  const cliente: ClienteHttp = {
    async requisitar(req): Promise<{ status: number; cabecalhos: Record<string, string>; corpo: string }> {
      chamadas.push({ metodo: req.metodo, url: req.url, cabecalhos: req.cabecalhos ?? {} })
      const u = new URL(req.url)
      if (u.href === 'https://oauth2.googleapis.com/token') {
        const f = new URLSearchParams(String(req.corpo))
        if (f.get('grant_type') === 'authorization_code' && f.get('code') === 'codigo-ok' && f.get('code_verifier')) {
          return { status: 200, cabecalhos: {}, corpo: JSON.stringify({ access_token: 'acesso-1', refresh_token: 'renova-1', expires_in: 3600, scope: `${ESCOPOS.leitura} ${ESCOPOS.envio}` }) }
        }
        if (f.get('grant_type') === 'refresh_token') return { status: 200, cabecalhos: {}, corpo: JSON.stringify({ access_token: 'acesso-2', expires_in: 3600 }) }
        return { status: 400, cabecalhos: {}, corpo: JSON.stringify({ error: 'invalid_grant' }) }
      }
      if (u.href.startsWith('https://oauth2.googleapis.com/revoke')) return { status: 200, cabecalhos: {}, corpo: '{}' }
      if (u.pathname === '/youtube/v3/channels') return { status: 200, cabecalhos: {}, corpo: JSON.stringify({ items: [{ id: 'UC123', snippet: { title: 'Canal de teste' } }] }) }
      if (u.href.startsWith('https://www.googleapis.com/upload/youtube/v3/videos?upload_id=sessao-1')) {
        const faixa = req.cabecalhos?.['Content-Range'] ?? ''
        const total = Number(faixa.split('/')[1])
        if (faixa.startsWith('bytes */')) {
          return recebidos >= total ? { status: 200, cabecalhos: {}, corpo: JSON.stringify({ id: 'video-abc' }) } : { status: 308, cabecalhos: recebidos ? { range: `bytes=0-${recebidos - 1}` } : {}, corpo: '' }
        }
        partes++
        if (opcoes.falharNaParte === partes) throw new Error('rede caiu')
        recebidos += (req.corpo as Buffer).length
        return recebidos >= total ? { status: 201, cabecalhos: {}, corpo: JSON.stringify({ id: 'video-abc' }) } : { status: 308, cabecalhos: { range: `bytes=0-${recebidos - 1}` }, corpo: '' }
      }
      if (u.pathname === '/upload/youtube/v3/videos') {
        if (opcoes.quota) return { status: 403, cabecalhos: {}, corpo: JSON.stringify({ error: { errors: [{ reason: 'quotaExceeded' }], message: 'quota' } }) }
        return { status: 200, cabecalhos: { location: 'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=sessao-1' }, corpo: '' }
      }
      return { status: 404, cabecalhos: {}, corpo: '{}' }
    }
  }
  return { cliente, chamadas }
}

/** "Navegador" de teste: segue a URL de autorização e devolve o código ao servidor local. */
async function navegador(urlAutorizacao: string, codigo = 'codigo-ok'): Promise<void> {
  const u = new URL(urlAutorizacao)
  expect(u.searchParams.get('code_challenge_method')).toBe('S256')
  const retorno = new URL(u.searchParams.get('redirect_uri')!)
  expect(retorno.hostname).toBe('127.0.0.1')
  retorno.searchParams.set('code', codigo)
  retorno.searchParams.set('state', u.searchParams.get('state')!)
  await new Promise<void>((resolve, reject) => http.get(retorno, (res) => res.resume().on('end', resolve)).on('error', reject))
}

const meta = { titulo: 'Teste', descricao: 'd', tags: [], categoriaId: '28', privacidade: 'private' as const, publicarEm: null, feitoParaCriancas: false, conteudoSintetico: false }

describe('@estudio/youtube', () => {
  it('sem credenciais: não configurado e sem chamadas de rede', async () => {
    const g = googleSimulado()
    const yt = criarYouTubeGateway({ http: g.cliente, segredos: segredosMemoria() })
    expect((await yt.status()).estado).toBe('nao_configurado')
    expect(g.chamadas).toEqual([])
    expect((await new YouTubeNaoConfigurado().status()).estado).toBe('nao_configurado')
  })

  it('conecta por OAuth com PKCE e retorno local, com escopos mínimos; desconecta e apaga tokens', async () => {
    const g = googleSimulado()
    const s = segredosMemoria()
    const yt = criarYouTubeGateway({ http: g.cliente, segredos: s })
    expect(() => yt.configurarCliente('invalido', 'x')).toThrow(ErroYouTube)
    yt.configurarCliente('123-abc.apps.googleusercontent.com', 'segredo-cliente')
    let urlUsada = ''
    const st = await yt.conectar({ metricas: false, receita: false, abrirNavegador: async (url) => { urlUsada = url; await navegador(url) } })
    expect(st.estado).toBe('conectado')
    expect(new URL(urlUsada).searchParams.get('scope')).toBe(`${ESCOPOS.leitura} ${ESCOPOS.envio}`)
    expect(await yt.listarCanais()).toEqual([{ id: 'UC123', titulo: 'Canal de teste' }])
    await yt.desconectar()
    expect(s.dados.has('youtube:tokens')).toBe(false)
    expect(g.chamadas.some((c) => c.url.includes('/revoke'))).toBe(true)
  })

  it('recusa resposta de autorização com "state" diferente', async () => {
    const yt = criarYouTubeGateway({ http: googleSimulado().cliente, segredos: segredosMemoria() })
    yt.configurarCliente('123-abc.apps.googleusercontent.com', 'segredo-cliente')
    await expect(
      yt.conectar({
        metricas: false,
        receita: false,
        abrirNavegador: async (url) => {
          const u = new URL(url)
          const r = new URL(u.searchParams.get('redirect_uri')!)
          r.searchParams.set('code', 'codigo-ok')
          r.searchParams.set('state', 'forjado')
          await new Promise<void>((res) => http.get(r, (x) => x.resume().on('end', res)))
        }
      })
    ).rejects.toThrow(/não corresponde/)
  })

  it('envio retomável: falha no meio, retomada a partir dos bytes confirmados, sem reenviar tudo', async () => {
    const g = googleSimulado({ falharNaParte: 2 })
    const s = segredosMemoria()
    const yt = criarYouTubeGateway({ http: g.cliente, segredos: s })
    yt.configurarCliente('123-abc.apps.googleusercontent.com', 'segredo-cliente')
    s.guardar('youtube:tokens', JSON.stringify({ acesso: 'a', renovacao: 'r', expiraEm: Date.now() + 3600_000, escopos: [] }))
    const pasta = mkdtempSync(join(tmpdir(), 'yt-'))
    const tamanho = TAMANHO_PARTE * 2 + 1000
    writeFileSync(join(pasta, 'v.mp4'), Buffer.alloc(tamanho, 1))
    const sessao = await yt.iniciarEnvio(meta, tamanho, 'video/mp4')
    await expect(yt.enviarPartes(sessao, join(pasta, 'v.mp4'), tamanho, 0, () => undefined, new AbortController().signal)).rejects.toThrow(/rede caiu/)
    const situacao = await yt.consultarEnvio(sessao, tamanho)
    expect(situacao).toEqual({ concluido: false, bytesRecebidos: TAMANHO_PARTE, videoId: null })
    const fim = await yt.enviarPartes(sessao, join(pasta, 'v.mp4'), tamanho, situacao.bytesRecebidos, () => undefined, new AbortController().signal)
    expect(fim).toMatchObject({ concluido: true, videoId: 'video-abc' })
    const enviosDeDados = g.chamadas.filter((c) => c.url.includes('upload_id') && !c.cabecalhos['Content-Range']?.startsWith('bytes */'))
    expect(enviosDeDados.map((c) => c.cabecalhos['Content-Range'])).toEqual([
      `bytes 0-${TAMANHO_PARTE - 1}/${tamanho}`,
      `bytes ${TAMANHO_PARTE}-${2 * TAMANHO_PARTE - 1}/${tamanho}`,
      `bytes ${TAMANHO_PARTE}-${2 * TAMANHO_PARTE - 1}/${tamanho}`,
      `bytes ${2 * TAMANHO_PARTE}-${tamanho - 1}/${tamanho}`
    ])
  })

  it('erro de cota é classificado com mensagem clara; token expirado é renovado', async () => {
    const g = googleSimulado({ quota: true })
    const s = segredosMemoria()
    const yt = criarYouTubeGateway({ http: g.cliente, segredos: s })
    yt.configurarCliente('123-abc.apps.googleusercontent.com', 'segredo-cliente')
    s.guardar('youtube:tokens', JSON.stringify({ acesso: 'velho', renovacao: 'renova-1', expiraEm: Date.now() - 1000, escopos: [] }))
    await expect(yt.iniciarEnvio(meta, 10, 'video/mp4')).rejects.toMatchObject({ tipo: 'quota' })
    expect(JSON.parse(s.dados.get('youtube:tokens')!).acesso).toBe('acesso-2')
  })
})
