import type { Rules } from "../rules.js";
import type { WorldState } from "../types.js";

/**
 * Coalizione minima vincente (originale: FUN_ab78_0ced per il mondo, FUN_ab78_3692 per le regioni).
 *
 * I candidati, nell'ordine dato, sono ordinati per quota decrescente (bubble sort, come
 * l'originale). Se il primo supera `winMin` è un egemone. Altrimenti si cerca, con la stessa
 * ricerca "a contachilometri" dell'originale, la combinazione del numero minimo di candidati
 * la cui somma sta fra `winMin` e `winMax`, preferendo la somma più piccola. L'ordine della
 * ricerca conta: in alcuni casi dà un risultato diverso da una ricerca esaustiva.
 */
export function minimalWinningCoalition(
  candidates: { index: number; share: number }[],
  rules: Rules,
): number[] {
  const { winMin, winMax } = rules.coalition;
  const order = [...candidates];
  for (let pass = 0; pass < order.length; pass++) {
    for (let b = 0; b < order.length - 1; b++) {
      if (order[b + 1]!.share > order[b]!.share) [order[b], order[b + 1]] = [order[b + 1]!, order[b]!];
    }
  }
  const sh = order.map((c) => c.share);
  const n = sh.length;
  if (n === 0) return [];
  if (sh[0]! > winMin) return [order[0]!.index];

  let s = 0;
  let e = 0;
  while (e < n && s < winMin) s += sh[e++]!;
  if (s < winMin) return [];

  const k = e;
  const idx = Array.from({ length: k }, (_, j) => n - k + j);
  let best = winMax;
  let result: number[] = [];
  s = 0;
  for (let j = 0; j < k; j++) {
    while (s !== winMin) {
      if (s < winMin && idx[j]! > j) {
        s = idx.reduce((acc, x) => acc + sh[x]!, 0);
        if (s > winMin && s < winMax && s < best) {
          result = idx.map((x) => order[x]!.index);
          best = s;
        }
        idx[j]!--;
        continue;
      }
      if (s > winMin && s < winMax) {
        idx[j]!++;
        s -= sh[idx[j]!]!;
      }
      break;
    }
    if (s === winMin) break;
  }
  return result;
}

/** Coalizione mondiale fra le grandi potenze (quota militare >= soglia), quote normalizzate. */
export function computeWorldCoalition(w: WorldState, rules: Rules): void {
  const gp = w.countries
    .map((c, index) => ({ index, share: c.milShare }))
    .filter((c) => c.share >= rules.coalition.candidateMin)
    .slice(0, rules.coalition.maxCandidates);
  const tot = gp.reduce((s, c) => s + c.share, 0);
  w.coalition = minimalWinningCoalition(
    gp.map((c) => ({ index: c.index, share: (100 * c.share) / tot })),
    rules,
  );
}
