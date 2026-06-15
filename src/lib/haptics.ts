/**
 * Helpers de haptic feedback (vibração) para reforço de hábito por recompensa.
 *
 * A Vibration API só funciona em navegadores móveis — principalmente Android
 * (Chrome/Firefox). iOS Safari ignora silenciosamente, então o app degrada
 * graciosamente: se a API não existe ou a chamada falha, vira no-op.
 */

export function canVibrate(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
}

function vibrate(pattern: number | number[]): void {
  if (!canVibrate()) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    // Alguns navegadores lançam se chamado fora de um gesto do usuário.
    // Ignoramos: haptic é um extra, não pode quebrar o fluxo.
  }
}

/** Toque curto de confirmação ao classificar uma tarefa. */
export function hapticSuccess(): void {
  vibrate([12, 28, 18]);
}

/** Toque leve para ações neutras (pular, voltar). */
export function hapticTap(): void {
  vibrate(8);
}

/** Padrão comemorativo ao concluir a sessão de classificação. */
export function hapticCelebrate(): void {
  vibrate([18, 40, 18, 40, 35, 60, 50]);
}
