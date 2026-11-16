/**
 * Palette a 256 colori del gioco, in stile SVGA anni '90 ma originale: rampe da 16 tonalità
 * per i colori d'interfaccia e della mappa. I nomi indicano l'indice del primo colore di ogni rampa.
 */
export const RAMP = {
  black: 0,
  grey: 16,       // 16 grigi, dal nero al bianco
  green: 32,      // verde terminale
  amber: 48,
  red: 64,
  blue: 80,       // mare e finestre
  cyan: 96,
  brown: 112,     // terre emerse
  olive: 128,
  violet: 144,
} as const;

function ramp(from: [number, number, number], to: [number, number, number]): [number, number, number][] {
  return Array.from({ length: 16 }, (_, k) => {
    const t = k / 15;
    return [0, 1, 2].map((c) => Math.round(from[c]! + (to[c]! - from[c]!) * t)) as [number, number, number];
  });
}

/** Palette RGB: 256 triple. Gli indici non assegnati restano neri, liberi per i mod. */
export function defaultPalette(): Uint8Array {
  const p = new Uint8Array(256 * 3);
  const put = (start: number, colors: [number, number, number][]) =>
    colors.forEach((c, k) => p.set(c, (start + k) * 3));
  put(RAMP.grey, ramp([0, 0, 0], [255, 255, 255]));
  put(RAMP.green, ramp([0, 24, 0], [140, 255, 120]));
  put(RAMP.amber, ramp([28, 14, 0], [255, 200, 60]));
  put(RAMP.red, ramp([30, 0, 0], [255, 80, 60]));
  put(RAMP.blue, ramp([0, 6, 30], [90, 140, 255]));
  put(RAMP.cyan, ramp([0, 24, 28], [120, 255, 255]));
  put(RAMP.brown, ramp([24, 14, 6], [220, 180, 120]));
  put(RAMP.olive, ramp([16, 20, 4], [190, 210, 90]));
  put(RAMP.violet, ramp([16, 0, 24], [210, 120, 255]));
  return p;
}
