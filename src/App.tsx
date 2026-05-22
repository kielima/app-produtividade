import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
  defaultStatsFiltersState,
  deserializeStatsFiltersState,
  serializeStatsFiltersState,
  StatsFiltersBar,
  type StatsFiltersState,
} from './components/StatsFiltersBar';
import {
  defaultFiltersState,
  deserializeFiltersState,
  ProjectCombobox,
  serializeFiltersState,
  TaskFiltersBar,
  type TaskFiltersState,
} from './components/TaskFiltersBar';
import {
  ShareTargetDialog,
  type ShareTargetDialogState,
} from './components/ShareTargetDialog';
import { UpdatePrompt } from './components/UpdatePrompt';
import { signOutCurrent } from './lib/auth';
import { auth } from './lib/firebase';
import { NotesFiltersBar } from './components/NotesFiltersBar';
import { SearchInput, SearchToggle } from './components/SearchBar';
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
import { nextTaskId, upsertTask } from './repositories/tasksRepo';
import { transcribeImage } from './lib/aiTranscribe';
import { serializeTitle } from './lib/parser';
import { hasLink, hasList, LINK_TAG, LIST_TAG, normalizeTags } from './lib/tags';
import { TasksRoot } from './views/TasksRoot';
import { ClassifyView } from './views/ClassifyView';
import { CountdownView } from './views/CountdownView';
import { EstatisticasView } from './views/EstatisticasView';
import { TodayView } from './views/TodayView';
import type { Note, Project, Task } from './types';

const TASK_FILTERS_KEY = 'app-produtividade:task-filters';
const PROJECT_FILTERS_KEY = 'app-produtividade:project-filters';
const STATS_FILTERS_KEY = 'app-produtividade:stats-filters';
const MENU_ORDER_KEY = 'app-produtividade:menu-order';

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

function loadStatsFilters(): StatsFiltersState {
  try {
    const raw = localStorage.getItem(STATS_FILTERS_KEY);
    if (!raw) return defaultStatsFiltersState();
    return deserializeStatsFiltersState(JSON.parse(raw));
  } catch {
    return defaultStatsFiltersState();
  }
}

interface SharePayload {
  title: string;
  text: string;
  url: string;
  image: { data: string; mimeType: string } | null;
}

function pickDefaultProjectId(projects: Project[]): string | null {
  const available = projects.filter(
    (p) => p.status !== 'Concluído' && p.status !== 'Cancelado',
  );
  return available[0]?.id ?? null;
}

type Tab =
  | 'today'
  | 'notes'
  | 'tasks'
  | 'projects'
  | 'countdown'
  | 'stats'
  | 'settings';

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'today', label: 'Hoje' },
  { key: 'notes', label: 'Keep' },
  { key: 'tasks', label: 'Tasks' },
  { key: 'projects', label: 'Projetos' },
  { key: 'countdown', label: 'Agenda' },
  { key: 'stats', label: 'Estatísticas' },
  { key: 'settings', label: 'Configurações' },
];

function loadMenuOrder(): Tab[] {
  const defaults = TABS.map((t) => t.key);
  try {
    const raw = localStorage.getItem(MENU_ORDER_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return defaults;
    const valid = parsed.filter((k): k is Tab =>
      defaults.includes(k as Tab),
    );
    // Acrescenta entradas que podem ter sido introduzidas após persistir
    // a ordem (ex: novo separador) mantendo a posição relativa do utilizador.
    for (const k of defaults) {
      if (!valid.includes(k)) valid.push(k);
    }
    return valid;
  } catch {
    return defaults;
  }
}

export function App() {
  const [user, loading, error] = useAuthState(auth);
  const [tab, setTab] = useState<Tab>('today');
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuOrder, setMenuOrder] = useState<Tab[]>(loadMenuOrder);
  const [filters, setFilters] = useState<TaskFiltersState>(loadTaskFilters);
  const [projectFilters, setProjectFilters] = useState<ProjectFiltersState>(
    loadProjectFilters,
  );
  const [statsFilters, setStatsFilters] = useState<StatsFiltersState>(
    loadStatsFilters,
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

  useEffect(() => {
    localStorage.setItem(
      STATS_FILTERS_KEY,
      JSON.stringify(serializeStatsFiltersState(statsFilters)),
    );
  }, [statsFilters]);

  useEffect(() => {
    localStorage.setItem(MENU_ORDER_KEY, JSON.stringify(menuOrder));
  }, [menuOrder]);

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
    menuOrder={menuOrder}
    setMenuOrder={setMenuOrder}
    filters={filters}
    setFilters={setFilters}
    projectFilters={projectFilters}
    setProjectFilters={setProjectFilters}
    statsFilters={statsFilters}
    setStatsFilters={setStatsFilters}
  />;
}

function AppShell({
  uid,
  tab,
  setTab,
  menuOpen,
  setMenuOpen,
  menuOrder,
  setMenuOrder,
  filters,
  setFilters,
  projectFilters,
  setProjectFilters,
  statsFilters,
  setStatsFilters,
}: {
  uid: string;
  tab: Tab;
  setTab: (t: Tab) => void;
  menuOpen: boolean;
  setMenuOpen: (v: boolean) => void;
  menuOrder: Tab[];
  setMenuOrder: (order: Tab[]) => void;
  filters: TaskFiltersState;
  setFilters: (f: TaskFiltersState) => void;
  projectFilters: ProjectFiltersState;
  setProjectFilters: (f: ProjectFiltersState) => void;
  statsFilters: StatsFiltersState;
  setStatsFilters: (f: StatsFiltersState) => void;
}) {
  const data = useUserData(uid);
  const tasksScrollRef = useRef(0);
  const notesScrollRef = useRef(0);
  const projectsScrollRef = useRef(0);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedNoteTags, setSelectedNoteTags] = useState<string[]>([]);
  const [duelOpen, setDuelOpen] = useState(false);
  const [classifyOpen, setClassifyOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [taskSearchQuery, setTaskSearchQuery] = useState('');
  const [noteSearchQuery, setNoteSearchQuery] = useState('');
  const [shareDialog, setShareDialog] = useState<ShareTargetDialogState | null>(
    null,
  );

  useEffect(() => {
    setSearchOpen(false);
  }, [tab]);

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
    let cancelled = false;

    async function readCachePayload(): Promise<SharePayload | null> {
      if (sessionStorage.getItem('pendingShareFromCache') !== '1') return null;
      sessionStorage.removeItem('pendingShareFromCache');
      try {
        const res = await caches.match('/share-target/pending');
        if (!res) return null;
        const payload = (await res.json()) as SharePayload;
        const cache = await caches.open('share-target-v1');
        await cache.delete('/share-target/pending');
        return payload;
      } catch {
        return null;
      }
    }

    function readLegacyPayload(): SharePayload | null {
      const raw = sessionStorage.getItem('pendingShare');
      if (!raw) return null;
      sessionStorage.removeItem('pendingShare');
      try {
        const parsed = JSON.parse(raw) as Partial<SharePayload>;
        return {
          title: parsed.title ?? '',
          text: parsed.text ?? '',
          url: parsed.url ?? '',
          image: null,
        };
      } catch {
        return null;
      }
    }

    async function processShare() {
      const payload = (await readCachePayload()) ?? readLegacyPayload();
      if (!payload || cancelled) return;

      // Caminho 1: imagem — transcreve com Gemini e mostra escolha.
      if (payload.image) {
        setShareDialog({ status: 'loading' });
        try {
          const result = await transcribeImage({
            imageBase64: payload.image.data,
            mimeType: payload.image.mimeType,
          });
          if (cancelled) return;
          setShareDialog({
            status: 'choose',
            title: result.title || payload.title || '',
            text: result.text || payload.text || '',
          });
        } catch (e) {
          if (cancelled) return;
          setShareDialog({
            status: 'error',
            message: e instanceof Error ? e.message : String(e),
          });
        }
        return;
      }

      // Caminho 2: URL/texto — fluxo antigo (cria nota direto).
      const sharedUrl = payload.url || payload.text;
      if (!sharedUrl) return;

      let title = payload.title;
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

  async function createNoteFromShare(title: string, text: string) {
    const note = await createNote(uid);
    await patchNote(uid, note.id, { title, note: text });
    setShareDialog(null);
    setTab('notes');
    setSelectedNoteId(note.id);
  }

  async function createTaskFromShare(title: string, text: string) {
    const sectionId = pickDefaultProjectId(data.projects);
    if (!sectionId) return;
    const taskId = await nextTaskId(uid);
    const today = new Date().toISOString().slice(0, 10);
    const newTask: Task = {
      id: String(taskId),
      taskId,
      title: serializeTitle(title || '(sem título)', {
        taskId,
        modo: 'manual',
        moscow: '',
        esforco: '',
        deadline: '',
        addedDate: today,
        dependsOn: [],
      }),
      note: text,
      checked: false,
      inProgress: false,
      moscow: '',
      modo: 'manual',
      esforco: '',
      deadline: '',
      addedDate: today,
      dependsOn: [],
      subtasks: [],
      section: sectionId,
    };
    await upsertTask(uid, newTask);
    setShareDialog(null);
    setTab('tasks');
    setSelectedTaskId(String(taskId));
  }

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

  // Preserva a posição de scroll das listas (tarefas, notas, projetos) ao abrir
  // um detalhe ou mudar de aba.
  useEffect(() => {
    if (tab !== 'tasks' || selectedTaskId) return;
    return () => {
      tasksScrollRef.current = window.scrollY;
    };
  }, [tab, selectedTaskId]);

  useLayoutEffect(() => {
    if (tab === 'tasks' && !selectedTaskId) {
      window.scrollTo(0, tasksScrollRef.current);
    }
  }, [tab, selectedTaskId]);

  useEffect(() => {
    if (tab !== 'notes' || selectedNoteId) return;
    return () => {
      notesScrollRef.current = window.scrollY;
    };
  }, [tab, selectedNoteId]);

  useLayoutEffect(() => {
    if (tab === 'notes' && !selectedNoteId) {
      window.scrollTo(0, notesScrollRef.current);
    }
  }, [tab, selectedNoteId]);

  useEffect(() => {
    if (tab !== 'projects' || selectedProjectId) return;
    return () => {
      projectsScrollRef.current = window.scrollY;
    };
  }, [tab, selectedProjectId]);

  useLayoutEffect(() => {
    if (tab === 'projects' && !selectedProjectId) {
      window.scrollTo(0, projectsScrollRef.current);
    }
  }, [tab, selectedProjectId]);

  const selectedProjectTaskCount = useMemo(() => {
    if (!selectedProject) return 0;
    return data.tasks.filter((t) => t.section === selectedProject.id).length;
  }, [selectedProject, data.tasks]);

  const classifyCount = useMemo(
    () =>
      data.tasks.filter(
        (t) => !t.checked && (t.moscow === '' || t.esforco === ''),
      ).length,
    [data.tasks],
  );

  const orderedTabs = useMemo(() => {
    const byKey = new Map(TABS.map((t) => [t.key, t]));
    const ordered = menuOrder
      .map((k) => byKey.get(k))
      .filter((t): t is (typeof TABS)[number] => Boolean(t));
    // Acrescenta no fim qualquer separador ainda não na ordem (defesa em
    // profundidade — loadMenuOrder já trata disto).
    for (const t of TABS) {
      if (!ordered.find((o) => o.key === t.key)) ordered.push(t);
    }
    return ordered;
  }, [menuOrder]);

  const shareDialogEl = shareDialog ? (
    <ShareTargetDialog
      state={shareDialog}
      canCreateTask={pickDefaultProjectId(data.projects) !== null}
      onCreateTask={() => {
        if (shareDialog.status !== 'choose') return;
        void createTaskFromShare(shareDialog.title, shareDialog.text);
      }}
      onCreateNote={() => {
        if (shareDialog.status !== 'choose') return;
        void createNoteFromShare(shareDialog.title, shareDialog.text);
      }}
      onCancel={() => setShareDialog(null)}
    />
  ) : null;

  if (selectedNote) {
    return (
      <NoteNavigationContext.Provider value={noteNavValue}>
        <TaskNavigationContext.Provider value={taskNavValue}>
          <div className="app app--detail">
            <main role="main">
              <NoteDetailView
                uid={uid}
                note={selectedNote}
                allTags={allNoteTags}
                projects={data.projects}
                onConvertedToTask={(taskId) => {
                  setSelectedNoteId(null);
                  setTab('tasks');
                  setSelectedTaskId(taskId);
                }}
                onClose={() => setSelectedNoteId(null)}
              />
            </main>
            <UpdatePrompt />
            {shareDialogEl}
          </div>
        </TaskNavigationContext.Provider>
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
            {shareDialogEl}
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
            {shareDialogEl}
          </div>
        </ProjectNavigationContext.Provider>
      </TaskNavigationContext.Provider>
    );
  }

  if (classifyOpen) {
    return (
      <TaskNavigationContext.Provider value={taskNavValue}>
        <ProjectNavigationContext.Provider value={projectNavValue}>
          <div className="app app--detail">
            <main role="main">
              <ClassifyView
                uid={uid}
                tasks={data.tasks}
                onClose={() => setClassifyOpen(false)}
              />
            </main>
            <UpdatePrompt />
            {shareDialogEl}
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
            {shareDialogEl}
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
        {searchOpen && (tab === 'notes' || tab === 'tasks') ? (
          <SearchInput
            query={tab === 'notes' ? noteSearchQuery : taskSearchQuery}
            setQuery={tab === 'notes' ? setNoteSearchQuery : setTaskSearchQuery}
            onClose={() => setSearchOpen(false)}
            placeholder={
              tab === 'notes' ? 'Pesquisar anotações...' : 'Pesquisar tarefas...'
            }
          />
        ) : (
          <>
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
          {orderedTabs.find((t) => t.key === tab)?.label}
        </span>
        {tab === 'notes' && (
          <>
            <SearchToggle
              active={noteSearchQuery.length > 0}
              onClick={() => setSearchOpen(true)}
            />
            <NotesFiltersBar
              allTags={allNoteTags}
              selectedTags={selectedNoteTags}
              setSelectedTags={setSelectedNoteTags}
            />
          </>
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
            <SearchToggle
              active={taskSearchQuery.length > 0}
              onClick={() => setSearchOpen(true)}
            />
            <TaskFiltersBar
              state={filters}
              setState={setFilters}
              showHideZero={true}
              onOpenClassify={() => setClassifyOpen(true)}
              classifyCount={classifyCount}
            />
          </>
        )}
        {tab === 'stats' && (
          <StatsFiltersBar
            state={statsFilters}
            setState={setStatsFilters}
            projects={data.projects}
          />
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
          </>
        )}
      </header>

      <SidebarMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        items={orderedTabs}
        activeKey={tab}
        onSelect={(key) => setTab(key as Tab)}
        onReorder={(keys) => setMenuOrder(keys as Tab[])}
        onSignOut={signOutCurrent}
      />

      <main role="main">
        {tab === 'today' && (
          <TodayView
            uid={uid}
            tasks={data.tasks}
            projects={data.projects}
            projectMap={data.projectMap}
            ctx={data.ctx}
          />
        )}
        {tab === 'notes' && (
          <NotesView
            uid={uid}
            notes={notes}
            selectedTags={selectedNoteTags}
            searchQuery={noteSearchQuery}
          />
        )}
        {tab === 'tasks' && (
          <TasksRoot
            uid={uid}
            data={data}
            filters={filters}
            searchQuery={taskSearchQuery}
          />
        )}
        {tab === 'projects' && (
          <ProjectsView uid={uid} filters={projectFilters} />
        )}
        {tab === 'countdown' && <CountdownView uid={uid} />}
        {tab === 'stats' && (
          <EstatisticasView
            uid={uid}
            projects={data.projects}
            projectScoreMap={data.ctx.projectScoreMap}
            filters={statsFilters}
          />
        )}
        {tab === 'settings' && <SettingsView uid={uid} />}
      </main>

      <UpdatePrompt />
      {shareDialogEl}
    </div>
    </ProjectNavigationContext.Provider>
    </TaskNavigationContext.Provider>
    </NoteNavigationContext.Provider>
  );
}
