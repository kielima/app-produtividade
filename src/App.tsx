import { useState } from 'react';
import { useAuthState } from 'react-firebase-hooks/auth';
import { AccessDenied } from './components/AccessDenied';
import { Login } from './components/Login';
import { UpdatePrompt } from './components/UpdatePrompt';
import { isAuthorized } from './lib/access';
import { signOutCurrent } from './lib/auth';
import { auth } from './lib/firebase';
import { ProjectsView } from './views/ProjectsView';
import { SettingsView } from './views/SettingsView';
import { TasksRoot } from './views/TasksRoot';

type Tab = 'tasks' | 'projects' | 'settings';

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'tasks', label: 'Tarefas' },
  { key: 'projects', label: 'Projetos' },
  { key: 'settings', label: 'Configurações' },
];

export function App() {
  const [user, loading, error] = useAuthState(auth);
  const [tab, setTab] = useState<Tab>('tasks');

  if (loading) {
    return (
      <main className="auth-screen" aria-busy="true">
        <p>Carregando…</p>
        <UpdatePrompt />
      </main>
    );
  }

  if (error) {
    return (
      <main className="auth-screen" role="alert">
        <h1>Erro de autenticação</h1>
        <p className="error">{error.message}</p>
        <UpdatePrompt />
      </main>
    );
  }

  if (!user) {
    return (
      <>
        <Login />
        <UpdatePrompt />
      </>
    );
  }
  if (!isAuthorized(user.uid)) {
    return (
      <>
        <AccessDenied email={user.email} />
        <UpdatePrompt />
      </>
    );
  }

  return (
    <div className="app">
      <header className="topbar" role="banner">
        <h1>Produtividade</h1>
        <nav className="tabs" aria-label="seções principais">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              className={tab === t.key ? 'tab active' : 'tab'}
              onClick={() => setTab(t.key)}
              aria-current={tab === t.key ? 'page' : undefined}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div className="topbar-right">
          <span className="user-email" aria-label="usuário logado">
            {user.email}
          </span>
          <button onClick={signOutCurrent} className="btn-secondary">
            Sair
          </button>
        </div>
      </header>

      <main role="main">
        {tab === 'tasks' && <TasksRoot uid={user.uid} />}
        {tab === 'projects' && <ProjectsView uid={user.uid} />}
        {tab === 'settings' && <SettingsView uid={user.uid} />}
      </main>

      <UpdatePrompt />
    </div>
  );
}
