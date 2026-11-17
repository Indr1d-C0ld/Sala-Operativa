import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { forme, maiuscola, parametri, voce } from "../src/paesi.js";
import { fill } from "../src/testo.js";

const f = (code: string) => forme(voce(code), code);

describe("nomi dei paesi con articoli e preposizioni", () => {
  it("forme tipiche", () => {
    expect(f("CH")).toMatchObject({ il: "la Cina", di: "della Cina", in: "in Cina", a: "alla Cina" });
    expect(f("US")).toMatchObject({ il: "gli Stati Uniti", di: "degli Stati Uniti", in: "negli Stati Uniti", da: "dagli Stati Uniti" });
    expect(f("IT")).toMatchObject({ il: "l'Italia", di: "dell'Italia", in: "in Italia" });
    expect(f("UK")).toMatchObject({ il: "il Regno Unito", in: "nel Regno Unito" });
    expect(f("CU")).toMatchObject({ il: "Cuba", di: "di Cuba", in: "a Cuba", a: "a Cuba" });
    expect(f("AA")).toMatchObject({ in: "ad Aruba" });
    expect(f("RP")).toMatchObject({ il: "le Filippine", in: "nelle Filippine" });
    expect(f("YM")).toMatchObject({ il: "lo Yemen", di: "dello Yemen" });
    expect(f("IS")).toMatchObject({ il: "Israele", in: "in Israele" });
    expect(f("SUHH")).toMatchObject({ il: "l'Unione Sovietica", su: "sull'Unione Sovietica" });
  });

  it("le frasi prendono articolo e maiuscola", () => {
    const p = { ...parametri("attore", f("US")), ...parametri("paese", f("KN")) };
    expect(maiuscola(fill("{attore_il} contro {paese_il}", p))).toBe("Gli Stati Uniti contro la Corea del Nord");
    expect(fill("Attacco {attore_di} {paese_in}", p)).toBe("Attacco degli Stati Uniti in Corea del Nord");
  });

  const dir = resolve(import.meta.dirname, "../public/scenarios");
  it.skipIf(!existsSync(resolve(dir, "2026.json")))("ogni paese di ogni anno ha la sua voce, con un nome unico", () => {
    const codes = new Set<string>();
    for (let y = 1990; y <= 2026; y++) {
      const file = resolve(dir, `${y}.json`);
      if (!existsSync(file)) continue;
      for (const c of (JSON.parse(readFileSync(file, "utf8")) as { countries: { code: string }[] }).countries) codes.add(c.code);
    }
    const missing = [...codes].filter((c) => !voce(c));
    expect(missing).toEqual([]);
    const names = [...codes].map((c) => voce(c)!.nome);
    expect(new Set(names).size).toBe(names.length);
  });
});
