import { createContext, useContext } from 'react';

interface TaskNavigation {
  openTask: (taskId: string) => void;
}

export const TaskNavigationContext = createContext<TaskNavigation | null>(null);

export function useTaskNavigation(): TaskNavigation {
  const ctx = useContext(TaskNavigationContext);
  if (!ctx) {
    throw new Error('useTaskNavigation must be used within TaskNavigationContext');
  }
  return ctx;
}
