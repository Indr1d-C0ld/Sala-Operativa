import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { Framebuffer, WIDTH } from "../src/framebuffer.js";
import { drawMap, tileAt, windowToMap, type MapRaster, type MapStyle } from "../src/map.js";

const STYLE: MapStyle = { seaA: 1, seaB: 2, neutral: 3, coast: 4, border: 5, highlight: 6, view: "fisica" };

/** Carta 20×12: mare intorno, due paesi affiancati (tessere 1 e 2) al centro. */
function piccola(): MapRaster {
  const pixels = new Uint8Array(240);
  for (let y = 1; y < 11; y++) for (let x = 1; x < 19; x++) pixels[y * 20 + x] = x < 10 ? 1 : 2;
  return { width: 20, height: 12, tiles: ["AA", "BB"], centroids: [null, null], pixels, relief: new Uint8Array(240).fill(100) };
}
const at = (fb: Framebuffer, x: number, y: number) => fb.pixels[y * WIDTH + x];

describe("carta politica (predefinita)", () => {
  it("ogni paese è a tinta piena; il rilievo sposta solo il tono nella rampa", () => {
    const fb = new Framebuffer();
    // rilievo con tono 8 (centro rampa) → nessuno spostamento; colori dei paesi 200 e 201 (tono 8 e 9)
    const m = { ...piccola(), relief: new Uint8Array(240).fill(88) };
    drawMap(fb, m, 0, 0, [0, 1], (c) => 200 + c, { ...STYLE, view: "politica" });
    expect(at(fb, 0, 0)).toBe(88);                  // il mare resta quello del rilievo
    const interno = [4, 5, 6, 7].flatMap((y) => [4, 5, 6, 7].map((x) => at(fb, x, y)));
    expect(new Set(interno)).toEqual(new Set([200]));
    // un rilievo più chiaro schiarisce il paese di due toni, dentro la sua rampa
    const chiaro = { ...piccola(), relief: new Uint8Array(240).fill(95) };
    drawMap(fb, chiaro, 0, 0, [0, 1], (c) => 200 + c, { ...STYLE, view: "politica" });
    expect(at(fb, 5, 5)).toBe(202);
  });
});

describe("carta con rilievo (vista fisica)", () => {
  it("usa il rilievo come base e vela i paesi a dithering", () => {
    const fb = new Framebuffer();
    drawMap(fb, piccola(), 0, 0, [0, 1], (c) => 200 + c, STYLE);
    expect(at(fb, 0, 0)).toBe(100);                 // il mare è quello del rilievo
    expect(at(fb, 9, 3)).toBe(STYLE.border);        // confine fra i due paesi
    expect(at(fb, 18, 3)).toBe(STYLE.coast);         // costa a destra
    const interno = [4, 5, 6, 7].flatMap((y) => [4, 5, 6, 7].map((x) => at(fb, x, y)));
    expect(interno).toContain(100);
    expect(interno).toContain(200);
  });

  it("contorna il paese scelto e lo vela di più", () => {
    const fb = new Framebuffer();
    drawMap(fb, piccola(), 0, 0, [0, 1], (c) => 200 + c, STYLE, (c) => (c === 1 ? "scelto" : "normale"));
    expect(at(fb, 10, 5)).toBe(STYLE.highlight);
    // blocchi 4×4 interni: quota 4/16 per il paese normale, 10/16 per quello scelto
    const count = (x0: number, c: number) => [4, 5, 6, 7].flatMap((y) => [0, 1, 2, 3].map((dx) => at(fb, x0 + dx, y))).filter((v) => v === c).length;
    expect(count(4, 200)).toBe(4);
    expect(count(12, 201)).toBe(10);
  });

  it("il rilievo pubblicato ha la terra esattamente dove la carta politica", () => {
    const dir = resolve(__dirname, "../../app/public/mappa");
    if (!existsSync(resolve(dir, "rilievo.bin"))) return;
    const carta = readFileSync(resolve(dir, "carta.bin"));
    const rilievo = readFileSync(resolve(dir, "rilievo.bin"));
    expect(rilievo.length).toBe(carta.length);
    // il mare usa solo la rampa blu (80–95), la terra mai
    let sbagliati = 0;
    for (let p = 0; p < carta.length; p++) if ((rilievo[p]! >= 80 && rilievo[p]! < 96) !== (carta[p] === 0)) sbagliati++;
    expect(sbagliati).toBe(0);
  });
});

describe("vista ingrandita", () => {
  it("la finestra si ripete in orizzontale ed è mare fuori dalla carta in verticale", () => {
    const m = { width: 20, height: 12 };
    expect(windowToMap(m, { x: 18, y: 0, w: 40, h: 20, scale: 2 }, 6, 3)).toEqual([1, 1]);
    expect(windowToMap(m, { x: -3, y: 0, w: 40, h: 20, scale: 1 }, 0, 0)).toEqual([17, 0]);
    expect(windowToMap(m, { x: 0, y: 10, w: 40, h: 20, scale: 1 }, 0, 5)).toBeNull();
  });

  it("ingrandisce ogni pixel della carta e trova la tessera sotto il mouse", () => {
    const fb = new Framebuffer();
    const win = { x: 8, y: 4, w: 8, h: 8, scale: 2 };
    drawMap(fb, piccola(), 0, 0, [0, 1], (c) => 200 + c, { ...STYLE, view: "politica" }, () => "normale", win);
    // i pixel (8..11, 4..7) della carta diventano blocchi 2×2: la colonna 9 è il confine fra i paesi
    expect([at(fb, 0, 0), at(fb, 1, 1)]).toEqual([at(fb, 0, 1), at(fb, 1, 0)]);
    expect(at(fb, 2, 0)).toBe(STYLE.border);
    expect(at(fb, 3, 1)).toBe(STYLE.border);
    expect(at(fb, 8, 0)).toBe(0);                   // fuori dalla finestra non si disegna
    expect(tileAt(piccola(), 1, 1, win)).toBe(0);
    expect(tileAt(piccola(), 5, 1, win)).toBe(1);
    expect(tileAt(piccola(), 9, 1, win)).toBe(-1);   // fuori dalla finestra
  });

  it("la carta 4× ha le stesse tessere della carta base e un rilievo delle stesse dimensioni", () => {
    const dir = resolve(__dirname, "../../app/public/mappa");
    if (!existsSync(resolve(dir, "carta_2560.json"))) return;
    const base = JSON.parse(readFileSync(resolve(dir, "carta.json"), "utf8"));
    const grande = JSON.parse(readFileSync(resolve(dir, "carta_2560.json"), "utf8"));
    expect(grande.tiles).toEqual(base.tiles);
    expect([grande.width, grande.height]).toEqual([base.width * 4, base.height * 4]);
    const carta = readFileSync(resolve(dir, "carta_2560.bin"));
    expect(carta.length).toBe(grande.width * grande.height);
    if (!existsSync(resolve(dir, "rilievo_2560.bin"))) return;
    const rilievo = readFileSync(resolve(dir, "rilievo_2560.bin"));
    expect(rilievo.length).toBe(carta.length);
    // il mare è sempre blu (sulla terra il blu c'è solo nei laghi)
    let sbagliati = 0;
    for (let p = 0; p < carta.length; p++) if (carta[p] === 0 && !(rilievo[p]! >= 80 && rilievo[p]! < 96)) sbagliati++;
    expect(sbagliati).toBe(0);
  });
});
