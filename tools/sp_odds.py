#!/usr/bin/env python3
"""Probabilità di successo delle azioni di Shadow President, ricostruite dagli esecutori
(overlay 37 b87a, 41 dc78, 39 c638, 40 d1a4). Formule e fonti in re/FORMATS.md, "Probabilità di successo".

Uso: python3 -I tools/sp_odds.py [scenario] chi_agisce bersaglio     (nomi come in CNAMES.TXT)
     python3 -I tools/sp_odds.py 0 "United States" Iraq

Il gioco tira r = rand(1,100) e confronta r con la soglia S (r < S oppure r <= S, secondo l'azione).
Se il bersaglio sono gli Stati Uniti, decide il giocatore (S = 101 o 0).
Le azioni 2-5 usano il livello di relazione relation() (FUN_7124_0b5a, 1 ostile .. 7 alleato).
Quando la relazione contiene un tiro rand(0,3), le soglie sono mostrate come intervallo.
"""
import math
import struct
import sys
from pathlib import Path

G = Path(__file__).resolve().parent.parent / "re/orig/SHADOW"
FRIENDS = {'A': 'AGJ', 'B': '', 'C': 'C', 'D': 'D', 'E': 'E', 'F': 'F', 'G': 'A', 'H': '', 'J': 'A', 'K': 'K',
           'L': '', 'M': 'M'}
ENEMIES = {'A': 'BDF', 'B': 'CAHJDEFM', 'C': 'HB', 'D': 'BGFA', 'E': 'HFB', 'F': 'EHADB', 'G': 'DMKL',
           'H': 'KLBCJEF', 'J': 'BH', 'K': 'HG', 'L': 'HG', 'M': 'GB'}
CATEGORY = [0] * 7 + [1] * 5 + [2] * 5 + [3] * 5 + [4] * 3   # tabella 2A56:0276, per codice azione
STRAT_FIELD = {0: 0x20, 1: 0x18, 2: 0x10, 3: 0x08, 4: 0x00}  # ansia del bersaglio: sociale, economica, spie, militare, nucleare


class Scenario:
    def __init__(self, sfx):
        rd = lambda f: (G / f"{f}.{sfx}").read_bytes()
        self.cty, self.num, self.wld = rd("COUNTRY"), rd("NUMBERS"), rd("WORLD")
        self.strat, self.assetb = rd("STRATEGY"), rd("ASSET")
        self.names = (G / "CNAMES.TXT").read_text(encoding="latin-1").splitlines()
        self.donors = list(struct.unpack_from("<15h", self.wld, 0x9E))
        self.world_peace = struct.unpack_from("<f", self.wld, 0x12E)[0]

    def C(self, i, o, t="d"):
        return struct.unpack_from("<" + t, self.cty, i * 202 + o)[0]

    def N(self, i, o, t="f"):
        return struct.unpack_from("<" + t, self.num, i * 61 + o)[0]

    def S(self, i, o):
        return struct.unpack_from("<d", self.strat, i * 160 + o)[0]

    def asset(self, target, slot, k):
        return struct.unpack_from("<h", self.asset_bytes(target), k * 30 + slot * 2)[0]

    def asset_bytes(self, i):
        return self.assetb[i * 180:(i + 1) * 180]


def affinity(sc, a, t):
    """(L28, L50): affinità ideologica fra chi agisce e bersaglio (NUMBERS+0x34)."""
    ia, it = chr(sc.num[a * 61 + 0x34]), chr(sc.num[t * 61 + 0x34])
    if ia == it:
        return 80, 5
    if it in FRIENDS.get(ia, ""):
        return 40, 4
    if it in ENEMIES.get(ia, ""):
        return 10, 1
    return 20, 2


def common(sc, a, t, code):
    """Termini calcolati prima dello switch sul codice (b87a:3bd2-3ff5, uguale in c638)."""
    L28, L50 = affinity(sc, a, t)
    slot = sc.donors.index(a) if a in sc.donors else -1
    L60 = sum(sc.asset(t, slot, k) for k in range(5)) if slot >= 0 else 0      # M$ di chi agisce nel bersaglio
    L58 = sc.S(t, STRAT_FIELD[CATEGORY[code]])
    econ_t = sc.C(t, 16) or 1e-5
    L68 = L60 * 1e6 * L58 / (econ_t * 0.25 * 1e5) * L28                       # leva economica
    L70 = (sc.C(a, 32) - sc.C(t, 32)) * ((1 - L58 / 100) + 2) * L28 / 100 / 100  # divario d'influenza
    return dict(L28=L28, L50=L50, L58=L58, L60=L60, L68=L68, L70=L70, slot=slot)


TEAM_MASK = 0x7F                       # DGROUP:00F0, toglie il bit "leader nella coalizione"
RIVALS = {frozenset((72, 117)): 2,     # India-Pakistan
          frozenset((160, 30)): 3, frozenset((72, 30)): 3, frozenset((59, 152)): 3}  # Vietnam-Cina, India-Cina, Grecia-Turchia
US, ISRAEL = 156, 78


def relation(sc, a, t, roll=0):
    """Livello di relazione fra due paesi (FUN_7124_0b5a, overlay 15), da 1 (ostile) a 7 (alleato).
    roll = esito di rand(0,3), usato solo fra paesi minori di squadre diverse."""
    infl = lambda i: sc.C(i, 32)
    reg = lambda i: sc.C(i, 24)                 # COUNTRY[24]: influenza regionale
    team = lambda i: sc.cty[i * 202 + 197] & TEAM_MASK
    eth = lambda i: sc.N(i, 0x30)
    ide = lambda i: chr(sc.num[i * 61 + 0x34])
    orient_gap = abs(sc.C(a, 195, "h") - sc.C(t, 195, "h"))
    big, small = (a, t) if infl(a) > infl(t) else (t, a)
    same_team = team(a) == team(t)
    coalition = [x for x in struct.unpack_from("<15h", sc.wld, 0x80)]
    coalition = coalition[:coalition.index(-1)] if -1 in coalition else coalition
    big_in, small_in = big in coalition, small in coalition
    if infl(big) >= 50:                                   # egemone
        r = int(eth(big) + 1)
    elif infl(big) >= 5:                                  # grande potenza
        if infl(small) >= 5 or sc.C(small, 56) >= 5:      # anche l'altro è una potenza
            r = 9 if big_in and small_in else 5 if big_in else 2 if small_in else 4
        elif not same_team:
            if team(small):
                r = 6 if reg(small) < 15 else 5
            else:
                r = 7 if reg(small) < 5 else 6
        elif sc.C(small, 88) < 4.4 and infl(small) < 4.0:
            r = 6 if reg(small) > 10 else 5
        else:
            r = 6
    elif infl(big) >= 1:                                  # potenza media
        mid_small = 1 <= infl(small) < 5
        if team(big):
            r = (6 if same_team else 7) if mid_small else (5 if same_team else 7)
        else:
            r = (7 if not team(small) else 6) if mid_small else (5 if not team(small) else 6)
    elif same_team:                                       # due paesi minori
        r = int(3 + eth(small) + eth(big))
    elif reg(big) >= 5:
        r = int((eth(small) + eth(big)) / 2) + roll
    else:
        r = 4
    r -= orient_gap
    if ide(big) == ide(small):
        r += 1
    if {big, small} == {US, ISRAEL}:
        r += 1
    if ide(big) == "H" or ide(small) == "H":             # imperialismo
        r -= 1
    if small == ISRAEL and ide(big) == "L":
        r = int(r * 0.5)
    elif big == ISRAEL and ide(small) == "K":
        r = int(r * 0.5)
    r -= RIVALS.get(frozenset((big, small)), 0)
    return min(max(r, 1), 7)


def team_bonus(sc, a, t, same, none):
    """Lb0 di b87a: stessa squadra (bit 0-6 di C+197 uguali), bersaglio senza squadra, altrimenti -30."""
    ta, tt = sc.cty[a * 202 + 197] & TEAM_MASK, sc.cty[t * 202 + 197] & TEAM_MASK
    return same if ta == tt else none if tt == 0 else -30


def odds(sc, a, t):
    """Soglia S per ogni azione calcolabile. P(successo) ~ S/100 (troncata a [0,1])."""
    w = lambda i: sc.C(i, 169)            # COUNTRY[169]: LER (Leadership Effectiveness Rating), limite massimo delle azioni
    infl = lambda i: sc.C(i, 32)
    mil = lambda i: sc.C(i, 56)
    out = {}
    k = common(sc, a, t, 0)
    s = k["L50"] * k["L68"] / 20 + 5
    out["0 riforma sociale"] = min(max(s, 5 + infl(a)), 100 * w(a))
    # 1 diritti umani: solo se etica_T < etica_A (b87a:4862)
    if sc.N(t, 0x30) < sc.N(a, 0x30):
        econ_t = sc.C(t, 16)
        L78 = 10 if not econ_t or not k["L60"] else k["L60"] / (econ_t * 0.25 / 10) * 100 * k["L28"] / 10
        out["1 diritti umani"] = min(max(L78, 5 + infl(a)), 75 * w(a))
    amb_t, peace_t, eth_a = sc.N(t, 0x35), sc.C(t, 145), sc.N(a, 0x30)
    for roll in (0, 3):
        rel = relation(sc, a, t, roll)
        tag = "" if relation(sc, a, t, 0) == relation(sc, a, t, 3) else f" (rand={roll})"
        base = 5 * rel - 5 * amb_t + 4 * sc.world_peace + 10 * (peace_t - 1)
        out["2 inviato di pace" + tag] = min(max((base + 10 - sc.S(t, 8) / 5) * eth_a / 4, 10 + infl(a)), 100 * w(a))
        s3 = 10 * rel - 5 * amb_t + team_bonus(sc, a, t, 30, 10) / 2 + 10 * (peace_t - 1)
        out["3 scambio culturale" + tag] = min(max(s3, 10 + infl(a)), 100)
        out["4 relazioni diplomatiche" + tag] = min(max((base + 10 - sc.S(t, 16) / 5) * eth_a / 4 * 1.5, 10), 100 * w(a))
        s5 = 30 * (rel - 3) + 10 * (7 - amb_t) + team_bonus(sc, a, t, 20, 10) + 10 * (peace_t - 1)
        out["5 legami economici" + tag] = min(max(s5, 10 + sc.C(a, 88)), 100 * w(a))
        if not tag:
            break
    out["6 condanna"] = 70 + 100 * w(a) - 100 * w(t)
    k = common(sc, a, t, 7)
    out["7 investimenti"] = min(max(k["L68"] * k["L28"] / 4, 10 + sc.C(a, 88) / 2), 100 * w(a))
    # 12 armi ai ribelli (dc78:410a)
    n00, n10, peace = sc.N(t, 0x00, "d"), sc.N(t, 0x10, "d"), sc.C(t, 145)
    mt = max(mil(t), 1)
    s = n10 * (mil(a) / mt) * (1 - w(t)) / n00 / peace if n00 and peace else 0
    s = max(s, mil(a) - mil(t) / 2 * sc.N(a, 0x30))
    s = max(s, n10 / 10 - 2)
    out["12 armi ai ribelli"] = min(s, 100 * w(a))
    # 14-16 sabotaggio, colpo di stato, assassinio (c638:3fac)
    k = common(sc, a, t, 14)
    spy = sc.asset(t, k["slot"], 5) if k["slot"] >= 0 else 0               # ASSET+0x96: spionaggio, M$
    for code, name in ((14, "sabotaggio"), (15, "colpo di stato"), (16, "assassinio")):
        D = (code - 12) ** 2 // 2
        defense = sc.S(t, 72) / 10 * w(t) * n00 * D or 1e-13
        b8 = spy * 5e5 * w(a) / defense / 2 * 100
        s = mil(a) / (mil(t) + 1) + 10 * b8 / ((100 - k["L28"]) / 2.5) - mil(t) + (n10 / (n00 + 10) - 2)
        out[f"{code} {name}"] = min(max(s, 1), 100 / D + D)
    k = common(sc, a, t, 18)
    out["18 meno spesa militare"] = min(max(k["L70"] * 100, 10), 100 * w(a))
    k = common(sc, a, t, 19)
    out["19 più spesa militare"] = min(max(k["L68"] * 1.5, 10), 100 * w(a))
    q = lambda i: sc.C(i, 104)
    s = 100 if not (w(t) and q(t)) else w(a) * q(a) / (w(t) * q(t)) * 50
    out["20 attacco chirurgico"] = min(s, 200 * w(a))
    return out


def main(argv):
    sfx = argv[0] if len(argv) == 3 else "0"
    sc = Scenario(sfx)
    a, t = (sc.names.index(x) for x in argv[-2:])
    rel = sorted({relation(sc, a, t, r) for r in range(4)})
    print(f"{sc.names[a]} -> {sc.names[t]}  (scenario {sfx}; affinità {affinity(sc, a, t)}; relazione {rel})")
    for name, s in sorted(odds(sc, a, t).items(), key=lambda kv: int(kv[0].split()[0])):
        p = min(max(math.ceil(s) - 1, 0), 100) if s > 0 else 0
        print(f"  {name:<26} soglia {s:8.2f}   P ~ {p}%")


if __name__ == "__main__":
    main(sys.argv[1:])
