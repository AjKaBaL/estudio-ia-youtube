import { useState } from 'react'
import { chamar, mensagemDeErro } from '../api'
import { useRetorno } from './retorno'
import { Ajuda, Campo, Etiqueta } from './ui'
import {
  FPS_RENDER,
  OPCOES_RENDER_RECOMENDADAS,
  PRESETS_RENDER,
  QUALIDADES_RENDER,
  RESOLUCAO_INFO,
  RESOLUCOES,
  VELOCIDADES_RENDER,
  estimarBytesRender,
  type FpsRender,
  type OpcoesRender,
  type PreferenciaRender,
  type QualidadeRender,
  type Resolucao,
  type VelocidadeRender
} from '@shared/midia'
import { formatarBytes } from './ui'

/** Quadros por segundo, qualidade e velocidade, com a explicação de cada escolha. */
export function OpcoesAvancadas({ opcoes, mudar, fpsRecomendado = 30 }: { opcoes: OpcoesRender; mudar: (o: OpcoesRender) => void; fpsRecomendado?: number }) {
  return (
    <div className="form-grade" style={{ marginTop: 8 }}>
      <Campo rotulo="Quadros por segundo" ajuda="30 é o padrão para narração, telas e imagens. Use 60 só se você gravou a 60 (jogos, telas com muito movimento): dobra o tempo de renderização. 24/25 para material filmado nessas taxas.">
        <select className="entrada" value={opcoes.fps} onChange={(e) => mudar({ ...opcoes, fps: Number(e.target.value) as FpsRender })}>
          {FPS_RENDER.map((f) => (
            <option key={f} value={f}>
              {f} quadros/s{f === fpsRecomendado ? ' (recomendado)' : ''}
            </option>
          ))}
        </select>
      </Campo>
      <Campo rotulo="Qualidade" ajuda="“Alta” já fica acima das taxas de bits que o YouTube recomenda para envio. “Máxima” quase não muda o que o público vê depois da compressão do YouTube, mas gera arquivos bem maiores.">
        <select className="entrada" value={opcoes.qualidade} onChange={(e) => mudar({ ...opcoes, qualidade: e.target.value as QualidadeRender })}>
          {(Object.keys(QUALIDADES_RENDER) as QualidadeRender[]).map((q) => (
            <option key={q} value={q}>
              {QUALIDADES_RENDER[q].rotulo}
            </option>
          ))}
        </select>
      </Campo>
      <Campo rotulo="Velocidade da renderização" ajuda="Não muda a resolução. “Rápida” termina antes com arquivo um pouco maior; “Lenta” economiza alguns megabytes e demora o dobro.">
        <select className="entrada" value={opcoes.velocidade} onChange={(e) => mudar({ ...opcoes, velocidade: e.target.value as VelocidadeRender })}>
          {(Object.keys(VELOCIDADES_RENDER) as VelocidadeRender[]).map((v) => (
            <option key={v} value={v}>
              {VELOCIDADES_RENDER[v].rotulo}
            </option>
          ))}
        </select>
      </Campo>
    </div>
  )
}

const DEZ_MIN = 600
const MINUTO = 60

/** Escolha da preferência padrão de vídeo (assistente e Configurações). */
export function PreferenciaVideo({ inicial, aoSalvar }: { inicial: PreferenciaRender; aoSalvar?: (p: PreferenciaRender) => void }) {
  const { avisar, avisarErro } = useRetorno()
  const [p, setP] = useState<PreferenciaRender>(inicial)
  const [salvando, setSalvando] = useState(false)
  const seletor = (formato: '16:9' | '9:16', valor: Resolucao, mudar: (r: Resolucao) => void, recomendada: Resolucao) => (
    <select className="entrada" value={valor} onChange={(e) => mudar(e.target.value as Resolucao)} disabled={p.modo === 'recomendado'}>
      {RESOLUCOES.map((r) => {
        const preset = `${formato}-${r}` as const
        return (
          <option key={r} value={r}>
            {PRESETS_RENDER[preset].rotulo}
            {r === recomendada ? ' — recomendado' : ''}
          </option>
        )
      })}
    </select>
  )
  return (
    <>
      <div className="opcoes-escolha" role="radiogroup" aria-label="Como escolher a resolução">
        <label className={`opcao${p.modo === 'recomendado' ? ' selecionada' : ''}`}>
          <input type="radio" name="modo-render" checked={p.modo === 'recomendado'} onChange={() => setP({ ...p, modo: 'recomendado' })} />
          <div>
            <div className="opcao-titulo">
              Automático pela qualidade das mídias <Etiqueta cor="verde">Recomendado</Etiqueta>
            </div>
            <div className="lista-meta">
              A cada renderização, o app lê a resolução e os quadros por segundo das mídias usadas e sugere a melhor opção sem ampliar além delas: até 4K em vídeos longos com material 4K e 1080p nos Shorts. Você sempre pode trocar antes de renderizar.
            </div>
          </div>
        </label>
        <label className={`opcao${p.modo === 'fixo' ? ' selecionada' : ''}`}>
          <input type="radio" name="modo-render" checked={p.modo === 'fixo'} onChange={() => setP({ ...p, modo: 'fixo' })} />
          <div>
            <div className="opcao-titulo">Sempre a mesma resolução</div>
            <div className="lista-meta">Útil se você grava sempre no mesmo equipamento. A resolução escolhida abaixo aparece selecionada no editor.</div>
          </div>
        </label>
      </div>
      <div className="form-grade" style={{ marginTop: 12 }}>
        <Campo rotulo="Vídeos longos (16:9)" ajuda="1080p é o mínimo recomendado. 1440p/4K valem a pena quando você grava nessa resolução.">
          {seletor('16:9', p.longo, (r) => setP({ ...p, longo: r }), '1080p')}
        </Campo>
        <Campo rotulo="Shorts (9:16)" ajuda="Shorts são vistos no celular: 1080×1920 é o padrão recomendado.">
          {seletor('9:16', p.short, (r) => setP({ ...p, short: r }), '1080p')}
        </Campo>
      </div>
      <OpcoesAvancadas opcoes={p.opcoes} mudar={(o) => setP({ ...p, opcoes: o })} />
      <Ajuda titulo="Quanto espaço cada resolução ocupa?">
        <table className="tabela compacta">
          <thead>
            <tr>
              <th>Resolução</th>
              <th>Vídeo de 10 min (longo)</th>
              <th>Short de 1 min</th>
            </tr>
          </thead>
          <tbody>
            {RESOLUCOES.map((r) => (
              <tr key={r}>
                <td>{RESOLUCAO_INFO[r].nome}</td>
                <td>até {formatarBytes(estimarBytesRender(`16:9-${r}`, p.opcoes, DEZ_MIN))}</td>
                <td>até {formatarBytes(estimarBytesRender(`9:16-${r}`, p.opcoes, MINUTO))}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="secundario pequeno">
          Valores máximos com as opções acima; o arquivo real costuma ser menor. A renderização precisa de espaço livre extra (cerca de 50%) enquanto trabalha. 4K costuma levar de 4 a 8 vezes mais tempo que 1080p no mesmo computador.
        </p>
      </Ajuda>
      <div className="acoes" style={{ marginTop: 12 }}>
        <button
          className="botao primario"
          disabled={salvando}
          onClick={async () => {
            setSalvando(true)
            try {
              const r = await chamar('render:salvarPreferencia', p)
              avisar('Preferência de vídeo salva.')
              aoSalvar?.(r)
            } catch (e) {
              avisarErro(mensagemDeErro(e))
            } finally {
              setSalvando(false)
            }
          }}
        >
          Salvar preferência de vídeo
        </button>
        <button className="botao fantasma" onClick={() => setP({ modo: 'recomendado', longo: '1080p', short: '1080p', opcoes: OPCOES_RENDER_RECOMENDADAS })}>
          Voltar ao recomendado
        </button>
      </div>
    </>
  )
}
