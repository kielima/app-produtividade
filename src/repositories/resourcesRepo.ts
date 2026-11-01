import { supabase } from '../lib/supabase';
import { publishLocalRow, subscribeTable, type Unsubscribe } from './realtimeTable';
import type { Resource } from '../types';

interface ResourceRow {
  id: string;
  user_id: string;
  nome: string;
  foto: string | null;
  descricao: string | null;
  tipo: string | null;
  ordem: number | null;
  criado_em?: string;
}

function rowToResource(row: ResourceRow): Resource {
  return {
    id: row.id,
    nome: row.nome ?? '',
    foto: row.foto ?? null,
    descricao: row.descricao ?? '',
    tipo: row.tipo === 'ia' ? 'ia' : 'pessoa',
    ordem: row.ordem ?? null,
  };
}

export function sortResources(list: Resource[]): Resource[] {
  return [...list].sort(
    (a, b) =>
      (a.ordem ?? Number.MAX_SAFE_INTEGER) - (b.ordem ?? Number.MAX_SAFE_INTEGER) ||
      a.nome.localeCompare(b.nome, 'pt-BR'),
  );
}

export function subscribeToResources(
  uid: string,
  cb: (resources: Resource[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return subscribeTable<ResourceRow, Resource>(
    { table: 'resources', uid, mapRow: rowToResource, idOf: (r) => r.id, onError },
    (list) => cb(sortResources(list)),
  );
}

export interface ResourceInput {
  nome: string;
  foto: string | null;
  descricao: string;
  tipo: Resource['tipo'];
  ordem?: number | null;
}

export async function createResource(uid: string, input: ResourceInput): Promise<Resource> {
  const nome = input.nome.trim();
  if (!nome) throw new Error('O recurso precisa de um nome.');
  const { data, error } = await supabase
    .from('resources')
    .insert({
      user_id: uid,
      nome,
      foto: input.foto,
      descricao: input.descricao.trim(),
      tipo: input.tipo,
      ordem: input.ordem ?? null,
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  publishLocalRow('resources', uid, data);
  return rowToResource(data as ResourceRow);
}

export async function updateResource(uid: string, id: string, input: ResourceInput): Promise<void> {
  const nome = input.nome.trim();
  if (!nome) throw new Error('O recurso precisa de um nome.');
  const { data, error } = await supabase
    .from('resources')
    .update({
      nome,
      foto: input.foto,
      descricao: input.descricao.trim(),
      tipo: input.tipo,
      ...(input.ordem !== undefined ? { ordem: input.ordem } : {}),
    })
    .eq('user_id', uid)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  publishLocalRow('resources', uid, data);
}

export async function deleteResource(uid: string, id: string): Promise<void> {
  // As tarefas atribuídas ficam sem responsável (`on delete set null`).
  const { error } = await supabase.from('resources').delete().eq('user_id', uid).eq('id', id);
  if (error) throw new Error(error.message);
}
