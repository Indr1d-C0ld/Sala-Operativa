import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { tileOwners, type ScenarioPack } from "../src/index.js";

const lineage = [
  { predecessor: "DDDE", successor: "GM", year: 1990 },
  { predecessor: "SUHH", successor: "RS", year: 1991 },
  { predecessor: "YUCS", successor: "HR", year: 1992 },
  { predecessor: "YUCS", successor: "YI", year: 1992 },
  { predecessor: "YI", successor: "RI", year: 2006 },
];

describe("proprietari delle tessere della carta", () => {
  it("risale ai predecessori e scende ai successori", () => {
    const tiles = ["RS", "HR", "RI", "DDDE", "GM", "XX"];
    expect(tileOwners(tiles, ["SUHH", "YUCS", "DDDE", "GM"], lineage, 1990)).toEqual([0, 1, 1, 2, 3, -1]);
    expect(tileOwners(tiles, ["RS", "HR", "YI", "GM"], lineage, 2000)).toEqual([0, 1, 2, 3, 3, -1]);
    expect(tileOwners(tiles, ["RS", "HR", "RI", "GM"], lineage, 2026)).toEqual([0, 1, 2, 3, 3, -1]);
  });
});

const CARTA = resolve(import.meta.dirname, "../../app/public/mappa/carta.json");
const packOf = (y: number) => resolve(import.meta.dirname, `../../app/public/scenarios/${y}.json`);

describe.skipIf(!existsSync(CARTA) || !existsSync(packOf(1990)))("carta reale", () => {
  const carta = JSON.parse(readFileSync(CARTA, "utf8")) as { tiles: string[]; width: number; height: number };
  for (const year of [1990, 2008, 2026]) {
    it(`${year}: le tessere abitate hanno un paese, e gli stati maggiori sono sulla carta`, () => {
      const pack = JSON.parse(readFileSync(packOf(year), "utf8")) as ScenarioPack;
      const owners = tileOwners(carta.tiles, pack.countries.map((c) => c.code), pack.lineage ?? [], year);
      // senza paese restano solo isole disabitate o assenti dagli scenari: sulla carta sono terra neutra
      const neutral = new Set(["SX", "HM", "AT", "AY", "FS", "RN", "TB", "BV", "IP"]);
      const orphans = carta.tiles.filter((t, k) => owners[k]! < 0 && !neutral.has(t));
      expect(orphans, orphans.join(" ")).toEqual([]);
      const onMap = new Set(owners.map((i) => pack.countries[i]?.code));
      for (const code of year === 1990 ? ["SUHH", "YUCS", "CSHH", "DDDE", "YDYE", "US", "CH"] : ["RS", "UP", "US", "CH", "BR"]) {
        expect(onMap.has(code), code).toBe(true);
      }
      if (year === 1990) {
        expect(pack.countries[owners[carta.tiles.indexOf("RS")]!]!.code).toBe("SUHH");
        expect(pack.countries[owners[carta.tiles.indexOf("HR")]!]!.code).toBe("YUCS");
        expect(pack.countries[owners[carta.tiles.indexOf("YM")]!]!.code).toBe("YEYE");
      }
    });
  }
});
