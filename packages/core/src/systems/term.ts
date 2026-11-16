import type { Rng } from "../rng.js";

/**
 * Mandato del presidente: elezioni ogni quattro anni e destituzione per impopolarità (ciclo
 * principale dell'originale, overlay 44: FUN_5000_0c7f per i giorni alle elezioni, la sequenza
 * elettorale FUN_77a0_4918, il controllo "Popularity has just fallen below 15%").
 */

/** Giorno (dall'1/1/1970 UTC) delle elezioni presidenziali di un anno: primo martedì dopo il primo lunedì di novembre. */
export function electionDay(year: number): number {
  const nov1 = Date.UTC(year, 10, 1) / 86_400_000;
  const weekday = new Date(nov1 * 86_400_000).getUTCDay();   // 0 domenica
  const firstMonday = nov1 + ((8 - weekday) % 7);
  return firstMonday + 1;
}

/** Prossimo giorno di elezioni a partire da `day` compreso (anni multipli di 4, come dal 1988). */
export function nextElection(day: number): number {
  let year = new Date(day * 86_400_000).getUTCFullYear();
  year += (4 - (year % 4)) % 4;
  if (electionDay(year) < day) year += 4;
  return electionDay(year);
}

/**
 * Esito delle elezioni (5000:0f76–1018): con popolarità ≥ 50 si vince, sotto 40 si perde, in
 * mezzo si perde se rand(1,100) > (popolarità − 40)·10.
 */
export function holdElection(rng: Rng, popularity: number): boolean {
  if (popularity >= 50) return true;
  if (popularity < 40) return false;
  return rng.int(1, 100) <= (popularity - 40) * 10;
}

/**
 * Controllo dell'impopolarità (5000:121e–13f9), quando la popolarità è sotto il 15%: con
 * probabilità (100 − 3·popolarità)% il presidente cade. Poi, se rand(1,100) > 15·x +
 * popolarità + 5, viene assassinato (FUN_77a0_2381), altrimenti destituito (FUN_77a0_2d83).
 * ◇ x è una variabile non identificata con certezza: qui il LER.
 */
export function unpopularityCheck(rng: Rng, popularity: number, ler: number): "killed" | "ousted" | null {
  if (popularity >= 15) return null;
  if (100 - popularity * 3 <= rng.int(1, 100)) return null;
  return rng.int(1, 100) > ler * 15 + popularity + 5 ? "killed" : "ousted";
}

/** Mandati completi dopo i quali la partita è vinta ("You have served 25 full terms!"). */
export const MAX_TERMS = 25;
