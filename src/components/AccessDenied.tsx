import { signOutCurrent } from '../lib/auth';

export function AccessDenied({ email }: { email?: string | null }) {
  return (
    <main className="auth-screen">
      <h1>Acesso negado</h1>
      <p>
        A conta {email ? <strong>{email}</strong> : 'usada'} não está autorizada a usar este app.
        Contate o dono.
      </p>
      <button onClick={signOutCurrent} className="btn-secondary">
        Sair
      </button>
    </main>
  );
}
