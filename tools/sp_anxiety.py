#!/usr/bin/env python3
"""Ansie e aiuti desiderati di Shadow President (passo 13 del ciclo di fine anno, FUN_7714_10b4).

Uso: python3 -I tools/sp_anxiety.py [scenario ...]    (default: tutti, 0 S0..S4)

Ricalcola da COUNTRY/NUMBERS/WORLD/REGION/REGIONS.DAT/CONTIG.FIL le cinque ansie
(STRATEGY+0x00..0x20) e i cinque aiuti desiderati (STRATEGY+0x78..0x98) e li confronta
con i valori salvati negli scenari. Formule in re/FORMATS.md, "Ansie".
"""
import struct
import sys
from pathlib import Path

G = Path(__file__).resolve().parent.parent / "re/orig/SHADOW"
USSR = 136


def read_regions():
    """REGIONS.DAT: '@' + id u16 + n u16, poi n voci (paese u16, 'C' membro / 'A' adiacente)."""
    d = (G / "REGIONS.DAT").read_bytes()
    regs, p = {}, 0
    while p < len(d):
        rid, cnt = struct.unpack_from("<2h", d, p + 1)
        p += 5
        regs[rid] = []
        for _ in range(cnt):
            regs[rid].append((struct.unpack_from("<h", d, p)[0], chr(d[p + 2])))
            p += 3
    member, home = {}, {}
    for rid, ents in regs.items():
        for i, kind in ents:
            member.setdefault(i, []).append(rid)    # al massimo 4 regioni per paese
            if kind == "C":
                home[i] = rid                       # regione "di casa": l'ultima in cui è 'C'
    return regs, member, home


def read_contig():
    """CONTIG.FIL: 42 byte per paese, n i16 + 20 vicini i16."""
    d = (G / "CONTIG.FIL").read_bytes()
    out = []
    for i in range(len(d) // 42):
        n = struct.unpack_from("<h", d, i * 42)[0]
        out.append(list(struct.unpack_from(f"<{n}h", d, i * 42 + 2)))
    return out


def weights(share):
    """(peso mondo, peso regione): le grandi potenze (quota >= 5) guardano al mondo per l'80%."""
    if share >= 5:
        return 0.8, 0.2
    wr = max(1 - 0.175 * share, 0.2)
    return 1 - wr, wr


def compute(sfx):
    rd = lambda f: (G / f"{f}.{sfx}").read_bytes()
    cty, num, wld, reg = rd("COUNTRY"), rd("NUMBERS"), rd("WORLD"), rd("REGION")
    strat = rd("STRATEGY")
    C = lambda i, o, t="d": struct.unpack_from("<" + t, cty, i * 202 + o)[0]
    N = lambda i, o, t="f": struct.unpack_from("<" + t, num, i * 61 + o)[0]
    W = lambda o, t="d": struct.unpack_from("<" + t, wld, o)[0]
    R = lambda k, o: struct.unpack_from("<d", reg, k * 210 + o)[0]
    S = lambda i, o: struct.unpack_from("<d", strat, i * 160 + o)[0]
    regs, member, home = read_regions()
    contig = read_contig()
    wp = W(0x12E, "f")
    wpf = 1.75 if wp == 0 else (4 / max(wp, 1e-5) + 3) / 4
    team = lambda i: cty[i * 202 + 197]
    team_no = lambda i: team(i) - 0x81 if team(i) > 0x80 else team(i) - 1
    leaders = struct.unpack_from("<15h", wld, 0xBC)
    warheads = lambda i: struct.unpack_from("<h", num, i * 61 + 0x3B)[0]    # NUMBERS+0x3B
    team_wh = {}
    for i in range(168):
        if team(i):
            team_wh[team_no(i)] = team_wh.get(team_no(i), 0) + warheads(i)
    region_mil = {r: sum(C(i, 0x38) / (3 if i == USSR else 1) for i, _ in e) for r, e in regs.items()}
    ranking = wld[0x6C:0x6C + 12]                                           # ideologie per influenza
    rank_infl = lambda i: (C(i, 32) / (ranking.index(num[i * 61 + 0x34]) + 1)
                           if num[i * 61 + 0x34] in ranking else 0.0)
    total_rank_infl = sum(rank_infl(i) for i in range(168))
    clamp = lambda x: min(max(x, 0.0), 100.0)

    res = {}
    for i in range(168):
        if not C(i, 16):
            continue
        rmax = lambda o: max([R(k, o) for k in member.get(i, [])] or [0.0])
        amb, eth, peace, n00 = N(i, 0x35), N(i, 0x30), C(i, 145), N(i, 0x00, "d")
        ler, lvl, pc, pop = C(i, 169), C(i, 193, "h"), C(i, 0x78), int(N(i, 0x18, "d"))
        out = {}
        # nucleare
        leader = team(i) and leaders[team_no(i)] == i
        if leader:
            own = max(team_wh[team_no(i)], 0)
            other = sum(v for k, v in team_wh.items() if k != team_no(i))
            a = other / (own + 1) * 75
        else:
            if team(i):
                a = (7 - wp) * amb * (7 - lvl) * (7 - peace) * wpf
            else:
                a = (7 - wp) * (7 - peace) * 2 * amb * (7 - lvl) / 7 * wpf
                if any(C(j, 193, "h") >= 2 for j in contig[i]):             # senza squadra e con un vicino nucleare
                    a *= 3
        out["anx_nuclear"] = clamp(a)
        # militare
        ms = C(i, 0x38)
        if leader:
            a = (100 - ms) / (7 - amb) * (7 - peace) + ms / 5
        else:
            a = 100 - 100 * (ms / (3 if i == USSR else 1)) / max(region_mil.get(home.get(i), 0), 1e-4)
            a = a / max(peace, 1e-4) * (amb + 10) / 10 * wpf
        out["anx_military"] = clamp(a)
        # politica (PTA)
        out["anx_political"] = clamp((0.5 / max(ler, 1e-4)) * amb * ((n00 + 1) / 2) * (7 - peace) * 2.25 * wpf)
        # economica
        we, wr = weights(C(i, 0x58))
        ref_pc, ref_g = we * W(0x38) + wr * rmax(0x40), we * W(0x10C) + wr * rmax(0xB6)
        a1 = max(0.0, 1 - pc / ref_pc) if ref_pc else 0.0
        a2 = max(0.0, 1 - N(i, 0x28) / ref_g) if ref_g else 0.0
        out["anx_economic"] = clamp((a1 + a2) / 2 * 100)
        # sociale
        g, pg = N(i, 0x28), N(i, 0x24)
        a = (pg / 0.023) * n00 * amb * 6 if g <= 0.005 else (pg / 0.023) * n00 * 10 * amb * (0.03 / g)
        out["anx_social"] = clamp(a)
        # aiuti desiderati
        we, wr = weights(C(i, 0x44))
        ref = we * W(0xE4) + wr * rmax(0x8E)
        out["want_nuc"] = 0.0 if ref < C(i, 0x60) or amb == 1 else \
            (ref - C(i, 0x60)) * 100 / (7 - amb) * out["anx_nuclear"] / 100
        we, wr = weights(ms)
        ref = we * W(0xF4) + wr * rmax(0x9E)
        out["want_mil"] = 0.0 if ref < C(i, 0x70) else \
            ((ref - C(i, 0x70)) / peace / (7 - amb) + amb * 100 * (7 - peace)) * out["anx_military"] / 100
        we, wr = weights(C(i, 32))
        ref = we * W(0x104) + wr * rmax(0xAE)
        out["want_intel"] = 0.0 if ref < S(i, 0x28) else (ref - S(i, 0x28)) / (7 - amb) * out["anx_political"] / 100
        we, wr = weights(C(i, 0x58))
        ref = we * W(0x38) + wr * rmax(0x40)
        if pc >= max(W(0x38), 21000.0) / 2 or ref < pc:
            out["want_econ"] = 0.0
        else:
            out["want_econ"] = min((ref - pc) * pop * out["anx_economic"] / 100, W(0x00) * 1e5)
        share = rank_infl(i) * 100 / total_rank_infl if total_rank_infl else rank_infl(i) * 100
        we, wr = weights(share)
        ref = we * 3000.0 + wr * rmax(0x40)
        out["want_hum"] = 0.0 if ref < pc else pop * (ref - pc) * out["anx_social"] / 100
        res[i] = out
    saved = {i: {k: S(i, o) for k, o in (("anx_nuclear", 0), ("anx_military", 8), ("anx_political", 0x10),
                                          ("anx_economic", 0x18), ("anx_social", 0x20), ("want_hum", 0x78),
                                          ("want_econ", 0x80), ("want_intel", 0x88), ("want_mil", 0x90),
                                          ("want_nuc", 0x98))} for i in res}
    return res, saved


def main(scen):
    for sfx in scen:
        res, saved = compute(sfx)
        line = []
        for k in next(iter(res.values())):
            ok = sum(1 for i in res if abs(res[i][k] - saved[i][k]) <= max(0.01, 1e-6 * abs(saved[i][k])))
            line.append(f"{k} {ok}/{len(res)}")
        print(sfx, "  ".join(line))


if __name__ == "__main__":
    main(sys.argv[1:] or ["0", "S0", "S1", "S2", "S3", "S4"])
