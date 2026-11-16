/**
 * Collegamento fra la carta politica (tessere di confini attuali, tools/build_map.py) e i paesi
 * di uno scenario. Una tessera appartiene al paese con lo stesso codice; se nell'anno quel paese
 * non esiste ancora, si risale la tabella delle successioni al predecessore (Russia → URSS nel
 * 1990); se non esiste più, si scende al successore (Germania Est → Germania nel 2026).
 */
export interface Succession {
  predecessor: string;
  successor: string;
  year: number;
}

/** Per ogni tessera l'indice del paese nello scenario, o -1 se nessun paese la possiede. */
export function tileOwners(tiles: string[], codes: string[], lineage: Succession[], year: number): number[] {
  const index = new Map(codes.map((c, i) => [c, i]));
  const resolve = (code: string, seen: Set<string>): number => {
    const direct = index.get(code);
    if (direct !== undefined) return direct;
    if (seen.has(code)) return -1;
    seen.add(code);
    // nato nell'anno dello scenario o dopo: apparteneva al predecessore
    for (const s of lineage) {
      if (s.successor === code && s.year >= year) {
        const r = resolve(s.predecessor, seen);
        if (r >= 0) return r;
      }
    }
    // scomparso prima dell'anno dello scenario: è passato al successore
    for (const s of lineage) {
      if (s.predecessor === code && s.year <= year) {
        const r = resolve(s.successor, seen);
        if (r >= 0) return r;
      }
    }
    return -1;
  };
  return tiles.map((t) => resolve(t, new Set()));
}
