import { describe, expect, it } from "vitest";
import it_ from "../src/testi/it.json";
import en from "../src/testi/en.json";
import paesiIt from "../src/testi/paesi.json";
import paesiEn from "../src/testi/paesi.en.json";
import { formeEn, voceEn } from "../src/paesi.js";

/** Tutte le stringhe di un catalogo, con il loro percorso (chiave.indice…). */
function stringhe(x: unknown, path = ""): Map<string, string> {
  const out = new Map<string, string>();
  if (typeof x === "string") out.set(path, x);
  else if (Array.isArray(x)) x.forEach((y, k) => stringhe(y, `${path}[${k}]`).forEach((v, p) => out.set(p, v)));
  else if (x && typeof x === "object") for (const [k, y] of Object.entries(x)) stringhe(y, path ? `${path}.${k}` : k).forEach((v, p) => out.set(p, v));
  return out;
}

/** Radici dei segnaposto: {paese_il} e {paese_di} contano come "paese" (le forme cambiano con la lingua). */
const radici = (s: string) => new Set([...s.matchAll(/\{(\w+?)(?:_\w+)?\}/g)].map((m) => m[1]!).sort());

describe("cataloghi italiano e inglese", () => {
  const IT = stringhe(it_);
  const EN = stringhe(en);

  it("hanno le stesse chiavi e le stesse liste", () => {
    expect([...EN.keys()].sort()).toEqual([...IT.keys()].sort());
  });

  it("usano gli stessi segnaposto", () => {
    for (const [k, v] of IT) expect([...radici(EN.get(k) ?? "")], k).toEqual([...radici(v)]);
  });

  it("le righe d'aiuto stanno nella barra in basso (78 caratteri)", () => {
    for (const c of [it_, en]) {
      for (const k of ["aiuto", "aiutoMenu", "aiutoScelta", "aiutoBilancio", "aiutoConsiglieri", "aiutoTitolo", "fineAiuto"] as const) {
        expect(c[k].length, k).toBeLessThanOrEqual(78);
      }
      for (const m of c.modiColore) expect(c.aiutoMappa.replace("{colori}", m).length).toBeLessThanOrEqual(78);
    }
  });
});

describe("nomi inglesi dei paesi", () => {
  it("ogni paese della tabella italiana ha il suo nome inglese, unico", () => {
    const codes = Object.keys(paesiIt);
    expect(codes.filter((c) => !(c in paesiEn))).toEqual([]);
    const names = Object.values(paesiEn).map((v) => v.nome);
    expect(new Set(names).size).toBe(names.length);
  });

  it("forme con e senza articolo", () => {
    expect(formeEn(voceEn("US"), "US")).toMatchObject({ nome: "United States", il: "the United States", di: "of the United States", in: "in the United States" });
    expect(formeEn(voceEn("CH"), "CH")).toMatchObject({ il: "China", a: "to China", da: "from China" });
    expect(formeEn(voceEn("RP"), "RP").il).toBe("the Philippines");
    expect(formeEn(voceEn("SUHH"), "SUHH").il).toBe("the Soviet Union");
    expect(formeEn(voceEn("KN"), "KN").nome).toBe("North Korea");
  });
});
