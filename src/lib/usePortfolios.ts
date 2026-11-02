import { useEffect, useState } from 'react';
import { subscribeToPortfolios } from '../repositories/portfoliosRepo';
import type { Portfolio } from '../types';

/** Lista viva dos portfólios do usuário (aba Portfólios e página do projeto). */
export function usePortfolios(uid: string): { portfolios: Portfolio[]; loaded: boolean } {
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    setLoaded(false);
    return subscribeToPortfolios(
      uid,
      (next) => {
        setPortfolios(next);
        setLoaded(true);
      },
      (err) => console.error('Falha ao carregar portfólios', err),
    );
  }, [uid]);
  return { portfolios, loaded };
}
