import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useAuthState } from 'react-firebase-hooks/auth';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
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
import { isTopLevel } from './lib/taskHierarchy';
import { auth } from './lib/firebase';
import { NotesFiltersBar } from './components/NotesFiltersBar';
import {
  LeituraFiltersBar,
  loadReadingFilters,
  saveReadingFilters,
  type ReadingFiltersState,
} from './components/LeituraFiltersBar';
import { SearchInput, SearchToggle } from './components/SearchBar';
import { NoteNavigationContext } from './lib/noteNavigation';
import { ProjectNavigationContext } from './lib/projectNavigation';
import { TaskNavigationContext } from './lib/taskNavigation';
import { ReadingNavigationContext } from './lib/readingNavigation';
import { useUserData } from './lib/useUserData';
import { ProjectDetailView } from './views/ProjectDetailView';
import { ProjectDuelView } from './views/ProjectDuelView';
import { ProjectsView } from './views/ProjectsView';
import { SettingsView } from './views/SettingsView';
import { TaskDetailView } from './views/TaskDetailView';
import { NoteDetailView } from './views/NoteDetailView';
import { NotesView } from './views/NotesView';
// Carregado sob demanda: arrasta o pdf.js (~1,3 MB) só quando a aba Leitura abre.
const LeituraView = lazy(() =>
  import('./views/LeituraView').then((m) => ({ default: m.LeituraView })),
);
// Carregado sob demanda: arrasta o CodeMirror só quando a aba Obsidian abre.
const ObsidianView = lazy(() =>
  import('./views/ObsidianView').then((m) => ({ default: m.ObsidianView })),
);
import {
  hasEverConnectedCalendar,
  startCalendarTokenScheduler,
  stopCalendarTokenScheduler,
} from './lib/googleCalendar';
import { createProject } from './repositories/projectsRepo';
import { createNote, patchNote, subscribeToNotes } from './repositories/notesRepo';
import { transcribeImage } from './lib/aiTranscribe';
import {
  createNoteFromText,
  createTaskFromText,
  pickDefaultProjectId,
} from './lib/createFromText';
import { hasLink, hasList, LINK_TAG, LIST_TAG, normalizeTags } from './lib/tags';
import { TasksRoot } from './views/TasksRoot';
import { ClassifyView } from './views/ClassifyView';
import { CountdownView } from './views/CountdownView';
import { EstatisticasView } from './views/EstatisticasView';
import { TodayView } from './views/TodayView';
import type { Note } from './types';

const TASK_FILTERS_KEY = 'app-produtividade:task-filters';
const PROJECT_FILTERS_KEY = 'app-produtividade:project-filters';
const STATS_FILTERS_KEY = 'app-produtividade:stats-filters';
const MENU_ORDER_KEY = 'app-produtividade:menu-order';
const NAV_TAB_KEY = 'app-produtividade:nav-tab';

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
  title?: string;
  text?: string;
  url?: string;
  image?: { data: string; mimeType: string } | null;
  error?: string;
}

type Tab =
  | 'today'
  | 'notes'
  | 'leitura'
  | 'obsidian'
  | 'tasks'
  | 'projects'
  | 'countdown'
  | 'stats'
  | 'settings';

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'today', label: 'Hoje' },
  { key: 'notes', label: 'Keep' },
  { key: 'leitura', label: 'Leitura' },
  { key: 'obsidian', label: 'Obsidian' },
  { key: 'tasks', label: 'Tasks' },
  { key: 'projects', label: 'Projetos' },
  { key: 'countdown', label: 'Agenda' },
  { key: 'stats', label: 'Estatísticas' },
  { key: 'settings', label: 'Configurações' },
];

function loadInitialTab(): Tab {
  try {
    const raw = localStorage.getItem(NAV_TAB_KEY);
    if (!raw) return 'today';
    const value = JSON.parse(raw);
    if (typeof value === 'string' && TABS.some((t) => t.key === value)) {
      return value as Tab;
    }
  } catch {
    // ignora — usa o default
  }
  return 'today';
}

type NavSnapshot = {
  tab: Tab;
  taskId: string | null;
  projectId: string | null;
  noteId: string | null;
  duel: boolean;
  classify: boolean;
};

function snapshotsEqual(a: NavSnapshot, b: NavSnapshot): boolean {
  return (
    a.tab === b.tab &&
    a.taskId === b.taskId &&
    a.projectId === b.projectId &&
    a.noteId === b.noteId &&
    a.duel === b.duel &&
    a.classify === b.classify
  );
}

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
  const [tab, setTab] = useState<Tab>(loadInitialTab);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuOrder, setMenuOrder] = useState<Tab[]>(loadMenuOrder);
  const [filters, setFilters] = useState<TaskFiltersState>(loadTaskFilters);
  const [projectFilters, setProjectFilters] = useState<ProjectFiltersState>(
    loadProjectFilters,
  );
  const [statsFilters, setStatsFilters] = useState<StatsFiltersState>(
    loadStatsFilters,
  );

  // No APK, o botão físico/gesto de voltar do Android por padrão apenas
  // fecha o app (o Capacitor só delega pro histórico do WebView quando um
  // listener 'backButton' está registrado). Aqui delegamos pro histórico da
  // SPA — o mesmo `history.back()` que os botões "fechar" já usam — e só
  // minimizamos o app quando não há mais pra onde voltar.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const listenerPromise = CapacitorApp.addListener(
      'backButton',
      ({ canGoBack }) => {
        if (canGoBack) {
          window.history.back();
        } else {
          CapacitorApp.minimizeApp();
        }
      },
    );
    return () => {
      listenerPromise.then((handle) => handle.remove());
    };
  }, []);

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

  // Persiste a aba ativa pra sobreviver a pull-to-refresh / reload do PWA.
  useEffect(() => {
    localStorage.setItem(NAV_TAB_KEY, JSON.stringify(tab));
  }, [tab]);

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
  // Vínculo tarefa/nota → PDF: item + anotação a abrir ao entrar na aba
  // Leitura (ver `useReadingNavigation`/`LeituraView`).
  const [pendingReadingTarget, setPendingReadingTarget] = useState<{
    itemId: string;
    annotationId: string;
  } | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedNoteTags, setSelectedNoteTags] = useState<string[]>([]);
  const [noteProjectFilter, setNoteProjectFilter] = useState<string | null>(null);
  const [duelOpen, setDuelOpen] = useState(false);
  const [classifyOpen, setClassifyOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [taskSearchQuery, setTaskSearchQuery] = useState('');
  const [noteSearchQuery, setNoteSearchQuery] = useState('');
  const [projectSearchQuery, setProjectSearchQuery] = useState('');
  const [readingFilters, setReadingFilters] =
    useState<ReadingFiltersState>(loadReadingFilters);
  const [readingOptions, setReadingOptions] = useState<{
    authors: string[];
    tags: string[];
    types: string[];
  }>({ authors: [], tags: [], types: [] });
  const [shareDialog, setShareDialog] = useState<ShareTargetDialogState | null>(
    null,
  );

  // Sincroniza a navegação (aba + detalhes) com o history do browser pra que
  // o gesto/botão de voltar do Android navegue para o estado anterior em vez
  // de fechar o PWA. Cada mudança "para a frente" empurra uma entrada; o
  // popstate restaura o snapshot guardado. As refs separam estes três casos:
  //  - isPoppingHistoryRef: a mudança vem do próprio popstate → não empurrar
  //  - skipHistorySyncRef:  limpeza defensiva (item apagado) → não empurrar
  //  - navInitializedRef:   só sincroniza depois do replaceState inicial
  const navSnapshot = useMemo<NavSnapshot>(
    () => ({
      tab,
      taskId: selectedTaskId,
      projectId: selectedProjectId,
      noteId: selectedNoteId,
      duel: duelOpen,
      classify: classifyOpen,
    }),
    [tab, selectedTaskId, selectedProjectId, selectedNoteId, duelOpen, classifyOpen],
  );
  const isPoppingHistoryRef = useRef(false);
  const skipHistorySyncRef = useRef(false);
  const navInitializedRef = useRef(false);

  useLayoutEffect(() => {
    if (navInitializedRef.current) return;
    navInitializedRef.current = true;
    window.history.replaceState(
      { ...(window.history.state ?? {}), appNav: navSnapshot },
      '',
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!navInitializedRef.current) return;
    if (isPoppingHistoryRef.current) {
      isPoppingHistoryRef.current = false;
      return;
    }
    if (skipHistorySyncRef.current) {
      skipHistorySyncRef.current = false;
      return;
    }
    const current = (window.history.state?.appNav ?? null) as NavSnapshot | null;
    if (current && snapshotsEqual(current, navSnapshot)) return;
    window.history.pushState(
      { ...(window.history.state ?? {}), appNav: navSnapshot },
      '',
    );
  }, [navSnapshot]);

  useEffect(() => {
    function onPop(e: PopStateEvent) {
      const snap = (e.state?.appNav ?? null) as NavSnapshot | null;
      if (!snap) return;
      isPoppingHistoryRef.current = true;
      setTab(snap.tab);
      setSelectedTaskId(snap.taskId);
      setSelectedProjectId(snap.projectId);
      setSelectedNoteId(snap.noteId);
      setDuelOpen(snap.duel);
      setClassifyOpen(snap.classify);
      // Fecha overlays (menu/pesquisa) em qualquer back — evita ficarem
      // sobrepostos ao conteúdo da aba restaurada.
      setMenuOpen(false);
      setSearchOpen(false);
    }
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [setTab, setMenuOpen]);

  // Helper para os botões "fechar" dos detalhes: delega no history para que
  // o popstate restaure o estado anterior — assim o botão e o gesto Android
  // têm o mesmo efeito (e não criam uma entrada futura "vazia").
  const goBack = useCallback(() => {
    window.history.back();
  }, []);

  useEffect(() => {
    setSearchOpen(false);
  }, [tab]);

  useEffect(() => {
    const unsub = subscribeToNotes(uid, setNotes);
    return unsub;
  }, [uid]);

  useEffect(() => saveReadingFilters(readingFilters), [readingFilters]);

  // Mantém o token do Google Calendar quente em background: o scheduler
  // refresca silenciosamente ~30min antes da expiração, evitando que o
  // usuário precise reconectar durante o uso. Roda mesmo quando a aba
  // Countdown não está montada.
  useEffect(() => {
    if (hasEverConnectedCalendar()) {
      startCalendarTokenScheduler(uid);
    }
    return () => {
      stopCalendarTokenScheduler();
    };
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
      // O SW responde com redirect imediato e processa o body em background,
      // então o cache pode ainda não existir ao chegar aqui. Polling curto.
      const DEADLINE_MS = 10_000;
      const start = Date.now();
      try {
        while (!cancelled && Date.now() - start < DEADLINE_MS) {
          const res = await caches.match('/share-target/pending');
          if (res) {
            const payload = (await res.json()) as SharePayload;
            const cache = await caches.open('share-target-v1');
            await cache.delete('/share-target/pending');
            return payload;
          }
          await new Promise((r) => setTimeout(r, 300));
        }
      } catch {
        // ignora — segue pro fallback legacy
      }
      return null;
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

      // O SW grava `{ error }` quando falha a ler o body do POST.
      if (payload.error) {
        setShareDialog({ status: 'error', message: payload.error });
        return;
      }

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
    const noteId = await createNoteFromText(uid, title, text);
    setShareDialog(null);
    setTab('notes');
    setSelectedNoteId(noteId);
  }

  async function createTaskFromShare(title: string, text: string) {
    const taskId = await createTaskFromText(uid, data.projects, title, text);
    if (!taskId) return;
    setShareDialog(null);
    setTab('tasks');
    setSelectedTaskId(taskId);
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
  const readingNavValue = useMemo(
    () => ({
      openAnnotation: (itemId: string, annotationId: string) => {
        setSelectedTaskId(null);
        setSelectedNoteId(null);
        setPendingReadingTarget({ itemId, annotationId });
        setTab('leitura');
      },
    }),
    [setTab],
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
      skipHistorySyncRef.current = true;
      setSelectedTaskId(null);
    }
  }, [selectedTaskId, selectedTask, data.tasks.length]);

  useEffect(() => {
    if (selectedProjectId && !selectedProject && data.projects.length > 0) {
      skipHistorySyncRef.current = true;
      setSelectedProjectId(null);
    }
  }, [selectedProjectId, selectedProject, data.projects.length]);

  useEffect(() => {
    if (selectedNoteId && !selectedNote && notes.length > 0) {
      skipHistorySyncRef.current = true;
      setSelectedNoteId(null);
    }
  }, [selectedNoteId, selectedNote, notes.length]);

  // Preserva a posição de scroll das listas (tarefas, notas, projetos) ao abrir
  // um detalhe ou mudar de aba. O listener mantém o ref atualizado enquanto a
  // lista está visível; ao sair, o cleanup remove o listener antes do browser
  // poder fazer clamp do scrollY (perdendo o valor). Ao reentrar, o scroll é
  // restaurado antes da pintura via useLayoutEffect.
  useLayoutEffect(() => {
    if (tab !== 'tasks' || selectedTaskId) return;
    window.scrollTo(0, tasksScrollRef.current);
    const onScroll = () => {
      tasksScrollRef.current = window.scrollY;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [tab, selectedTaskId]);

  useLayoutEffect(() => {
    if (tab !== 'notes' || selectedNoteId) return;
    window.scrollTo(0, notesScrollRef.current);
    const onScroll = () => {
      notesScrollRef.current = window.scrollY;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [tab, selectedNoteId]);

  useLayoutEffect(() => {
    if (tab !== 'projects' || selectedProjectId) return;
    window.scrollTo(0, projectsScrollRef.current);
    const onScroll = () => {
      projectsScrollRef.current = window.scrollY;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [tab, selectedProjectId]);

  const selectedProjectTaskCount = useMemo(() => {
    if (!selectedProject) return 0;
    return data.tasks.filter(
      (t) => t.section === selectedProject.id && isTopLevel(t, data.tasks),
    ).length;
  }, [selectedProject, data.tasks]);

  const selectedProjectNotes = useMemo(() => {
    if (!selectedProject) return [];
    return notes.filter((n) => n.projectId === selectedProject.id);
  }, [selectedProject, notes]);

  const classifyCount = useMemo(
    () =>
      data.tasks.filter(
        (t) =>
          !t.checked && isTopLevel(t, data.tasks) && (t.moscow === '' || t.esforco === ''),
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
      <ReadingNavigationContext.Provider value={readingNavValue}>
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
                  onClose={goBack}
                />
              </main>
              <UpdatePrompt />
              {shareDialogEl}
            </div>
          </TaskNavigationContext.Provider>
        </NoteNavigationContext.Provider>
      </ReadingNavigationContext.Provider>
    );
  }

  if (selectedTask) {
    return (
      <ReadingNavigationContext.Provider value={readingNavValue}>
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
                  onClose={goBack}
                />
              </main>
              <UpdatePrompt />
              {shareDialogEl}
            </div>
          </ProjectNavigationContext.Provider>
        </TaskNavigationContext.Provider>
      </ReadingNavigationContext.Provider>
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
                onClose={goBack}
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
                projects={data.projects}
                onClose={goBack}
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
      <NoteNavigationContext.Provider value={noteNavValue}>
      <TaskNavigationContext.Provider value={taskNavValue}>
        <ProjectNavigationContext.Provider value={projectNavValue}>
          <div className="app app--detail">
            <main role="main">
              <ProjectDetailView
                uid={uid}
                project={selectedProject}
                allProjects={data.projects}
                taskCount={selectedProjectTaskCount}
                score={data.ctx.projectScoreMap[selectedProject.id]}
                notes={selectedProjectNotes}
                onClose={goBack}
              />
            </main>
            <UpdatePrompt />
            {shareDialogEl}
          </div>
        </ProjectNavigationContext.Provider>
      </TaskNavigationContext.Provider>
      </NoteNavigationContext.Provider>
    );
  }

  return (
    <NoteNavigationContext.Provider value={noteNavValue}>
    <TaskNavigationContext.Provider value={taskNavValue}>
    <ProjectNavigationContext.Provider value={projectNavValue}>
    <div className={`app${tab === 'notes' ? ' app--notes' : ''}`}>
      <header
        className="topbar"
        role="banner"
      >
        {searchOpen &&
        (tab === 'notes' || tab === 'tasks' || tab === 'leitura' || tab === 'projects') ? (
          <SearchInput
            query={
              tab === 'notes'
                ? noteSearchQuery
                : tab === 'tasks'
                  ? taskSearchQuery
                  : tab === 'projects'
                    ? projectSearchQuery
                    : readingFilters.search
            }
            setQuery={
              tab === 'notes'
                ? setNoteSearchQuery
                : tab === 'tasks'
                  ? setTaskSearchQuery
                  : tab === 'projects'
                    ? setProjectSearchQuery
                    : (q) => setReadingFilters({ ...readingFilters, search: q })
            }
            onClose={() => setSearchOpen(false)}
            placeholder={
              tab === 'notes'
                ? 'Pesquisar anotações...'
                : tab === 'tasks'
                  ? 'Pesquisar tarefas...'
                  : tab === 'projects'
                    ? 'Pesquisar projetos...'
                    : 'Pesquisar título, autor, DOI…'
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
              searchQuery={noteSearchQuery}
              onClearSearch={() => setNoteSearchQuery('')}
              projects={data.projects}
              projectFilter={noteProjectFilter}
              setProjectFilter={setNoteProjectFilter}
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
              searchQuery={taskSearchQuery}
              onClearSearch={() => setTaskSearchQuery('')}
            />
          </>
        )}
        {tab === 'leitura' && (
          <>
            <SearchToggle
              active={readingFilters.search.length > 0}
              onClick={() => setSearchOpen(true)}
            />
            <LeituraFiltersBar
              state={readingFilters}
              setState={setReadingFilters}
              allAuthors={readingOptions.authors}
              allTags={readingOptions.tags}
              allTypes={readingOptions.types}
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
            <SearchToggle
              active={projectSearchQuery.length > 0}
              onClick={() => setSearchOpen(true)}
            />
            <ProjectFiltersBar
              state={projectFilters}
              setState={setProjectFilters}
              searchQuery={projectSearchQuery}
              onClearSearch={() => setProjectSearchQuery('')}
            />
          </>
        )}
        {tab === 'obsidian' && (
          // Alvo do portal renderizado por ObsidianView — mantém o estado
          // (modo árvore/grafo, busca) local à própria view em vez de subir
          // pra cá, já que depende do hook do vault (useObsidianVault), que
          // não deveria rodar antes do usuário sequer abrir esta aba.
          <div id="obsidian-topbar-slot" className="obsidian-topbar-slot" />
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
            onCreateEventNeedsAuth={() => setTab('countdown')}
          />
        )}
        {tab === 'notes' && (
          <NotesView
            uid={uid}
            notes={notes}
            selectedTags={selectedNoteTags}
            searchQuery={noteSearchQuery}
            projectFilter={noteProjectFilter}
            projects={data.projects}
          />
        )}
        {tab === 'leitura' && (
          <Suspense fallback={<p className="reader-status">Carregando…</p>}>
            <LeituraView
              uid={uid}
              projects={data.projects}
              filters={readingFilters}
              onOptionsChange={setReadingOptions}
              pendingTarget={pendingReadingTarget}
              onPendingTargetHandled={() => setPendingReadingTarget(null)}
            />
          </Suspense>
        )}
        {tab === 'obsidian' && (
          <Suspense fallback={<p className="reader-status">Carregando…</p>}>
            <ObsidianView uid={uid} />
          </Suspense>
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
          <ProjectsView
            uid={uid}
            filters={projectFilters}
            searchQuery={projectSearchQuery}
          />
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
