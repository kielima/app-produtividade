// Gera subtarefas a partir do título + nota de uma tarefa, via Claude. A
// chamada real acontece na Edge Function `call-claude` (ver
// src/lib/claudeClient.ts); aqui só se monta o prompt e o schema.

import { callClaude } from './claudeClient';

export class AiSubtasksError extends Error {}

function buildPrompt(title: string, note: string, existingSubtasks: string[]): string {
  const noteBlock = note.trim()
    ? `\n\n## Anotações\n${note.trim()}`
    : '';
  const existingBlock = existingSubtasks.length
    ? `\n\n## Subtarefas já existentes (não duplicar)\n${existingSubtasks.map((s) => `- ${s}`).join('\n')}`
    : '';

  return [
    'Você é um assistente de produtividade. Quebre a tarefa abaixo em',
    'subtarefas concretas, acionáveis e ordenadas. Cada subtarefa deve ser',
    'curta (uma linha, idealmente < 80 caracteres) e começar com um verbo',
    'no infinitivo. Use o mesmo idioma do título (em geral português do',
    'Brasil). Gere entre 3 e 7 subtarefas. Não repita subtarefas que já',
    'existem.',
    '',
    `## Título\n${title}`,
    noteBlock,
    existingBlock,
  ].join('\n');
}

export async function generateSubtasks(args: {
  title: string;
  note: string;
  existingSubtasks: string[];
}): Promise<string[]> {
  const prompt = buildPrompt(args.title, args.note, args.existingSubtasks);

  let parsed: { subtasks?: unknown };
  try {
    parsed = await callClaude<{ subtasks?: unknown }>({
      content: [{ type: 'text', text: prompt }],
      schema: {
        type: 'object',
        properties: { subtasks: { type: 'array', items: { type: 'string' } } },
        required: ['subtasks'],
        additionalProperties: false,
      },
    });
  } catch (e) {
    throw new AiSubtasksError(e instanceof Error ? e.message : String(e));
  }

  if (!Array.isArray(parsed.subtasks)) {
    throw new AiSubtasksError('Campo "subtasks" ausente ou inválido.');
  }

  return parsed.subtasks
    .filter((s): s is string => typeof s === 'string')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
