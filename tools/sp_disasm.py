#!/usr/bin/env python3
"""Disassembla una funzione delle immagini ricostruite (re/work/shadow_ovl?.exe) con r2,
annotando costanti FP di DGROUP e campi dei record paese.

Uso: python3 -I tools/sp_disasm.py A ab78 0ced [fine_hex] > out.asm
  A|B      immagine; seg/off come nei nomi Ghidra (FUN_ab78_0ced); fine = offset di fine
           (default: inizio della funzione successiva nel C decompilato).
"""
import re
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORK = ROOT / "re/work"
DG_FILE_OFF = 21504 + 0x2F15 * 16  # DGROUP nel file originale

COUNTRY = {0: "nuclear_power", 8: "military_power", 16: "economic_power", 24: "reg_infl",
           32: "total_infl_share", 40: "total_infl_prev?", 48: "reg_mil_share", 56: "military_share",
           64: "mil_share_delta", 68: "nuclear_share", 76: "f32_76", 80: "reg_econ_share", 88: "economic_share",
           96: "nuclear_spending", 104: "mil_quality", 112: "military_spending", 120: "pc_gnp",
           128: "oil_share?", 136: "resource_mult?", 144: "b144?", 145: "peace_level",
           153: "bellig_avg3", 157: "bellig", 161: "bellig1", 165: "bellig2", 169: "LER",
           177: "qol?", 185: "qol_prev?", 193: "nuclear_level", 195: "ideology?", 197: "alliance?",
           198: "influence_abs?"}


def main(img, seg, off, end=None):
    seg, off = int(seg, 16), int(off, 16)
    if end is None:
        c = (WORK / f"decomp_{img}.c").read_text()
        starts = sorted(int(m, 16) for m in re.findall(rf"^// ===== \w+ @ {seg:04x}:([0-9a-f]+)", c, re.M))
        later = [s for s in starts if s > off]
        end = later[0] if later else off + 0x2000
    else:
        end = int(end, 16)
    exe = (WORK / f"shadow_ovl{img}.exe").read_bytes()
    hp = struct.unpack_from("<H", exe, 8)[0] * 16
    seg_bytes = exe[hp + (seg - 0x1000) * 16: hp + (seg - 0x1000) * 16 + 0x10000]
    orig = (ROOT / "re/orig/SHADOW/SHADOW.EXE").read_bytes()
    with tempfile.NamedTemporaryFile(suffix=".bin") as t:
        t.write(seg_bytes)
        t.flush()
        out = subprocess.run(["r2", "-q", "-e", "scr.color=0", "-e", "asm.bytes=false", "-e", "asm.comments=false",
                              "-a", "x86", "-b", "16", "-n", "-c", f"pD {end - off} @ {off}", t.name],
                             capture_output=True, text=True).stdout
    for line in out.splitlines():
        line = line.strip().replace("0000:", "")
        m = re.search(r"(qword|dword) \[(0x[0-9a-f]+)\]", line)
        if m and line.split()[1].startswith("f"):
            a = int(m.group(2), 16)
            fmt = "<d" if m.group(1) == "qword" else "<f"
            try:
                line += f"    ; = {struct.unpack_from(fmt, orig, DG_FILE_OFF + a)[0]!r}"
            except struct.error:
                pass
        m = re.search(r"es:\[bx \+ (0x[0-9a-f]+)\]", line)
        if m and int(m.group(1), 16) in COUNTRY:
            line += f"    ; C.{COUNTRY[int(m.group(1), 16)]}?"
        print(line)


if __name__ == "__main__":
    main(*sys.argv[1:])
