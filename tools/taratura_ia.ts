/**
 * Banco di misura dell'IA: simula molte partite senza interfaccia e conta che cosa succede nel
 * mondo (azioni IA per tipo ed esito, guerre, annessioni, atomiche, cambi di regime, pace
 * mondiale, PIL mondiale, paesi rimasti). Serve a tarare `rules.ai` e i parametri vicini.
 *
 * Le partite sono "interattive" come quelle vere, con un giocatore automatico che non reagisce
 * alle aggressioni, respinge le proposte e alla resa ordina la mobilitazione.
 *
 * Uso (servono gli scenari: npm run scenari):
 *   npm run taratura
 *   TARATURA='{"anni":[1990,2026],"durata":10,"semi":6,"deriva":0}' npm run taratura
 *   TARATURA='{"regole":{"ai":{"turnEveryDays":14}}}' npm run taratura
 * `regole` si fonde con le regole classiche; il riepilogo esce in tabella sul terminale e,
 * con "json":"file.json", anche in un file. Con DEBUG=1 stampa anche ogni guerra (con relazione,
 * squadre e ideologie), cambio di regime e disordine dal quarto stadio in su.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { it } from "vitest";
import { classicRules, generationRules } from "@melchior/data";
import { relationLevel, Simulation, worldFromPack, type Rules, type ScenarioPack } from "@melchior/core";

interface Opzioni {
  anni: number[];
  durata: number;
  semi: number;
  deriva: number;
  regole?: Record<string, unknown>;
  json?: string;
}

const opz: Opzioni = { anni: [1990, 2026], durata: 10, semi: 5, deriva: 0, ...JSON.parse(process.env.TARATURA ?? "{}") };

function fondi<T>(base: T, extra: unknown): T {
  if (extra === null || typeof extra !== "object" || Array.isArray(extra)) return (extra ?? base) as T;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(extra)) out[k] = fondi(out[k], v);
  return out as T;
}
const rules: Rules = fondi(classicRules, opz.regole ?? {});

const NOMI_AZIONI = [
  "inviato di pace", "aiuti", "relazioni", "alleanza", "pressioni pace", "commercio",
  "condanna", "aiuti economici", "nazione favorita", "regolato", "limitato", "embargo",
  "armi ai ribelli", "spionaggio", "sabotaggio", "golpe", "assassinio", "negoziato",
  "spesa militare", "spesa nucleare", "attacco chirurgico", "invasione",
  "riduz. nucleare", "comm. nucleare", "attacco nucleare", "truppe", "aiuti emergenza",
];

/** Conteggi di una partita, per anno di gioco. */
interface Misura {
  azioni: number[];            // azioni IA eseguite per codice
  riuscite: number[];          // di cui riuscite
  guerre: number;
  vittorie: number;            // annessioni
  respinte: number;
  paci: number;
  atomiche: number;
  allerte: number;
  esercitazioni: number;
  regimi: number;              // cambi di regime (golpe e disordini)
  disordini: number;
  truppe: number;
  pace: number;                // pace mondiale media
  pil: number;                 // PIL mondiale finale / iniziale
  paesi: number;               // paesi attivi finali / iniziali
  usaAnnessi: number;
  escalation: number;          // atomiche messe in coda dall'escalation in guerra
  etica: number[];             // distribuzione iniziale dell'etica (1–6)
  conquiste: Map<string, number>;
  lanci: Map<string, number>;  // attacchi nucleari "chi→contro chi"
  scelte: Record<string, number>; // pause per una scelta del giocatore, per tipo
}

function partita(anno: number, seme: number): Misura {
  const pack = JSON.parse(readFileSync(resolve(import.meta.dirname, `../packages/app/public/scenarios/${anno}.json`), "utf8")) as ScenarioPack;
  const world = worldFromPack(pack, rules, generationRules, seme, { drift: opz.deriva, protect: ["US"] });
  const player = world.countries.findIndex((c) => c.key === "US");
  const sim = new Simulation({ world, rules, seed: seme, start: new Date(Date.UTC(anno, 0, 1)), player, interactive: true });
  const m: Misura = {
    azioni: Array(27).fill(0), riuscite: Array(27).fill(0), guerre: 0, vittorie: 0, respinte: 0, paci: 0,
    atomiche: 0, allerte: 0, esercitazioni: 0, regimi: 0, disordini: 0, truppe: 0, pace: 0, pil: 0, paesi: 0,
    usaAnnessi: 0, escalation: 0, etica: Array(7).fill(0), conquiste: new Map(), lanci: new Map(), scelte: { reaction: 0, decision: 0, surrender: 0 },
  };
  for (const c of world.countries) if (c.econPower > 0) m.etica[Math.round(c.ethic)]!++;
  // l'escalation passa da queueAction (privato) con il codice 24: la contiamo a parte
  const s = sim as unknown as { queueAction: (a: number, t: number, code: number, d: number, h?: number, amount?: number) => void };
  const originale = s.queueAction.bind(sim);
  s.queueAction = (a, t, code, d, h, amount) => {
    if (code === 24) m.escalation++;
    originale(a, t, code, d, h, amount);
  };
  const pil = () => sim.world.countries.reduce((s, c) => s + c.econPower, 0);
  const attivi = () => sim.world.countries.filter((c) => c.econPower > 0).length;
  const pil0 = pil();
  const paesi0 = attivi();
  const giorni = Math.round(opz.durata * 365.25);
  let campioni = 0;
  for (let g = 0; g < giorni && !sim.gameOver; g++) {
    sim.advanceDay();
    // giocatore automatico: nessuna reazione, proposte respinte, truppe al fronte quando cede la difesa
    for (let k = 0; k < 20 && sim.pending; k++) {
      const p = sim.pending;
      m.scelte[p.kind] = (m.scelte[p.kind] ?? 0) + 1;
      if (p.kind === "reaction") sim.react("none");
      else if (p.kind === "decision") sim.decide(false);
      else if (p.kind === "surrender") sim.decideSurrender("troops");
    }
    if (g % 7 === 0) {
      m.pace += sim.world.worldPeace;
      campioni++;
    }
    for (const r of sim.reports) {
      switch (r.key) {
        case "aiActionSucceeded":
        case "aiActionFailed":
          m.azioni[r.action!]!++;
          if (r.key === "aiActionSucceeded") m.riuscite[r.action!]!++;
          break;
        case "warStarted":
          if (process.env.DEBUG) console.log("guerra", sim.date.toISOString().slice(0, 10), sim.world.countries[r.actor!]!.key, "→", sim.world.countries[r.country!]!.key, "relazione", relationLevel(sim.world, rules, r.actor!, r.country!, 0), "squadre", sim.world.countries[r.actor!]!.team, sim.world.countries[r.country!]!.team, sim.world.countries[r.actor!]!.ideology, sim.world.countries[r.country!]!.ideology);
          m.guerre++; m.azioni[21]!++; m.riuscite[21]!++; break;
        case "warWon": {
          m.vittorie++;
          const k = `${sim.world.countries[r.actor!]!.key}→${sim.world.countries[r.country!]!.key}`;
          m.conquiste.set(k, (m.conquiste.get(k) ?? 0) + 1);
          break;
        }
        case "warRepelled": m.respinte++; break;
        case "peaceNegotiated": m.paci++; break;
        case "nuclearStrike": {
          const k = `${sim.world.countries[r.actor!]!.key}→${sim.world.countries[r.country!]!.key}`;
          m.lanci.set(k, (m.lanci.get(k) ?? 0) + 1);
        }
          m.atomiche++; m.azioni[24]!++; m.riuscite[24]!++; break;
        case "nuclearAlert": m.allerte++; m.azioni[24]!++; break;
        case "militaryExercises": m.esercitazioni++; m.azioni[21]!++; break;
        case "regimeChange":
          if (process.env.DEBUG) console.log("regime", sim.date.toISOString().slice(0, 10), sim.world.countries[r.country!]!.key, "→", sim.world.countries[r.country!]!.ideology, "LER", sim.world.countries[r.country!]!.ler.toFixed(2));
          m.regimi++;
          break;
        case "socialHappened":
          if (process.env.DEBUG && r.stage! >= 4) console.log("disordini", sim.date.toISOString().slice(0, 10), sim.world.countries[r.country!]!.key, "stadio", r.stage, "LER", sim.world.countries[r.country!]!.ler.toFixed(2));
          m.disordini++;
          break;
        case "troopsDeployed": m.truppe++; m.azioni[25]!++; m.riuscite[25]!++; break;
        case "deployRefused": m.azioni[25]!++; break;
      }
    }
    sim.reports.length = 0;
  }
  if (sim.gameOver === "playerConquered") m.usaAnnessi = 1;
  m.pace /= Math.max(campioni, 1);
  m.pil = pil() / pil0;
  m.paesi = attivi() / paesi0;
  return m;
}

const fmt = (x: number, d = 1) => x.toFixed(d).padStart(7);

it("taratura dell'IA", { timeout: 3_600_000 }, () => {
  const mancanti = opz.anni.filter((a) => !existsSync(resolve(import.meta.dirname, `../packages/app/public/scenarios/${a}.json`)));
  if (mancanti.length) throw new Error(`mancano gli scenari ${mancanti.join(", ")}: npm run scenari`);
  const riepilogo: Record<string, unknown> = { opzioni: opz };
  const righe: string[] = [];
  for (const anno of opz.anni) {
    const ms = Array.from({ length: opz.semi }, (_, s) => partita(anno, 1000 + s));
    const anniTot = opz.durata * ms.length;
    const somma = (f: (m: Misura) => number) => ms.reduce((s, m) => s + f(m), 0);
    const perAnno = (f: (m: Misura) => number) => somma(f) / anniTot;
    const media = (f: (m: Misura) => number) => somma(f) / ms.length;
    const conquiste = new Map<string, number>();
    const lanci = new Map<string, number>();
    for (const m of ms) for (const [k, v] of m.conquiste) conquiste.set(k, (conquiste.get(k) ?? 0) + v);
    for (const m of ms) for (const [k, v] of m.lanci) lanci.set(k, (lanci.get(k) ?? 0) + v);
    const r = {
      azioniAnno: perAnno((m) => m.azioni.reduce((a, b) => a + b, 0)),
      guerre: perAnno((m) => m.guerre), annessioni: perAnno((m) => m.vittorie), respinte: perAnno((m) => m.respinte),
      paci: perAnno((m) => m.paci), atomiche: perAnno((m) => m.atomiche), allerte: perAnno((m) => m.allerte),
      esercitazioni: perAnno((m) => m.esercitazioni), regimi: perAnno((m) => m.regimi), disordini: perAnno((m) => m.disordini),
      truppe: perAnno((m) => m.truppe), pace: media((m) => m.pace), pil: media((m) => m.pil), paesi: media((m) => m.paesi),
      usaAnnessi: somma((m) => m.usaAnnessi), escalation: perAnno((m) => m.escalation),
      etica: [1, 2, 3, 4, 5, 6].map((e) => somma((m) => m.etica[e]!) / ms.length),
      perPartita: ms.map((m) => [m.vittorie, m.atomiche, Number(m.pil.toFixed(2))]),
      scelte: ["reaction", "decision", "surrender"].map((k) => perAnno((m) => m.scelte[k] ?? 0)),
      lanci: [...lanci].sort((a, b) => b[1] - a[1]).slice(0, 8),
      conquistatori: [...conquiste].sort((a, b) => b[1] - a[1]).slice(0, 25),
      perAzione: NOMI_AZIONI.map((nome, c) => ({ nome, anno: perAnno((m) => m.azioni[c]!), riuscita: somma((m) => m.azioni[c]!) ? somma((m) => m.riuscite[c]!) / somma((m) => m.azioni[c]!) : 0 })),
    };
    riepilogo[anno] = r;
    righe.push(`\n== ${anno}: ${opz.semi} partite di ${opz.durata} anni, deriva ${opz.deriva} ==`);
    righe.push(`azioni IA/anno ${fmt(r.azioniAnno)}   pace media ${fmt(r.pace, 2)}   PIL finale ×${r.pil.toFixed(2)}   paesi rimasti ${(r.paesi * 100).toFixed(0)}%   USA annessi ${r.usaAnnessi}`);
    righe.push(`per anno: guerre ${fmt(r.guerre, 2)}  annessioni ${fmt(r.annessioni, 2)}  respinte ${fmt(r.respinte, 2)}  paci ${fmt(r.paci, 2)}  esercitazioni ${fmt(r.esercitazioni, 2)}`);
    righe.push(`          atomiche ${fmt(r.atomiche, 2)}  allerte ${fmt(r.allerte, 2)}  regimi ${fmt(r.regimi, 2)}  disordini ${fmt(r.disordini, 1)}  truppe ${fmt(r.truppe, 2)}`);
    righe.push(`          escalation nucleare ${fmt(r.escalation, 2)}   etica iniziale (1…6): ${r.etica.map((x) => x.toFixed(0)).join(" ")}`);
    righe.push(`per partita [annessioni, atomiche, PIL]: ${r.perPartita.map((x) => `[${x.join(" ")}]`).join(" ")}`);
    const quota = (codici: number[]) => (codici.reduce((t, c) => t + r.perAzione[c]!.anno, 0) / r.azioniAnno * 100).toFixed(0).padStart(3);
    righe.push(`composizione %: diplomazia ${quota([0, 1, 2, 3, 4, 5, 6, 26])}  economia ${quota([7, 8, 9, 10, 11])}  coperte ${quota([12, 13, 14, 15, 16])}  militari ${quota([17, 18, 19, 20, 21, 25])}  nucleari ${quota([22, 23, 24])}`);
    righe.push(`pause per il giocatore/anno: allarmi ${fmt(r.scelte[0]!, 2)}  proposte ${fmt(r.scelte[1]!, 2)}  rese ${fmt(r.scelte[2]!, 2)}`);
    righe.push(`attacchi nucleari: ${r.lanci.map(([k, v]) => `${k} ${v}`).join(", ") || "nessuno"}`);
    righe.push(`conquistatori: ${r.conquistatori.map(([k, v]) => `${k} ${v}`).join(", ") || "nessuno"}`);
    righe.push(r.perAzione.filter((a) => a.anno > 0).map((a) => `  ${a.nome.padEnd(18)}${fmt(a.anno, 2)}/anno  riuscita ${(a.riuscita * 100).toFixed(0).padStart(3)}%`).join("\n"));
  }
  console.log(righe.join("\n"));
  if (opz.json) writeFileSync(opz.json, JSON.stringify(riepilogo, null, 1));
});
