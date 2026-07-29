// Verificação e instalação de atualização do app.
//
// O workflow "Android APK" publica cada build na main: hospeda o APK no
// Firebase Hosting e grava a linha singleton `app_version` no Supabase com o
// commit construído e a URL do APK. Aqui lemos essa linha (leitura pública,
// sem login — RLS permite `select` para todo mundo), comparamos o commit
// publicado com o da build instalada (__APP_COMMIT__) e, no Android, baixamos
// o APK e abrimos o instalador via o plugin nativo `Atualizador`. Nada de
// código nem dados pessoais transita por aqui — a linha só tem o commit e a
// URL do APK.

import { Capacitor, registerPlugin } from '@capacitor/core';
import { supabase } from './supabase';

interface AtualizadorPlugin {
  // Baixa o APK da URL e abre o instalador do Android. Resolve quando o
  // instalador é aberto; rejeita se o download falhar.
  baixarEInstalar(options: { url: string }): Promise<void>;
}

const Atualizador = registerPlugin<AtualizadorPlugin>('Atualizador');

// Commit da build instalada (vazio em build de desenvolvimento).
export const COMMIT_ATUAL = __APP_COMMIT__;

export interface InfoAtualizacao {
  // true quando o commit publicado difere do commit instalado.
  disponivel: boolean;
  // Commit da última build publicada (curto, 7 chars) — null se ausente.
  commitRemoto: string | null;
  // URL direta do APK no Firebase Hosting (null se ausente).
  urlApk: string | null;
  // Quando a build foi publicada — para mostrar ao usuário.
  publicadoEm: Date | null;
}

// Só dá para instalar o APK direto no Android nativo. No navegador/PWA a
// atualização vem pelo service worker (ver UpdatePrompt).
export function podeInstalarApk(): boolean {
  return Capacitor.getPlatform() === 'android';
}

// true quando estamos numa build "de verdade" (com commit carimbado) e dá para
// comparar versões. Em `npm run dev` o commit é vazio.
export function buildIdentificavel(): boolean {
  return COMMIT_ATUAL.length > 0;
}

// O verificador depende do Supabase (é de lá que vem a versão publicada).
export function servicoDisponivel(): boolean {
  return Boolean(import.meta.env.VITE_SUPABASE_URL);
}

export async function verificarAtualizacao(): Promise<InfoAtualizacao> {
  const { data, error } = await supabase
    .from('app_version')
    .select('commit, apk_url, atualizado_em')
    .eq('id', 1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) {
    throw new Error('Nenhuma build publicada ainda.');
  }

  const commitRemoto = data.commit ? (data.commit as string).slice(0, 7) : null;
  const urlApk = (data.apk_url as string | null) ?? null;
  const publicadoEm = data.atualizado_em ? new Date(data.atualizado_em as string) : null;

  const atualCurto = COMMIT_ATUAL.slice(0, 7);
  const disponivel = Boolean(
    commitRemoto && atualCurto && commitRemoto !== atualCurto,
  );

  return { disponivel, commitRemoto, urlApk, publicadoEm };
}

export async function instalarAtualizacao(url: string): Promise<void> {
  await Atualizador.baixarEInstalar({ url });
}
