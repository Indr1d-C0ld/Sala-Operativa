#!/usr/bin/env python3
"""Trova le chiamate (lcall) a una funzione nelle immagini ricostruite, anche tramite stub.
Uso: python3 -I tools/sp_xref.py FUN_5db5_3cd2"""
import json, struct, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
W = ROOT / "re/work"
sm = json.loads((W / "stub_map.json").read_text())
om = json.loads((W / "overlay_map.json").read_text())
name = sys.argv[1]
seg, off = (int(x, 16) for x in name.split("_")[1:3])
pats = []
for k, v in sm.items():
    if v == name:
        o = int(k, 16)
        pats.append(b"\x9a" + struct.pack("<HH", o & 0xFFF, 0x289F + (o >> 12) * 0x100))
        pats.append(b"\x9a" + struct.pack("<HH", o, 0x289F))
pats.append(b"\x9a" + struct.pack("<HH", off, seg))
ranges = [(int(v["segment"], 16), int(v["segment"], 16) + (v["size"] + 15) // 16, v["image"][-5], k) for k, v in om.items()]
for img in "AB":
    exe = (W / f"shadow_ovl{img}.exe").read_bytes()
    hp = struct.unpack_from("<H", exe, 8)[0] * 16
    body = exe[hp:]
    seen = set()
    for p in set(pats):
        i = body.find(p)
        while i != -1:
            lin = 0x10000 + i
            ov = [(a, k) for a, b, im, k in ranges if im == img and a * 16 <= lin < b * 16]
            where = f"{ov[0][0]:04x}:{lin - ov[0][0]*16:04x} (ovl {ov[0][1]})" if ov else f"root lin {lin:#x}"
            if where not in seen:
                seen.add(where); print(img, where)
            i = body.find(p, i + 1)
