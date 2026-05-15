import { useState } from 'react';
import { signInWithGoogle } from '../lib/auth';

export function Login() {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    setError(null);
    setLoading(true);
    try {
      await signInWithGoogle();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-screen">
      <h1>Produtividade — Kiê</h1>
      <p>Acesso restrito. Entre com a conta Google autorizada.</p>
      <button onClick={handleClick} disabled={loading} className="btn-primary">
        {loading ? 'Entrando…' : 'Entrar com Google'}
      </button>
      {error && <p className="error">{error}</p>}
    </main>
  );
}
