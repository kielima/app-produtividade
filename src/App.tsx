import { useState } from 'react';
import { useAuthState } from 'react-firebase-hooks/auth';
import { Login } from './components/Login';
import { SidebarMenu } from './components/SidebarMenu';
import { UpdatePrompt } from './components/UpdatePrompt';
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
  const [menuOpen, setMenuOpen] = useState(false);

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

  return (
    <div className="app">
      <header className="topbar" role="banner">
        <button
          type="button"
          className="menu-toggle"
          onClick={() => setMenuOpen(true)}
          aria-label="Abrir menu"
          aria-expanded={menuOpen}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M4 6h16M4 12h16M4 18h16"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </header>

      <SidebarMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        items={TABS}
        activeKey={tab}
        onSelect={(key) => setTab(key as Tab)}
        onSignOut={signOutCurrent}
      />

      <main role="main">
        {tab === 'tasks' && <TasksRoot uid={user.uid} />}
        {tab === 'projects' && <ProjectsView uid={user.uid} />}
        {tab === 'settings' && <SettingsView uid={user.uid} />}
      </main>

      <UpdatePrompt />
    </div>
  );
}
