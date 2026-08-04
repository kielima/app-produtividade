// Julgamento automático de um duelo (aba Projetos → Duelo) via Gemini, com
// base nos objetivos/descrições dos dois projetos. Mesmo modelo/proxy que o
// resto das features de IA do app (ver `geminiClient.ts`); só a decisão de
// qual escolher muda — a aplicação do resultado continua em `ProjectDuelView`
// (chama `handlePick`), pra reaproveitar undo/histórico/persistência do
// Glicko-2 já existentes.

import { getGeminiModel } from './aiSubtasks';
import { callGemini } from './geminiClient';
import type { Project } from '../types';

export class AiJudgeDuelError extends Error {}

export interface DuelVerdict {
  winnerId: string;
  reasoning: string;
}

function describeProject(p: Project): string {
  const lines = [`- id: ${p.id}`, `  nome: ${p.name}`];
  if (p.area) lines.push(`  área: ${p.area}`);
  if (p.objective) lines.push(`  objetivo: ${p.objective}`);
  if (p.currentStatus) lines.push(`  status atual: ${p.currentStatus}`);
  if (p.nextSteps) lines.push(`  próximos passos: ${p.nextSteps}`);
  if (p.deadline) lines.push(`  prazo: ${p.deadline}`);
  if (p.moscow) lines.push(`  MoSCoW: ${p.moscow}`);
  if (p.priority) lines.push(`  prioridade (P1/P2/P3): ${p.priority}`);
  if (p.notes) lines.push(`  notas: ${p.notes}`);
  return lines.join('\n');
}

const PROMPT_INTRO = [
  'Você está ajudando a priorizar projetos pessoais num duelo par-a-par',
  '(estilo "qual é mais prioritário?"). Avalie os dois projetos abaixo e',
  'decida qual merece mais atenção AGORA, considerando: proximidade do',
  'prazo, clareza/urgência dos próximos passos, classificação MoSCoW',
  '(Must > Should > Could > Won\'t) e prioridade declarada (P1 > P2 > P3).',
  'Se as informações forem insuficientes ou muito parecidas, escolha o',
  'projeto com prazo mais próximo; na ausência de prazo, o de MoSCoW mais',
  'alto.',
].join('\n');

/** Pede ao Gemini pra escolher o vencedor do duelo entre `a` e `b`. */
export async function judgeDuel(a: Project, b: Project): Promise<DuelVerdict> {
  const prompt = [
    PROMPT_INTRO,
    '',
    '## Projeto A',
    describeProject(a),
    '',
    '## Projeto B',
    describeProject(b),
  ].join('\n');

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'object',
        properties: {
          winner: { type: 'string', enum: ['a', 'b'] },
          reasoning: { type: 'string' },
        },
        required: ['winner', 'reasoning'],
      },
    },
  };

  let json;
  try {
    json = await callGemini(getGeminiModel(), body);
  } catch (e) {
    throw new AiJudgeDuelError(e instanceof Error ? e.message : String(e));
  }

  if (json.promptFeedback?.blockReason) {
    throw new AiJudgeDuelError(`Prompt bloqueado: ${json.promptFeedback.blockReason}`);
  }

  const responseText = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!responseText) {
    throw new AiJudgeDuelError('Resposta do Gemini sem conteúdo.');
  }

  let parsed: { winner?: unknown; reasoning?: unknown };
  try {
    parsed = JSON.parse(responseText);
  } catch {
    throw new AiJudgeDuelError('JSON inválido na resposta do Gemini.');
  }

  if (parsed.winner !== 'a' && parsed.winner !== 'b') {
    throw new AiJudgeDuelError('Vencedor retornado inválido.');
  }
  const reasoning = typeof parsed.reasoning === 'string' ? parsed.reasoning : '';
  return { winnerId: parsed.winner === 'a' ? a.id : b.id, reasoning };
}
