// Regra de "isto é um conflito?" isolada como função pura para ter uma única
// fonte de verdade usada tanto pelo autosave quanto por um eventual botão
// manual de "verificar atualizações" — evita duas implementações do mesmo
// critério divergindo com o tempo.
export function hasConflict(loadedModifiedTime: string, currentModifiedTime: string): boolean {
  return loadedModifiedTime !== currentModifiedTime;
}
