import { useEffect, useRef, useState } from 'react';
import { serializeTitle } from '../lib/parser';
import { useNoteNavigation } from '../lib/noteNavigation';
import { useTaskNavigation } from '../lib/taskNavigation';
import { createNote } from '../repositories/notesRepo';
import { nextTaskId, upsertTask } from '../repositories/tasksRepo';
import type { Project, Task } from '../types';
import { NewEventForm } from './NewEventForm';

function isHiddenProject(p: Project): boolean {
  return p.status === 'Concluído' || p.status === 'Cancelado';
}

export function TodayFab({
  uid,
  projects,
  defaultProjectId = '',
  onNeedEventAuth,
  onEventCreated,
}: {
  uid: string;
  projects: Project[];
  defaultProjectId?: string;
  onNeedEventAuth: () => void;
  onEventCreated?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [showEventForm, setShowEventForm] = useState(false);
  const [creatingTask, setCreatingTask] = useState(false);
  const [creatingNote, setCreatingNote] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const { openTask } = useTaskNavigation();
  const { openNote } = useNoteNavigation();

  const availableProjects = projects.filter((p) => !isHiddenProject(p));
  const taskDisabled = creatingTask || availableProjects.length === 0;

  // Fecha o dial ao apertar Escape ou clicar fora. Ignora cliques fora
  // enquanto o modal de evento (que é position:fixed, fora do container) está
  // aberto — ele tem o próprio tratamento de fechar.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    function onPointerDown(e: PointerEvent) {
      if (showEventForm) return;
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open, showEventForm]);

  async function handleNewTask() {
    if (taskDisabled) return;
    const sectionId =
      defaultProjectId && availableProjects.some((p) => p.id === defaultProjectId)
        ? defaultProjectId
        : availableProjects[0]!.id;
    setCreatingTask(true);
    setOpen(false);
    try {
      const taskId = await nextTaskId(uid);
      const today = new Date().toISOString().slice(0, 10);
      const newTask: Task = {
        id: String(taskId),
        taskId,
        title: serializeTitle('', {
          taskId,
          modo: 'manual',
          moscow: '',
          esforco: '',
          deadline: '',
          addedDate: today,
          dependsOn: [],
        }),
        note: '',
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
        completedAt: null,
      };
      await upsertTask(uid, newTask);
      openTask(String(taskId));
    } finally {
      setCreatingTask(false);
    }
  }

  async function handleNewNote() {
    if (creatingNote) return;
    setCreatingNote(true);
    setOpen(false);
    try {
      const note = await createNote(uid);
      openNote(note.id);
    } finally {
      setCreatingNote(false);
    }
  }

  function handleNewEvent() {
    setOpen(false);
    setShowEventForm(true);
  }

  return (
    <div className="speed-dial" ref={containerRef}>
      <div className={`speed-dial-actions${open ? ' is-open' : ''}`}>
        <button
          type="button"
          className="speed-dial-mini"
          onClick={handleNewTask}
          disabled={taskDisabled}
          tabIndex={open ? 0 : -1}
          aria-hidden={!open}
          aria-label="adicionar tarefa"
          title={
            availableProjects.length === 0
              ? 'Crie um projeto antes de adicionar uma tarefa'
              : 'adicionar tarefa'
          }
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M9 11l3 3L22 4" />
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
          </svg>
        </button>

        <button
          type="button"
          className="speed-dial-mini"
          onClick={handleNewNote}
          disabled={creatingNote}
          tabIndex={open ? 0 : -1}
          aria-hidden={!open}
          aria-label="adicionar anotação"
          title="adicionar anotação"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <path d="M14 2v6h6" />
            <path d="M8 13h8" />
            <path d="M8 17h6" />
          </svg>
        </button>

        <button
          type="button"
          className="speed-dial-mini"
          onClick={handleNewEvent}
          tabIndex={open ? 0 : -1}
          aria-hidden={!open}
          aria-label="adicionar evento na agenda"
          title="adicionar evento na agenda"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <line x1="16" x2="16" y1="2" y2="6" />
            <line x1="8" x2="8" y1="2" y2="6" />
            <line x1="3" x2="21" y1="10" y2="10" />
          </svg>
        </button>
      </div>

      <button
        type="button"
        className="fab speed-dial-main"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={open ? 'fechar menu de criação' : 'criar novo item'}
        title="criar novo item"
      >
        <svg
          className="speed-dial-plus"
          width="20"
          height="20"
          viewBox="0 0 20 20"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M10 3v14M3 10h14"
            stroke="white"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        </svg>
      </button>

      {showEventForm && (
        <NewEventForm
          uid={uid}
          onClose={() => setShowEventForm(false)}
          onCreated={() => {
            setShowEventForm(false);
            onEventCreated?.();
          }}
          onNeedsAuth={() => {
            setShowEventForm(false);
            onNeedEventAuth();
          }}
        />
      )}
    </div>
  );
}
