/**
 * "Esperando minha resposta" — mesma regra do painel da Sudeste
 * (sdt/assets/tarefas-regra.js, `aguardaResposta`): o secretário agendado
 * pergunta nos comentários com autor "Claude", e a Kiê quer achar o que ainda
 * não respondeu. Calculado pelos comentários, sem tag — nunca fica
 * desatualizado: espera resposta quem tem como ÚLTIMO comentário (o de
 * `criadoEm` mais recente) um do Claude. Duas perguntas seguidas continuam
 * esperando; uma resposta da Kiê tira da lista; nova pergunta depois volta.
 */
export const AUTOR_DO_CLAUDE = 'claude';

export interface ComentarioResumo {
  autorNome: string | null;
  criadoEm: string;
}

export function ehDoClaude(autorNome: string | null | undefined): boolean {
  return (autorNome ?? '').trim().toLowerCase() === AUTOR_DO_CLAUDE;
}

export function aguardaResposta(comentarios: ReadonlyArray<ComentarioResumo>): boolean {
  let ultimo: ComentarioResumo | null = null;
  let quando = -Infinity;
  for (const c of comentarios) {
    const t = Date.parse(c.criadoEm);
    const v = Number.isNaN(t) ? -Infinity : t;
    // Empate de horário fica com o que vem depois na lista; horário ilegível
    // perde para qualquer legível.
    if (!ultimo || v >= quando) {
      ultimo = c;
      quando = v;
    }
  }
  return !!ultimo && ehDoClaude(ultimo.autorNome);
}

/** Ids (de tarefa ou nota) cujo último comentário é do Claude. */
export function idsAguardandoResposta(
  porAlvo: ReadonlyMap<string, ReadonlyArray<ComentarioResumo>>,
): Set<string> {
  const ids = new Set<string>();
  for (const [id, lista] of porAlvo) if (aguardaResposta(lista)) ids.add(id);
  return ids;
}
