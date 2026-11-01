import { supabase } from '../lib/supabase';
import { inferirTipo, reduzirFoto } from '../lib/imagens';
import { publishLocalRow, subscribeTable, type Unsubscribe } from './realtimeTable';
import type { TaskAnexo } from '../types';

const BUCKET = 'task-anexos';
// A URL assinada vale por pouco tempo, então nunca fica guardada — é pedida
// de novo a cada vez que o anexo é mostrado.
const SIGNED_URL_TTL_SECONDS = 3600;
const MAX_ANEXO_BYTES = 10 * 1024 * 1024;
const TIPOS_ACEITOS = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf'];

interface AnexoRow {
  id: string;
  user_id: string;
  task_id: string;
  path: string;
  nome: string;
  tipo: string;
  bytes: number;
  criado_em: string;
}

function rowToAnexo(row: AnexoRow): TaskAnexo {
  return {
    id: row.id,
    taskId: row.task_id,
    path: row.path,
    nome: row.nome,
    tipo: row.tipo,
    bytes: row.bytes,
    criadoEm: row.criado_em,
  };
}

/** Anexos de UMA tarefa, em ordem de envio. */
export function subscribeToTaskAnexos(
  uid: string,
  taskId: string,
  cb: (anexos: TaskAnexo[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return subscribeTable<AnexoRow, TaskAnexo>(
    {
      table: 'task_anexos',
      uid,
      extraColumn: 'task_id',
      extraValue: taskId,
      mapRow: rowToAnexo,
      idOf: (a) => a.id,
      onError,
    },
    (list) => cb([...list].sort((a, b) => a.criadoEm.localeCompare(b.criadoEm))),
  );
}

function extensaoDoTipo(tipo: string): string {
  const porTipo: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'application/pdf': 'pdf',
  };
  return porTipo[tipo] ?? 'bin';
}

export async function uploadTaskAnexo(uid: string, taskId: string, original: File): Promise<TaskAnexo> {
  // Foto grande da câmera vira um JPEG menor antes de subir (ver imagens.ts).
  const file = await reduzirFoto(original);
  const tipo = inferirTipo(file);
  if (tipo === 'image/heic' || tipo === 'image/heif') {
    throw new Error('Foto em HEIC não é aceita — mude a câmera para JPEG ou envie um print.');
  }
  if (!TIPOS_ACEITOS.includes(tipo)) {
    throw new Error(`Formato não aceito (${tipo || 'desconhecido'}): só foto (PNG, JPEG, WebP, GIF) ou PDF.`);
  }
  if (file.size > MAX_ANEXO_BYTES) {
    throw new Error(`O arquivo passou de ${Math.round(MAX_ANEXO_BYTES / 1048576)} MB.`);
  }
  const path = `${uid}/${taskId}/${crypto.randomUUID()}.${extensaoDoTipo(tipo)}`;
  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: tipo });
  if (uploadError) throw new Error(uploadError.message);
  const { data, error } = await supabase
    .from('task_anexos')
    .insert({ user_id: uid, task_id: taskId, path, nome: file.name || 'arquivo', tipo, bytes: file.size })
    .select('*')
    .single();
  if (error) {
    await supabase.storage.from(BUCKET).remove([path]);
    throw new Error(error.message);
  }
  publishLocalRow('task_anexos', taskId, data);
  return rowToAnexo(data as AnexoRow);
}

export async function deleteTaskAnexo(uid: string, anexo: TaskAnexo): Promise<void> {
  // A linha some por cascade quando a tarefa é apagada, mas o ARQUIVO no
  // Storage não; aqui, ao remover um anexo, os dois vão juntos.
  await supabase.storage.from(BUCKET).remove([anexo.path]);
  const { error } = await supabase.from('task_anexos').delete().eq('id', anexo.id).eq('user_id', uid);
  if (error) throw new Error(error.message);
}

export async function signedUrlForTaskAnexo(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error || !data) throw new Error(error?.message ?? 'Não foi possível abrir o anexo.');
  return data.signedUrl;
}
