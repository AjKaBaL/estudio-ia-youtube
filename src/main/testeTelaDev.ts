import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, type BrowserWindow } from 'electron'

/**
 * Apenas em desenvolvimento (ESTUDIO_TESTE_RENDER): exercita a renderização pela tela do Estúdio,
 * clicando nos mesmos botões que o usuário. As mídias vêm de ESTUDIO_TESTE_ARQUIVOS (no lugar da
 * caixa de diálogo). Use sempre com ESTUDIO_PASTA_DADOS apontando para uma pasta de teste.
 * Não existe no aplicativo instalado.
 */
export async function testarRenderPelaTela(janela: BrowserWindow, pasta: string): Promise<void> {
  mkdirSync(pasta, { recursive: true })
  const wc = janela.webContents
  const espera = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
  const js = <T>(codigo: string): Promise<T> => wc.executeJavaScript(codigo) as Promise<T>
  const foto = async (nome: string): Promise<void> => writeFileSync(join(pasta, `${nome}.png`), (await wc.capturePage()).toPNG())
  const clicarTexto = (texto: string): Promise<boolean> =>
    js<boolean>(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === ${JSON.stringify(texto)} && !x.disabled); if (b) b.click(); return !!b })()`)
  const etapas: string[] = []
  const resultado = (ok: boolean): void => {
    writeFileSync(join(pasta, 'resultado.json'), JSON.stringify({ ok, etapas }, null, 2))
    app.quit()
  }

  await new Promise<void>((r) => wc.once('did-finish-load', () => r()))
  await espera(1500)

  // Preparação pela mesma IPC da interface: projeto, roteiro, mídia com licença própria e linha do tempo.
  const prep = await js<{ ok: boolean; erro?: string }>(`(async () => {
    const inv = async (c, d) => { const r = await window.estudio.invoke(c, d); if (!r.ok) throw new Error(c + ': ' + r.erro.mensagem); return r.dados }
    try {
      const proj = await inv('projetos:criar', { nome: 'Teste de renderização' })
      const rot = await inv('roteiros:criar', { projetoId: proj.id, titulo: 'Teste pela tela', tipoVideo: 'longo',
        conteudo: '# Teste\\n\\n## Abertura\\n\\nEsta é a primeira frase da abertura do vídeo de teste.\\n\\n## Conclusão\\n\\nE esta é a frase final do vídeo de teste.\\n' })
      const imp = await inv('midia:importar', { projetoId: proj.id, situacaoLicenca: 'criado_usuario' })
      if (imp.erros.length || imp.importados.length !== 3) throw new Error('importação: ' + JSON.stringify(imp.erros))
      const por = (t) => imp.importados.find(m => m.categoria === t).id
      const ed = await inv('edicao:criar', { roteiroId: rot.id, formato: '16:9' })
      const total = Math.max(...ed.estado.clips.map(c => c.inicio + c.duracao))
      const meio = Math.round(total / 2 * 1000) / 1000
      const base = { corteInicio: 0, volume: 1, fadeIn: 0, fadeOut: 0, texto: '' }
      const clips = [...ed.estado.clips,
        { ...base, id: 'teste-v1', faixa: 'video', recursoId: por('video'), inicio: 0, duracao: meio, cena: 0 },
        { ...base, id: 'teste-v2', faixa: 'video', recursoId: por('imagem'), inicio: meio, duracao: Math.round((total - meio) * 1000) / 1000, cena: 1 },
        { ...base, id: 'teste-a1', faixa: 'narracao', recursoId: por('audio'), inicio: 0, duracao: total, cena: 0 }]
      await inv('edicao:salvar', { id: ed.id, revisaoBase: ed.revisao, estado: { ...ed.estado, clips } })
      await inv('pautas:criar', { projetoId: proj.id, titulo: 'Tema de teste: chips de IA no Brasil', tipoSugerido: 'longo' })
      await inv('pautas:criar', { projetoId: proj.id, titulo: 'Tema de teste: robôs na indústria', tipoSugerido: 'short' })
      return { ok: true }
    } catch (e) { return { ok: false, erro: String(e) } }
  })()`)
  etapas.push(prep.ok ? 'preparação ok' : `preparação falhou: ${prep.erro}`)
  if (!prep.ok) return resultado(false)

  // Daqui em diante, só cliques na interface.
  await js(`document.querySelector('[data-tela="estudio"]').click()`)
  await espera(800)
  await js(`document.querySelector('.lista-item.clicavel')?.click()`)
  await espera(1500)
  // Rola até o painel de renderização (fica abaixo da linha do tempo).
  const rolar = (): Promise<unknown> => js(`[...document.querySelectorAll('h2')].find(h => h.textContent.includes('Exportar'))?.scrollIntoView()`)
  await rolar()
  await espera(400)
  await foto('1-editor')
  if (!(await clicarTexto('Renderizar'))) {
    etapas.push('botão Renderizar indisponível (FFmpeg não encontrado?)')
    return resultado(false)
  }
  etapas.push('clicou em Renderizar')
  let status = ''
  for (let i = 0; i < 120; i++) {
    await espera(1000)
    if (i === 1) {
      await foto('2-renderizando')
      etapas.push(`barra da renderização: ${await js<string>(`[...document.querySelectorAll('.progresso')].map(b => b.innerText.split(String.fromCharCode(10)).join(' ')).join(' | ') || 'NÃO apareceu'`)}`)
    }
    status = await js<string>(`[...document.querySelectorAll('.lista .etiqueta, .lista [class*="etiqueta"]')].map(e => e.textContent).join(',')`)
    if (/concluida|erro|cancelada/.test(status)) break
  }
  await rolar()
  await foto('3-render-final')
  etapas.push(`situação na lista: ${status}`)
  if (!status.includes('concluida')) return resultado(false)

  await clicarTexto('Controle de qualidade')
  await espera(800)
  await clicarTexto('Executar verificação')
  for (let i = 0; i < 60; i++) {
    await espera(1000)
    if (!(await js<boolean>(`[...document.querySelectorAll('button')].some(b => b.textContent.includes('Verificando'))`))) break
  }
  await espera(800)
  await foto('4-qualidade')
  const texto = await js<string>(`document.querySelector('main')?.innerText ?? document.body.innerText`)
  writeFileSync(join(pasta, 'qualidade.txt'), texto)
  etapas.push('controle de qualidade executado')

  // Mídia automática no editor: abre o diálogo e produz (a edição de teste já tem narração e imagens).
  await clicarTexto('Voltar')
  await espera(800)
  if (await clicarTexto('Gerar narração e imagens')) {
    await espera(1200)
    await foto('7b-midia-dialogo')
    await clicarTexto('Produzir agora')
    for (let i = 0; i < 60 && !(await js<boolean>(`!![...document.querySelectorAll('.alerta.info li')].length`)); i++) await espera(500)
    const rel = await js<string>(`[...document.querySelectorAll('.alerta.info li')].map(l => l.textContent).join(' | ')`)
    etapas.push(`mídia automática no editor: ${rel || 'SEM RELATÓRIO'}`)
    await foto('7c-midia-relatorio')
    await clicarTexto('Fechar')
    await espera(500)
    if (!rel) return resultado(false)
  } else etapas.push('botão Gerar narração e imagens AUSENTE')

  // Publicação: rascunho com descrição e miniatura automáticas, depois o criador de miniaturas.
  await clicarTexto('Voltar')
  await espera(800)
  await rolar()
  if (await clicarTexto('Preparar publicação')) {
    for (let i = 0; i < 30 && !(await js<boolean>(`document.body.innerText.includes('Rascunho de publicação pronto')`)); i++) await espera(1000)
    etapas.push('publicação preparada')
    await js(`document.querySelector('[data-tela="publicacoes"]').click()`)
    await espera(1000)
    await js(`[...document.querySelectorAll('.lista-item.clicavel')].at(-1)?.click()`)
    await espera(2000)
    await foto('5-publicacao')
    await js(`[...document.querySelectorAll('h2')].find(h => h.textContent.trim() === 'Miniatura')?.scrollIntoView()`)
    await espera(600)
    await foto('6-miniatura')
    etapas.push(`miniatura automática: ${await js<boolean>(`!!document.querySelector('img.miniatura-grande')`)}`)
    if (await clicarTexto('Criar outra')) {
      for (let i = 0; i < 30 && !(await js<boolean>(`!!document.querySelector('.previa-miniatura img')`)); i++) await espera(1000)
      await espera(800)
      await foto('7-criar-miniatura')
      etapas.push('criador de miniaturas aberto com prévia')
      await clicarTexto('Cancelar')
    }
  } else etapas.push('botão Preparar publicação indisponível')
  // Painel do administrador: próximos temas, agendar e frequência.
  await js(`document.querySelector('[data-tela="painel"]').click()`)
  await espera(1500)
  await foto('8-painel')
  const temasAntes = await js<number>(`[...document.querySelectorAll('h2')].find(h => h.textContent.includes('Próximos temas'))?.closest('section')?.querySelectorAll('li').length ?? -1`)
  await clicarTexto('Produzir agora')
  await espera(1500)
  const videos = await js<string>(`[...document.querySelectorAll('h2')].find(h => h.textContent.includes('Próximos vídeos'))?.closest('section')?.innerText ?? ''`)
  etapas.push(`painel: ${temasAntes} tema(s); depois de agendar, próximos vídeos ${videos.includes('Tema de teste') ? 'incluem o tema' : 'NÃO incluem o tema'}`)
  await foto('9-painel-agendado')
  if (!videos.includes('Tema de teste')) return resultado(false)

  // Fontes: padrão já cadastradas e campo para identificar um site.
  await js(`document.querySelector('[data-tela="pautas"]').click()`)
  await espera(800)
  await clicarTexto('Fontes e opções')
  await espera(1200)
  const padrao = await js<number>(`[...document.querySelectorAll('.etiqueta')].filter(e => e.textContent === 'Padrão').length`)
  etapas.push(`fontes padrão na tela: ${padrao}`)
  await foto('10-fontes')
  if (padrao < 20) return resultado(false)

  // Conta do YouTube: links diretos do Google Cloud e importação do arquivo baixado.
  await js(`document.querySelector('[data-tela="publicacoes"]').click()`)
  await espera(1200)
  await js(`[...document.querySelectorAll('strong')].find(s => s.textContent.includes('Importar arquivo baixado'))?.scrollIntoView()`)
  await espera(400)
  const links = await js<number>(`document.querySelectorAll('a.link-passo').length`)
  etapas.push(`YouTube: ${links} botão(ões) para páginas do Google Cloud`)
  await foto('11-youtube')

  // IA híbrida: catálogo de IAs gratuitas e a decisão atual do roteador.
  await js(`document.querySelector('[data-tela="config"]').click()`)
  await espera(800)
  await clicarTexto('Serviços de IA e custos')
  await espera(1200)
  const cartoes = await js<number>(`[...document.querySelectorAll('h2')].find(h => h.textContent.includes('IAs gratuitas'))?.closest('section')?.querySelectorAll('.cartao-suave').length ?? 0`)
  const decide = await js<boolean>(`document.body.innerText.includes('Como o aplicativo decide agora')`)
  etapas.push(`IA: ${cartoes} IA(s) no catálogo; painel de decisão ${decide ? 'visível' : 'AUSENTE'}`)
  await foto('12-ia-servicos')
  await js(`[...document.querySelectorAll('h2')].find(h => h.textContent.includes('IAs gratuitas'))?.scrollIntoView()`)
  await espera(400)
  await foto('13-ia-catalogo')
  if (cartoes < 5 || !decide) return resultado(false)

  // Revisão interna na tela de revisão (sem IA cadastrada: só regras fixas).
  await js(`(async () => { const l = await window.estudio.invoke('roteiros:buscar', { texto: '', status: null, ordem: 'atualizado_desc' }); const id = l.dados[0].id; await window.estudio.invoke('roteiros:alterarStatus', { id, status: 'pronto_revisao' }) })()`)
  await js(`document.querySelector('[data-tela="revisao"]').click()`)
  await espera(1000)
  await js(`document.querySelector('.lista-item.clicavel')?.click()`)
  await espera(1200)
  await clicarTexto('Revisar agora')
  for (let i = 0; i < 20 && !(await js<boolean>(`document.body.innerText.includes('por regras')`)); i++) await espera(500)
  const interna = await js<boolean>(`document.body.innerText.includes('Revisão interna') && document.body.innerText.includes('por regras')`)
  etapas.push(`revisão interna na tela: ${interna ? 'feita (regras)' : 'NÃO apareceu'}`)
  await foto('14-revisao-interna')
  if (!interna) return resultado(false)

  // Configurações › Mídia automática: vozes do Windows, fontes de imagem e geradores.
  await js(`document.querySelector('[data-tela="config"]').click()`)
  await espera(800)
  await clicarTexto('Mídia automática (voz e imagens)')
  await espera(2500)
  const vozes = await js<number>(`[...document.querySelectorAll('select option')].filter(o => o.textContent.includes('(pt') || o.textContent.includes('(en')).length`)
  const fontes = await js<number>(`document.body.innerText.includes('Wikimedia Commons') && document.body.innerText.includes('Pixabay') && document.body.innerText.includes('Pollinations') ? 1 : 0`)
  etapas.push(`config de mídia: ${vozes} voz(es) do Windows listada(s); fontes e geradores ${fontes ? 'visíveis' : 'AUSENTES'}`)
  await foto('14b-config-midia')
  if (!fontes) return resultado(false)

  // Primeiros passos: configuração de um clique.
  await js(`document.querySelector('[data-tela="inicio"]').click()`)
  await espera(1200)
  await foto('15-assistente-rapido')
  const antes = await js<string>(`document.querySelector('.passos li')?.textContent ?? ''`)
  await clicarTexto('Configurar tudo com o recomendado')
  for (let i = 0; i < 20 && (await js<string>(`document.querySelector('.passos li')?.textContent ?? ''`)) === antes; i++) await espera(500)
  const depois = await js<string>(`document.querySelector('.passos li')?.textContent ?? ''`)
  etapas.push(`assistente: "${antes}" → "${depois}" com 1 clique`)
  await espera(600)
  await foto('16-assistente-ia')
  if (antes === depois) return resultado(false)

  // Piloto automático no Painel de produção: ligar com 1 clique.
  await js(`document.querySelector('[data-tela="painel"]').click()`)
  await espera(1500)
  const temPiloto = await js<boolean>(`[...document.querySelectorAll('h2')].some(h => h.textContent.includes('Piloto automático'))`)
  // "Produzir agora" já ligou o piloto; se não, liga aqui.
  await clicarTexto('Ligar piloto automático')
  let piloto = ''
  for (let i = 0; i < 10 && !/Ligado|Trabalhando/.test(piloto); i++) {
    await espera(500)
    piloto = await js<string>(`[...document.querySelectorAll('h2')].find(h => h.textContent.includes('Piloto automático'))?.closest('section')?.querySelector('.etiqueta')?.textContent ?? ''`)
  }
  await foto('16b-piloto')
  etapas.push(`piloto automático: painel ${temPiloto ? 'visível' : 'AUSENTE'}, depois de ligar: ${piloto || 'sem estado'}`)
  if (!temPiloto || !/Ligado|Trabalhando/.test(piloto)) return resultado(false)

  // Barra de status do topo: espera → "Trabalhar agora" → trabalhando, com painel de detalhes.
  const antesStatus = await js<string>(`document.querySelector('.status-chip')?.className + ' | ' + (document.querySelector('.status-chip')?.textContent ?? 'AUSENTE')`)
  await clicarTexto('Trabalhar agora')
  let depoisStatus = ''
  for (let i = 0; i < 10; i++) {
    await espera(500)
    depoisStatus = await js<string>(`document.querySelector('.status-chip')?.className + ' | ' + document.querySelector('.status-chip')?.textContent`)
    if (depoisStatus.includes('trabalhando')) break
  }
  await js(`document.querySelector('.status-chip')?.click()`)
  await espera(800)
  await foto('17-status-trabalho')
  etapas.push(`barra de status: [${antesStatus}] → [${depoisStatus}]`)
  if (!depoisStatus.includes('trabalhando')) return resultado(false)

  const erros = await js<string[]>('window.__errosCaptura ?? []')
  etapas.push(`erros de interface: ${erros.length}`)
  resultado(erros.length === 0)
}
