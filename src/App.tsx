import { useEffect, useMemo, useState } from 'react';
import { useAuthState } from 'react-firebase-hooks/auth';
import { Login } from './components/Login';
import {
  defaultProjectFiltersState,
  deserializeProjectFiltersState,
  ProjectFiltersBar,
  serializeProjectFiltersState,
  type ProjectFiltersState,
} from './components/ProjectFiltersBar';
import { SidebarMenu } from './components/SidebarMenu';
import {
  defaultFiltersState,
  deserializeFiltersState,
  serializeFiltersState,
  TaskFiltersBar,
  type TaskFiltersState,
} from './components/TaskFiltersBar';
import { UpdatePrompt } from './components/UpdatePrompt';
import { signOutCurrent } from './lib/auth';
import { auth } from './lib/firebase';
import { ProjectNavigationContext } from './lib/projectNavigation';
import { TaskNavigationContext } from './lib/taskNavigation';
import { useUserData } from './lib/useUserData';
import { ProjectDetailView } from './views/ProjectDetailView';
import { ProjectDuelView } from './views/ProjectDuelView';
import { ProjectsView } from './views/ProjectsView';
import { SettingsView } from './views/SettingsView';
import { TaskDetailView } from './views/TaskDetailView';
import { createProject } from './repositories/projectsRepo';
import { TasksRoot, TaskView, VIEW_TABS } from './views/TasksRoot';

const TASK_VIEW_KEY = 'app-produtividade:task-view';
const TASK_FILTERS_KEY = 'app-produtividade:task-filters';
const PROJECT_FILTERS_KEY = 'app-produtividade:project-filters';

function loadTaskFilters(): TaskFiltersState {
  try {
    const raw = localStorage.getItem(TASK_FILTERS_KEY);
    if (!raw) return defaultFiltersState();
    return deserializeFiltersState(JSON.parse(raw));
  } catch {
    return defaultFiltersState();
  }
}

function loadProjectFilters(): ProjectFiltersState {
  try {
    const raw = localStorage.getItem(PROJECT_FILTERS_KEY);
    if (!raw) return defaultProjectFiltersState();
    return deserializeProjectFiltersState(JSON.parse(raw));
  } catch {
    return defaultProjectFiltersState();
  }
}

type Tab = 'tasks' | 'projects' | 'settings';

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'tasks', label: 'Tarefas' },
  { key: 'projects', label: 'Projetos' },
  { key: 'settings', label: 'Configurações' },
];

export function App() {
  const [user, loading, error] = useAuthState(auth);
  const [tab, setTab] = useState<Tab>('projects');
  const [menuOpen, setMenuOpen] = useState(false);
  const [taskView, setTaskView] = useState<TaskView>(() => {
    const stored = localStorage.getItem(TASK_VIEW_KEY);
    return (VIEW_TABS.find((v) => v.key === stored)?.key ?? 'prioridade') as TaskView;
  });
  const [filters, setFilters] = useState<TaskFiltersState>(loadTaskFilters);
  const [projectFilters, setProjectFilters] = useState<ProjectFiltersState>(
    loadProjectFilters,
  );

  useEffect(() => {
    localStorage.setItem(TASK_VIEW_KEY, taskView);
  }, [taskView]);

  useEffect(() => {
    localStorage.setItem(
      TASK_FILTERS_KEY,
      JSON.stringify(serializeFiltersState(filters)),
    );
  }, [filters]);

  useEffect(() => {
    localStorage.setItem(
      PROJECT_FILTERS_KEY,
      JSON.stringify(serializeProjectFiltersState(projectFilters)),
    );
  }, [projectFilters]);

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
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [duelOpen, setDuelOpen] = useState(false);

  const taskNavValue = useMemo(
    () => ({ openTask: (taskId: string) => setSelectedTaskId(taskId) }),
    [],
  );
  const projectNavValue = useMemo(
    () => ({
      openProject: (projectId: string) => setSelectedProjectId(projectId),
      openProjectTasks: (projectId: string) => {
        setSelectedProjectId(null);
        setSelectedTaskId(null);
        setFilters({ ...defaultFiltersState(), projectFilter: projectId });
        setTaskView('prioridade');
        setTab('tasks');
      },
    }),
    [setFilters, setTaskView, setTab],
  );

  const selectedTask = selectedTaskId
    ? data.tasks.find((t) => t.id === selectedTaskId) ?? null
    : null;
  const selectedProject = selectedProjectId
    ? data.projects.find((p) => p.id === selectedProjectId) ?? null
    : null;

  useEffect(() => {
    if (selectedTaskId && !selectedTask && data.tasks.length > 0) {
      setSelectedTaskId(null);
    }
  }, [selectedTaskId, selectedTask, data.tasks.length]);

  useEffect(() => {
    if (selectedProjectId && !selectedProject && data.projects.length > 0) {
      setSelectedProjectId(null);
    }
  }, [selectedProjectId, selectedProject, data.projects.length]);

  const selectedProjectTaskCount = useMemo(() => {
    if (!selectedProject) return 0;
    return data.tasks.filter((t) => t.section === selectedProject.id).length;
  }, [selectedProject, data.tasks]);

  if (selectedTask) {
    return (
      <TaskNavigationContext.Provider value={taskNavValue}>
        <ProjectNavigationContext.Provider value={projectNavValue}>
          <div className="app app--detail">
            <main role="main">
              <TaskDetailView
                uid={uid}
                task={selectedTask}
                allTasks={data.tasks}
                projects={data.projects}
                projectMap={data.projectMap}
                ctx={data.ctx}
                onClose={() => setSelectedTaskId(null)}
              />
            </main>
            <UpdatePrompt />
          </div>
        </ProjectNavigationContext.Provider>
      </TaskNavigationContext.Provider>
    );
  }

  if (duelOpen) {
    return (
      <TaskNavigationContext.Provider value={taskNavValue}>
        <ProjectNavigationContext.Provider value={projectNavValue}>
          <div className="app app--detail">
            <main role="main">
              <ProjectDuelView
                uid={uid}
                projects={data.projects}
                onClose={() => setDuelOpen(false)}
              />
            </main>
            <UpdatePrompt />
          </div>
        </ProjectNavigationContext.Provider>
      </TaskNavigationContext.Provider>
    );
  }

  if (selectedProject) {
    return (
      <TaskNavigationContext.Provider value={taskNavValue}>
        <ProjectNavigationContext.Provider value={projectNavValue}>
          <div className="app app--detail">
            <main role="main">
              <ProjectDetailView
                uid={uid}
                project={selectedProject}
                taskCount={selectedProjectTaskCount}
                score={data.ctx.projectScoreMap[selectedProject.id]}
                onClose={() => setSelectedProjectId(null)}
              />
            </main>
            <UpdatePrompt />
          </div>
        </ProjectNavigationContext.Provider>
      </TaskNavigationContext.Provider>
    );
  }

  return (
    <TaskNavigationContext.Provider value={taskNavValue}>
    <ProjectNavigationContext.Provider value={projectNavValue}>
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
          <>
            <button
              type="button"
              className="duel-toggle"
              onClick={() => setDuelOpen(true)}
              aria-label="Reordenar por duelos"
              title="Reordenar por duelos"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                focusable="false"
              >
                <polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5" />
                <line x1="13" x2="19" y1="19" y2="13" />
                <line x1="16" x2="20" y1="16" y2="20" />
                <line x1="19" x2="21" y1="21" y2="19" />
                <polyline points="14.5 6.5 18 3 21 3 21 6 17.5 9.5" />
                <line x1="5" x2="9" y1="14" y2="18" />
                <line x1="7" x2="4" y1="17" y2="20" />
                <line x1="3" x2="5" y1="19" y2="21" />
              </svg>
            </button>
            <ProjectFiltersBar
              state={projectFilters}
              setState={setProjectFilters}
            />
          </>
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
    </ProjectNavigationContext.Provider>
    </TaskNavigationContext.Provider>
  );
}
