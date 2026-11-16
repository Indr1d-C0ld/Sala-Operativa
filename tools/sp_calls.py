#!/usr/bin/env python3
"""Risolve le lcall agli stub e annota le stringhe di DGROUP.
 le lcall agli stub (289f:x, 299f:x = 289f:x+0x1000) in un .asm di sp_disasm.
Uso: python3 -I tools/sp_calls.py re/work/X.asm  -> stampa il .asm con i nomi delle funzioni chiamate."""
import json, re, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
SM = {int(k, 16): v for k, v in json.loads((ROOT / "re/work/stub_map.json").read_text()).items()}
RT = {0x2e8: "fcmp", 0x2d4: "ftol", 0x3c: "rand", 0x6c0: "farmalloc", 0xe68: "memcpy", 0xe72: "memset", 0x2c8: "fatal"}

def resolve(seg, off):
    if seg in (0x289f, 0x299f):
        o = off + (seg - 0x289f) * 16
        return SM.get(o, f"stub_{o:#x}")
    return f"FUN_{seg:04x}_{off:04x}"

ORIG = (ROOT / "re/orig/SHADOW/SHADOW.EXE").read_bytes()
DG = 21504 + 0x2F15 * 16

def dgstr(a):
    e = ORIG.find(b"\0", DG + a)
    s = ORIG[DG + a:e]
    if 4 <= len(s) < 200 and all(32 <= c < 127 or c in (10, 13) for c in s):
        return s.decode("latin-1").replace("\n", "\\n").replace("\r", "")
    return None

for line in open(sys.argv[1]):
    m = re.search(r"mov (?:ax|word \[bp - 0x[0-9a-f]+\]), 0x([0-9a-f]{3,4})$", line.rstrip())
    if m and dgstr(int(m.group(1), 16)):
        line = line.rstrip() + f'    ; "{dgstr(int(m.group(1), 16))}"\n'

    m = re.search(r"lcall 0x([0-9a-f]+):0x([0-9a-f]+)", line)
    if m:
        line = line.rstrip() + f"    ; -> {resolve(int(m.group(1),16), int(m.group(2),16))}\n"
    sys.stdout.write(line)
