import type { Rng } from "../rng.js";
import type { Rules } from "../rules.js";
import type { Country, WorldState } from "../types.js";
import { relationLevel } from "./relation.js";

/**
 * Reazione del giocatore a un'aggressione IA (originale: FUN_a482_25e6, overlay 31), aperta
 * prima di un attacco chirurgico o di un'invasione. Una reazione riuscita impedisce l'azione
 * ("%-s has prevented %-s from %-s %-s."); una fallita la lascia procedere.
 *
 * Termini comuni (P = giocatore, A = aggressore):
 *  - k = 2 se P e A sono nella stessa squadra (anche nessuna), 0,5 se A non ha squadra, 0,25 altrimenti;
 *  - L = quota militare di A / (15 se ha una squadra, 20 altrimenti) / 20: l'intensità;
 *  - rel = livello di relazione P–A; r = rand(1,100); la reazione riesce se r ≤ S.
 */
export const REACTIONS = ["none", "protest", "sanctions", "tradeCut", "militaryThreat", "nuclearThreat"] as const;
export type Reaction = (typeof REACTIONS)[number];

export interface ReactionOutcome {
  reaction: Reaction;
  prevented: boolean;
  /** Sanzioni bloccate dal veto di un membro permanente. */
  vetoed: boolean;
  threshold: number | null;
  roll: number | null;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi);

export function resolveReaction(w: WorldState, rules: Rules, rng: Rng, player: number, aggressor: number, reaction: Reaction): ReactionOutcome {
  const P = w.countries[player]!;
  const A = w.countries[aggressor]!;
  const out: ReactionOutcome = { reaction, prevented: false, vetoed: false, threshold: null, roll: null };
  if (reaction === "none") return out;

  const k = P.team === A.team ? 2 : A.team === 0 ? 0.5 : 0.25;
  const L = A.milShare / (A.team ? 15 : 20) / 20;
  const rel = relationLevel(w, rules, player, aggressor, rng.int(0, 3));
  const roll = rng.int(1, 100);
  out.roll = roll;
  const peaceShift = (world: number, aggressorPeace: number) => {
    w.worldPeace += world;
    A.peace += aggressorPeace;
  };

  switch (reaction) {
    case "protest": {
      const num = ((2 * rel * (P.influence / (A.milShare + 1)) * k) / (A.ambition + 0.01)) + P.influence * k;
      const S = num / (Math.abs(Math.trunc(A.ethic - P.ethic)) + 2) + 2 * rel;
      out.threshold = S;
      out.prevented = roll <= S;
      // protestare contro un compagno di squadra costa comunque
      P.ler *= out.prevented && k < 2 ? 1.01 : 0.95;
      break;
    }
    case "sanctions": {
      const veto = rules.reaction.vetoPowers;
      const isVeto = (c: Country) => veto.includes(c.key);
      const members = w.countries.map((c, i) => [c, i] as const).filter(([c, i]) => isVeto(c) && c.econPower > 0 && i !== player);
      let vetoes = isVeto(A) ? 1 : 0;
      if (A.team) vetoes += members.filter(([c, i]) => i !== aggressor && c.team === A.team).length;
      if (vetoes) {
        out.vetoed = true;
        P.ler *= 0.98 ** vetoes;
        break;
      }
      const sum = w.countries.filter(isVeto).reduce((s, c) => s + c.influence, 0);
      const S = (((sum - A.influence) / (A.influence + 1)) / (2 * A.ambition + 0.01) / (2 * A.ambition + 0.01)) * A.ethic ** 2 + sum / 10;
      out.threshold = S;
      out.prevented = roll <= S;
      if (out.prevented) { P.ler *= 1.02; peaceShift(0.1 * L, -0.3 * L); }
      else { P.ler *= 0.98; peaceShift(-0.1 * L, 0.3 * L); }
      break;
    }
    case "tradeCut": {
      const slot = w.donors.indexOf(player);
      A.ambition *= 1.045;
      if (slot >= 0) {
        const level = A.tradeLevel[slot] ?? 3;                       // 4 nazione più favorita … 1 bloccato
        const S = rel + ((P.econShare / (A.econShare + 1)) * (1 - ((4 - level) * 25) / 100) / (A.ambition + 0.1))
          * ((k + 0.05) / 2) * ((9 - A.ethic) / 3);
        out.threshold = S;
        out.prevented = roll <= S;
      }
      if (out.prevented) { P.ler *= 1.1; peaceShift(-L / 4, -L / 2); }
      else { P.ler *= 0.98; peaceShift(-L / 2, -L); }
      break;
    }
    case "militaryThreat": {
      P.ambition *= 1.01;
      if (P.ethic > 2.7) P.ethic *= 0.95;
      const S = ((rel * (P.milShare / (A.milShare + 1)) * k) / (A.ambition ** 2 + 0.01)) + 3 + (A.milShare / 1.5) * ((7 - P.ethic) / 4);
      out.threshold = S;
      out.prevented = roll <= S;
      if (out.prevented) { P.ler *= 1.03; A.ambition *= 0.96; peaceShift(-L, -3 * L); }
      else { P.ler *= 0.97; A.ambition *= 1.04; peaceShift(-L / 2, -1.5 * L); }
      break;
    }
    case "nuclearThreat": {
      P.ambition *= 1.02;
      if (P.ethic > 1.5) P.ethic *= 0.75;
      const S = (P.nucShare * (P.ambition / (A.ambition + 1)) + 50 - A.nucShare * 0.02 + 2 * rel) * ((7 - P.ethic) / 3);
      out.threshold = S;
      A.ambition += 1;                                    // a482:4771–4ae8, dopo la soglia
      out.prevented = roll <= S;
      if (out.prevented) { P.ler *= 1.1; w.worldPeace -= 0.5; A.peace -= 1; P.peace -= 1; }
      else { P.ler *= 0.9; w.worldPeace -= 1; A.peace -= 2; P.peace -= 1; }
      break;
    }
  }
  w.worldPeace = clamp(w.worldPeace, 1, 6);
  for (const c of [A, P]) {
    c.peace = clamp(c.peace, 1, 6);
    c.ethic = clamp(c.ethic, 1, 6);
    c.ambition = clamp(c.ambition, 1, 6);
  }
  P.ler = clamp(P.ler, 0, 1);
  return out;
}

/** Azioni IA contro il giocatore che il giocatore accetta o respinge (nell'originale S = 101 o 0). */
export const DECISION_CODES = new Set([0, 1, 2, 3, 4, 5, 7, 18, 19, 22, 23]);

/** Azioni IA prima delle quali il giocatore può reagire. */
export const REACTION_CODES = new Set([20, 21, 25]);   // 25 solo se le truppe si ammassano a un confine ostile
