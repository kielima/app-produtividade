/**
 * Score do projeto (0..3) derivado da posição manual na aba Projetos.
 *
 * Usa a inversa da CDF normal padrão (probit) reescalonada linearmente
 * para [0, 3], ancorando o topo da lista em 3 e o fundo em 0. Assim a
 * maioria dos projetos do meio do ranking fica próxima de 1.5 e só os
 * extremos atingem os valores máximos — distribuição gaussiana.
 *
 * Casos especiais:
 *   - 0 projetos: retorna mapa vazio.
 *   - 1 projeto:  recebe 3 (único, sempre prioridade máxima).
 *   - N ≥ 2:      aplica a curva probit normalizada.
 */

// Acklam (2003) — aproximação racional da inversa da CDF normal padrão.
// Precisão ~1e-9 no intervalo (0,1).
function inverseNormalCDF(p: number): number {
  if (p <= 0 || p >= 1) {
    throw new RangeError(`p must be in (0,1), got ${p}`);
  }
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.38357751867269e2, -3.066479806614716e1, 2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783,
  ];
  const d = [
    7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
    3.754408661907416,
  ];
  const pLow = 0.02425;
  const pHigh = 1 - pLow;

  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1)
    );
  }
  if (p <= pHigh) {
    const q = p - 0.5;
    const r = q * q;
    return (
      ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) /
      (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1)
    );
  }
  const q = Math.sqrt(-2 * Math.log(1 - p));
  return (
    -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
    ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1)
  );
}

/**
 * Mapeia projetos já ordenados (índice 0 = maior prioridade) para o
 * score derivado da curva. Não reordena: confia na ordem recebida.
 */
export function buildProjectScoreMap(
  orderedProjects: ReadonlyArray<{ id: string }>,
): Record<string, number> {
  const total = orderedProjects.length;
  const out: Record<string, number> = {};
  if (total === 0) return out;
  if (total === 1) {
    out[orderedProjects[0]!.id] = 3;
    return out;
  }
  const z = (rank: number) => inverseNormalCDF((total - rank + 0.5) / total);
  const zMax = z(1);
  const zMin = z(total);
  const range = zMax - zMin;
  orderedProjects.forEach((p, idx) => {
    const rank = idx + 1;
    out[p.id] = (3 * (z(rank) - zMin)) / range;
  });
  return out;
}
