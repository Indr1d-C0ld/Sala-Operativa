#!/usr/bin/env python3
"""
Carta politica del gioco: rasterizza i confini di Natural Earth (1:50m, pubblico dominio) in una
griglia di pixel in proiezione di Miller, dove ogni pixel porta l'indice di una "tessera" (un
paese attuale, più Germania Est e Yemen del Sud ricavati dividendo Germania e Yemen lungo il
vecchio confine). Il gioco collega ogni tessera al paese dello scenario con la tabella delle
successioni: nel 1990 la Russia diventa URSS, la Croazia Jugoslavia, e così via.

Uscita in packages/app/public/mappa/:
  carta.bin   un byte per pixel, riga per riga: 0 = mare, k = tessera k-1
  carta.json  dimensioni, proiezione, codici delle tessere e loro baricentro in pixel

Con una larghezza diversa da 640 (per esempio 2560, la carta ingrandita 4× delle viste per
regione e per paese) i file si chiamano carta_<larghezza>.bin e carta_<larghezza>.json; l'elenco
delle tessere è lo stesso a ogni larghezza.

Uso: python3 tools/build_map.py [larghezza]
"""
import json
import math
import sqlite3
import struct
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
SHP = ROOT / "data/sources/naturalearth/ne_50m_admin_0_countries/ne_50m_admin_0_countries"
DB = ROOT / "data/worldbook.sqlite"
OUT = ROOT / "packages/app/public/mappa"

LAT_N, LAT_S = 84.0, -58.0          # niente Antartide, poco Artico: come una carta murale

# Codici Natural Earth (ADM0_A3) → codice Factbook, dove FIPS e ISO non bastano
NE_TO_FB = {
    "NOR": "NO", "KAS": "IN", "KOS": "KV", "SDS": "OD", "PSX": "WE", "SAH": "WI", "CYN": "CY",
    "SOL": "SO", "KAB": "KZ", "TWN": "TW", "ALD": "FI", "ATC": "AT", "IOA": "KT", "CNM": "CY",
    "BJN": "CO", "SER": "CO", "USG": "CU", "ESB": "CY", "WSB": "CY", "CLP": "IP",
}
# Pezzi staccati dal paese che li contiene (lon, lat del pixel) per gli stati scomparsi
SPLITS = {
    "DDDE": ("GM", lambda lon, lat: lon > 10.6 and lat > 50.3 and not (lon < 11.3 and lat < 51.0)),
    "YDYE": ("YM", lambda lon, lat: lon > 45.6 or (lat < 13.9 and lon > 44.2)),
}


def miller_y(lat):
    return 1.25 * math.log(math.tan(math.pi / 4 + 0.4 * math.radians(lat)))


def read_dbf(path):
    data = path.read_bytes()
    n, header_len, rec_len = struct.unpack("<IHH", data[4:12])
    fields, pos = [], 32
    while data[pos] != 0x0D:
        name = data[pos:pos + 11].split(b"\0")[0].decode()
        fields.append((name, data[pos + 16]))
        pos += 32
    rows = []
    for i in range(n):
        rec = data[header_len + i * rec_len: header_len + (i + 1) * rec_len]
        off, row = 1, {}
        for name, size in fields:
            row[name] = rec[off:off + size].decode("utf-8", "replace").strip("\0 ")
            off += size
        rows.append(row)
    return rows


def read_shp(path):
    """Solo poligoni (tipo 5): una lista di anelli [(lon, lat), ...] per ogni record."""
    data = path.read_bytes()
    pos, shapes = 100, []
    while pos < len(data):
        _, length = struct.unpack(">II", data[pos:pos + 8])
        content = data[pos + 8: pos + 8 + 2 * length]
        pos += 8 + 2 * length
        if struct.unpack("<i", content[:4])[0] != 5:
            shapes.append([])
            continue
        nparts, npoints = struct.unpack("<ii", content[36:44])
        parts = list(struct.unpack(f"<{nparts}i", content[44:44 + 4 * nparts])) + [npoints]
        pts = np.frombuffer(content, "<f8", 2 * npoints, 44 + 4 * nparts).reshape(-1, 2)
        shapes.append([pts[parts[k]:parts[k + 1]] for k in range(nparts)])
    return shapes


def rasterize(rings, width, height, project):
    """Riempimento pari-dispari di più anelli, campionando al centro di ogni pixel."""
    edges = []
    for ring in rings:
        xs, ys = project(ring)
        edges.append(np.stack([xs[:-1], ys[:-1], xs[1:], ys[1:]], axis=1))
    e = np.concatenate(edges)
    e = e[e[:, 1] != e[:, 3]]
    mask = np.zeros((height, width), bool)
    y0, y1 = np.minimum(e[:, 1], e[:, 3]), np.maximum(e[:, 1], e[:, 3])
    for row in range(max(0, int(y0.min())), min(height, int(y1.max()) + 1)):
        yc = row + 0.5
        sel = (y0 <= yc) & (y1 > yc)
        if not sel.any():
            continue
        s = e[sel]
        xs = np.sort(s[:, 0] + (yc - s[:, 1]) * (s[:, 2] - s[:, 0]) / (s[:, 3] - s[:, 1]))
        for a, b in zip(xs[0::2], xs[1::2]):
            lo, hi = max(0, math.ceil(a - 0.5)), min(width, math.ceil(b - 0.5))
            if hi > lo:
                mask[row, lo:hi] = True
    return mask


def main():
    width = int(sys.argv[1]) if len(sys.argv) > 1 else 640
    y_top, y_bottom = miller_y(LAT_N), miller_y(LAT_S)
    scale = width / (2 * math.pi)
    height = round((y_top - y_bottom) * scale)
    if width % 640 == 0:
        # multiplo esatto della carta base: il pixel (x, y) a 640 copre i pixel (kx…, ky…) a 640·k
        height = round((y_top - y_bottom) * 640 / (2 * math.pi)) * (width // 640)

    def project(ring):
        lon, lat = ring[:, 0], np.clip(ring[:, 1], -89.9, 89.9)
        x = (lon + 180) / 360 * width
        y = (y_top - 1.25 * np.log(np.tan(np.pi / 4 + 0.4 * np.radians(lat)))) * scale
        return x, y

    def unproject(px, py):
        lon = (px + 0.5) / width * 360 - 180
        my = y_top - (py + 0.5) / scale
        lat = math.degrees(2.5 * math.atan(math.exp(my / 1.25)) - 0.625 * math.pi)
        return lon, lat

    con = sqlite3.connect(DB)
    known = {c for (c,) in con.execute("select code from entity")}
    by_iso = {i: c for c, i in con.execute("select code, iso2 from entity where iso2 is not null")}

    rows, shapes = read_dbf(SHP.with_suffix(".dbf")), read_shp(SHP.with_suffix(".shp"))
    tiles, grid, missing = [], np.zeros((height, width), np.uint8), []
    for row, rings in zip(rows, shapes):
        code = NE_TO_FB.get(row["ADM0_A3"])
        if not code and row.get("FIPS_10") in known:
            code = row["FIPS_10"]
        if not code and row.get("ISO_A2") in by_iso:
            code = by_iso[row["ISO_A2"]]
        if not code or not rings:
            missing.append(f'{row["ADM0_A3"]} {row["NAME"]}')
            continue
        if code not in tiles:
            tiles.append(code)
        mask = rasterize(rings, width, height, project)
        if not mask.any():
            # isola più piccola di un pixel: almeno il punto centrale dell'anello più grande
            ring = max(rings, key=len)
            x, y = project(ring)
            px, py = int(np.clip(x.mean(), 0, width - 1)), int(np.clip(y.mean(), 0, height - 1))
            if grid[py, px] == 0:
                mask[py, px] = True
        grid[mask & (grid == 0)] = tiles.index(code) + 1

    for split, (parent, inside) in SPLITS.items():
        tiles.append(split)
        p = tiles.index(parent) + 1
        for py, px in zip(*np.nonzero(grid == p)):
            if inside(*unproject(px, py)):
                grid[py, px] = len(tiles)

    assert len(tiles) < 255
    centroids = []
    for k in range(len(tiles)):
        ys, xs = np.nonzero(grid == k + 1)
        centroids.append([int(xs.mean()), int(ys.mean())] if len(xs) else None)

    OUT.mkdir(parents=True, exist_ok=True)
    name = "carta" if width == 640 else f"carta_{width}"
    (OUT / f"{name}.bin").write_bytes(grid.tobytes())
    (OUT / f"{name}.json").write_text(json.dumps({
        "format": "melchior-carta/1",
        "source": "Natural Earth 1:50m admin 0 (pubblico dominio)",
        "width": width, "height": height,
        "projection": {"name": "miller", "latN": LAT_N, "latS": LAT_S},
        "tiles": tiles, "centroids": centroids,
    }, ensure_ascii=False))
    print(f"{width}×{height}, {len(tiles)} tessere, {np.count_nonzero(grid)} pixel di terra")
    if missing:
        print("senza codice:", "; ".join(missing))


if __name__ == "__main__":
    main()
