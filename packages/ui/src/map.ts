import type { Framebuffer } from "./framebuffer.js";

/** Carta politica rasterizzata (tools/build_map.py): un byte per pixel, 0 = mare, k = tessera k-1. */
export interface MapRaster {
  width: number;
  height: number;
  tiles: string[];
  centroids: ([number, number] | null)[];
  pixels: Uint8Array;
  /**
   * Rilievo pixel-art (tools/build_relief.py, convertito con PixelLab): un indice di palette per
   * pixel, stesse dimensioni e stessi pixel di terra della carta. Se c'è fa da base al disegno.
   */
  relief?: Uint8Array;
}

export interface MapStyle {
  seaA: number;
  seaB: number;
  /** Terre che non appartengono a nessun paese dello scenario (solo senza rilievo). */
  neutral: number;
  /** Linea di costa e confini fra stati. */
  coast: number;
  border: number;
  /** Contorno del paese evidenziato. */
  highlight?: number;
  /**
   * "politica" (predefinita): ogni paese a tinta piena, con il rilievo ridotto a una leggera
   * variazione di tono dentro la rampa del colore. "fisica": il rilievo con una velatura.
   */
  view?: "politica" | "fisica";
}

/**
 * Finestra su una carta più grande dello schermo (vista per regione e per paese): l'angolo in
 * alto a sinistra (x, y) in pixel della carta, le dimensioni (w, h) in pixel dello schermo e
 * l'ingrandimento intero `scale`. In orizzontale la carta si ripete (il Pacifico si attraversa),
 * in verticale fuori dalla carta c'è mare.
 */
export interface MapWindow { x: number; y: number; w: number; h: number; scale: number }

/** Pixel della carta sotto un punto della finestra, o null fuori dalla carta in verticale. */
export function windowToMap(map: { width: number; height: number }, win: MapWindow, sx: number, sy: number): [number, number] | null {
  const my = win.y + Math.floor(sy / win.scale);
  if (my < 0 || my >= map.height) return null;
  const mx = (((win.x + Math.floor(sx / win.scale)) % map.width) + map.width) % map.width;
  return [mx, my];
}

/** Quanto risalta un paese sopra il rilievo. */
export type MapEmphasis = "normale" | "sopra" | "scelto";

/** Matrice di Bayer 4×4, come in framebuffer.ts. */
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
/** Quota del colore del paese sul rilievo (su 16), per livello di evidenza. */
const COVER: Record<MapEmphasis, number> = { normale: 4, sopra: 6, scelto: 10 };

/**
 * Disegna la carta in (x, y). `owners` dà per ogni tessera il paese (-1 = nessuno), `colorOf`
 * il colore di un paese. I confini si tracciano solo fra paesi diversi: nel 1990 le repubbliche
 * sovietiche sono un'unica macchia.
 *
 * Con il rilievo, il colore del paese è una velatura a dithering ordinato sopra la pixel-art
 * (un pixel su quattro, di più per il paese sotto il mouse o scelto, che ha anche il contorno
 * in `style.highlight`). Senza rilievo il paese è una campitura piena.
 *
 * Con `win` disegna solo quella finestra della carta, ingrandita di `win.scale`.
 */
export function drawMap(
  fb: Framebuffer, map: MapRaster, x: number, y: number, owners: number[], colorOf: (country: number) => number,
  style: MapStyle, emphasis: (country: number) => MapEmphasis = () => "normale", win?: MapWindow,
): void {
  const { width: w, height: h, pixels, relief } = map;
  const owner = (p: number) => {
    const t = pixels[p]!;
    return t === 0 ? -2 : owners[t - 1] ?? -1;
  };
  const colors = new Map<number, number>();
  const levels = new Map<number, MapEmphasis>();
  const colorFor = (o: number) => {
    let k = colors.get(o);
    if (k === undefined) colors.set(o, (k = colorOf(o)));
    return k;
  };
  const levelFor = (o: number) => {
    let k = levels.get(o);
    if (k === undefined) levels.set(o, (k = emphasis(o)));
    return k;
  };
  const colorAt = (xx: number, yy: number): number => {
    const p = yy * w + xx;
    const o = owner(p);
    let c: number;
    if (o === -2) {
      c = relief ? relief[p]! : ((xx + yy) & 1) === 0 || ((xx ^ yy) & 2) === 0 ? style.seaA : style.seaB;
    } else {
      const right = xx + 1 < w ? owner(p + 1) : o;
      const down = yy + 1 < h ? owner(p + w) : o;
      const left = xx > 0 ? owner(p - 1) : o;
      const up = yy > 0 ? owner(p - w) : o;
      const level = o >= 0 ? levelFor(o) : "normale";
      if (level === "scelto" && style.highlight !== undefined && (right !== o || down !== o || left !== o || up !== o)) {
        c = style.highlight;
      } else if (right === -2 || down === -2) c = style.coast;
      else if (right !== o || down !== o) c = style.border;
      else if (relief && style.view === "fisica") {
        c = relief[p]!;
        if (o >= 0 && BAYER4[(yy & 3) * 4 + (xx & 3)]! < COVER[level]) c = colorFor(o);
      } else {
        c = o === -1 ? style.neutral : colorFor(o);
        if (o >= 0 && level !== "normale") c = shade(c, level === "scelto" ? 3 : 2);
        // il rilievo come ombreggiatura: ±2 toni nella rampa del colore (rampe da 16)
        if (relief) c = shade(c, Math.round(((relief[p]! & 15) - 8) / 4));
      }
    }
    return c;
  };
  if (!win) {
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) fb.plot(x + xx, y + yy, colorAt(xx, yy));
    return;
  }
  // con l'ingrandimento ogni pixel della carta si calcola una volta e copre scale×scale pixel
  const s = win.scale;
  for (let sy = 0; sy < win.h; sy += s) {
    for (let sx = 0; sx < win.w; sx += s) {
      const m = windowToMap(map, win, sx, sy);
      const c = m ? colorAt(m[0], m[1]) : ((sx + sy) & 2) === 0 ? style.seaA : style.seaB;
      for (let dy = 0; dy < s && sy + dy < win.h; dy++)
        for (let dx = 0; dx < s && sx + dx < win.w; dx++) fb.plot(x + sx + dx, y + sy + dy, c);
    }
  }
}

/** Sposta un colore di `delta` toni dentro la sua rampa da 16. */
function shade(c: number, delta: number): number {
  const base = c & ~15;
  return base + Math.min(Math.max((c & 15) + delta, 0), 15);
}

/**
 * Tessera sotto un punto della carta (coordinate relative alla carta), o -1 per il mare. Con
 * `win` le coordinate sono relative alla finestra.
 */
export function tileAt(map: MapRaster, mx: number, my: number, win?: MapWindow): number {
  if (win) {
    if (mx < 0 || my < 0 || mx >= win.w || my >= win.h) return -1;
    const m = windowToMap(map, win, mx, my);
    if (!m) return -1;
    [mx, my] = m;
  }
  if (mx < 0 || my < 0 || mx >= map.width || my >= map.height) return -1;
  return map.pixels[Math.floor(my) * map.width + Math.floor(mx)]! - 1;
}
