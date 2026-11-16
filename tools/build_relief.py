#!/usr/bin/env python3
"""
Rilievo pixel-art della carta del mondo, allineato pixel per pixel alla carta politica
(packages/app/public/mappa/carta.bin, tools/build_map.py).

Tre fasi:
  sorgente   dipinge una carta "fisica" dalla maschera terra/mare della carta: mare con fondali
             vicino alle coste, biomi stimati da latitudine e longitudine (ghiacci, tundra, taiga,
             foreste temperate, steppe, deserti, savane, foreste pluviali), catene montuose con
             ombreggiatura. Nessun confine politico. Scrive data/sources/rilievo/sorgente.png
             (640×321) e i tasselli ingranditi 2× da mandare a PixelLab (tassello_N.png).
  rilievo    rimonta i tasselli convertiti da PixelLab (pixellab_N.png, image_to_pixelart in
             modalità faithful, uno per tassello) e li riduce alla palette del gioco
             (packages/ui/src/palette.ts). La maschera della carta decide terra e mare: i pixel di
             terra prendono solo colori delle rampe di terra, quelli di mare solo blu, così le coste
             restano esattamente quelle della carta politica. Scrive
             packages/app/public/mappa/rilievo.bin (un indice di palette per pixel) e
             data/sources/rilievo/rilievo.png (anteprima).
  anteprima  come rilievo, ma parte da sorgente.png invece che dai tasselli di PixelLab: utile per
             provare la riduzione senza spendere generazioni.

Uso: python3 tools/build_relief.py sorgente|rilievo|anteprima
"""
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
MAPPA = ROOT / "packages/app/public/mappa"
WORK = ROOT / "data/sources/rilievo"
# Tasselli: colonne della carta (x0, x1). PixelLab restituisce al massimo 512×512.
TILES = [(0, 320), (320, 640)]


def load_map():
    meta = json.loads((MAPPA / "carta.json").read_text())
    w, h = meta["width"], meta["height"]
    grid = np.frombuffer((MAPPA / "carta.bin").read_bytes(), np.uint8).reshape(h, w)
    return meta, grid


def lonlat(meta):
    """Longitudine e latitudine del centro di ogni pixel (proiezione di Miller)."""
    w, h = meta["width"], meta["height"]
    proj = meta["projection"]
    scale = w / (2 * math.pi)
    y_top = 1.25 * math.log(math.tan(math.pi / 4 + 0.4 * math.radians(proj["latN"])))
    lon = (np.arange(w) + 0.5) / w * 360 - 180
    my = y_top - (np.arange(h) + 0.5) / scale
    lat = np.degrees(2.5 * np.arctan(np.exp(my / 1.25)) - 0.625 * math.pi)
    return np.meshgrid(lon, lat)


def noise(shape, cell, seed):
    """Rumore a valori, liscio, in [-1, 1]."""
    rng = np.random.default_rng(seed)
    small = rng.uniform(-1, 1, (shape[0] // cell + 3, shape[1] // cell + 3))
    big = ndimage.zoom(small, cell, order=3)
    return np.clip(big[: shape[0], : shape[1]], -1, 1)


def blob(lon, lat, lon0, lat0, rlon, rlat):
    """Macchia ellittica morbida, 1 al centro e 0 fuori."""
    d = ((lon - lon0) / rlon) ** 2 + ((lat - lat0) / rlat) ** 2
    return np.clip(1.2 - d, 0, 1)


def ridge(lon, lat, pts, width):
    """Catena montuosa lungo una spezzata di punti (lon, lat), larga `width` gradi."""
    out = np.zeros_like(lon)
    for (a0, b0), (a1, b1) in zip(pts, pts[1:]):
        dx, dy = a1 - a0, b1 - b0
        t = np.clip(((lon - a0) * dx + (lat - b0) * dy) / (dx * dx + dy * dy), 0, 1)
        d = np.hypot(lon - (a0 + t * dx), lat - (b0 + t * dy))
        out = np.maximum(out, np.clip(1 - d / width, 0, 1))
    return out


# Deserti e zone aride: (lon, lat, raggio lon, raggio lat, intensità)
DESERTS = [
    (5, 23, 22, 7, 1.0), (25, 22, 10, 6, 1.0), (45, 23, 12, 7, 1.0), (55, 20, 6, 4, 0.9),
    (60, 30, 9, 5, 0.8), (71, 27, 4, 3, 0.7), (85, 40, 13, 4, 0.9), (105, 42, 12, 4, 0.8),
    (62, 42, 8, 4, 0.6), (128, -25, 13, 7, 1.0), (19, -24, 6, 5, 0.7), (15, -22, 2, 5, 0.6),
    (-70, -22, 2.5, 6, 0.9), (-112, 34, 6, 5, 0.7), (-112, 28, 3, 4, 0.6), (-68, -42, 4, 8, 0.6),
    (46, 8, 4, 5, 0.6),
]
# Foreste pluviali: (lon, lat, raggio lon, raggio lat)
JUNGLES = [
    (-62, -4, 15, 8), (-75, 2, 4, 6), (20, 0, 10, 5), (10, 4, 6, 3), (-5, 7, 8, 2.5),
    (112, 0, 14, 6), (140, -5, 8, 4), (102, 15, 6, 7), (-85, 12, 6, 5), (-50, -15, 5, 8),
    (78, 11, 3, 4), (48, -19, 2, 6),
]
# Catene montuose: spezzate (lon, lat) e larghezza in gradi
RANGES = [
    ([(-70, 10), (-77, 0), (-79, -8), (-70, -18), (-69, -30), (-71, -40), (-73, -50)], 3.0),
    ([(-150, 62), (-135, 60), (-122, 50), (-110, 42), (-106, 35), (-104, 30)], 3.5),
    ([(-104, 26), (-100, 20), (-96, 17), (-90, 15)], 2.0),
    ([(70, 36), (78, 34), (85, 30), (92, 28), (98, 28)], 3.0),
    ([(78, 34), (86, 33), (95, 33), (100, 32)], 5.0),
    ([(6, 45), (10, 46.5), (14, 47)], 1.5),
    ([(40, 43), (48, 41)], 1.5),
    ([(46, 38), (52, 36), (60, 34), (68, 35)], 2.5),
    ([(58, 50), (60, 58), (64, 67)], 1.5),
    ([(-8, 31), (-2, 33), (8, 36)], 2.0),
    ([(37, 15), (39, 9), (38, 5)], 2.5),
    ([(-123, 50), (-120, 40)], 1.5),
    ([(7, 61), (10, 64), (15, 68)], 2.0),
    ([(29, 0), (30, -10), (34, -15)], 2.0),
    ([(146, -38), (151, -30), (147, -20)], 1.5),
    ([(-80, 35), (-75, 41), (-70, 45)], 1.5),
    ([(170, -44), (175, -40)], 1.5),
    ([(135, 62), (150, 63), (160, 60)], 3.0),
]

# Colori della sorgente (RGB), scelti vicino alle rampe della palette del gioco
C = {
    "abisso": (14, 30, 92), "mare": (26, 52, 140), "basso": (48, 84, 180),
    "ghiaccio": (232, 236, 240), "tundra": (128, 132, 104), "taiga": (40, 78, 38),
    "temperata": (70, 112, 44), "prateria": (128, 148, 64), "steppa": (160, 150, 88),
    "savana": (150, 140, 66), "pluviale": (26, 82, 30), "deserto": (214, 178, 104),
    "roccia": (120, 96, 70), "vetta": (200, 196, 190),
}


def paint(meta, grid):
    h, w = grid.shape
    lon, lat = lonlat(meta)
    land = grid > 0
    n1, n2, n3 = noise((h, w), 12, 1), noise((h, w), 5, 2), noise((h, w), 3, 3)
    alat = np.abs(lat) + 3 * n1

    img = np.zeros((h, w, 3), float)
    def put(mask, color, wgt=1.0):
        a = np.clip(wgt, 0, 1)[..., None] if np.ndim(wgt) else wgt
        img[:] = np.where(mask[..., None], img * (1 - a) + np.array(color) * a, img)

    # Mare: fondali più chiari vicino alla costa
    dist = ndimage.distance_transform_edt(~land)
    put(~land, C["abisso"])
    put(~land, C["mare"], np.clip(1.0 - dist / 10 + 0.3 * n2, 0, 1))
    put(~land, C["basso"], np.clip(1.0 - dist / 2.5, 0, 0.8))

    # Fasce climatiche
    put(land, C["savana"])
    put(land, C["prateria"], np.clip((alat - 23) / 6, 0, 1))
    put(land, C["temperata"], np.clip((alat - 33) / 6, 0, 1))
    put(land, C["taiga"], np.clip((alat - 50) / 5, 0, 1))
    put(land, C["tundra"], np.clip((alat - 63) / 4, 0, 1))
    put(land, C["ghiaccio"], np.clip((alat - 76) / 3, 0, 1))
    # Steppe dell'Asia centrale e delle grandi pianure; pampa
    steppe = (blob(lon, lat, 65, 47, 22, 5) + blob(lon, lat, 105, 47, 12, 4)
              + blob(lon, lat, -102, 42, 6, 9) + blob(lon, lat, -62, -35, 5, 5))
    put(land, C["steppa"], np.clip(steppe * (1 + 0.5 * n2), 0, 0.9))
    # Foreste pluviali
    jungle = sum(blob(lon, lat, *j) for j in JUNGLES)
    put(land, C["pluviale"], np.clip(jungle * (1.0 + 0.8 * n2), 0, 0.95))
    # Deserti
    desert = sum(i * blob(lon, lat, a, b, ra, rb) for a, b, ra, rb, i in DESERTS)
    put(land, C["deserto"], np.clip(desert * (2.0 + 0.8 * n2) - 0.2, 0, 1))
    # Groenlandia: calotta di ghiaccio, costa di tundra
    gl = grid == meta["tiles"].index("GL") + 1
    coast = ndimage.distance_transform_edt(land)
    put(gl, C["tundra"])
    put(gl, C["ghiaccio"], np.clip((coast - 1.5) / 2, 0, 1))

    # Rilievi: quota, ombreggiatura con luce da nord-ovest, vette innevate
    elev = sum(r * ridge(lon, lat, pts, wd) for (pts, wd), r in zip(RANGES, [1] * len(RANGES)))
    elev = np.clip(elev, 0, 1) * (0.8 + 0.4 * n3)
    elev = np.where(land, elev, 0)
    put(land, C["roccia"], np.clip(elev * 1.1 - 0.2, 0, 0.7))
    put(land, C["vetta"], np.clip((elev - 0.75) * 3, 0, 0.9))
    gy, gx = np.gradient(ndimage.gaussian_filter(elev, 1.5))
    shade = np.clip(1 - 3 * (gx + gy), 0.75, 1.25)
    # leggera tessitura per non avere campiture piatte
    shade = shade * (1 + 0.06 * n3)
    img = np.where(land[..., None], img * shade[..., None], img)
    return np.clip(img, 0, 255).astype(np.uint8)


def palette():
    """La stessa palette di packages/ui/src/palette.ts (rampe da 16 colori)."""
    def ramp(a, b):
        return [tuple(round(a[c] + (b[c] - a[c]) * k / 15) for c in range(3)) for k in range(16)]
    ramps = {
        "grey": (16, ramp((0, 0, 0), (255, 255, 255))),
        "green": (32, ramp((0, 24, 0), (140, 255, 120))),
        "amber": (48, ramp((28, 14, 0), (255, 200, 60))),
        "blue": (80, ramp((0, 6, 30), (90, 140, 255))),
        "brown": (112, ramp((24, 14, 6), (220, 180, 120))),
        "olive": (128, ramp((16, 20, 4), (190, 210, 90))),
    }
    return ramps


def quantize(rgb, land):
    """Indici di palette: terra solo dalle rampe di terra, mare solo dalla rampa blu."""
    ramps = palette()
    def choices(names, lo=0, hi=16):
        idx, cols = [], []
        for n in names:
            start, cs = ramps[n]
            for k in range(lo, hi):
                idx.append(start + k)
                cols.append(cs[k])
        return np.array(idx), np.array(cols, float)
    # niente toni troppo scuri (si confonderebbero con confini e coste) né il verde fosforescente
    # i grigi neutri solo per neve e ghiaccio; l'ambra sarebbe troppo accesa per le sabbie
    parts = [choices(["brown", "olive"], 3, 16), choices(["green"], 3, 9), choices(["grey"], 11, 16)]
    land_idx = np.concatenate([i for i, _ in parts])
    land_col = np.concatenate([c for _, c in parts])
    sea_idx, sea_col = choices(["blue"], 1, 11)
    out = np.zeros(land.shape, np.uint8)
    px = rgb.reshape(-1, 3).astype(float)
    lm = land.reshape(-1)
    for mask, idx, col in ((lm, land_idx, land_col), (~lm, sea_idx, sea_col)):
        sub = px[mask]
        # distanza pesata per luminanza percepita
        d = (((sub[:, None, :] - col[None, :, :]) * np.array([0.30, 0.59, 0.11]) ** 0.5) ** 2).sum(-1)
        out.reshape(-1)[mask] = idx[d.argmin(1)]
    return out


def save_relief(rgb, grid):
    land = grid > 0
    ind = quantize(rgb, land)
    (MAPPA / "rilievo.bin").write_bytes(ind.tobytes())
    pal = np.zeros((256, 3), np.uint8)
    for start, cs in palette().values():
        pal[start:start + 16] = cs
    Image.fromarray(pal[ind]).save(WORK / "rilievo.png")
    Image.fromarray(pal[ind]).resize((ind.shape[1] * 2, ind.shape[0] * 2), Image.NEAREST).save(WORK / "rilievo_2x.png")
    print(f"rilievo.bin {ind.shape[1]}×{ind.shape[0]}, {len(np.unique(ind))} colori")


def main():
    stage = sys.argv[1] if len(sys.argv) > 1 else "sorgente"
    meta, grid = load_map()
    WORK.mkdir(parents=True, exist_ok=True)
    if stage == "sorgente":
        src = paint(meta, grid)
        Image.fromarray(src).save(WORK / "sorgente.png")
        for k, (x0, x1) in enumerate(TILES):
            tile = Image.fromarray(src[:, x0:x1])
            tile.resize((tile.width * 2, tile.height * 2), Image.NEAREST).save(WORK / f"tassello_{k}.png")
        print(f"sorgente {src.shape[1]}×{src.shape[0]}, {len(TILES)} tasselli in {WORK}")
    elif stage in ("rilievo", "anteprima"):
        h, w = grid.shape
        if stage == "anteprima":
            rgb = np.asarray(Image.open(WORK / "sorgente.png").convert("RGB"))
        else:
            # dove PixelLab lascia pixel trasparenti (capita sull'ultima riga) si tiene la sorgente
            rgb = np.asarray(Image.open(WORK / "sorgente.png").convert("RGB")).copy()
            for k, (x0, x1) in enumerate(TILES):
                tile = Image.open(WORK / f"pixellab_{k}.png").convert("RGBA")
                if tile.size != (x1 - x0, h):
                    tile = tile.resize((x1 - x0, h), Image.NEAREST)
                t = np.asarray(tile)
                opaque = t[..., 3] == 255
                rgb[:, x0:x1][opaque] = t[..., :3][opaque]
        save_relief(rgb, grid)
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
