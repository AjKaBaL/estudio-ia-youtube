/**
 * Controle de qualidade do vídeo (Etapa 12) por regras explícitas. Bloqueadores impedem a publicação;
 * avisos podem ser aceitos com justificativa registrada. Não garante ausência de todos os erros.
 */

export interface ItemQualidade {
  codigo: string
  nivel: 'bloqueador' | 'aviso' | 'ok'
  mensagem: string
}

export interface DadosQualidade {
  arquivoExiste: boolean
  tamanhoBytes: number
  sonda: { duracao: number; video: { largura: number; altura: number } | null; audio: { canais: number } | null } | null
  esperado: { duracao: number; largura: number; altura: number; temAudio: boolean }
  silencios: { inicio: number; fim: number }[] | null
  pretos: { inicio: number; fim: number }[] | null
  legendas: { inicio: number; fim: number; texto: string }[]
  narracaoFim: number | null
  cenasSemVisual: string[]
  midias: { id: number; nome: string; situacaoLicenca: string; licenca: string; origem: string; urlOrigem: string; existe: boolean }[]
  fontesAnexadas: number
  roteiroAprovado: boolean
  revisaoRenderizada: number
  revisaoAtual: number
}

export function avaliarQualidade(d: DadosQualidade): ItemQualidade[] {
  const itens: ItemQualidade[] = []
  const add = (codigo: string, nivel: ItemQualidade['nivel'], mensagem: string): void => {
    itens.push({ codigo, nivel, mensagem })
  }

  if (!d.arquivoExiste || d.tamanhoBytes === 0) add('arquivo', 'bloqueador', 'O arquivo renderizado não existe ou está vazio.')
  else if (!d.sonda) add('arquivo', 'bloqueador', 'O arquivo renderizado não pôde ser aberto pelo FFprobe.')
  else add('arquivo', 'ok', 'Arquivo existe e pode ser aberto.')

  const s = d.sonda
  if (s) {
    const tolerancia = Math.max(1, d.esperado.duracao * 0.03)
    if (Math.abs(s.duracao - d.esperado.duracao) > tolerancia) add('duracao', 'bloqueador', `Duração de ${s.duracao.toFixed(1)} s; esperado ${d.esperado.duracao.toFixed(1)} s.`)
    else add('duracao', 'ok', `Duração ${s.duracao.toFixed(1)} s confere.`)
    if (!s.video) add('video', 'bloqueador', 'Não há trilha de vídeo.')
    else if (s.video.largura !== d.esperado.largura || s.video.altura !== d.esperado.altura) add('resolucao', 'bloqueador', `Resolução ${s.video.largura}×${s.video.altura}; esperado ${d.esperado.largura}×${d.esperado.altura}.`)
    else add('resolucao', 'ok', `Resolução ${s.video.largura}×${s.video.altura} e proporção conferem.`)
    if (!s.audio) add('audio', 'bloqueador', 'Não há trilha de áudio.')
    else add('audio', 'ok', 'Trilha de áudio presente.')
  }

  if (s && d.silencios) {
    const silencioTotal = d.silencios.reduce((t, x) => t + (Math.min(x.fim, s.duracao) - x.inicio), 0)
    if (d.esperado.temAudio && silencioTotal >= s.duracao * 0.95) add('silencio', 'bloqueador', 'O áudio está totalmente silencioso, mas o projeto tem narração ou trilha.')
    else if (d.silencios.some((x) => Math.min(x.fim, s.duracao) - x.inicio > 5)) add('silencio', 'aviso', 'Há trechos de silêncio com mais de 5 s.')
    else add('silencio', 'ok', 'Sem silêncio inesperado.')
  } else if (s) add('silencio', 'aviso', 'Silêncio não verificado (FFmpeg indisponível).')

  if (s && d.pretos) {
    const longos = d.pretos.filter((p) => p.fim - p.inicio > 2 && p.inicio > 1 && p.fim < s.duracao - 1)
    const totalPreto = d.pretos.reduce((t, p) => t + (p.fim - p.inicio), 0)
    if (totalPreto > s.duracao * 0.5) add('tela_preta', 'bloqueador', 'Mais da metade do vídeo é tela preta: imagens ausentes?')
    else if (longos.length) add('tela_preta', 'aviso', `Tela preta por mais de 2 s em ${longos.length} trecho(s) (ex.: ${longos[0]!.inicio.toFixed(1)} s).`)
    else add('tela_preta', 'ok', 'Sem tela preta inesperada.')
  } else if (s) add('tela_preta', 'aviso', 'Tela preta não verificada (FFmpeg indisponível).')

  const dur = s?.duracao ?? d.esperado.duracao
  const foraDoTempo = d.legendas.filter((l) => l.fim > dur + 0.1 || l.inicio < 0)
  const longas = d.legendas.filter((l) => l.texto.length > 84)
  const sobrepostas = d.legendas.filter((l, i) => i > 0 && l.inicio < d.legendas[i - 1]!.fim - 0.01)
  if (foraDoTempo.length) add('legendas', 'bloqueador', `${foraDoTempo.length} legenda(s) terminam depois do fim do vídeo.`)
  else if (longas.length || sobrepostas.length) add('legendas', 'aviso', `${longas.length} legenda(s) longas demais para o quadro e ${sobrepostas.length} sobreposta(s).`)
  else add('legendas', 'ok', d.legendas.length ? 'Legendas dentro do tempo e do tamanho.' : 'Sem legendas.')

  if (d.narracaoFim !== null) {
    if (d.narracaoFim > dur + 0.05) add('narracao', 'bloqueador', `A narração termina em ${d.narracaoFim.toFixed(1)} s, depois do fim do vídeo: será cortada.`)
    else if (dur - d.narracaoFim < 0.3) add('narracao', 'aviso', 'A narração termina colada no fim do vídeo; confira se não há corte abrupto.')
    else add('narracao', 'ok', 'Narração termina antes do fim do vídeo.')
  }

  if (d.cenasSemVisual.length) add('cenas', 'aviso', `Cenas sem imagem ou vídeo: ${d.cenasSemVisual.slice(0, 5).join(', ')}.`)
  else add('cenas', 'ok', 'Todas as cenas têm imagem ou vídeo.')

  const ausentes = d.midias.filter((m) => !m.existe)
  const semLicenca = d.midias.filter((m) => m.situacaoLicenca === 'nao_verificado' || (m.situacaoLicenca === 'licenciado' && !m.licenca.trim()) || (!m.origem.trim() && !m.urlOrigem.trim() && m.situacaoLicenca !== 'criado_usuario'))
  if (ausentes.length) add('midias', 'bloqueador', `Arquivos de mídia ausentes: ${ausentes.map((m) => m.nome).join(', ')}.`)
  if (semLicenca.length) add('licencas', 'bloqueador', `Mídias sem origem/licença registrada: ${semLicenca.map((m) => m.nome).slice(0, 5).join(', ')}.`)
  if (!ausentes.length && !semLicenca.length) add('licencas', 'ok', 'Todas as mídias têm arquivo e origem/licença registrados.')
  // Mídia sintética: o YouTube exige divulgação quando o conteúdo realista pode enganar o público.
  if (d.midias.some((m) => m.situacaoLicenca === 'gerado_ia' && /imagem gerada|v[ií]deo gerado/i.test(m.origem))) {
    add('conteudo_sintetico', 'aviso', 'Há imagens geradas por IA: se alguma parecer real (pessoa, lugar ou fato), marque “Conteúdo alterado ou sintético” ao publicar.')
  }

  if (d.fontesAnexadas === 0) add('fontes', 'bloqueador', 'Nenhuma fonte/afirmação verificada anexada ao roteiro.')
  else add('fontes', 'ok', `${d.fontesAnexadas} fonte(s)/afirmação(ões) anexadas ao roteiro.`)
  if (!d.roteiroAprovado) add('roteiro', 'bloqueador', 'O roteiro não está aprovado para produção.')
  if (d.revisaoRenderizada !== d.revisaoAtual) add('desatualizado', 'aviso', 'O projeto foi alterado depois desta renderização.')
  // Título, descrição e miniatura são conferidos (e exigidos) na aprovação da publicação, que vem depois desta etapa.
  add('miniatura', 'ok', 'Miniatura, título e descrição são conferidos na etapa de publicação.')
  return itens
}

export interface Excecao {
  codigo: string
  justificativa: string
  aceitaEm: string
}

/** Aprovado somente sem bloqueadores e com todos os avisos aceitos explicitamente. */
export function situacaoQualidade(itens: ItemQualidade[], excecoes: Excecao[]): { aprovado: boolean; bloqueadores: number; avisosPendentes: number } {
  const bloqueadores = itens.filter((i) => i.nivel === 'bloqueador').length
  const avisosPendentes = itens.filter((i) => i.nivel === 'aviso' && !excecoes.some((e) => e.codigo === i.codigo)).length
  return { aprovado: bloqueadores === 0 && avisosPendentes === 0, bloqueadores, avisosPendentes }
}
