#!/usr/bin/env python3
"""Ricostruisce SHADOW.EXE (MZ + overlay RTLink/Plus + emulatore x87 MS C) in
eseguibili MZ "piatti" analizzabili con Ghidra.

Uso: python3 -I tools/sp_unpack.py re/orig/SHADOW/SHADOW.EXE re/work

Cosa fa:
  1. legge l'immagine residente (root) e la catena dei 66 segmenti overlay accodati;
  2. dispone root + un gruppo di overlay in un'unica immagine, ogni overlay su un
     segmento fisso, e ne converte le rilocazioni in rilocazioni MZ;
  3. riscrive gli stub del gestore overlay (segmento 289f) in salti diretti;
  4. converte le INT 34h-3Dh dell'emulatore FP Microsoft in vere istruzioni x87.
Produce shadow_ovlA.exe / shadow_ovlB.exe (stesso root, gruppi di overlay diversi)
e overlay_map.json (overlay n -> segmento, offset nel file).

Formato overlay RTLink/Plus (ricavato): ogni segmento inizia con
  u16 paragrafi_totali, u16 paragrafi_intestazione, u16 510, u16 0
  poi u32 offset di rilocazione (0 = riempimento), poi il codice.
Stub (segmento 289f):  9A 38 0B 75 22 | EA off16 0000 | u16 n_overlay   (12 byte)
                       9A 1E 0B 75 22 | EA off16 seg16                  (10 byte, codice residente)
"""
import json
import re
import struct
import sys
from pathlib import Path

STUB_SEG = 0x289F
OVL_BASE_PARA = 0x4000          # primo paragrafo libero dopo root + BSS + stack
MAX_IMAGE_PARA = 0xE000         # resta sotto 1 MB con il caricamento di Ghidra a 1000:0000


def read_mz(d):
    (sig, last, pages, nrel, hdrpar, _mn, _mx, ss, sp, _cs, ip, cs, relo, _ov) = struct.unpack_from("<14H", d, 0)
    end = (pages - 1) * 512 + (last or 512)
    relocs = [struct.unpack_from("<HH", d, relo + 4 * i) for i in range(nrel)]
    return dict(hdr=hdrpar * 16, end=end, ss=ss, sp=sp, cs=cs, ip=ip, relocs=relocs)


def read_overlays(d, start):
    segs, o, n = [], start, 1
    while o + 16 <= len(d):
        tot, hdr, _k, z = struct.unpack_from("<4H", d, o)
        if z or not hdr or tot <= hdr:
            break
        rel = [r for r in struct.unpack_from(f"<{(hdr * 16 - 16) // 4}I", d, o + 16) if r]
        segs.append(dict(n=n, file_off=o, code=bytes(d[o + hdr * 16:o + tot * 16]), relocs=rel))
        o += tot * 16
        n += 1
    return segs


def fix_fpu(buf):
    """INT 34h-3Bh -> FWAIT+ESC; INT 3Ch -> prefisso di segmento+ESC; INT 3Dh -> FWAIT."""
    b = bytearray(buf)
    seg_prefix = {0: 0x3E, 1: 0x36, 2: 0x2E, 3: 0x26}  # DS, SS, CS, ES (bit 7-6)
    i = 0
    n = 0
    while i < len(b) - 2:
        if b[i] == 0xCD:
            v = b[i + 1]
            if 0x34 <= v <= 0x3B:
                b[i], b[i + 1] = 0x9B, 0xD8 + (v - 0x34)
                n += 1
                i += 2
                continue
            if v == 0x3C:
                x = b[i + 2]
                b[i], b[i + 1], b[i + 2] = 0x90, seg_prefix[x >> 6], 0xD8 | (x & 7)
                n += 1
                i += 3
                continue
            if v == 0x3D:
                b[i], b[i + 1] = 0x9B, 0x90
                n += 1
                i += 2
                continue
        i += 1
    return bytes(b), n


def build(d, mz, ovls, group, out_path):
    root = bytearray(d[mz["hdr"]:mz["end"]])
    image = bytearray(OVL_BASE_PARA * 16)
    image[:len(root)] = root
    relocs = list(mz["relocs"])
    seg_of = {}
    para = OVL_BASE_PARA
    for ov in ovls:
        if ov["n"] not in group:
            continue
        seg_of[ov["n"]] = para
        code = bytearray(ov["code"])
        for r in ov["relocs"]:
            relocs.append((r & 0xFFFF, para + (r >> 16)))
        image += code
        para += (len(code) + 15) // 16
        image += bytes(para * 16 - len(image))
    assert para <= MAX_IMAGE_PARA, f"immagine troppo grande: {para:#x} paragrafi"

    # stub del gestore overlay -> salti diretti
    stub_base = STUB_SEG * 16
    stub_area = image[stub_base:stub_base + 0x2000]
    for m in re.finditer(rb"\x9a(\x1e|\x38)\x0b\x75\x22\xea", stub_area):
        p = stub_base + m.start()
        kind = m.group(1)
        off, seg = struct.unpack_from("<HH", image, p + 6)
        image[p:p + 5] = b"\x90" * 5
        if kind == b"\x38":
            n_ovl = struct.unpack_from("<H", image, p + 10)[0]
            if n_ovl in seg_of:
                struct.pack_into("<H", image, p + 8, seg_of[n_ovl])
                relocs.append((p + 8 - stub_base, STUB_SEG))
        else:
            relocs.append((p + 8 - stub_base, STUB_SEG))

    image, nfpu = fix_fpu(bytes(image))

    # MZ header: 28 byte + tabella rilocazioni, allineato a 512
    hdr_size = 28 + 4 * len(relocs)
    hdr_par = (hdr_size + 511) // 512 * 32
    total = hdr_par * 16 + len(image)
    pages, last = (total + 511) // 512, total % 512
    head = bytearray(hdr_par * 16)
    struct.pack_into("<14H", head, 0, 0x5A4D, last, pages, len(relocs), hdr_par, 0x100, 0xFFFF,
                     mz["ss"], mz["sp"], 0, mz["ip"], mz["cs"], 28, 0)
    for i, (off, seg) in enumerate(relocs):
        struct.pack_into("<HH", head, 28 + 4 * i, off, seg)
    Path(out_path).write_bytes(bytes(head) + image)
    return seg_of, nfpu, len(relocs)


def main(exe, outdir):
    d = Path(exe).read_bytes()
    mz = read_mz(d)
    ovls = read_overlays(d, (mz["end"] + 15) // 16 * 16)
    print(f"root {mz['end'] - mz['hdr']} byte, {len(ovls)} overlay, {sum(len(o['code']) for o in ovls)} byte di codice")
    # ripartizione in gruppi che stanno sotto il limite di 1 MB
    budget = (MAX_IMAGE_PARA - OVL_BASE_PARA) * 16
    groups, cur, used = [], [], 0
    for ov in ovls:
        sz = (len(ov["code"]) + 15) // 16 * 16
        if used + sz > budget:
            groups.append(cur)
            cur, used = [], 0
        cur.append(ov["n"])
        used += sz
    groups.append(cur)
    out = Path(outdir)
    out.mkdir(parents=True, exist_ok=True)
    omap = {}
    for gi, g in enumerate(groups):
        name = f"shadow_ovl{chr(65 + gi)}.exe"
        seg_of, nfpu, nrel = build(d, mz, ovls, set(g), out / name)
        for n, s in seg_of.items():
            ov = ovls[n - 1]
            omap[n] = dict(image=name, segment=f"{s + 0x1000:04X}", file_off=hex(ov["file_off"]), size=len(ov["code"]))
        print(f"{name}: overlay {g[0]}-{g[-1]}, {nrel} rilocazioni, {nfpu} istruzioni FP ripristinate")
    (out / "overlay_map.json").write_text(json.dumps(omap, indent=1))


if __name__ == "__main__":
    main(*sys.argv[1:3])
