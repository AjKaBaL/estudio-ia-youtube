import type { Banco } from '../db/conexao'
import { lerPolitica, listarProvedores, executarEnvio, planejarEnvio, type PedidoEnvio } from './central'
import type { Cofre } from './cofre'
import { TAREFAS_IA, type TarefaIa } from '@shared/ia'
import type { RotaIa } from '@shared/tipos'

/**
 * Roteador da IA híbrida, por regras fixas e explicáveis (sem IA decidindo sobre IA):
 * 1. só entram provedores ativos, com chave, com modelo, com o papel da tarefa, fora de pausa e abaixo do limite diário;
 * 2. no modo "somente local", só o PC; no híbrido/online, também as gratuitas (se você permitiu uso automático);
 *    pagas nunca entram na escolha automática (só manual, com plano e autorização);
 * 3. ordem: a sua prioridade (1 = primeiro) e, no empate, o PC antes;
 * 4. se um falhar (limite, erro, resposta fora do formato), tenta o próximo; limites pausam o provedor sozinhos.
 * O adaptador "Simulado" nunca é escolhido automaticamente (é só para testes manuais).
 */

export function rota(db: Banco, cofre: Cofre, tarefa: TarefaIa, opcoes: { excluir?: number[]; agora?: Date } = {}): RotaIa {
  const politica = lerPolitica(db)
  const ordem: (RotaIa['ordem'][number] & { prioridade: number })[] = []
  const descartados: RotaIa['descartados'] = []
  for (const p of listarProvedores(db, cofre, opcoes.agora)) {
    const nome = p.config.nome
    const motivo = !p.ativo
      ? 'desativado'
      : p.config.adaptador === 'simulado'
        ? 'Simulado não entra na escolha automática'
        : !p.config.papeis[tarefa]
          ? `não está marcado para “${tarefa === 'escrever' ? 'escrever' : 'revisar'}”`
          : !p.chaveConfigurada
            ? 'sem chave'
            : !p.config.modelo
              ? 'sem modelo escolhido'
              : p.pausadoAte
                ? `em pausa até ${new Date(p.pausadoAte).toLocaleString('pt-BR')} (${p.ultimoErro ?? 'limite'})`
                : p.config.limiteDiario !== null && p.usoHoje >= p.config.limiteDiario
                  ? `limite diário atingido (${p.usoHoje}/${p.config.limiteDiario})`
                  : !p.local && politica.modo === 'local'
                    ? 'modo “somente local”'
                    : !p.local && !p.config.gratuito
                      ? 'pago: só na escolha manual, com sua autorização'
                      : !p.local && !politica.gratuitosAutomaticos
                        ? 'gratuito, mas o uso automático de IAs gratuitas está desligado'
                        : opcoes.excluir?.includes(p.id)
                          ? 'escreveu este texto; a revisão usa outra IA'
                          : null
    if (motivo) descartados.push({ nome, motivo })
    else ordem.push({ id: p.id, nome, local: p.local, prioridade: p.config.prioridade })
  }
  ordem.sort((a, b) => a.prioridade - b.prioridade || Number(b.local) - Number(a.local) || a.id - b.id)
  return { tarefa, ordem: ordem.map(({ prioridade: _p, ...r }) => r), descartados }
}

export function rotas(db: Banco, cofre: Cofre): RotaIa[] {
  return TAREFAS_IA.map((t) => rota(db, cofre, t))
}

export type ResultadoRoteado<T> =
  | { ok: true; valor: T; texto: string; provedor: { id: number; nome: string }; tentativas: { nome: string; erro: string }[] }
  | { ok: false; tentativas: { nome: string; erro: string }[] }

const MAX_TENTATIVAS = 4

/** Executa a tarefa no primeiro provedor que der certo, na ordem da rota. Nunca pede autorização: quem exige fica de fora. */
export async function executarRoteado<T = string>(
  db: Banco,
  cofre: Cofre,
  tarefa: TarefaIa,
  montar: (provedorId: number) => PedidoEnvio,
  opcoes: { temperatura: number; json: boolean; sinal: AbortSignal; excluir?: number[]; validar?: (texto: string) => T }
): Promise<ResultadoRoteado<T>> {
  const tentativas: { nome: string; erro: string }[] = []
  let r = rota(db, cofre, tarefa, { excluir: opcoes.excluir })
  // Se excluir o escritor deixou a revisão sem ninguém, usa o mesmo modelo (melhor que nenhuma IA) e registra.
  if (r.ordem.length === 0 && opcoes.excluir?.length) {
    r = rota(db, cofre, tarefa)
    if (r.ordem.length) tentativas.push({ nome: '—', erro: 'Nenhuma outra IA disponível: a revisão usou a mesma IA que escreveu.' })
  }
  for (const alvo of r.ordem.slice(0, MAX_TENTATIVAS)) {
    if (opcoes.sinal.aborted) break
    const pedido = montar(alvo.id)
    const plano = planejarEnvio(db, cofre, pedido)
    if (plano.bloqueios.length || plano.exigeAutorizacao) {
      tentativas.push({ nome: alvo.nome, erro: plano.bloqueios[0] ?? 'exige autorização' })
      continue
    }
    try {
      const resp = await executarEnvio(db, cofre, pedido, null, { temperatura: opcoes.temperatura, json: opcoes.json, sinal: opcoes.sinal, tarefa })
      const valor = opcoes.validar ? opcoes.validar(resp.texto) : (resp.texto as T)
      return { ok: true, valor, texto: resp.texto, provedor: { id: alvo.id, nome: alvo.nome }, tentativas }
    } catch (e) {
      if (opcoes.sinal.aborted) throw e
      tentativas.push({ nome: alvo.nome, erro: e instanceof Error ? e.message : 'falha' })
    }
  }
  return { ok: false, tentativas }
}
