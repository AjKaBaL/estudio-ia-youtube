import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { adaptadorOllama } from '../ia/adaptadores'
import * as ia from '../ia/central'
import { validarUrlProvedor } from '../ia/http'
import { POLITICA_PADRAO, provedorIaSchema, type ProvedorIaConfig } from '@shared/ia'
import { bancoDeTeste, cofreDeTeste } from './auxiliares'

const base = (c: Partial<ProvedorIaConfig>): ProvedorIaConfig =>
  provedorIaSchema.parse({
  nome: 'P',
  adaptador: 'simulado',
  urlBase: '',
  modelo: '',
  precoEntradaPorMilhao: null,
  precoSaidaPorMilhao: null,
  maxTokensSaida: 1000,
  limitesConhecidos: '',
  ...c
  })
const pedido = (provedorId: number) => ({ provedorId, finalidade: 'teste', sistema: 'sis', partes: [{ rotulo: 'Roteiro privado', texto: 'x'.repeat(4000) }] })

describe('cofre de credenciais', () => {
  it('guarda cifrado, não expõe a chave e permite remover', () => {
    const cofre = cofreDeTeste()
    cofre.guardar('provedor:1', 'sk-segredo-muito-secreto')
    const arquivo = (cofre as unknown as { arquivo: string }).arquivo
    expect(readFileSync(arquivo, 'utf8')).not.toContain('sk-segredo')
    expect(cofre.obter('provedor:1')).toBe('sk-segredo-muito-secreto')
    cofre.remover('provedor:1')
    expect(cofre.possui('provedor:1')).toBe(false)
  })
  it('recusa salvar quando a criptografia do Windows não está disponível', () => {
    expect(() => cofreDeTeste(false).guardar('x', 'y')).toThrow(/criptografia/)
  })
})

describe('central de serviços', () => {
  it('padrão é custo zero: modo local, teto zero, recursos caros desligados', () => {
    const db = bancoDeTeste()
    expect(ia.lerPolitica(db)).toEqual(POLITICA_PADRAO)
    const c = ia.central(db, cofreDeTeste())
    expect(c.categorias.find((x) => x.categoria === 'imagem')?.disponivel).toBe(false)
    expect(c.provedores).toEqual([])
  })

  it('adaptador simulado: local, sem autorização, uso registrado com custo zero', async () => {
    const db = bancoDeTeste()
    const cofre = cofreDeTeste()
    const p = ia.salvarProvedor(db, cofre, null, base({ nome: 'Simulado' }))
    const plano = ia.planejarEnvio(db, cofre, pedido(p.id))
    expect(plano).toMatchObject({ local: true, exigeAutorizacao: false, bloqueios: [], custo: { valor: 0 } })
    const r = await ia.executarEnvio(db, cofre, { ...pedido(p.id), partes: [{ rotulo: 'x', texto: '[A7]' }] }, null, { temperatura: 0.5, json: true, sinal: new AbortController().signal })
    expect(r.texto).toContain('[SIMULADO]')
    expect(ia.central(db, cofre).usoRecente[0]).toMatchObject({ provedor: 'Simulado', custo: 0, sucesso: true })
  })

  it('online: bloqueado no modo local, exige chave, respeita tetos e exige autorização do plano exato', async () => {
    const db = bancoDeTeste()
    const cofre = cofreDeTeste()
    const p = ia.salvarProvedor(db, cofre, null, base({ nome: 'Online', adaptador: 'openai_compativel', urlBase: 'https://api.exemplo.invalid/v1', modelo: 'm', precoEntradaPorMilhao: 1, precoSaidaPorMilhao: 2 }))
    let plano = ia.planejarEnvio(db, cofre, pedido(p.id))
    expect(plano.bloqueios.join(' ')).toMatch(/somente local/)
    expect(plano.bloqueios.join(' ')).toMatch(/chave/)
    expect(plano.avisos.join(' ')).toMatch(/api.exemplo.invalid/)
    expect(plano.dados).toEqual([{ rotulo: 'Roteiro privado', caracteres: 4000 }])

    ia.salvarPolitica(db, { ...POLITICA_PADRAO, modo: 'hibrido', tetoPorExecucao: 0.0001, tetoMensal: 1 })
    ia.definirChave(db, cofre, p.id, 'sk-teste-1234567')
    plano = ia.planejarEnvio(db, cofre, pedido(p.id))
    expect(plano.bloqueios.join(' ')).toMatch(/teto por execução/)
    await expect(ia.executarEnvio(db, cofre, pedido(p.id), plano.assinatura, { temperatura: 0, json: false, sinal: new AbortController().signal })).rejects.toThrow(/teto/)

    ia.salvarPolitica(db, { ...POLITICA_PADRAO, modo: 'hibrido', tetoPorExecucao: 1, tetoMensal: 1 })
    plano = ia.planejarEnvio(db, cofre, pedido(p.id))
    expect(plano.bloqueios).toEqual([])
    expect(plano.exigeAutorizacao).toBe(true)
    await expect(ia.executarEnvio(db, cofre, pedido(p.id), null, { temperatura: 0, json: false, sinal: new AbortController().signal })).rejects.toThrow(/autorização/)
    // Autorização de outro conteúdo não vale para este.
    const outro = ia.planejarEnvio(db, cofre, { ...pedido(p.id), partes: [{ rotulo: 'x', texto: 'outro' }] })
    await expect(ia.executarEnvio(db, cofre, pedido(p.id), outro.assinatura, { temperatura: 0, json: false, sinal: new AbortController().signal })).rejects.toThrow(/autorização/)
  })

  it('preço desconhecido: custo não estimável, aviso explícito e autorização obrigatória', () => {
    const db = bancoDeTeste()
    const cofre = cofreDeTeste()
    ia.salvarPolitica(db, { ...POLITICA_PADRAO, modo: 'online', tetoMensal: null, tetoPorExecucao: null })
    const p = ia.salvarProvedor(db, cofre, null, base({ adaptador: 'openai_compativel', urlBase: 'https://api.exemplo.invalid/v1', modelo: 'm' }))
    ia.definirChave(db, cofre, p.id, 'sk-teste-1234567')
    const plano = ia.planejarEnvio(db, cofre, pedido(p.id))
    expect(plano.custo).toMatchObject({ estimavel: false, valor: null })
    expect(plano.avisos.join(' ')).toMatch(/Não foi possível estimar o custo/)
    expect(plano.exigeAutorizacao).toBe(true)
  })

  it('valida endereços: local só loopback, online só https público', () => {
    expect(() => validarUrlProvedor('http://192.168.0.10:11434', true)).toThrow()
    expect(validarUrlProvedor('http://127.0.0.1:11434', true).port).toBe('11434')
    expect(() => validarUrlProvedor('http://api.exemplo.invalid', false)).toThrow(/https/)
    expect(() => validarUrlProvedor('https://10.0.0.5/v1', false)).toThrow()
    const db = bancoDeTeste()
    expect(() => ia.salvarProvedor(db, cofreDeTeste(), null, base({ adaptador: 'ollama', urlBase: 'http://intranet:11434', modelo: 'x' }))).toThrow()
  })

  it('remover provedor apaga a chave do cofre', () => {
    const db = bancoDeTeste()
    const cofre = cofreDeTeste()
    const p = ia.salvarProvedor(db, cofre, null, base({ adaptador: 'openai_compativel', urlBase: 'https://api.exemplo.invalid/v1', modelo: 'm' }))
    ia.definirChave(db, cofre, p.id, 'sk-teste-1234567')
    ia.removerProvedor(db, cofre, p.id)
    expect(cofre.possui(`provedor:${p.id}`)).toBe(false)
  })
})

describe('adaptador Ollama contra servidor local de teste', () => {
  let servidor: http.Server
  let url = ''
  beforeAll(async () => {
    servidor = http.createServer((req, res) => {
      let corpo = ''
      req.on('data', (c) => (corpo += c))
      req.on('end', () => {
        if (req.url === '/api/tags') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ models: [{ name: 'modelo-teste' }] }))
        if (req.url === '/api/chat') {
          const pedidoRecebido = JSON.parse(corpo) as { model: string; messages: unknown[] }
          return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ message: { content: `ok:${pedidoRecebido.model}:${pedidoRecebido.messages.length}` }, prompt_eval_count: 10, eval_count: 5 }))
        }
        res.writeHead(404).end()
      })
    })
    await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', r))
    url = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`
  })
  afterAll(() => servidor.close())

  it('testa conexão e gera resposta', async () => {
    const cfg = base({ adaptador: 'ollama', urlBase: url, modelo: 'modelo-teste' })
    expect(await adaptadorOllama.testar(cfg, null, new AbortController().signal)).toMatch(/modelo-teste/)
    const r = await adaptadorOllama.gerar({ sistema: 's', usuario: 'u', maxTokens: 10, temperatura: 0, json: false }, cfg, null, new AbortController().signal)
    expect(r).toEqual({ texto: 'ok:modelo-teste:2', tokensEntrada: 10, tokensSaida: 5 })
  })
})
