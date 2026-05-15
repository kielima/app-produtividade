import { useAuthState } from 'react-firebase-hooks/auth';
import { auth } from './lib/firebase';
import { isAuthorized } from './lib/access';
import { signOutCurrent } from './lib/auth';
import { Login } from './components/Login';
import { AccessDenied } from './components/AccessDenied';
import { ListView } from './views/ListView';

export function App() {
  const [user, loading, error] = useAuthState(auth);

  if (loading) {
    return (
      <main className="auth-screen">
        <p>Carregando…</p>
      </main>
    );
  }

  if (error) {
    return (
      <main className="auth-screen">
        <h1>Erro de autenticação</h1>
        <p className="error">{error.message}</p>
      </main>
    );
  }

  if (!user) return <Login />;

  if (!isAuthorized(user.uid)) {
    return <AccessDenied email={user.email} />;
  }

  return (
    <div className="app">
      <header className="topbar">
        <h1>Produtividade</h1>
        <div className="topbar-right">
          <span className="user-email">{user.email}</span>
          <button onClick={signOutCurrent} className="btn-secondary">
            Sair
          </button>
        </div>
      </header>
      <ListView uid={user.uid} />
    </div>
  );
}
