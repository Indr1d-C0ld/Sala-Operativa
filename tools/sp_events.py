#!/usr/bin/env python3
"""Dump degli eventi programmati e delle guerre di uno scenario di Shadow President.

Uso: python3 -I tools/sp_events.py re/orig/SHADOW [0|S0..S4]

File letti (layout in re/FORMATS.md):
  QUEUE.*    31 x 24 byte: eventi in coda (azioni IA, avvisi, conseguenze nucleari)
  CONFLICT.* 14 byte per partecipante a una guerra
  TROOPS.*   25 byte per contingente schierato all'estero
"""
import datetime
import struct
import sys
from pathlib import Path

EPOCH = 0x26669100  # 644256000 = 1 giugno 1990 16:00 UTC: tempo 0 del gioco (orologio +0x64 = secondi da qui)

# EventCode delle azioni (EventType 1 = IA, 2 = giocatore), indice 0-based in ACTLST.FIL
ACTIONS = [
    "social reform", "human rights", "peace envoy", "cultural exchange", "diplomatic relations",
    "economic ties", "condemnation", "investment", "most-favored-nation", "regulate trade",
    "restrict trade", "block trade", "arms to rebels", "espionage", "sabotage", "coup d'etat",
    "assassination", "negotiate peace", "discourage military spending", "encourage military spending",
    "surgical strike", "invasion (war room)", "discourage nuclear spending", "encourage nuclear spending",
    "nuclear strike", "troop deployment",
]
EVENT_TYPES = {0: "vuoto", 1: "azione IA", 2: "azione giocatore", 3: "notizia", 4: "popolarità",
               5: "conseguenze nucleari", 6: "avviso CIA"}
NUKE_STAGES = {0: "ricaduta regionale", 1: "spostamento delle alleanze", 2: "conseguenze globali"}
WARN_STAGES = {1: "preparativi militari", 2: "truppe al confine"}


def when(t):
    return datetime.datetime.fromtimestamp(t, datetime.UTC).strftime("%Y-%m-%d %H:%M")


def main(game: Path, suffix: str = "0"):
    names = (game / "CNAMES.TXT").read_text(encoding="latin-1").splitlines()
    nm = lambda i: names[i] if 0 <= i < len(names) else str(i)

    print(f"== QUEUE.{suffix}")
    q = (game / f"QUEUE.{suffix}").read_bytes()
    for i in range(len(q) // 24):
        t, typ, code, act, vic, st = struct.unpack_from("<I5h", q, i * 24)
        amb, eth = struct.unpack_from("<ff", q, i * 24 + 14)
        param = struct.unpack_from("<h", q, i * 24 + 22)[0]
        if not t and not typ:
            continue
        what = (ACTIONS[code] if typ in (1, 2) and 0 <= code < len(ACTIONS)
                else NUKE_STAGES.get(code) if typ == 5 else WARN_STAGES.get(code) if typ == 6 else code)
        extra = f" ({param} truppe)" if typ in (1, 2) and code == 25 else ""
        print(f"{when(t)}  {EVENT_TYPES.get(typ, typ):<18} {what}{extra}: {nm(act)} -> {nm(vic)}"
              f"  [stato {st}, ambizione {amb:g}, etica {eth:g}]")

    print(f"\n== CONFLICT.{suffix}")
    c = (game / f"CONFLICT.{suffix}").read_bytes()
    for i in range(len(c) // 14):
        active, side, theater, who, start, last = struct.unpack_from("<BBhhII", c, i * 14)
        print(f"guerra in {nm(theater)}: {nm(who)} lato {'difensori' if side else 'attaccanti'}"
              f"{'' if active == 1 else ' (chiusa)'}  dal {when(start)}")

    print(f"\n== TROOPS.{suffix}")
    tr = (game / f"TROOPS.{suffix}").read_bytes()
    for i in range(len(tr) // 25):
        _, owner, loc, n, n0, dead, sent, arrived = struct.unpack_from("<BhhIIIII", tr, i * 25)
        if owner < 0:
            continue
        print(f"{nm(owner):<16} in {nm(loc):<26} {n:>7} (iniziali {n0}, morti {dead})")


if __name__ == "__main__":
    main(Path(sys.argv[1]), *sys.argv[2:3])
