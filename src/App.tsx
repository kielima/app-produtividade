import { useEffect, useState } from 'react';
import { useAuthState } from 'react-firebase-hooks/auth';
import { Login } from './components/Login';
import {
  defaultProjectFiltersState,
  ProjectFiltersBar,
  type ProjectFiltersState,
} from './components/ProjectFiltersBar';
import { SidebarMenu } from './components/SidebarMenu';
import {
  defaultFiltersState,
  TaskFiltersBar,
  type TaskFiltersState,
} from './components/TaskFiltersBar';
import { UpdatePrompt } from './components/UpdatePrompt';
import { signOutCurrent } from './lib/auth';
import { auth } from './lib/firebase';
import { useUserData } from './lib/useUserData';
import { ProjectsView } from './views/ProjectsView';
import { SettingsView } from './views/SettingsView';
import { createProject } from './repositories/projectsRepo';
import { TasksRoot, TaskView, VIEW_TABS } from './views/TasksRoot';

const TASK_VIEW_KEY = 'app-produtividade:task-view';

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
  const [taskView, setTaskView] = useState<TaskView>(() => {
    const stored = localStorage.getItem(TASK_VIEW_KEY);
    return (VIEW_TABS.find((v) => v.key === stored)?.key ?? 'prioridade') as TaskView;
  });
  const [filters, setFilters] = useState<TaskFiltersState>(() =>
    defaultFiltersState(),
  );
  const [projectFilters, setProjectFilters] = useState<ProjectFiltersState>(
    () => defaultProjectFiltersState(),
  );

  useEffect(() => {
    localStorage.setItem(TASK_VIEW_KEY, taskView);
  }, [taskView]);

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

  return <AppShell
    uid={user.uid}
    tab={tab}
    setTab={setTab}
    menuOpen={menuOpen}
    setMenuOpen={setMenuOpen}
    taskView={taskView}
    setTaskView={setTaskView}
    filters={filters}
    setFilters={setFilters}
    projectFilters={projectFilters}
    setProjectFilters={setProjectFilters}
  />;
}

function AppShell({
  uid,
  tab,
  setTab,
  menuOpen,
  setMenuOpen,
  taskView,
  setTaskView,
  filters,
  setFilters,
  projectFilters,
  setProjectFilters,
}: {
  uid: string;
  tab: Tab;
  setTab: (t: Tab) => void;
  menuOpen: boolean;
  setMenuOpen: (v: boolean) => void;
  taskView: TaskView;
  setTaskView: (v: TaskView) => void;
  filters: TaskFiltersState;
  setFilters: (f: TaskFiltersState) => void;
  projectFilters: ProjectFiltersState;
  setProjectFilters: (f: ProjectFiltersState) => void;
}) {
  const data = useUserData(uid);

  return (
    <div className="app">
      <header
        className={`topbar${tab === 'tasks' ? ' topbar--with-subtabs' : ''}`}
        role="banner"
      >
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
        {tab === 'tasks' && (
          <>
            <nav className="subtabs" aria-label="Visualizações de tarefas">
              {VIEW_TABS.map((v) => (
                <button
                  key={v.key}
                  type="button"
                  className={taskView === v.key ? 'subtab active' : 'subtab'}
                  onClick={() => setTaskView(v.key)}
                >
                  {v.label}
                </button>
              ))}
            </nav>
            <TaskFiltersBar
              state={filters}
              setState={setFilters}
              projects={data.projects}
              showHideZero={taskView === 'prioridade'}
              onCreateProject={async (name) => {
                const p = await createProject(uid, name, data.projects.length);
                return p.id;
              }}
            />
          </>
        )}
        {tab === 'projects' && (
          <ProjectFiltersBar
            state={projectFilters}
            setState={setProjectFilters}
          />
        )}
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
        {tab === 'tasks' && (
          <TasksRoot uid={uid} view={taskView} data={data} filters={filters} />
        )}
        {tab === 'projects' && (
          <ProjectsView uid={uid} filters={projectFilters} />
        )}
        {tab === 'settings' && <SettingsView uid={uid} />}
      </main>

      <UpdatePrompt />
    </div>
  );
}
