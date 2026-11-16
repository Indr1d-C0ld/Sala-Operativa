import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { classicRules as rules, generationRules } from "@melchior/data";
import { ADVISORS, advisorReport, cabinetBriefing, Simulation, worldFromPack, type ScenarioPack } from "../src/index.js";

const PACK = resolve(import.meta.dirname, "../../app/public/scenarios/2026.json");
const TEXTS = resolve(import.meta.dirname, "../../app/src/testi/it.json");

describe.skipIf(!existsSync(PACK))("consiglieri", () => {
  const w = worldFromPack(JSON.parse(readFileSync(PACK, "utf8")) as ScenarioPack, rules, generationRules, 2026);
  const idx = (k: string) => w.countries.findIndex((c) => c.key === k);
  const sim = new Simulation({ world: w, rules, seed: 2, start: new Date(Date.UTC(2026, 0, 1)), player: idx("US") });
  sim.advanceDays(120);
  const texts = JSON.parse(readFileSync(TEXTS, "utf8")) as { rapporti: Record<string, string>; pareri: Record<string, string>; consiglieri: Record<string, unknown> };

  it("ogni consigliere riferisce, e ogni riga ha il suo testo italiano", () => {
    for (const who of ADVISORS) {
      expect(texts.consiglieri[who], who).toBeDefined();
      for (const k of ["IR", "UK", "CH", "KN", "BR", "US"]) {
        const lines = advisorReport(sim.advisorContext(), who, idx(k));
        expect(lines.length, `${who} su ${k}`).toBeGreaterThan(0);
        for (const l of lines) if (l.key !== "pressNews") expect(texts.rapporti[l.key], l.key).toBeDefined();
      }
    }
  });

  it("i pareri seguono il buon senso e hanno il loro testo", () => {
    const ctx = sim.advisorContext();
    const invadeAlly = cabinetBriefing(ctx, idx("UK"), 21);
    expect(invadeAlly.opinions.find((o) => o.advisor === "state")!.stance).toBe(-2);
    const envoy = cabinetBriefing(ctx, idx("UK"), 2);
    expect(envoy.opinions.find((o) => o.advisor === "state")!.stance).toBe(2);
    expect(envoy.chance).not.toBeNull();
    const nuke = cabinetBriefing(ctx, idx("KN"), 24);
    expect(nuke.opinions.find((o) => o.advisor === "defense")!.stance).toBe(-2);
    for (const b of [invadeAlly, envoy, nuke]) for (const o of b.opinions) expect(texts.pareri[o.reason], o.reason).toBeDefined();
  });
});
