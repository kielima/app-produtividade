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
  ProjectCombobox,
  serializeFiltersState,
  TaskFiltersBar,
  type TaskFiltersState,
} from './components/TaskFiltersBar';
import { UpdatePrompt } from './components/UpdatePrompt';
import { signOutCurrent } from './lib/auth';
import { auth } from './lib/firebase';
import { NotesFiltersBar } from './components/NotesFiltersBar';
import { NoteNavigationContext } from './lib/noteNavigation';
import { ProjectNavigationContext } from './lib/projectNavigation';
import { TaskNavigationContext } from './lib/taskNavigation';
import { useUserData } from './lib/useUserData';
import { ProjectDetailView } from './views/ProjectDetailView';
import { ProjectDuelView } from './views/ProjectDuelView';
import { ProjectsView } from './views/ProjectsView';
import { SettingsView } from './views/SettingsView';
import { TaskDetailView } from './views/TaskDetailView';
import { NoteDetailView } from './views/NoteDetailView';
import { NotesView } from './views/NotesView';
import { createProject } from './repositories/projectsRepo';
import { createNote, patchNote, subscribeToNotes } from './repositories/notesRepo';
import { hasLink, hasList, LINK_TAG, LIST_TAG, normalizeTags } from './lib/tags';
import { TasksRoot } from './views/TasksRoot';
import { EstatisticasView } from './views/EstatisticasView';
import type { Note } from './types';

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

type Tab = 'notes' | 'tasks' | 'projects' | 'stats' | 'settings';

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'notes', label: 'Keep' },
  { key: 'tasks', label: 'Tasks' },
  { key: 'projects', label: 'Projetos' },
  { key: 'stats', label: 'Estatísticas' },
  { key: 'settings', label: 'Configurações' },
];

export function App() {
  const [user, loading, error] = useAuthState(auth);
  const [tab, setTab] = useState<Tab>('notes');
  const [menuOpen, setMenuOpen] = useState(false);
  const [filters, setFilters] = useState<TaskFiltersState>(loadTaskFilters);
  const [projectFilters, setProjectFilters] = useState<ProjectFiltersState>(
    loadProjectFilters,
  );

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
  filters: TaskFiltersState;
  setFilters: (f: TaskFiltersState) => void;
  projectFilters: ProjectFiltersState;
  setProjectFilters: (f: ProjectFiltersState) => void;
}) {
  const data = useUserData(uid);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedNoteTags, setSelectedNoteTags] = useState<string[]>([]);
  const [duelOpen, setDuelOpen] = useState(false);

  useEffect(() => {
    const unsub = subscribeToNotes(uid, setNotes);
    return unsub;
  }, [uid]);

  // Automação: garante tags automáticas (`link` para URLs, `lista` para listas)
  // em toda nota. Roda sempre que a lista é atualizada — cobre notas existentes
  // (backfill) e novas edições, sem custo extra quando as tags já estão presentes.
  useEffect(() => {
    for (const n of notes) {
      const additions: string[] = [];
      if (hasLink(n.note) && !n.tags.includes(LINK_TAG)) additions.push(LINK_TAG);
      if (hasList(n.items, n.note) && !n.tags.includes(LIST_TAG)) additions.push(LIST_TAG);
      if (additions.length === 0) continue;
      patchNote(uid, n.id, { tags: normalizeTags([...n.tags, ...additions]) });
    }
  }, [notes, uid]);

  useEffect(() => {
    const raw = sessionStorage.getItem('pendingShare');
    if (!raw) return;
    sessionStorage.removeItem('pendingShare');

    let cancelled = false;

    async function processShare() {
      let share: { title: string; text: string; url: string };
      try {
        share = JSON.parse(raw!);
      } catch {
        return;
      }

      const sharedUrl = share.url || share.text;
      if (!sharedUrl) return;

      let title = share.title;
      if (!title) {
        try {
          const res = await fetch(
            `https://api.microlink.io?url=${encodeURIComponent(sharedUrl)}`,
          );
          const json = await res.json();
          title = json?.data?.title ?? '';
        } catch {
          // microlink indisponível — usa a URL como título
        }
      }

      if (cancelled) return;

      const note = await createNote(uid);
      await patchNote(uid, note.id, {
        title: title || sharedUrl,
        note: sharedUrl,
      });

      if (cancelled) return;
      setTab('notes');
      setSelectedNoteId(note.id);
    }

    processShare();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

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
        setTab('tasks');
      },
    }),
    [setFilters, setTab],
  );
  const noteNavValue = useMemo(
    () => ({ openNote: (noteId: string) => setSelectedNoteId(noteId) }),
    [],
  );

  const allNoteTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of notes) {
      for (const tag of n.tags) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([tag]) => tag);
  }, [notes]);

  const selectedTask = selectedTaskId
    ? data.tasks.find((t) => t.id === selectedTaskId) ?? null
    : null;
  const selectedProject = selectedProjectId
    ? data.projects.find((p) => p.id === selectedProjectId) ?? null
    : null;
  const selectedNote = selectedNoteId
    ? notes.find((n) => n.id === selectedNoteId) ?? null
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

  useEffect(() => {
    if (selectedNoteId && !selectedNote && notes.length > 0) {
      setSelectedNoteId(null);
    }
  }, [selectedNoteId, selectedNote, notes.length]);

  const selectedProjectTaskCount = useMemo(() => {
    if (!selectedProject) return 0;
    return data.tasks.filter((t) => t.section === selectedProject.id).length;
  }, [selectedProject, data.tasks]);

  if (selectedNote) {
    return (
      <NoteNavigationContext.Provider value={noteNavValue}>
        <div className="app app--detail">
          <main role="main">
            <NoteDetailView
              uid={uid}
              note={selectedNote}
              allTags={allNoteTags}
              onClose={() => setSelectedNoteId(null)}
            />
          </main>
          <UpdatePrompt />
        </div>
      </NoteNavigationContext.Provider>
    );
  }

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
    <NoteNavigationContext.Provider value={noteNavValue}>
    <TaskNavigationContext.Provider value={taskNavValue}>
    <ProjectNavigationContext.Provider value={projectNavValue}>
    <div className="app">
      <header
        className="topbar"
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
        <span className="topbar-section-name">
          {TABS.find((t) => t.key === tab)?.label}
        </span>
        {tab === 'notes' && (
          <NotesFiltersBar
            allTags={allNoteTags}
            selectedTags={selectedNoteTags}
            setSelectedTags={setSelectedNoteTags}
          />
        )}
        {tab === 'tasks' && (
          <>
            <div className="topbar-project-picker">
              <ProjectCombobox
                value={filters.projectFilter}
                onChange={(next) =>
                  setFilters({ ...filters, projectFilter: next })
                }
                projects={data.projects}
                onCreateProject={async (name) => {
                  const p = await createProject(uid, name, data.projects.length);
                  return p.id;
                }}
              />
            </div>
            <TaskFiltersBar
              state={filters}
              setState={setFilters}
              showHideZero={true}
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
        {tab === 'notes' && (
          <NotesView
            uid={uid}
            notes={notes}
            selectedTags={selectedNoteTags}
          />
        )}
        {tab === 'tasks' && (
          <TasksRoot uid={uid} data={data} filters={filters} />
        )}
        {tab === 'projects' && (
          <ProjectsView uid={uid} filters={projectFilters} />
        )}
        {tab === 'stats' && (
          <EstatisticasView uid={uid} projectScoreMap={data.ctx.projectScoreMap} />
        )}
        {tab === 'settings' && <SettingsView uid={uid} />}
      </main>

      <UpdatePrompt />
    </div>
    </ProjectNavigationContext.Provider>
    </TaskNavigationContext.Provider>
    </NoteNavigationContext.Provider>
  );
}
