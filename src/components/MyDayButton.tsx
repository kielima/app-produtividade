import { addToMyDay, isInMyDay, removeFromMyDay } from '../lib/myDay';
import type { Task } from '../types';

/**
 * Liga/desliga a presença da tarefa na lista "Meu dia". Usado em todo lugar
 * que mostra uma tarefa (card e página de detalhe), para que dê pra
 * adicioná-la ao dia de qualquer tela.
 */
export function MyDayButton({
  uid,
  task,
  variant = 'icon',
}: {
  uid: string;
  task: Task;
  // `icon`: botão compacto para a linha do card. `badge`: etiqueta com texto,
  // no estilo dos demais controles da página de detalhe.
  variant?: 'icon' | 'badge';
}) {
  const active = isInMyDay(task);
  const label = active ? 'Remover do Meu dia' : 'Adicionar ao Meu dia';

  async function toggle() {
    try {
      if (active) await removeFromMyDay(uid, task);
      else await addToMyDay(uid, task);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Não foi possível salvar a tarefa.');
    }
  }

  if (variant === 'badge') {
    return (
      <button
        type="button"
        className={`badge my-day${active ? ' active' : ''}`}
        onClick={toggle}
        title={label}
      >
        ☀️ {active ? 'No Meu dia' : 'Meu dia'}
      </button>
    );
  }

  return (
    <button
      type="button"
      className={`my-day-btn${active ? ' active' : ''}`}
      onClick={toggle}
      aria-label={label}
      aria-pressed={active}
      title={label}
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill={active ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
      </svg>
    </button>
  );
}
