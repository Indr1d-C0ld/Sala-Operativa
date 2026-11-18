import type { Rng } from "../rng.js";
import type { Rules } from "../rules.js";
import type { WorldState } from "../types.js";

/**
 * Ritorsioni (originale: FUN_976b_044d, messa in coda da FUN_976b_0ef2). Chi subisce un'azione
 * risponde, sempre se l'azione è riuscita e con probabilità `failureChance`% se è fallita; con
 * lui risponde il leader della sua squadra, con l'etica e l'ambizione del paese colpito. Non
 * scatta se il bersaglio è il giocatore (decide lui) né dopo un attacco nucleare (che ha le sue
 * ritorsioni).
 *
 * La risposta viene da APPACT.FIL: per il codice subito, la riga trunc(gravità + ambizione/4 −
 * etica) fra 0 e 2 e una delle sue cinque risposte a caso. Poi i filtri dell'originale:
 *  - l'atomica solo con livello nucleare ≥ 4;
 *  - attacco, invasione e truppe da un paese di quota militare < 2,3 solo contro un confinante;
 *  - se rand(1,2) < ambizione la risposta si riduce a una condanna (per le azioni ostili) o a
 *    niente: i paesi ambiziosi protestano, gli altri rispondono davvero;
 *  - la condanna resta solo se rand(0,8) ≥ etica, lo spionaggio solo se rand(0,8) ≤ ambizione;
 *  - commercio e spionaggio solo da un donatore.
 * ◇ Manca il tiro di deterrenza dei paesi poco ambiziosi protetti dalle truppe del leader della
 * loro squadra (044d:06dd–0dbb, non trascritto).
 */
const HOSTILE = new Set([6, 11, 14, 15, 16, 20, 21, 24, 25]);

/**
 * Risposta di `responder` a `code` subito da `against`, o null. `like` è il paese di cui si
 * usano etica, ambizione e livello nucleare (il colpito, quando risponde il leader della squadra).
 */
export function retaliation(
  w: WorldState, rules: Rules, rng: Rng, responder: number, against: number, code: number, like = responder,
): number | null {
  const R = w.countries[responder]!;
  const L = w.countries[like]!;
  const table = rules.retaliation.responses[code];
  if (!table) return null;
  const g = rules.retaliation.gravity[code] ?? 2;
  const row = Math.min(Math.max(Math.trunc(g + L.ambition / 4 - L.ethic), 0), 2);
  let r: number | null = table[row]![rng.int(0, 4)]!;
  if (r < 0) return null;
  if (r === 24 && L.nucLevel < 4) return null;
  if ((r === 20 || r === 21 || r === 25) && R.milShare < 2.3 && !(w.neighbours[responder] ?? []).includes(against)) return null;
  if (rng.int(1, 2) < L.ambition) r = HOSTILE.has(r) ? 6 : null;
  if (r === null) return null;
  if (r === 6 && rng.int(0, 8) < L.ethic) return null;
  if (r === 13 && rng.int(0, 8) > L.ambition) return null;
  if (((r >= 8 && r <= 11) || r === 13) && !w.donors.includes(responder)) return null;
  return r;
}

/**
 * Popolarità del giocatore per un'operazione coperta scoperta dalla stampa (c638), secondo
 * l'affinità con il bersaglio (`aff`: 1 nemico, 2 neutrale, 4 amico, 5 stessa ideologia),
 * l'influenza del bersaglio, la relazione 1–7 e la pace mondiale. Le armi ai ribelli (12) non
 * hanno una formula decifrata: null.
 */
export function covertPopularity(code: number, success: boolean, aff: number, infl: number, rel: number, worldPeace: number): number | null {
  const neutralCoup = success ? -5 * (rel - 4) + infl : -2 * (rel - 4) + infl;
  switch (code) {
    case 14: {
      const v = aff === 1 ? 3 - 3 * infl : aff === 4 ? -5 * infl : aff === 5 ? -10 * infl : 1 - 3 * (rel - 4);
      return Math.max(v, -20);
    }
    case 15: {
      const v = aff === 1 ? (success ? 5 + infl : -1 - infl / 2)
        : aff === 4 ? (success ? -8 * (infl + 1) : -6 * infl)
        : aff === 5 ? (success ? -15 * (infl + 1) : -10 * infl)
        : neutralCoup;
      return Math.max(v, -30);
    }
    case 16: {
      const v = aff === 1 ? (success ? -(worldPeace - 2) * (infl + 1) : -0.5 * (worldPeace - 2) * (infl + 1))
        : aff === 4 ? (success ? -10 * (infl + 1) : -8 * infl)
        : aff === 5 ? (success ? -20 * (infl + 1) : -15 * infl)
        : neutralCoup;
      return Math.max(v, -15 * aff);
    }
    default:
      return null;
  }
}
