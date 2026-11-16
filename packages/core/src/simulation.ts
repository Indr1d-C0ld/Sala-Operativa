import { Rng } from "./rng.js";
import type { Rules } from "./rules.js";
import type { WorldState } from "./types.js";
import { ACTIONS, actionRefusal, performAction, type ActionOutcome, type ActionRefusal } from "./systems/actions.js";
import { planAiTurn } from "./systems/ai.js";
import { endWar, reinforce, startWar, warOf, warTick } from "./systems/war.js";
import { defaultContingent, deployTroops } from "./systems/troops.js";
import { relationLevel } from "./systems/relation.js";
import { DISASTER_TYPES, strikeDisaster } from "./systems/disasters.js";
import { hasNukes, nuclearStrike, warEscalation } from "./systems/nuclear.js";
import { actionPopularity, applyBudget, evaluateBudget, initialBudget, monthlyBudget, type BudgetProjection, type PlayerBudget, type Rates, type Spending } from "./systems/budget.js";
import { affinity } from "./systems/actions.js";
import { holdElection, MAX_TERMS, nextElection, unpopularityCheck } from "./systems/term.js";
import { DECISION_CODES, REACTION_CODES, REACTIONS, resolveReaction, type Reaction, type ReactionOutcome } from "./systems/reaction.js";
import { addAid, distributeAid } from "./systems/aid.js";
import { computeAnxieties } from "./systems/anxiety.js";
import { computeBelligerence } from "./systems/belligerence.js";
import { computeBudgets } from "./systems/budgets.js";
import { computeWorldCoalition } from "./systems/coalition.js";
import { computeGrowth, computeMilitary, computeQualityOfLife, computeWorldMaxima } from "./systems/economy.js";
import { computeOrientation } from "./systems/orientation.js";
import { computeRegions } from "./systems/regions.js";
import { leadershipRecovery, planSocialEvents, resolveSocialEvent } from "./systems/social.js";
import { distributeSpies } from "./systems/spies.js";
import { computeTeamLeaders } from "./systems/teams.js";
import { computeTrade } from "./systems/trade.js";
import { computeOutcry } from "./systems/unrest.js";
import { computeInfluence, computeWorldShares, rankIdeologies } from "./systems/world.js";

const DAY_MS = 86_400_000;
/** Notizie conservate in memoria e nei salvataggi. */
const MAX_REPORTS = 5000;

/** Copia profonda di dati semplici (lo stato non contiene funzioni né date). */
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/** Evento in coda: evento sociale o azione di un paese IA (avvisi e guerre arriveranno qui). */
export type GameEvent =
  | { day: number; hour: number; kind: "social"; country: number; stage: number }
  | { day: number; hour: number; kind: "action"; actor: number; target: number; code: number };

/**
 * Notizia prodotta dalla simulazione. Il nucleo non contiene testi: l'interfaccia traduce
 * `key` con i suoi cataloghi (in italiano) usando `params`.
 */
export interface Report {
  day: number;
  key:
    | "endOfMonth" | "endOfYear"
    | "socialSuppressed" | "socialHappened" | "regimeChange"
    | "playerKilled" | "playerOusted" | "playerConquered"
    | "actionSucceeded" | "actionFailed"
    | "aiActionSucceeded" | "aiActionFailed" | "ciaWarning" | "militaryExercises"
    | "reactionPrevented" | "reactionFailed" | "sanctionsVetoed" | "proposalAccepted" | "proposalRefused"
    | "warStarted" | "warWon" | "warRepelled" | "peaceNegotiated"
    | "nuclearStrike" | "nuclearFallout" | "nuclearWinter" | "nuclearAlert"
    | "electionWon" | "electionLost" | "termsCompleted"
    | "troopsApproaching" | "troopsDeployed" | "troopsIncreased" | "deployRefused" | "warJoined" | "troopsSurrendered"
    | "mobilization" | "disaster";
  /** Indice in REACTIONS della reazione del giocatore. */
  reaction?: number;
  /** Paese che agisce, per le azioni IA (country è il bersaglio). */
  actor?: number;
  country?: number;
  stage?: number;
  /** Codice dell'azione, per actionSucceeded/actionFailed (country è il bersaglio). */
  action?: number;
  /** Valori numerici della notizia (disastri: vittime, danni in $, magnitudo). */
  value?: number;
  value2?: number;
  value3?: number;
}

export type GameOver = null | "playerKilled" | "playerOusted" | "electionLost" | "termsCompleted" | "playerConquered";

/** Scelta che ferma il tempo finché il giocatore non risponde. */
export type PendingChoice =
  | { kind: "reaction"; actor: number; target: number; code: number }
  | { kind: "decision"; actor: number; code: number }
  /** La difesa degli Stati Uniti cede: resa o mobilitazione generale (decide il giocatore). */
  | { kind: "surrender"; war: number; actor: number };

/** Passi del giorno corrente ancora da eseguire dopo una scelta del giocatore. */
interface DayRest { aiTurn: boolean; month: boolean; year: boolean }

export interface SimulationOptions {
  world: WorldState;
  rules: Rules;
  seed: number;
  /** Data di partenza (UTC). */
  start: Date;
  /** Indice del paese del giocatore, -1 se nessuno (simulazione pura). */
  player: number;
  /**
   * Partita con un giocatore che risponde: le azioni IA possono prenderlo di mira e, prima di
   * un'aggressione, il tempo si ferma finché non sceglie una reazione. Senza, nessuna attesa.
   */
  interactive?: boolean;
  /** Bilancio iniziale del giocatore (se manca, ricavato dal suo paese). */
  budget?: PlayerBudget;
  /** Elezioni ogni quattro anni (nell'originale si potevano disattivare). Predefinito: sì. */
  elections?: boolean;
  /** Disastri naturali e incidenti (disattivabili come nell'originale). Predefinito: sì. */
  disasters?: boolean;
}

/** Stato completo serializzabile: salvataggi e replay. */
export interface SimulationSnapshot {
  world: WorldState;
  day: number;
  rng: number;
  player: number;
  queue: GameEvent[];
  reports: Report[];
  gameOver: GameOver;
  interactive?: boolean;
  pending?: PendingChoice | null;
  rest?: DayRest | null;
  budget?: PlayerBudget | null;
  elections?: boolean;
  terms?: number;
  disasters?: boolean;
}

/**
 * Il ciclo di gioco. Il tempo avanza a giorni; ogni giorno si eseguono gli eventi in coda già
 * scaduti, a cavallo di un mese il ciclo di fine mese, a cavallo di un anno quello di fine anno
 * (i 15 passi dell'originale, nello stesso ordine).
 */
export class Simulation {
  readonly world: WorldState;
  readonly rules: Rules;
  readonly rng: Rng;
  readonly player: number;
  /** Giorni dall'1/1/1970 (UTC). */
  day: number;
  queue: GameEvent[] = [];
  reports: Report[] = [];
  gameOver: GameOver = null;
  readonly interactive: boolean;
  /** Scelta in attesa del giocatore: finché c'è, il tempo non avanza. */
  pending: PendingChoice | null = null;
  private rest: DayRest | null = null;
  /** Bilancio e popolarità del giocatore (null senza giocatore). */
  budget: PlayerBudget | null = null;
  /** Elezioni attive, e mandati vinti finora (il primo è quello in corso). */
  elections = true;
  terms = 1;
  disasters = true;

  constructor(o: SimulationOptions) {
    this.world = o.world;
    this.rules = o.rules;
    this.rng = new Rng(o.seed);
    this.player = o.player;
    this.interactive = (o.interactive ?? false) && o.player >= 0;
    this.day = Math.floor(o.start.getTime() / DAY_MS);
    if (o.player >= 0) this.budget = o.budget ?? initialBudget(o.world.countries[o.player]!);
    this.elections = (o.elections ?? true) && o.player >= 0;
    this.disasters = o.disasters ?? true;
  }

  /** Quello che i consiglieri sanno della partita (vedi systems/advisors.ts). */
  advisorContext(): import("./systems/advisors.js").AdvisorContext {
    return {
      world: this.world, rules: this.rules, player: this.player,
      popularity: this.budget?.popularity ?? null, daysToElection: this.daysToElection,
      news: this.reports.slice(-400).filter((r) => r.key !== "endOfMonth" && r.key !== "endOfYear"),
      pending: this.queue.flatMap((e) => (e.kind === "action" ? [{ actor: e.actor, target: e.target, code: e.code, day: e.day }] : [])),
    };
  }

  /** Giorni alle prossime elezioni, o null se disattivate. */
  get daysToElection(): number | null {
    return this.elections ? nextElection(this.day) - this.day : null;
  }

  /** Un disastro, con la probabilità giornaliera delle regole; i disastri vecchi di 60 giorni si scordano. */
  private disasterCheck(): void {
    this.world.disasters = this.world.disasters.filter((d) => this.day - d.day <= 60);
    if (!this.disasters || this.rng.next() >= this.rules.disasters.dailyChance) return;
    const d = strikeDisaster(this.world, this.rules, this.rng, this.player, this.day);
    if (!d) return;
    this.report({
      key: "disaster", country: d.country, stage: DISASTER_TYPES.indexOf(d.type), action: d.direction,
      value: d.casualties, value2: d.damage, ...(d.magnitude !== undefined ? { value3: d.magnitude } : {}),
      ...(d.culprit !== undefined ? { actor: d.culprit } : {}),
    });
  }

  /** Giorno di elezioni: rielezione o fine della partita. */
  private electionCheck(): void {
    if (!this.elections || !this.budget || nextElection(this.day) !== this.day) return;
    const pop = this.budget.popularity;
    if (!holdElection(this.rng, pop)) {
      this.report({ key: "electionLost", country: this.player, stage: Math.round(pop) });
      this.gameOver = "electionLost";
      return;
    }
    this.terms += 1;
    this.report({ key: "electionWon", country: this.player, stage: this.terms });
    if (this.terms > MAX_TERMS) {
      this.report({ key: "termsCompleted", country: this.player });
      this.gameOver = "termsCompleted";
    }
  }

  /** Proiezione del bilancio proposto (o di quello indicato), per la schermata del bilancio. */
  evaluateBudget(rates?: Rates, spending?: Spending): BudgetProjection | null {
    if (!this.budget) return null;
    return evaluateBudget(this.budget, this.world.countries[this.player]!, rates, spending);
  }

  /** Il giocatore propone il bilancio dell'anno prossimo: entra in vigore a fine anno. */
  proposeBudget(rates: Rates, spending: Spending): void {
    if (this.budget) this.budget.proposed = { rates: { ...rates }, spending: { ...spending } };
  }

  private popularity(delta: number): void {
    if (this.budget) this.budget.popularity = Math.min(100, Math.max(0, this.budget.popularity + delta));
  }

  get date(): Date {
    return new Date(this.day * DAY_MS);
  }

  private isPlayer = (i: number): boolean => i === this.player;

  /** Avanza di un giorno. */
  advanceDay(): void {
    if (this.gameOver || this.pending) return;
    const before = this.date;
    this.day += 1;
    const after = this.date;
    const rest = {
      aiTurn: this.day % this.rules.ai.turnEveryDays === 0,
      month: after.getUTCMonth() !== before.getUTCMonth(),
      year: after.getUTCFullYear() !== before.getUTCFullYear(),
    };
    this.rest = rest;
    if (this.day % this.rules.war.tickEveryDays === 0) this.warTicks();
    if (this.gameOver) return;
    this.electionCheck();
    if (this.gameOver) return;
    this.disasterCheck();
    this.continueDay();
  }

  /** Un tick per ogni guerra in corso; le rese chiudono la guerra (annessione se perde chi difende). */
  private warTicks(): void {
    for (const war of [...this.world.wars]) {
      for (const j of reinforce(this.world, war, this.day)) this.report({ key: "warJoined", actor: j, country: war.theater });
      const loser = warTick(this.world, this.rules, this.rng, war);
      if (loser === null) {
        // chi sta perdendo e ha l'atomica può usarla, entro poche ore
        const esc = warEscalation(this.world, this.rng, war);
        if (esc) this.queueAction(esc.actor, esc.target, 24, 0, this.rng.int(1, 5));
        continue;
      }
      const attacker = war.sides[0].countries[0]!;
      // se cede la difesa degli Stati Uniti decide il giocatore (resa o mobilitazione)
      if (loser === 1 && war.theater === this.player && this.interactive) {
        this.pending = { kind: "surrender", war: war.id, actor: attacker };
        return;
      }
      this.finishWar(war, loser);
      if (this.gameOver) return;
    }
  }

  /** Chiude una guerra con le sue notizie: vittoria o difesa riuscita, contingenti arresi, annessione. */
  private finishWar(war: import("./types.js").War, loser: 0 | 1): void {
    {
      const attacker = war.sides[0].countries[0]!;
      this.report({ key: loser === 1 ? "warWon" : "warRepelled", actor: attacker, country: war.theater });
      // la vittoria porta 10 punti di popolarità (FUN_5db5_3cd2); la sconfitta li toglie (◇)
      const playerSide = war.sides.findIndex((side) => side.countries.includes(this.player));
      if (playerSide >= 0) this.popularity(playerSide === loser ? -10 : 10);
      for (const d of endWar(this.world, war, loser)) this.report({ key: "troopsSurrendered", actor: d.owner, country: d.location });
      // il paese del giocatore annesso: fine della presidenza
      if (this.player >= 0 && !this.world.countries[this.player]!.econPower) this.endGame("playerConquered");
    }
  }

  /**
   * La difesa degli Stati Uniti cede: il giocatore si arrende (annessione, fine della partita) o
   * ordina la mobilitazione generale (◇ +2% della popolazione al fronte, forza al 60%, −5 punti
   * di popolarità).
   */
  decideSurrender(surrender: boolean): void {
    const p = this.pending;
    if (!p || p.kind !== "surrender") return;
    this.pending = null;
    const war = this.world.wars.find((x) => x.id === p.war);
    if (war) {
      if (surrender) this.finishWar(war, 1);
      else {
        const def = war.sides[1];
        const P = this.world.countries[this.player]!;
        const extra = Math.round(P.population * 0.02);
        const k = def.countries.indexOf(this.player);
        if (k >= 0) def.contributions[k] = def.contributions[k]! + extra;
        def.troops += extra;
        def.force += extra;
        def.strength = 60;
        P.troops += extra;
        war.mobilized = (war.mobilized ?? 0) + 1;
        this.popularity(-5);
        this.report({ key: "mobilization", country: this.player });
      }
    }
    if (!this.gameOver) this.continueDay();
  }

  /** I due paesi combattono su lati opposti della stessa guerra? */
  private atWarWith(a: number, b: number): boolean {
    return this.world.wars.some((war) => {
      const side = (i: number) => (war.sides[0].countries.includes(i) ? 0 : war.sides[1].countries.includes(i) || war.theater === i ? 1 : -1);
      const sa = side(a);
      const sb = side(b);
      return sa >= 0 && sb >= 0 && sa !== sb;
    });
  }

  /** Mette in coda un'azione IA fra `days` giorni (ora `hour`). */
  private queueAction(actor: number, target: number, code: number, days: number, hour = 0): void {
    this.queue.push({ kind: "action", actor, target, code, day: this.day + days, hour });
  }

  /**
   * Esegue un'azione già ammessa: invasione e negoziato passano dal modulo guerra, le altre da
   * performAction. Restituisce l'esito, o null se l'azione non ha avuto luogo.
   */
  private execute(actor: number, target: number, code: number, funding: number): ActionOutcome {
    const w = this.world;
    if (code === 21) {
      startWar(w, this.rules, actor, target, this.day);
      this.report({ key: "warStarted", actor, country: target });
      return { code, actor, target, threshold: null, roll: null, success: true };
    }
    if (code === 25) {
      const out = deployTroops(w, this.rules, this.rng, actor, target, defaultContingent(w, actor), this.day);
      if (out.kind === "refused") this.report({ key: "deployRefused", actor, country: target });
      else if (out.kind === "adjusted") this.report({ key: "troopsIncreased", actor, country: out.host });
      else {
        if (out.kind === "staged") this.report({ key: "troopsApproaching", actor, country: target });
        this.report({ key: "troopsDeployed", actor, country: out.host });
      }
      return { code, actor, target, threshold: null, roll: null, success: out.kind !== "refused" };
    }
    if (code === 24) {
      const strike = nuclearStrike(w, this.rng, actor, target);
      this.report({ key: "nuclearStrike", actor, country: target });
      this.report({ key: "nuclearFallout", country: target, stage: strike.fallout.length });
      this.report({ key: "nuclearWinter" });
      // ritorsioni del bersaglio (il giocatore decide da sé come rispondere)
      if (target !== this.player) for (const [c, d] of strike.retaliation) this.queueAction(target, actor, c, d);
      return { code, actor, target, threshold: null, roll: null, success: true };
    }
    const out = performAction(w, this.rules, this.rng, actor, target, code, funding);
    if (code === 17 && out.success) {
      const war = warOf(w, target);
      if (war) {
        this.report({ key: "peaceNegotiated", actor, country: war.theater });
        endWar(w, war, null);
      }
    }
    if (out.success && code === 15) this.report({ key: "regimeChange", country: target });
    return out;
  }

  /** Esegue il resto del giorno; si ferma se un evento chiede una scelta al giocatore. */
  private continueDay(): void {
    if (this.pending) return;
    this.processEvents();
    if (this.pending || !this.rest) return;
    const r = this.rest;
    this.rest = null;
    // a partita finita il resto della giornata non avviene
    if (this.gameOver) return;
    if (r.aiTurn) this.aiTurn();
    if (r.month) this.endOfMonth();
    if (r.year && !this.gameOver) this.endOfYear();
  }

  /** Avanza di `n` giorni, fermandosi prima se serve una scelta del giocatore. */
  advanceDays(n: number): void {
    for (let k = 0; k < n && !this.gameOver && !this.pending; k++) this.advanceDay();
  }

  /** Risponde a un'aggressione in attesa: se la reazione riesce l'azione non avviene. */
  react(reaction: Reaction): ReactionOutcome | null {
    const p = this.pending;
    if (!p || p.kind !== "reaction") return null;
    this.pending = null;
    const out = resolveReaction(this.world, this.rules, this.rng, this.player, p.actor, reaction);
    const r = REACTIONS.indexOf(reaction);
    if (out.vetoed) this.report({ key: "sanctionsVetoed", actor: p.actor, country: p.target, action: p.code, reaction: r });
    if (out.prevented) this.report({ key: "reactionPrevented", actor: p.actor, country: p.target, action: p.code, reaction: r });
    else {
      if (reaction !== "none" && !out.vetoed) this.report({ key: "reactionFailed", actor: p.actor, country: p.target, action: p.code, reaction: r });
      this.runAiAction(p.actor, p.target, p.code, true);
    }
    // dopo una minaccia l'aggressore può rispondere con l'atomica (a482:4698, a482:4eb4)
    const A = this.world.countries[p.actor]!;
    if ((reaction === "militaryThreat" || reaction === "nuclearThreat") && hasNukes(A) && this.rng.int(1, 100) <= A.ambition) {
      this.queueAction(p.actor, this.player, 24, 0, this.rng.int(1, 2));
    }
    this.continueDay();
    return out;
  }

  /** Accetta o respinge un'azione IA rivolta al giocatore (nell'originale S = 101 o 0). */
  decide(accept: boolean): void {
    const p = this.pending;
    if (!p || p.kind !== "decision") return;
    this.pending = null;
    if (!actionRefusal(this.world, this.rules, p.actor, this.player, p.code)) {
      const P = this.world.countries[this.player]!;
      const before = P.milSpend;
      performAction(this.world, this.rules, this.rng, p.actor, this.player, p.code, 0, accept);
      // la spesa militare del giocatore è una voce del bilancio: la proposta accettata la cambia
      // lì, altrimenti il 1° gennaio applyBudget la riporterebbe al valore di prima
      if (this.budget && before > 0 && P.milSpend !== before) {
        const f = P.milSpend / before;
        this.budget.spending.defense *= f;
        this.budget.proposed.spending.defense *= f;
      }
    }
    this.report({ key: accept ? "proposalAccepted" : "proposalRefused", actor: p.actor, country: this.player, action: p.code });
    this.continueDay();
  }

  /**
   * Il giocatore tenta l'azione `code` contro `target` (subito, non in differita come
   * nell'originale). Se non è ammessa restituisce il motivo e non tira dadi.
   */
  act(code: number, target: number, funding = 0): ActionOutcome | ActionRefusal {
    if (this.gameOver) return "inactive";
    const refusal = actionRefusal(this.world, this.rules, this.player, target, code, this.day);
    if (refusal) return refusal;
    const before = { aff: affinity(this.rules, this.world.countries[this.player]!, this.world.countries[target]!)[1], infl: this.world.countries[target]!.influence };
    const out = this.execute(this.player, target, code, funding);
    this.popularity(actionPopularity(code, before.aff, before.infl, this.world.worldPeace));
    if (code !== 21 && code !== 24 && code !== 25) this.report({ key: out.success ? "actionSucceeded" : "actionFailed", country: target, action: code });
    return out;
  }

  private report(r: Omit<Report, "day">): void {
    this.reports.push({ day: this.day, ...r });
    // in memoria restano le notizie più recenti: una partita di cent'anni ne produce centomila
    if (this.reports.length > MAX_REPORTS) this.reports.splice(0, this.reports.length - MAX_REPORTS);
  }

  /** Turno IA: le azioni scelte vanno in coda; gli attacchi chirurgici fanno scattare un avviso CIA. */
  private aiTurn(): void {
    for (const p of planAiTurn(this.world, this.rules, this.rng, this.player, this.interactive)) {
      const day = this.day + Math.floor(p.delayHours / 24);
      this.queue.push({ kind: "action", actor: p.actor, target: p.target, code: p.code, day, hour: p.delayHours % 24 });
      if (p.code === 20 && day > this.day) this.report({ key: "ciaWarning", actor: p.actor, country: p.target });
    }
  }

  /** Esegue un'azione IA in coda. Quelle del modulo guerra non ancora portato non hanno effetto. */
  private runAiAction(actor: number, target: number, code: number, reacted = false): void {
    const w = this.world;
    if (!w.countries[actor]!.econPower || !w.countries[target]!.econPower) return;
    const hostileDeployment = code !== 25 || relationLevel(w, this.rules, actor, target, 0) < 5;
    if (this.interactive && !reacted && REACTION_CODES.has(code) && hostileDeployment) {
      this.pending = { kind: "reaction", actor, target, code };
      return;
    }
    if (this.interactive && target === this.player && DECISION_CODES.has(code)) {
      this.pending = { kind: "decision", actor, code };
      return;
    }
    if (!ACTIONS.some((a) => a.code === code && !a.needsWar)) return;
    const refusal = actionRefusal(w, this.rules, actor, target, code, this.day);
    if (refusal === "cannotInvade") {
      // invasione non fattibile: "%-s conducted military exercises near %-s."
      this.report({ key: "militaryExercises", actor, country: target });
      return;
    }
    if (refusal) return;
    if (code === 24 && this.rules.ai.nuclearOnlyAtWar && !this.atWarWith(actor, target)) {
      // allerta nucleare: la minaccia scuote i due paesi ma nessuna testata parte
      for (const i of [actor, target]) w.countries[i]!.anxiety.nuclear = 100;
      this.report({ key: "nuclearAlert", actor, country: target });
      return;
    }
    const out = this.execute(actor, target, code, 10);
    if (code !== 21 && code !== 24 && code !== 25) this.report({ key: out.success ? "aiActionSucceeded" : "aiActionFailed", actor, country: target, action: code });
  }

  private processEvents(): void {
    const due = this.queue.filter((e) => e.day <= this.day).sort((a, b) => a.day - b.day || a.hour - b.hour);
    if (!due.length) return;
    this.queue = this.queue.filter((e) => e.day > this.day);
    for (let k = 0; k < due.length; k++) {
      const e = due[k]!;
      if (this.gameOver) break;
      if (e.kind === "action") {
        this.runAiAction(e.actor, e.target, e.code);
        if (this.pending) {
          // il resto degli eventi di oggi aspetta la scelta del giocatore
          this.queue.push(...due.slice(k + 1));
          return;
        }
        continue;
      }
      if (e.kind === "social") {
        const out = resolveSocialEvent(this.world, this.rules, this.rng, e.country, e.stage, this.isPlayer(e.country));
        if (out.kind === "suppressed") {
          this.report({ key: "socialSuppressed", country: e.country, stage: e.stage });
          continue;
        }
        this.report({ key: "socialHappened", country: e.country, stage: e.stage });
        if (out.regimeChange) this.report({ key: "regimeChange", country: e.country });
        if (out.playerKilled) this.endGame("playerKilled");
        else if (out.playerOusted) this.endGame("playerOusted");
      }
    }
  }

  private endGame(reason: Exclude<GameOver, null>): void {
    this.gameOver = reason;
    this.report({ key: reason, country: this.player });
  }

  /** Fine mese: oscillazione del LER, malcontento, nuovi eventi sociali. */
  endOfMonth(): void {
    leadershipRecovery(this.world, this.rng);
    computeOutcry(this.world);
    for (const p of planSocialEvents(this.world, this.rules, this.rng)) {
      this.queue.push({ kind: "social", country: p.country, stage: p.stage, day: this.day + p.delayDays, hour: p.delayHours });
    }
    if (this.budget) {
      const P = this.world.countries[this.player]!;
      monthlyBudget(this.budget, P);
      // sotto il 15% di popolarità il presidente rischia la destituzione o l'assassinio (◇ ogni mese)
      const fall = unpopularityCheck(this.rng, this.budget.popularity, P.ler);
      if (fall) this.endGame(fall === "killed" ? "playerKilled" : "playerOusted");
    }
    this.report({ key: "endOfMonth" });
  }

  /** Fine anno: i passi del ciclo annuale nell'ordine dell'originale. */
  endOfYear(): void {
    const w = this.world;
    const r = this.rules;
    if (this.budget) applyBudget(this.budget, w.countries[this.player]!);   // bilancio del giocatore
    computeGrowth(w);                                  // 1  crescita
    computeMilitary(w, this.isPlayer);                 // 2  informazioni mondiali
    computeWorldShares(w);
    computeInfluence(w, r);
    computeWorldMaxima(w);
    computeWorldCoalition(w, r);                       // 3  coalizione mondiale
    computeBelligerence(w, r);                         // 4  livelli di pace (belligeranza)
    rankIdeologies(w, r);                              // 5  orientamento e qualità della vita
    updateLeaderEthic(w);
    computeOrientation(w, r);
    computeQualityOfLife(w);
    computeRegions(w, r);                              // 6  regioni e coalizioni regionali
    computeTeamLeaders(w, r);                          // 7  World Team
    computeTrade(w);                                   // 8  commercio
    computeBudgets(w, this.isPlayer);                  // 9  bilanci
    distributeAid(w, r, this.isPlayer);                // 10 aiuti
    distributeSpies(w, this.isPlayer);                 // 11 spie
    addAid(w);                                         // 12 somma degli aiuti
    computeWorldMaxima(w);                             // 13 ansie e bisogni
    computeAnxieties(w, r);
    this.queue = this.queue.filter((e) => e.day >= this.day);  // 15 eventi scaduti
    this.report({ key: "endOfYear" });
  }

  save(): SimulationSnapshot {
    return clone({
      world: this.world, day: this.day, rng: this.rng.save(), player: this.player,
      queue: this.queue, reports: this.reports, gameOver: this.gameOver,
      interactive: this.interactive, pending: this.pending, rest: this.rest, budget: this.budget,
      elections: this.elections, terms: this.terms, disasters: this.disasters,
    });
  }

  /**
   * Porta un salvataggio di una versione precedente al formato attuale: i campi aggiunti dopo
   * (guerre, contingenti, disastri, contributi dei partecipanti) prendono il valore iniziale.
   */
  static migrate(world: WorldState): WorldState {
    const w = world as Partial<WorldState> & WorldState;
    w.wars ??= [];
    w.deployments ??= [];
    w.disasters ??= [];
    for (const war of w.wars) {
      for (const side of war.sides) {
        // vecchie guerre senza contributi: le truppe del lato divise in parti uguali
        side.contributions ??= side.countries.map(() => side.troops / Math.max(side.countries.length, 1));
      }
    }
    return w;
  }

  static load(s: SimulationSnapshot, rules: Rules): Simulation {
    const sim = new Simulation({
      world: Simulation.migrate(clone(s.world)), rules, seed: 0, start: new Date(s.day * DAY_MS), player: s.player, interactive: s.interactive ?? false,
    });
    sim.pending = clone(s.pending ?? null);
    sim.budget = clone(s.budget ?? null);
    sim.elections = s.elections ?? sim.elections;
    sim.terms = s.terms ?? 1;
    sim.disasters = s.disasters ?? true;
    sim.rest = clone(s.rest ?? null);
    sim.rng.restore(s.rng);
    sim.queue = clone(s.queue);
    sim.reports = clone(s.reports);
    sim.gameOver = s.gameOver;
    return sim;
  }
}

/** Etica del paese più influente dell'ideologia dominante (WORLD+0x48 nell'originale). */
export function updateLeaderEthic(w: WorldState): void {
  const dom = w.ideologyRanking[0];
  let best = -1;
  w.countries.forEach((c, i) => {
    if (c.ideology === dom && (best < 0 || c.influence > w.countries[best]!.influence)) best = i;
  });
  if (best >= 0) w.leaderEthic = w.countries[best]!.ethic;
}
