import { useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from './supabase';

export interface SessionUser {
  uid: string;
  email?: string;
  // Vem de user_metadata (o provider Google preenche full_name/name/avatar_url).
  displayName?: string;
  photoURL?: string;
}

function toSessionUser(user: User | null | undefined): SessionUser | null {
  if (!user) return null;
  const meta = user.user_metadata ?? {};
  return {
    uid: user.id,
    email: user.email ?? undefined,
    displayName: (meta.full_name as string | undefined) ?? (meta.name as string | undefined),
    photoURL: meta.avatar_url as string | undefined,
  };
}

/**
 * Substitui `useAuthState(auth)` do `react-firebase-hooks`: mesma tupla
 * `[user, loading, error]`, mas em cima da sessão do Supabase Auth.
 */
export function useSupabaseUser(): [SessionUser | null | undefined, boolean, Error | null] {
  const [user, setUser] = useState<SessionUser | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;

    void supabase.auth.getSession().then(({ data, error: err }) => {
      if (cancelled) return;
      if (err) setError(err);
      setUser(toSessionUser(data.session?.user));
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return;
      setUser(toSessionUser(session?.user));
      setLoading(false);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  return [user, loading, error];
}
