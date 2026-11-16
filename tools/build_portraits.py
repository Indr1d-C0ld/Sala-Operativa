#!/usr/bin/env python3
"""
Ritratti dei consiglieri: dalle PNG scelte fra i candidati di PixelLab ai file del gioco.

Le sorgenti sono data/sources/consiglieri/<id>.png (64×64, generate con create_image_pro su
canvas 64×64 e sfondo pieno, già vincolate alla palette del gioco; i 16 candidati di ogni
chiamata restano in data/sources/consiglieri/candidati/). Lo script riporta ogni pixel
all'indice più vicino della palette di packages/ui/src/palette.ts (indici 0–159: grigi e
rampe da 16 colori) e scrive packages/app/public/consiglieri/<id>.bin: 4096 byte, un indice
per pixel, riga per riga. Un'immagine di altra misura viene ridotta a 64×64 (nearest);
i pixel trasparenti diventano neri.

Scrive anche data/sources/consiglieri/anteprima.png (i sette ritratti ricostruiti dagli
indici, ingranditi 3×) per controllare la conversione.

Uso: python3 tools/build_portraits.py
"""
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data/sources/consiglieri"
OUT = ROOT / "packages/app/public/consiglieri"
SIZE = 64
# Stesso ordine di ADVISORS in packages/core/src/systems/advisors.ts
ADVISORS = ["chief", "security", "state", "defense", "press", "intelligence", "economy"]

# Rampe di packages/ui/src/palette.ts: (primo indice, colore iniziale, colore finale)
RAMPS = [
    (16, (0, 0, 0), (255, 255, 255)),      # grigi
    (32, (0, 24, 0), (140, 255, 120)),     # verde
    (48, (28, 14, 0), (255, 200, 60)),     # ambra
    (64, (30, 0, 0), (255, 80, 60)),       # rosso
    (80, (0, 6, 30), (90, 140, 255)),      # blu
    (96, (0, 24, 28), (120, 255, 255)),    # ciano
    (112, (24, 14, 6), (220, 180, 120)),   # marrone
    (128, (16, 20, 4), (190, 210, 90)),    # oliva
    (144, (16, 0, 24), (210, 120, 255)),   # viola
]


def palette():
    """Palette RGB 160×3 (gli indici 1–15 sono neri come nel gioco)."""
    p = np.zeros((160, 3), np.int32)
    for start, a, b in RAMPS:
        for k in range(16):
            p[start + k] = [round(a[c] + (b[c] - a[c]) * k / 15) for c in range(3)]
    return p


def quantize(rgb, pal):
    """Indice di palette più vicino (distanza euclidea con pesi percettivi) per ogni pixel."""
    # Solo gli indici "veri": 0 (nero) e 16–159; 1–15 sono duplicati del nero.
    idx = np.array([0] + list(range(16, 160)))
    cols = pal[idx].astype(np.float32)
    px = rgb.reshape(-1, 3).astype(np.float32)
    w = np.array([0.30, 0.59, 0.11], np.float32) ** 0.5
    d = (((px[:, None, :] - cols[None, :, :]) * w) ** 2).sum(-1)
    return idx[d.argmin(1)].astype(np.uint8).reshape(rgb.shape[:2])


def load(path):
    im = Image.open(path).convert("RGBA")
    if im.size != (SIZE, SIZE):
        im = im.resize((SIZE, SIZE), Image.NEAREST)
    a = np.asarray(im)
    rgb = a[..., :3].copy()
    rgb[a[..., 3] < 128] = 0
    return rgb


def main():
    pal = palette()
    OUT.mkdir(parents=True, exist_ok=True)
    sheet = Image.new("RGB", (len(ADVISORS) * SIZE * 3, SIZE * 3))
    for n, who in enumerate(ADVISORS):
        src = SRC / f"{who}.png"
        if not src.exists():
            print(f"manca {src.relative_to(ROOT)}, salto")
            continue
        rgb = load(src)
        ind = quantize(rgb, pal)
        (OUT / f"{who}.bin").write_bytes(ind.tobytes())
        err = np.abs(pal[ind] - rgb.astype(np.int32)).max()
        print(f"{who}: {len(np.unique(ind))} colori, scarto massimo {err}")
        prev = Image.fromarray(pal[ind].astype(np.uint8)).resize((SIZE * 3, SIZE * 3), Image.NEAREST)
        sheet.paste(prev, (n * SIZE * 3, 0))
    sheet.save(SRC / "anteprima.png")


if __name__ == "__main__":
    main()
