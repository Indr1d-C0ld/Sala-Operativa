import type { Rules } from "../rules.js";
import type { WorldState } from "../types.js";
import { actionThreshold, affinity } from "./actions.js";
import { actionPopularity } from "./budget.js";
import { relationLevel } from "./relation.js";
import { warOf } from "./war.js";

/**
 * I consiglieri del presidente. L'originale ne ha sette, ciascuno con il suo rapporto sul paese
 * selezionato e un parere sulle azioni ("Cabinet Briefing"); qui ruoli e contenuti seguono il
 * manuale, ma nomi, testi e giudizi sono nostri. Il nucleo produce solo chiavi e numeri: i testi
 * sono nei cataloghi dell'interfaccia.
 */
export const ADVISORS = ["chief", "security", "state", "defense", "press", "intelligence", "economy"] as const;
export type AdvisorId = (typeof ADVISORS)[number];

/** Una riga di rapporto: chiave di testo e parametri (numeri o indici di paese). */
export interface AdvisorLine {
  key: string;
  country?: number;
  other?: number;
  value?: number;
  value2?: number;
  /** Indice della notizia in `AdvisorContext.news` (per il portavoce). */
  ref?: number;
}

/** Quello che i consiglieri sanno della partita oltre al mondo. */
export interface AdvisorContext {
  world: WorldState;
  rules: Rules;
  player: number;
  popularity: number | null;
  daysToElection: number | null;
  /** Ultime notizie (come Report: key, country, actor, action). */
  news: { key: string; day: number; country?: number; actor?: number; action?: number; stage?: number; value?: number }[];
  /** Azioni IA in coda (la CIA le intercetta). */
  pending: { actor: number; target: number; code: number; day: number }[];
}

const active = (w: WorldState, i: number) => (w.countries[i]?.econPower ?? 0) > 0;

function top<T>(items: T[], by: (x: T) => number, n: number): T[] {
  return [...items].sort((a, b) => by(b) - by(a)).slice(0, n);
}

/** Rapporto di un consigliere sul paese `t` (righe in ordine di importanza). */
export function advisorReport(ctx: AdvisorContext, who: AdvisorId, t: number): AdvisorLine[] {
  const { world: w, rules, player: p } = ctx;
  const T = w.countries[t]!;
  const P = w.countries[p];
  const all = w.countries.map((_, i) => i).filter((i) => active(w, i));
  const lines: AdvisorLine[] = [];
  switch (who) {
    case "chief": {
      if (ctx.popularity !== null) lines.push({ key: "chiefPopularity", value: ctx.popularity });
      if (ctx.daysToElection !== null) lines.push({ key: "chiefElection", value: ctx.daysToElection });
      for (const war of w.wars.slice(0, 3)) lines.push({ key: "chiefWar", country: war.sides[0].countries[0]!, other: war.theater });
      const allies = all.filter((i) => i !== p && P && w.countries[i]!.team === P.team && P.team !== 0 && w.countries[i]!.outcry > 60);
      for (const i of top(allies, (i) => w.countries[i]!.outcry, 2)) lines.push({ key: "chiefAllyCrisis", country: i, value: w.countries[i]!.outcry });
      // disastri recenti: le notizie dicono quanti morti
      for (const r of ctx.news.filter((r) => r.key === "disaster").slice(-2).reverse()) {
        lines.push({ key: "chiefDisaster", country: r.country ?? -1, value: r.value ?? 0, value2: r.stage ?? 0 });
      }
      for (const i of top(all, (i) => w.countries[i]!.outcry, 2)) lines.push({ key: "chiefHotSpot", country: i, value: w.countries[i]!.outcry });
      break;
    }
    case "security": {
      if (t !== p) lines.push({ key: "securityMood", country: t, value: 8 - relationLevel(w, rules, p, t, 0) });
      lines.push({ key: "securityAlignment", country: t, value: T.team, value2: T.influence });
      const threats = all.filter((i) => i !== p).map((i) => ({ i, rel: relationLevel(w, rules, p, i, 0) }))
        .filter((x) => x.rel <= 2);
      for (const x of top(threats, (x) => w.countries[x.i]!.milShare + w.countries[x.i]!.nucShare, 3)) {
        lines.push({ key: w.countries[x.i]!.nucLevel >= 4 ? "securityNuclearThreat" : "securityThreat", country: x.i, value: w.countries[x.i]!.milShare });
      }
      lines.push({ key: "securityCoalition", value: w.coalition.length, country: w.coalition[0] ?? -1, other: w.coalition[1] ?? -1 });
      break;
    }
    case "state": {
      const anx = Object.entries(T.anxiety).sort((a, b) => b[1] - a[1]);
      lines.push({ key: `stateAnxiety_${anx[0]![0]}`, country: t, value: anx[0]![1] });
      const hunger = Object.entries(T.hunger).sort((a, b) => b[1] - a[1]);
      if (hunger[0]![1] > 0) lines.push({ key: `stateHunger_${hunger[0]![0]}`, country: t, value: hunger[0]![1] });
      lines.push({ key: "stateStrategic", country: t, value: T.stratValue });
      const needy = all.filter((i) => i !== p && P && w.countries[i]!.team === P.team && P.team !== 0);
      for (const i of top(needy, (i) => w.countries[i]!.hunger.economic + w.countries[i]!.hunger.humanitarian, 2)) {
        lines.push({ key: "stateAllyNeeds", country: i });
      }
      break;
    }
    case "defense": {
      if (P && t !== p) lines.push({ key: "defenseCompare", country: t, value: T.troops, value2: P.troops ? T.milPower / Math.max(P.milPower, 1) : 0 });
      if (T.warheads) lines.push({ key: "defenseNukes", country: t, value: T.warheads });
      const war = warOf(w, t);
      if (war) lines.push({ key: "defenseAtWar", country: war.sides[0].countries[0]!, other: war.theater, value: Math.round(war.sides[0].totalDead + war.sides[1].totalDead) });
      const abroad = w.deployments.filter((d) => d.owner === t && d.troops >= 1);
      if (abroad.length) lines.push({ key: "defenseAbroad", country: t, value: Math.round(abroad.reduce((s, d) => s + d.troops, 0)), value2: abroad.length });
      for (const d of w.deployments.filter((d) => d.location === t && d.troops >= 1).slice(0, 3)) {
        lines.push({ key: "defenseForeign", country: d.owner, other: t, value: Math.round(d.troops) });
      }
      for (const i of top(all, (i) => w.countries[i]!.milShare, 3)) lines.push({ key: "defenseTopPower", country: i, value: w.countries[i]!.milShare });
      break;
    }
    case "press": {
      const about = ctx.news.filter((r) => r.country === t || r.actor === t).slice(-4).reverse();
      if (!about.length) lines.push({ key: "pressQuiet", country: t });
      for (const r of about) lines.push({ key: "pressNews", ref: ctx.news.indexOf(r) });
      break;
    }
    case "intelligence": {
      lines.push({ key: `intelAmbition_${Math.min(6, Math.max(1, Math.round(T.ambition)))}`, country: t, value: T.ambition });
      const r = t === p ? 7 : relationLevel(w, rules, p, t, 0);
      if (t !== p) lines.push({ key: T.ambition >= 4 && r <= 3 ? "intelConcern" : "intelNoConcern", country: t });
      const covert = ctx.pending.filter((e) => e.target === p && [12, 13, 14, 15, 16, 20, 21, 24].includes(e.code));
      for (const e of covert.slice(0, 3)) lines.push({ key: "intelPlot", country: e.actor, value: e.code });
      if (!covert.length) lines.push({ key: "intelNoPlots" });
      break;
    }
    case "economy": {
      lines.push({ key: "economyQol", country: t, value: T.qol, value2: T.pcGnp });
      lines.push({ key: "economyGrowth", country: t, value: T.gdpGrowth });
      if (P && t !== p) lines.push({ key: "economyCompare", country: t, value: T.econPower / Math.max(P.econPower, 1e-9) });
      for (const i of top(all, (i) => w.countries[i]!.qol, 3)) lines.push({ key: "economyTopQol", country: i, value: w.countries[i]!.qol });
      break;
    }
  }
  return lines;
}

/** Parere di un consigliere su un'azione: −2 contrario … +2 favorevole, con il motivo. */
export interface Opinion { advisor: AdvisorId; stance: number; reason: string }

/**
 * Riunione di gabinetto su un'azione del giocatore contro `t`: ciascun consigliere guarda il suo
 * campo (relazione e politica estera, forze, segretezza, opinione pubblica, economia).
 */
export function cabinetBriefing(ctx: AdvisorContext, t: number, code: number): { chance: number | null; opinions: Opinion[] } {
  const { world: w, rules, player: p } = ctx;
  const P = w.countries[p]!;
  const T = w.countries[t]!;
  const s = actionThreshold(w, rules, p, t, code);
  const chance = s === null ? null : Math.round(Math.min(Math.max(s - 1, 0), 100));
  const [, aff] = affinity(rules, P, T);
  const rel = relationLevel(w, rules, p, t, 0);
  const hostile = [6, 10, 11, 12, 14, 15, 16, 19, 20, 21, 23, 24].includes(code);
  const friendly = rel >= 5 || aff >= 4;
  const opinions: Opinion[] = [];
  const say = (advisor: AdvisorId, stance: number, reason: string) => opinions.push({ advisor, stance: Math.max(-2, Math.min(2, stance)), reason });

  // Segretario di Stato: coerenza con la politica estera
  if (hostile && friendly) say("state", -2, "opinionInconsistent");
  else if (!hostile && friendly) say("state", 2, "opinionConsistent");
  else if (hostile) say("state", 0, "opinionRival");
  else say("state", 1, "opinionOpening");

  // Portavoce: opinione pubblica
  const pop = actionPopularity(code, aff, T.influence, w.worldPeace);
  say("press", pop <= -10 ? -2 : pop < 0 ? -1 : pop > 0 ? 1 : 0, pop < 0 ? "opinionUnpopular" : pop > 0 ? "opinionPopular" : "opinionNeutral");

  // Un parere per consigliere: chi è competente per l'azione ne valuta la riuscita
  if ([20, 21, 24].includes(code)) {
    // Difesa: rapporti di forza (e mai l'atomica)
    const stronger = P.milPower > T.milPower * 2;
    say("defense", code === 24 ? -2 : stronger ? 1 : -2, code === 24 ? "opinionNuclear" : stronger ? "opinionWeCanWin" : "opinionTooStrong");
  } else if (code >= 12 && code <= 16 && P.ler < 0.4) {
    // CIA: con una leadership debole la rete rischia di essere scoperta
    say("intelligence", -1, "opinionExposure");
  } else {
    const expert: AdvisorId = code >= 12 && code <= 16 ? "intelligence" : code >= 17 ? "defense" : code >= 7 ? "economy" : "security";
    if (chance === null) say(expert, 1, "opinionCertain");
    else say(expert, chance >= 60 ? 2 : chance >= 35 ? 1 : chance >= 15 ? -1 : -2, chance >= 35 ? "opinionLikely" : "opinionUnlikely");
  }
  // Capo di gabinetto: la presidenza
  if (ctx.popularity !== null && ctx.popularity < 40 && pop < 0) say("chief", -2, "opinionDanger");
  else say("chief", Math.sign(opinions.reduce((s, o) => s + o.stance, 0)), "opinionSummary");
  return { chance, opinions };
}
