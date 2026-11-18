import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { classicRules as rules, generationRules } from "@melchior/data";
import { canInvade, deployTroops, endWar, growDeployments, homeTroops, hostChance, reinforce, Rng, Simulation, startWar, warOf, warsOf, worldFromPack, type ScenarioPack } from "../src/index.js";

const dir = resolve(import.meta.dirname, "../../app/public/scenarios");
const fresh = (y = 2026) => worldFromPack(JSON.parse(readFileSync(resolve(dir, `${y}.json`), "utf8")) as ScenarioPack, rules, generationRules, y);
const idx = (w: ReturnType<typeof fresh>, k: string) => w.countries.findIndex((c) => c.key === k);

describe.skipIf(!existsSync(resolve(dir, "2026.json")) || !existsSync(resolve(dir, "1990.json")))("truppe all'estero e alleati", () => {
  it("i contingenti di partenza seguono l'anno", () => {
    const w90 = fresh(1990);
    const has = (w: ReturnType<typeof fresh>, o: string, l: string) => w.deployments.some((d) => d.owner === idx(w, o) && d.location === idx(w, l));
    expect(has(w90, "US", "GM")).toBe(true);
    expect(has(w90, "SUHH", "DDDE")).toBe(true);
    const w26 = fresh(2026);
    expect(has(w26, "US", "KS")).toBe(true);
    expect(has(w26, "US", "IZ")).toBe(false);
    for (const d of w26.deployments) expect(homeTroops(w26, d.owner)).toBeGreaterThan(0);
  });

  it("verso un amico le truppe vanno nel paese, verso un rivale ai suoi confini", () => {
    const w = fresh();
    const us = idx(w, "US");
    const friendly = deployTroops(w, rules, new Rng(1), us, idx(w, "PL"), 20000, 0);
    expect(friendly.kind).toBe("stationed");
    let staged = false;
    for (let s = 1; s < 30 && !staged; s++) {
      const out = deployTroops(w, rules, new Rng(s), us, idx(w, "IR"), 20000, 0);
      if (out.kind === "staged") {
        staged = true;
        expect(w.neighbours[idx(w, "IR")]).toContain(out.host);
      }
    }
    expect(staged).toBe(true);
  });

  it("il contingente nasce vuoto e cresce ogni settimana fino al livello ordinato", () => {
    const w = fresh();
    const us = idx(w, "US");
    const pl = idx(w, "PL");
    expect(hostChance(w, rules, us, pl)).toBeGreaterThan(50);           // un alleato accetta volentieri
    const out = deployTroops(w, rules, new Rng(1), us, pl, 50000, 0);
    expect(out.kind).toBe("stationed");
    const d = w.deployments.find((x) => x.owner === us && x.location === pl)!;
    expect(d.troops).toBe(0);
    expect(d.ordered).toBe(50000);
    growDeployments(w);
    expect(d.troops).toBeGreaterThan(0);
    for (let k = 0; k < 20; k++) growDeployments(w);
    expect(d.troops).toBe(50000);
  });

  it("chi invade un paese già in guerra si unisce agli attaccanti", () => {
    const w = fresh();
    const war = startWar(w, rules, idx(w, "KN"), idx(w, "KS"), 0);
    const again = startWar(w, rules, idx(w, "CH"), idx(w, "KS"), 0);
    expect(again).toBe(war);
    expect(war.sides[0].countries).toContain(idx(w, "CH"));
    expect(w.wars).toHaveLength(1);
    // la Corea del Nord può combattere anche su un altro fronte
    startWar(w, rules, idx(w, "KN"), idx(w, "CH"), 0);
    expect(warsOf(w, idx(w, "KN"))).toHaveLength(2);
  });

  it("le truppe schierate ai confini rendono possibile un'invasione lontana", () => {
    const w = fresh();
    const fr = idx(w, "FR");
    const ir = idx(w, "IR");
    expect(canInvade(w, rules, fr, ir, 100)).toBe(false);
    const host = w.neighbours[ir]![0]!;
    w.deployments.push({ owner: fr, location: host, troops: 20000, initial: 20000, sent: 0, arrive: 50 });
    expect(canInvade(w, rules, fr, ir, 40)).toBe(false);          // non ancora arrivate
    expect(canInvade(w, rules, fr, ir, 60)).toBe(true);
  });

  it("chi ha truppe nel paese invaso lo difende, anche se arriva dopo", () => {
    const w = fresh();
    const kn = idx(w, "KN");
    const ks = idx(w, "KS");
    const us = idx(w, "US");
    const war = startWar(w, rules, kn, ks, 10);
    expect(war.sides[1].countries).toContain(us);                // i soldati americani in Corea del Sud
    const jp = idx(w, "JA");
    w.deployments.push({ owner: jp, location: ks, troops: 5000, initial: 5000, sent: 10, arrive: 20 });
    expect(reinforce(w, war, 15)).toEqual([]);
    expect(reinforce(w, war, 20)).toEqual([jp]);
    expect(war.sides[1].countries).toContain(jp);
  });

  it("a fine guerra le truppe sconfitte si arrendono, le altre tornano a casa", () => {
    const w = fresh();
    const kn = idx(w, "KN");
    const ks = idx(w, "KS");
    const us = idx(w, "US");
    const usTroops = w.countries[us]!.troops;
    const contingent = w.deployments.find((d) => d.owner === us && d.location === ks)!.troops;
    const war = startWar(w, rules, kn, ks, 0);
    const surrendered = endWar(w, war, 1);
    expect(surrendered.some((d) => d.owner === us)).toBe(true);
    expect(w.countries[us]!.troops).toBeCloseTo(usTroops - contingent, 0);
    expect(w.deployments.some((d) => d.location === ks)).toBe(false);
  });

  it("se cede la difesa degli Stati Uniti decide il giocatore", () => {
    const w = fresh();
    const us = idx(w, "US");
    const sim = new Simulation({ world: w, rules, seed: 1, start: new Date(Date.UTC(2026, 0, 1)), player: us, interactive: true, elections: false });
    const war = startWar(w, rules, idx(w, "MX"), us, sim.day);
    war.sides[1].troops = 0;
    war.sides[1].contributions = war.sides[1].contributions.map(() => 0);   // i soldati al fronte sono caduti
    sim.advanceDay();
    expect(sim.pending?.kind).toBe("surrender");
    const day = sim.day;
    sim.advanceDays(5);
    expect(sim.day).toBe(day);                                     // il tempo è fermo
    sim.decideSurrender("troops");
    expect(sim.reports.some((r) => r.key === "mobilization")).toBe(true);
    expect(war.sides[1].troops).toBeGreaterThan(0);
    expect(warOf(sim.world, us)).toBeDefined();
    expect(sim.gameOver).toBeNull();
  });
});
