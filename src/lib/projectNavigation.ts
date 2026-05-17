import { createContext, useContext } from 'react';

interface ProjectNavigation {
  openProject: (projectId: string) => void;
}

export const ProjectNavigationContext = createContext<ProjectNavigation | null>(null);

export function useProjectNavigation(): ProjectNavigation {
  const ctx = useContext(ProjectNavigationContext);
  if (!ctx) {
    throw new Error('useProjectNavigation must be used within ProjectNavigationContext');
  }
  return ctx;
}
