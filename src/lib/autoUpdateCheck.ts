// Checagem automática de atualização em segundo plano — só relevante no APK
// Android: no navegador/PWA a checagem já acontece sozinha (o browser
// verifica o service worker no registro e o UpdatePrompt reforça isso ao
// voltar o foco e periodicamente, ver UpdatePrompt.tsx). No nativo não há
// service worker, então a única forma de saber que há uma build nova era o
// usuário abrir Configurações e clicar em "Verificar atualização" — este
// módulo automatiza isso: roda ao abrir o app e sempre que ele volta pro
// primeiro plano, com um intervalo mínimo entre checagens pra não bater no
// Supabase toda vez que a tela liga/desliga.
//
// Estado compartilhado num pequeno store fora do React (module-level) porque
// o componente que mostra o aviso (UpdatePrompt) é remontado a cada troca de
// tela dentro do app — um efeito nele reiniciaria a checagem e reencadearia
// listeners a cada navegação. Aqui a checagem e o listener do Capacitor são
// registrados uma única vez (guardunder por `started`) e todo mount só
// assina o estado atual (guardado por `started`, abaixo).

import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { useSyncExternalStore } from 'react';
import {
  buildIdentificavel,
  servicoDisponivel,
  verificarAtualizacao,
  type InfoAtualizacao,
} from './atualizacao';

// Não checa de novo antes de passar esse tempo desde a última checagem
// automática (o app pode voltar pro primeiro plano várias vezes por hora).
const INTERVALO_MINIMO_MS = 60 * 60 * 1000;

let state: InfoAtualizacao | null = null;
let lastCheckAt = 0;
let checking = false;
let started = false;
const listeners = new Set<() => void>();

function setState(next: InfoAtualizacao | null) {
  state = next;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return state;
}

async function check() {
  if (checking) return;
  if (!buildIdentificavel() || !servicoDisponivel()) return;
  const now = Date.now();
  if (now - lastCheckAt < INTERVALO_MINIMO_MS) return;
  lastCheckAt = now;
  checking = true;
  try {
    const info = await verificarAtualizacao();
    if (info.disponivel) setState(info);
  } catch {
    // Checagem em segundo plano: falha silenciosa, não incomoda o usuário.
    // A verificação manual em Configurações continua disponível e mostra erro.
  } finally {
    checking = false;
  }
}

// Idempotente: chamadas repetidas (a cada remount do UpdatePrompt) não
// registram listeners duplicados nem disparam checagens extras.
export function startAutoUpdateCheck() {
  if (started || !Capacitor.isNativePlatform()) return;
  started = true;
  void check();
  void CapacitorApp.addListener('appStateChange', ({ isActive }) => {
    if (isActive) void check();
  });
}

export function useAutoUpdateInfo(): InfoAtualizacao | null {
  return useSyncExternalStore(subscribe, getSnapshot);
}

export function dismissAutoUpdateInfo() {
  setState(null);
}
