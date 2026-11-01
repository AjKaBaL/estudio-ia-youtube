import { useState } from 'react'
import { chamar, mensagemDeErro, useDados } from '../api'
import { useRetorno } from './retorno'
import { Alerta } from './ui'
import type { EstadoAssistente } from '@shared/tipos'
import { BarraProgresso, useProgressoRemoto } from './progresso'

type AcaoAplicavel = 'tudo' | 'projeto' | 'pesquisa' | 'agenda_leve' | 'agenda_medio' | 'agenda_intenso' | 'ia_hibrido' | 'ia_local' | 'video'

/** Botão que aplica uma configuração recomendada inteira com um clique. */
export function BotaoRapido({
  acao,
  children,
  primario = false,
  aoConcluir
}: {
  acao: AcaoAplicavel
  children: React.ReactNode
  primario?: boolean
  aoConcluir?: (estado: EstadoAssistente) => void
}) {
  const { avisar, avisarErro } = useRetorno()
  const [ocupado, setOcupado] = useState(false)
  return (
    <button
      className={`botao${primario ? ' primario' : ''}`}
      disabled={ocupado}
      onClick={async () => {
        setOcupado(true)
        try {
          const r = await chamar('rapido:aplicar', { acao })
          avisar(r.mensagens.join(' '))
          aoConcluir?.(r.estado)
        } catch (e) {
          avisarErro(mensagemDeErro(e))
        } finally {
          setOcupado(false)
        }
      }}
    >
      {ocupado ? 'Aplicando…' : children}
    </button>
  )
}

/** Ollama em um clique: instala pelo winget, abre, baixa um modelo leve e cadastra como IA do PC. */
export function InstalarOllama({ aoConcluir }: { aoConcluir?: () => void }) {
  const { avisar, avisarErro } = useRetorno()
  const amb = useDados(() => chamar('rapido:ambiente'), [])
  // Uma instalação já em andamento (ex.: voltou para esta tela) também mostra a barra.
  const inicial = useDados(() => chamar('rapido:progresso'), [])
  const [rodando, setRodando] = useState(false)
  const emAndamento = rodando || (inicial.dados?.pacote === 'ollama' && inicial.dados.ativo)
  const prog = useProgressoRemoto(() => chamar('rapido:progresso'), emAndamento)
  const barra = (prog ?? inicial.dados)?.pacote === 'ollama' ? (prog ?? inicial.dados) : null
  if (!amb.dados) return null
  return (
    <div className="cartao-suave" style={{ marginTop: 12 }}>
      <strong>IA no seu PC (Ollama)</strong>
      {amb.dados.ollama || amb.dados.winget ? (
        <>
          <p className="secundario pequeno">
            {amb.dados.ollama
              ? 'O Ollama já está aberto neste PC. Um clique confere se ele tem um modelo que sirva, baixa um modelo leve se precisar (cerca de 2,5 GB) e o cadastra como IA do PC.'
              : 'Um clique instala o Ollama pelo instalador oficial do Windows (aceitando os termos do fornecedor), abre o programa, baixa um modelo leve (cerca de 2,5 GB, bom para PCs com 16 GB de memória) e o cadastra como IA do PC.'}{' '}
            Você não precisa abrir o PowerShell nem digitar comandos. Pode continuar usando o app enquanto isso.
          </p>
          <button
            className="botao primario"
            disabled={emAndamento}
            onClick={async () => {
              setRodando(true)
              try {
                const r = await chamar('rapido:instalarOllama')
                avisar(r.mensagem)
                amb.recarregar()
                aoConcluir?.()
              } catch (e) {
                avisarErro(mensagemDeErro(e))
              } finally {
                setRodando(false)
              }
            }}
          >
            {emAndamento ? 'Configurando o Ollama…' : 'Configurar o Ollama (1 clique)'}
          </button>
          {barra && (emAndamento || barra.etapa === 'Erro') && <BarraProgresso percentual={barra.percentual} etapa={barra.etapa} detalhe={barra.detalhe} inicio={barra.iniciadoEm} ativo={barra.ativo} erro={barra.etapa === 'Erro'} />}
        </>
      ) : (
        <Alerta>
          O instalador do Windows (winget) não foi encontrado. Baixe o Ollama em{' '}
          <a href="https://ollama.com/download" target="_blank" rel="noreferrer">
            ollama.com/download
          </a>{' '}
          , instale normalmente e depois clique em “Configurar o Ollama (1 clique)”.
        </Alerta>
      )}
    </div>
  )
}

/** FFmpeg em um clique pelo winget. */
export function InstalarFfmpeg({ aoConcluir }: { aoConcluir?: () => void }) {
  const { avisar, avisarErro } = useRetorno()
  const amb = useDados(() => chamar('rapido:ambiente'), [])
  const [ocupado, setOcupado] = useState(false)
  const prog = useProgressoRemoto(() => chamar('rapido:progresso'), ocupado)
  if (!amb.dados || amb.dados.ffmpeg) return null
  if (!amb.dados.winget) return null
  return (
    <div style={{ display: 'grid', gap: 4, minWidth: 260 }}>
    <button
      className="botao primario"
      disabled={ocupado}
      onClick={async () => {
        setOcupado(true)
        try {
          const r = await chamar('rapido:instalarFfmpeg')
          avisar(r.mensagem)
          amb.recarregar()
          aoConcluir?.()
        } catch (e) {
          avisarErro(mensagemDeErro(e))
        } finally {
          setOcupado(false)
        }
      }}
    >
      {ocupado ? 'Instalando o FFmpeg…' : 'Instalar FFmpeg (1 clique)'}
    </button>
      {ocupado && prog?.pacote === 'ffmpeg' && <BarraProgresso percentual={prog.percentual} etapa={prog.etapa} detalhe={prog.detalhe} inicio={prog.iniciadoEm} ativo={prog.ativo} />}
    </div>
  )
}
