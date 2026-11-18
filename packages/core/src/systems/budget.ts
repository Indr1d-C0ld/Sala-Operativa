import type { Country } from "../types.js";

/**
 * Bilancio del giocatore e popolarità (originale: schermata "BUDGET VIEW", valutazione
 * FUN_5f0c_1842, applicazione FUN_7124_377e, mese FUN_5f0c_308e). Formule in re/FORMATS.md.
 *
 * L'originale usa costanti in dollari del 1990 (aiuti 18,6 G$, ricerca 172,5 G$, saldo /10¹³ +
 * 0,0302 che pareggia il deficit di allora). Qui (◇) si confrontano con i valori iniziali della
 * partita, così le formule valgono in qualsiasi anno: aiuti / aiuti iniziali, ricerca / ricerca
 * dell'anno prima, (saldo/PIL − saldo/PIL iniziale) / 1,92.
 */
export interface Rates { personal: number; corporate: number; sales: number; tariffs: number }
export interface Spending { defense: number; social: number; aid: number; research: number }

export interface PlayerBudget {
  /** In vigore quest'anno. */
  rates: Rates;
  spending: Spending;
  /** Proposti dal giocatore: entrano in vigore alla fine dell'anno. */
  proposed: { rates: Rates; spending: Spending };
  /** Riferimenti iniziali della partita. */
  reference: { aid: number; balanceShare: number };
  /** Profitti delle società e importazioni, in frazione del PIL (5–15%). */
  profits: number;
  imports: number;
  /** Debito accumulato (≤ 0). */
  debt: number;
  /** Popolarità del presidente, %. */
  popularity: number;
  /** Variazioni mensili verso gli obiettivi (2A56:0330–0348). */
  monthly: { popularity: number; growth: number; profits: number; imports: number };
}

export interface BudgetProjection {
  gdp: number;
  revenue: Rates;
  totalRevenue: number;
  totalSpending: number;
  balance: number;
  target: { growth: number; profits: number; imports: number; popularity: number };
}

const clamp = (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi);
/** Coefficiente diverso se la voce aumenta o cala: alzare le tasse pesa più che abbassarle. */
const asym = (delta: number, up: number, down: number) => delta * (delta > 0 ? up : down);

const sumSpending = (s: Spending) => s.defense + s.social + s.aid + s.research;

function revenues(r: Rates, gdp: number, profits: number, imports: number): Rates {
  const income = 0.833 * gdp;
  const personal = r.personal * income;
  return { personal, corporate: r.corporate * gdp * profits, sales: r.sales * (income - personal), tariffs: r.tariffs * gdp * imports };
}

/** Bilancio iniziale ricavato dal paese e, se ci sono, dalle entrate e uscite del Factbook. */
export function initialBudget(c: Country, revenueUsd?: number | null, expenditureUsd?: number | null): PlayerBudget {
  const gdp = c.econPower * 1e5;
  const profits = 0.1;
  const imports = 0.12;
  const R = revenueUsd && revenueUsd > 0 ? revenueUsd : 0.17 * gdp;
  const E = expenditureUsd && expenditureUsd > 0 ? expenditureUsd : 0.21 * gdp;
  const base = { corporate: 0.21, sales: 0.02, tariffs: 0.03 };
  // aliquota sulle persone che fa tornare il gettito totale del Factbook
  const fixed = base.corporate * gdp * profits + base.sales * 0.833 * gdp + base.tariffs * gdp * imports;
  const personal = clamp((R - fixed) / (0.833 * gdp * (1 - base.sales)), 0, 0.6);
  const rates: Rates = { personal: Math.round(personal * 1000) / 1000, ...base };
  const aid = c.budget.economicAid + c.budget.humanitarianAid || 0.002 * gdp;
  const defense = c.milSpend;
  const research = 0.03 * E;
  const spending: Spending = { defense, aid, research, social: Math.max(E - defense - aid - research, 0) };
  const balance = Object.values(revenues(rates, gdp, profits, imports)).reduce((s, x) => s + x, 0) - sumSpending(spending);
  return {
    rates, spending,
    proposed: { rates: { ...rates }, spending: { ...spending } },
    reference: { aid, balanceShare: balance / gdp },
    profits, imports, debt: Math.min(0, -0.6 * gdp), popularity: 55,
    monthly: { popularity: 0, growth: 0, profits: 0, imports: 0 },
  };
}

/**
 * Valutazione di un bilancio proposto (FUN_5f0c_1842): gettito, saldo e obiettivi di crescita,
 * profitti, importazioni e popolarità. Si ripete 5 volte perché PIL e crescita convergano.
 */
export function evaluateBudget(b: PlayerBudget, c: Country, rates = b.proposed.rates, spending = b.proposed.spending): BudgetProjection {
  const gdp0 = c.econPower * 1e5;
  const old = { rates: b.rates, spending: b.spending };
  const d = {
    personal: rates.personal - old.rates.personal,
    corporate: rates.corporate - old.rates.corporate,
    sales: rates.sales - old.rates.sales,
    tariffs: rates.tariffs - old.rates.tariffs,
  };
  const rs = old.spending.social ? spending.social / old.spending.social : 1;
  const ra = b.reference.aid ? spending.aid / b.reference.aid : 1;
  const rr = old.spending.research ? spending.research / old.spending.research : 1;
  let growth = c.gdpGrowth;
  let out!: BudgetProjection;
  for (let k = 0; k < 5; k++) {
    const gdp = gdp0 * (1 + growth);
    const rev = revenues(rates, gdp, b.profits, b.imports);
    const totalRevenue = rev.personal + rev.corporate + rev.sales + rev.tariffs;
    const totalSpending = sumSpending(spending);
    const balance = totalRevenue - totalSpending;
    const fiscal = (balance / gdp - b.reference.balanceShare) / 1.92;
    growth = c.gdpGrowth
      - asym(d.personal, 0.3, 0.2) - asym(d.corporate, 0.2, 0.1) - asym(d.sales, 0.2, 0.5) - asym(d.tariffs, 0.3, 0.7)
      - asym(rs - 1, 0.06, 0.1) + (rr > 1 ? Math.min((rr - 1) * 0.011, 0.02) : (rr - 1) * 0.005) - asym(ra - 1, 0.0005, 0.001)
      + (fiscal < 0 ? 1.3 * fiscal : fiscal / 5);
    const profits = b.profits - 0.2 * d.personal + 0.7 * d.tariffs + (rr > 1 ? Math.min((rr - 1) * 0.015, 0.05) : (rr - 1) * 0.025);
    const imports = b.imports - 0.2 * d.personal + 0.05 * d.corporate - asym(d.tariffs, 0.5, 2);
    // dazi (5f0c:2773–289f): alzarli piace se l'economia rallenta, abbassarli scontenta
    const fiscalTerm = fiscal < 0 ? 1.3 * fiscal : fiscal / 5;
    const slowdown = 13 * (growth - 0.03) + 0.2 - rates.tariffs;
    const tariffs = d.tariffs > 0 ? 0.6 * (d.tariffs - fiscalTerm) + 0.1 * slowdown : 20 * d.tariffs;
    const popularity = b.popularity / 100 - asym(d.personal, 4, 2) + 0.2 * d.corporate - asym(d.sales, 8, 5)
      + asym(rs - 1, 0.9, 5) + asym(rr - 1, 0.01, 0.005) - 0.05 * (ra - 1) + fiscal + tariffs;
    out = {
      gdp, revenue: rev, totalRevenue, totalSpending, balance,
      target: { growth, profits: clamp(profits, 0.05, 0.15), imports: clamp(imports, 0.05, 0.15), popularity: clamp(popularity * 100, 0, 100) },
    };
  }
  return out;
}

/**
 * Fine anno (FUN_7124_377e): il bilancio proposto entra in vigore, gli obiettivi fissano le
 * variazioni mensili, la difesa ridimensiona truppe e spesa militare, l'assistenza estera si
 * divide in aiuti economici (66%) e umanitari (34%).
 */
export function applyBudget(b: PlayerBudget, c: Country): BudgetProjection {
  const p = evaluateBudget(b, c);
  const oldDefense = b.spending.defense;
  b.rates = { ...b.proposed.rates };
  b.spending = { ...b.proposed.spending };
  b.monthly = {
    growth: (p.target.growth - c.gdpGrowth) / 12,
    profits: (p.target.profits - b.profits) / 12,
    imports: (p.target.imports - b.imports) / 12,
    popularity: (p.target.popularity - b.popularity) / 12,
  };
  if (oldDefense > 0) c.troops *= b.spending.defense / oldDefense;
  c.milSpend = b.spending.defense;
  c.budget.economicAid = 0.66 * b.spending.aid;
  c.budget.humanitarianAid = 0.34 * b.spending.aid;
  return p;
}

/**
 * Mese (FUN_5f0c_308e): crescita, profitti e importazioni vanno verso gli obiettivi, il saldo
 * si accumula nel debito, la popolarità segue il bilancio e soffre se la crescita è sotto il 3%.
 */
export function monthlyBudget(b: PlayerBudget, c: Country): void {
  c.gdpGrowth += b.monthly.growth;
  b.profits = clamp(b.profits + b.monthly.profits, 0.05, 0.15);
  b.imports = clamp(b.imports + b.monthly.imports, 0.05, 0.15);
  const gdp = c.econPower * 1e5;
  const rev = revenues(b.rates, gdp, b.profits, b.imports);
  const balance = rev.personal + rev.corporate + rev.sales + rev.tariffs - sumSpending(b.spending);
  b.debt = Math.min(0, b.debt + balance / 12);
  const g = b.popularity > 45 ? clamp(c.gdpGrowth, -0.2, 0.1) : c.gdpGrowth;
  const value = g < 0.03 ? (g - 0.03) * 50 / 100 : 0;          // ◇ in frazione: −5 punti % a crescita 2%
  b.popularity = clamp((b.popularity + b.monthly.popularity) * (1 + value), 0, 100);
}

/** Variazione della popolarità per un'azione del giocatore (◇ salvo l'invasione, documentata). */
export function actionPopularity(code: number, affinity: number, targetInfluence: number, worldPeace: number): number {
  const hostile = [6, 12, 14, 15, 16, 20, 21, 24].includes(code);
  if (!hostile) return code <= 5 ? 0.5 : code === 26 ? 1 : 0;
  if (code === 21) {
    // invadere un paese della stessa ideologia costa −(infl + 4)·pace mondiale (max −40), un amico metà
    if (affinity === 5) return -Math.min((targetInfluence + 4) * worldPeace, 40);
    if (affinity === 4) return -Math.min(((targetInfluence + 4) * worldPeace) / 2, 20);
    return affinity === 1 ? 2 : -2;
  }
  if (code === 24) return -30;
  if (affinity >= 4) return -3;
  return affinity === 1 ? 1 : -1;
}
