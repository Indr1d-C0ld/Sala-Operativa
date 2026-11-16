import type { Framebuffer } from "./framebuffer.js";

/**
 * Font bitmap monospaziato a celle 8×16, come il testo VGA. I glifi si generano all'avvio da
 * un font di sistema, ridotto a 1 bit con una soglia: niente file di font da distribuire, e le
 * lettere accentate dell'italiano sono incluse. Un mod può sostituire `glyphs` con un font
 * disegnato a mano (stesso formato: 16 byte per carattere, un bit per pixel).
 */
export const CELL_W = 8;
export const CELL_H = 16;

export class BitmapFont {
  /** Glifi per codice carattere: 16 righe da 8 bit. */
  readonly glyphs = new Map<number, Uint8Array>();

  static fromSystemFont(chars: string, css = "bold 15px 'DejaVu Sans Mono', 'Courier New', monospace", threshold = 110): BitmapFont {
    const font = new BitmapFont();
    const canvas = document.createElement("canvas");
    canvas.width = CELL_W;
    canvas.height = CELL_H;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    for (const ch of chars) {
      ctx.clearRect(0, 0, CELL_W, CELL_H);
      ctx.fillStyle = "#fff";
      ctx.font = css;
      ctx.textBaseline = "alphabetic";
      ctx.fillText(ch, 0, 12);
      const data = ctx.getImageData(0, 0, CELL_W, CELL_H).data;
      const rows = new Uint8Array(CELL_H);
      for (let y = 0; y < CELL_H; y++) {
        for (let x = 0; x < CELL_W; x++) if (data[(y * CELL_W + x) * 4 + 3]! > threshold) rows[y]! |= 0x80 >> x;
      }
      font.glyphs.set(ch.codePointAt(0)!, rows);
    }
    return font;
  }

  /** Disegna una riga di testo; restituisce la x dopo l'ultimo carattere. */
  draw(fb: Framebuffer, text: string, x: number, y: number, color: number, background = -1): number {
    for (const ch of text) {
      const rows = this.glyphs.get(ch.codePointAt(0)!) ?? this.glyphs.get(63);
      if (background >= 0) fb.fillRect(x, y, CELL_W, CELL_H, background);
      if (rows) {
        for (let yy = 0; yy < CELL_H; yy++) {
          const r = rows[yy]!;
          if (r) for (let xx = 0; xx < CELL_W; xx++) if (r & (0x80 >> xx)) fb.plot(x + xx, y + yy, color);
        }
      }
      x += CELL_W;
    }
    return x;
  }
}

/** Caratteri da generare: ASCII stampabile, lettere accentate e simboli usati dai testi italiani. */
export const ITALIAN_CHARSET =
  Array.from({ length: 95 }, (_, k) => String.fromCharCode(32 + k)).join("") + "àèéìíòóùúÀÈÉÌÒÙçãõñüöäâêôÅåæØøÇ«»°€·—–’…█▒░▲▼◄►↑↓←→";
