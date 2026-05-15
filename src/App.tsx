import { useState } from 'react';
import { useAuthState } from 'react-firebase-hooks/auth';
import { AccessDenied } from './components/AccessDenied';
import { Login } from './components/Login';
import { isAuthorized } from './lib/access';
import { signOutCurrent } from './lib/auth';
import { auth } from './lib/firebase';
import { ProjectsView } from './views/ProjectsView';
import { TasksRoot } from './views/TasksRoot';

type Tab = 'tasks' | 'projects';

export function App() {
  const [user, loading, error] = useAuthState(auth);
  const [tab, setTab] = useState<Tab>('tasks');

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
  if (!isAuthorized(user.uid)) return <AccessDenied email={user.email} />;

  return (
    <div className="app">
      <header className="topbar">
        <h1>Produtividade</h1>
        <nav className="tabs">
          <button
            type="button"
            className={tab === 'tasks' ? 'tab active' : 'tab'}
            onClick={() => setTab('tasks')}
          >
            Tarefas
          </button>
          <button
            type="button"
            className={tab === 'projects' ? 'tab active' : 'tab'}
            onClick={() => setTab('projects')}
          >
            Projetos
          </button>
        </nav>
        <div className="topbar-right">
          <span className="user-email">{user.email}</span>
          <button onClick={signOutCurrent} className="btn-secondary">
            Sair
          </button>
        </div>
      </header>

      {tab === 'tasks' ? <TasksRoot uid={user.uid} /> : <ProjectsView uid={user.uid} />}
    </div>
  );
}
