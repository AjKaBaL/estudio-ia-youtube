import { ROTULO_STATUS_ROTEIRO, ROTULO_TIPO_FONTE, ROTULO_TIPO_VIDEO } from '@shared/dominio'
import type { RoteiroCompleto, Versao } from '@shared/tipos'

/** Formatos de exportação de roteiro. Funções puras: recebem dados, devolvem texto. */

export const FORMATO_JSON = 'estudio-ia-youtube/roteiro'
export const VERSAO_FORMATO_JSON = 1

function data(iso: string | null): string {
  return iso ? iso.slice(0, 10) : '—'
}

export function exportarTxt(r: RoteiroCompleto): string {
  const linhas = [
    r.titulo,
    '='.repeat(Math.min(r.titulo.length, 80)),
    `Tipo: ${ROTULO_TIPO_VIDEO[r.tipoVideo]}`,
    `Status: ${ROTULO_STATUS_ROTEIRO[r.status]}`,
    `Tema: ${r.tema || '—'}`,
    `Palavras-chave: ${r.palavrasChave.join(', ') || '—'}`,
    `Data prevista: ${data(r.dataPrevista)}`,
    `Versão: ${r.versaoAtual} (atualizado em ${data(r.atualizadoEm)})`,
    '',
    r.conteudo
  ]
  if (r.fontes.length) {
    linhas.push('', 'FONTES', ...r.fontes.map((f, i) => `${i + 1}. ${f.titulo} — ${f.url} (acesso em ${data(f.acessadaEm)})`))
  }
  if (r.notas) linhas.push('', 'NOTAS', r.notas)
  return `${linhas.join('\r\n')}\r\n`
}

/** Escapa caracteres que mudariam a formatação Markdown em campos de uma linha. */
function md(texto: string): string {
  return texto.replace(/([\\`*_[\]<>#|])/g, '\\$1')
}

export function exportarMarkdown(r: RoteiroCompleto): string {
  const linhas = [
    `# ${md(r.titulo)}`,
    '',
    `- **Tipo:** ${ROTULO_TIPO_VIDEO[r.tipoVideo]}`,
    `- **Status:** ${ROTULO_STATUS_ROTEIRO[r.status]}`,
    `- **Tema:** ${md(r.tema) || '—'}`,
    `- **Palavras-chave:** ${r.palavrasChave.map(md).join(', ') || '—'}`,
    `- **Data prevista:** ${data(r.dataPrevista)}`,
    `- **Versão:** ${r.versaoAtual} (atualizado em ${data(r.atualizadoEm)})`,
    '',
    '## Roteiro',
    '',
    r.conteudo
  ]
  if (r.fontes.length) {
    linhas.push('', '## Fontes', '')
    for (const f of r.fontes) {
      const extra = [f.autor && `autor: ${md(f.autor)}`, f.publicadaEm && `publicado em ${f.publicadaEm}`, `acesso em ${data(f.acessadaEm)}`, ROTULO_TIPO_FONTE[f.tipoFonte]]
        .filter(Boolean)
        .join(' · ')
      linhas.push(`- [${md(f.titulo)}](<${f.url.replace(/>/g, '%3E')}>) — ${extra}`)
    }
  }
  if (r.notas) linhas.push('', '## Notas', '', r.notas)
  if (r.comentarios.length) {
    linhas.push('', '## Histórico de revisão', '')
    for (const c of r.comentarios) {
      linhas.push(`- ${data(c.criadoEm)} (versão ${c.versaoNumero})${c.resolvidoEm ? ' — resolvido' : ''}: ${md(c.texto)}`)
    }
  }
  return `${linhas.join('\n')}\n`
}

/** JSON completo para backup/intercâmbio, com todas as versões. */
export function exportarJson(r: RoteiroCompleto, versoes: Versao[], versaoApp: string): string {
  return JSON.stringify(
    { formato: FORMATO_JSON, versaoFormato: VERSAO_FORMATO_JSON, exportadoEm: new Date().toISOString(), versaoApp, roteiro: r, versoes },
    null,
    2
  )
}

/** Nome de arquivo seguro para Windows a partir do título. */
export function nomeArquivo(titulo: string, extensao: string): string {
  const base = titulo
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    // Caracteres de controle são proibidos em nomes de arquivo do Windows.
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/\s+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, 80)
  const reservado = /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(base)
  return `${base && !reservado ? base : 'roteiro'}.${extensao}`
}
