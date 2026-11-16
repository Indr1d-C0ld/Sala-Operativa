import { CELL_H, CELL_W, type BitmapFont } from "./font.js";
import type { Framebuffer } from "./framebuffer.js";
import { RAMP } from "./palette.js";

/** Tema dei colori d'interfaccia: testo verde terminale su fondo nero, finestre grigio-blu. */
export interface Theme {
  text: number;
  textDim: number;
  textHighlight: number;
  background: number;
  windowFace: number;
  windowLight: number;
  windowDark: number;
  titleBar: number;
  titleText: number;
  selection: number;
}

export const DEFAULT_THEME: Theme = {
  text: RAMP.green + 12,
  textDim: RAMP.green + 7,
  textHighlight: RAMP.amber + 14,
  background: RAMP.black,
  windowFace: RAMP.grey + 2,
  windowLight: RAMP.grey + 9,
  windowDark: RAMP.grey + 0,
  titleBar: RAMP.blue + 6,
  titleText: RAMP.grey + 15,
  selection: RAMP.green + 4,
};

/** Finestra con cornice in rilievo e barra del titolo; restituisce l'area interna. */
export function drawWindow(
  fb: Framebuffer, font: BitmapFont, theme: Theme,
  x: number, y: number, w: number, h: number, title: string,
): { x: number; y: number; w: number; h: number } {
  fb.fillRect(x, y, w, h, theme.windowFace);
  fb.bevel(x, y, w, h, theme.windowLight, theme.windowDark);
  fb.fillRect(x + 2, y + 2, w - 4, CELL_H + 2, theme.titleBar);
  font.draw(fb, title, x + 6, y + 3, theme.titleText);
  const inner = { x: x + 4, y: y + CELL_H + 6, w: w - 8, h: h - CELL_H - 10 };
  fb.fillRect(inner.x, inner.y, inner.w, inner.h, theme.background);
  fb.bevel(inner.x - 1, inner.y - 1, inner.w + 2, inner.h + 2, theme.windowLight, theme.windowDark, true);
  return inner;
}

/** Elenco scorrevole a righe di testo, con la riga selezionata evidenziata. */
export function drawList(
  fb: Framebuffer, font: BitmapFont, theme: Theme,
  area: { x: number; y: number; w: number; h: number }, rows: string[], selected: number, top: number,
): void {
  const visible = Math.floor(area.h / CELL_H);
  const cols = Math.floor(area.w / CELL_W);
  fb.setClip(area.x, area.y, area.w, area.h);
  for (let r = 0; r < visible && top + r < rows.length; r++) {
    const i = top + r;
    const y = area.y + r * CELL_H;
    if (i === selected) fb.fillRect(area.x, y, area.w, CELL_H, theme.selection);
    font.draw(fb, rows[i]!.slice(0, cols), area.x, y, i === selected ? theme.textHighlight : theme.text);
  }
  fb.resetClip();
}

/** Barra orizzontale a dithering per un valore 0..1 (es. un'ansia). */
export function drawGauge(fb: Framebuffer, x: number, y: number, w: number, value: number, a: number, b: number): void {
  const filled = Math.round(Math.min(Math.max(value, 0), 1) * w);
  fb.ditherRect(x, y, filled, CELL_H - 4, a, b, 10);
  fb.fillRect(x + filled, y, w - filled, CELL_H - 4, RAMP.grey + 1);
}
