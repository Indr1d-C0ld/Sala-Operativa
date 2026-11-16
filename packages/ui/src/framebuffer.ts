/**
 * Framebuffer indicizzato 640×480: ogni pixel è un indice di palette (0–255), come una scheda
 * SVGA a 256 colori. Si disegna qui e si presenta su un canvas ingrandito per multipli interi.
 */
export const WIDTH = 640;
export const HEIGHT = 480;

/** Matrice di Bayer 4×4 per il dithering ordinato. */
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

export class Framebuffer {
  readonly pixels = new Uint8Array(WIDTH * HEIGHT);
  /** Rettangolo di ritaglio corrente. */
  private clip = { x0: 0, y0: 0, x1: WIDTH, y1: HEIGHT };

  setClip(x: number, y: number, w: number, h: number): void {
    this.clip = { x0: Math.max(0, x), y0: Math.max(0, y), x1: Math.min(WIDTH, x + w), y1: Math.min(HEIGHT, y + h) };
  }

  resetClip(): void {
    this.clip = { x0: 0, y0: 0, x1: WIDTH, y1: HEIGHT };
  }

  plot(x: number, y: number, color: number): void {
    const { x0, y0, x1, y1 } = this.clip;
    if (x >= x0 && x < x1 && y >= y0 && y < y1) this.pixels[y * WIDTH + x] = color;
  }

  fillRect(x: number, y: number, w: number, h: number, color: number): void {
    const { x0, y0, x1, y1 } = this.clip;
    const xa = Math.max(x, x0), xb = Math.min(x + w, x1), ya = Math.max(y, y0), yb = Math.min(y + h, y1);
    for (let yy = ya; yy < yb; yy++) this.pixels.fill(color, yy * WIDTH + xa, yy * WIDTH + xb);
  }

  /** Riempie con un dithering ordinato fra due colori; `level` 0..16 è la quota di `b`. */
  ditherRect(x: number, y: number, w: number, h: number, a: number, b: number, level: number): void {
    const { x0, y0, x1, y1 } = this.clip;
    for (let yy = Math.max(y, y0); yy < Math.min(y + h, y1); yy++) {
      for (let xx = Math.max(x, x0); xx < Math.min(x + w, x1); xx++) {
        this.pixels[yy * WIDTH + xx] = BAYER4[(yy & 3) * 4 + (xx & 3)]! < level ? b : a;
      }
    }
  }

  hline(x: number, y: number, w: number, color: number): void {
    this.fillRect(x, y, w, 1, color);
  }

  vline(x: number, y: number, h: number, color: number): void {
    this.fillRect(x, y, 1, h, color);
  }

  /** Cornice in rilievo (luce in alto a sinistra) o incassata. */
  bevel(x: number, y: number, w: number, h: number, light: number, dark: number, sunken = false): void {
    const [tl, br] = sunken ? [dark, light] : [light, dark];
    this.hline(x, y, w, tl);
    this.vline(x, y, h, tl);
    this.hline(x, y + h - 1, w, br);
    this.vline(x + w - 1, y, h, br);
  }

  /** Copia un'immagine indicizzata; `transparent` (se dato) non viene disegnato. */
  blit(src: Uint8Array, sw: number, sh: number, x: number, y: number, transparent = -1): void {
    for (let yy = 0; yy < sh; yy++) {
      for (let xx = 0; xx < sw; xx++) {
        const c = src[yy * sw + xx]!;
        if (c !== transparent) this.plot(x + xx, y + yy, c);
      }
    }
  }
}

/** Presenta il framebuffer su un canvas 640×480, convertendo gli indici con la palette. */
export class Screen {
  private ctx: CanvasRenderingContext2D;
  private image: ImageData;

  constructor(private canvas: HTMLCanvasElement, private palette: Uint8Array) {
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    canvas.style.imageRendering = "pixelated";
    this.ctx = canvas.getContext("2d")!;
    this.image = this.ctx.createImageData(WIDTH, HEIGHT);
  }

  present(fb: Framebuffer): void {
    const out = this.image.data;
    const p = this.palette;
    for (let i = 0; i < fb.pixels.length; i++) {
      const c = fb.pixels[i]! * 3;
      out[i * 4] = p[c]!;
      out[i * 4 + 1] = p[c + 1]!;
      out[i * 4 + 2] = p[c + 2]!;
      out[i * 4 + 3] = 255;
    }
    this.ctx.putImageData(this.image, 0, 0);
  }

  /** Ingrandisce il canvas al massimo multiplo intero che entra nel contenitore. */
  fitInteger(availableWidth: number, availableHeight: number): number {
    const scale = Math.max(1, Math.floor(Math.min(availableWidth / WIDTH, availableHeight / HEIGHT)));
    this.canvas.style.width = `${WIDTH * scale}px`;
    this.canvas.style.height = `${HEIGHT * scale}px`;
    return scale;
  }
}
