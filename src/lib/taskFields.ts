import type { Esforco, Modo, MoSCoW } from '../types';

/**
 * Normalização dos campos categóricos da tarefa (`moscow`, `modo`,
 * `esforco`).
 *
 * As três colunas são `text` livre no Postgres — sem CHECK, sem enum — então
 * o banco guarda o que quer que tenha sido gravado ao longo da vida do app:
 * rótulos de versões anteriores (`modo = 'colaborar'`, de antes da troca por
 * Manual/Delegar/Cowork/Design/Code/Chat), variações de caixa vindas do
 * dashboard.html (`'Manual'`) e migrações que nunca rodaram. O tipo `Task`
 * promete uniões fechadas, mas `rowToTask` só fazia um cast — o valor
 * inesperado entrava no app disfarçado de valor válido e só estourava lá na
 * frente, em quem indexa um `Record<Modo, …>` com ele.
 *
 * Estas funções são o ponto único onde o valor bruto vira valor do domínio:
 * usadas na leitura do banco (`rowToTask`) e no parser de markdown, garantem
 * que nenhum consumidor precise se defender de valor fora da união.
 */

export const MOSCOW_VALUES = ['must', 'should', 'could', 'wont'] as const;
export const MODO_VALUES = [
  'manual',
  'delegar',
  'cowork',
  'design',
  'code',
  'chat',
] as const;
export const ESFORCO_VALUES = ['rapido', 'medio', 'longo'] as const;

// Caixa, acentos e apóstrofo fora: `"Won't"`, `"WONT"` e `"wont"` são o mesmo
// valor, assim como `"Rápido"` e `"rapido"`.
function fold(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['’]/g, '');
}

export function normalizeMoscow(raw: unknown): MoSCoW {
  const v = fold(raw);
  return (MOSCOW_VALUES as readonly string[]).includes(v) ? (v as MoSCoW) : '';
}

export function normalizeEsforco(raw: unknown): Esforco {
  const v = fold(raw);
  return (ESFORCO_VALUES as readonly string[]).includes(v) ? (v as Esforco) : '';
}

export function normalizeModo(raw: unknown): Modo {
  const v = fold(raw);
  if ((MODO_VALUES as readonly string[]).includes(v)) return v as Modo;
  // "Colaborar" é o rótulo antigo (pré-migração): virou "chat", tanto na tag
  // escrita no título quanto no valor gravado na coluna.
  if (v === 'colaborar') return 'chat';
  return 'manual';
}
