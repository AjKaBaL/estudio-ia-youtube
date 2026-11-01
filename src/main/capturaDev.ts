import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, type BrowserWindow } from 'electron'

/**
 * Apenas em desenvolvimento (ESTUDIO_CAPTURA_DIR): percorre as telas pela navegação lateral
 * e salva capturas PNG para a verificação visual. Não existe no aplicativo instalado.
 */
export async function capturarTelas(janela: BrowserWindow, pasta: string): Promise<void> {
  mkdirSync(pasta, { recursive: true })
  const wc = janela.webContents
  const espera = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
  await new Promise<void>((r) => wc.once('did-finish-load', () => r()))
  await espera(1500)
  const telas = (await wc.executeJavaScript(
    `Array.from(document.querySelectorAll('[data-tela]')).map(b => b.getAttribute('data-tela'))`
  )) as string[]
  for (const tela of telas) {
    await wc.executeJavaScript(`document.querySelector('[data-tela="${tela.replace(/[^a-z0-9_-]/gi, '')}"]').click()`)
    await espera(700)
    writeFileSync(join(pasta, `${tela}.png`), (await wc.capturePage()).toPNG())
  }
  // Cada etapa dos Primeiros passos.
  await wc.executeJavaScript(`document.querySelector('[data-tela="inicio"]').click()`)
  await espera(700)
  const passos = (await wc.executeJavaScript(`document.querySelectorAll('.passo').length`)) as number
  for (let i = 0; i < passos; i++) {
    await wc.executeJavaScript(`document.querySelectorAll('.passo')[${i}].click()`)
    await espera(900)
    writeFileSync(join(pasta, `inicio-${i + 1}.png`), (await wc.capturePage()).toPNG())
  }
  // Abas das Configurações.
  await wc.executeJavaScript(`document.querySelector('[data-tela="config"]').click()`)
  await espera(500)
  const abas = (await wc.executeJavaScript(`document.querySelectorAll('[role="tab"]').length`)) as number
  for (let i = 1; i < abas; i++) {
    await wc.executeJavaScript(`document.querySelectorAll('[role="tab"]')[${i}].click()`)
    await espera(700)
    writeFileSync(join(pasta, `config-${i}.png`), (await wc.capturePage()).toPNG())
  }
  // Abas de Pautas e pesquisas e o detalhe da primeira pauta.
  await wc.executeJavaScript(`document.querySelector('[data-tela="pautas"]').click()`)
  await espera(500)
  const abasPautas = (await wc.executeJavaScript(`document.querySelectorAll('[role="tab"]').length`)) as number
  for (let i = 1; i < abasPautas; i++) {
    await wc.executeJavaScript(`document.querySelectorAll('[role="tab"]')[${i}].click()`)
    await espera(700)
    writeFileSync(join(pasta, `pautas-${i}.png`), (await wc.capturePage()).toPNG())
  }
  await wc.executeJavaScript(`document.querySelectorAll('[role="tab"]')[0].click()`)
  await espera(500)
  if ((await wc.executeJavaScript(`!!document.querySelector('.lista-item.clicavel')`)) as boolean) {
    await wc.executeJavaScript(`document.querySelector('.lista-item.clicavel').click()`)
    await espera(800)
    writeFileSync(join(pasta, 'pauta-detalhe.png'), (await wc.capturePage()).toPNG())
    await wc.executeJavaScript(`document.querySelectorAll('[role="tab"]')[2].click()`)
    await espera(700)
    writeFileSync(join(pasta, 'pauta-dossie.png'), (await wc.capturePage()).toPNG())
  }
  // Painel de revisão do primeiro roteiro da lista.
  await wc.executeJavaScript(`document.querySelector('[data-tela="revisao"]').click()`)
  await espera(600)
  if ((await wc.executeJavaScript(`!!document.querySelector('.lista-item.clicavel')`)) as boolean) {
    await wc.executeJavaScript(`document.querySelector('.lista-item.clicavel').click()`)
    await espera(900)
    writeFileSync(join(pasta, 'revisao-painel.png'), (await wc.capturePage()).toPNG())
  }
  // Editor de vídeo (cria um projeto de edição na pasta de dados de teste, se não houver).
  await wc.executeJavaScript(`(async () => {
    const r = await window.estudio.invoke('edicao:listar')
    if (r.ok && r.dados.length === 0) await window.estudio.invoke('edicao:criar', { roteiroId: 1 })
  })()`)
  await wc.executeJavaScript(`document.querySelector('[data-tela="estudio"]').click()`)
  await espera(600)
  if ((await wc.executeJavaScript(`!!document.querySelector('.lista-item.clicavel')`)) as boolean) {
    await wc.executeJavaScript(`document.querySelector('.lista-item.clicavel').click()`)
    await espera(1200)
    writeFileSync(join(pasta, 'estudio-editor.png'), (await wc.capturePage()).toPNG())
  }
  // Abre o primeiro roteiro da biblioteca, se houver, para capturar o editor.
  await wc.executeJavaScript(`document.querySelector('[data-tela="biblioteca"]').click()`)
  await espera(700)
  const temRoteiro = (await wc.executeJavaScript(`!!document.querySelector('tr.clicavel')`)) as boolean
  if (temRoteiro) {
    await wc.executeJavaScript(`document.querySelector('tr.clicavel').click()`)
    await espera(700)
    writeFileSync(join(pasta, 'editor.png'), (await wc.capturePage()).toPNG())
  }
  const erros = (await wc.executeJavaScript('window.__errosCaptura ?? []')) as string[]
  writeFileSync(join(pasta, 'erros.json'), JSON.stringify(erros, null, 2))
  app.quit()
}
