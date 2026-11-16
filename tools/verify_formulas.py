#!/usr/bin/env python3
"""Verifica le formule ricavate da SHADOW.EXE sui file dati degli scenari.
Uso: python3 -I tools/verify_formulas.py [suffisso, default 0]"""
import math, struct, sys
from pathlib import Path
G = Path(__file__).resolve().parent.parent / "re/orig/SHADOW"
sfx = sys.argv[1] if len(sys.argv) > 1 else "0"
cty = (G / f"COUNTRY.{sfx}").read_bytes(); num = (G / f"NUMBERS.{sfx}").read_bytes()
wld = (G / f"WORLD.{sfx}").read_bytes(); cia = (G / "CIADATA.FIL").read_bytes()
C = lambda i, o, t="d": struct.unpack_from("<" + t, cty, i * 202 + o)[0]
N = lambda i, o, t="f": struct.unpack_from("<" + t, num, i * 61 + o)[0]
W = lambda o, t="d": struct.unpack_from("<" + t, wld, o)[0]
troops = [struct.unpack_from("<I", cia, i * 66 + 53)[0] for i in range(168)]
WEIGHTS = {1: (1.0, 0.0), 2: (0.7, 0.3), 3: (0.6, 0.4), 4: (0.5, 0.5), 5: (0.3, 0.7), 6: (0.1, 0.9)}
T = [[50, 45, 45, 40, 40, 30, 50], [50, 41, 25, 17, 12.7, 9.3, 8], [30, 20, 15, 11, 8.5, 6.5, 5.5],
     [20, 13, 10, 7.7, 6, 4.5, 3.7], [15, 9.5, 8, 5.7, 4.3, 3, 2.4], [12, 7.3, 6, 4.3, 3.1, 2, 1.4],
     [10, 6, 4.6, 3.3, 2.5, 1.3, 0.6]]


def check(name, pairs, tol=1e-6):
    pairs = list(pairs)
    ok = sum(1 for a, b in pairs if abs(a - b) <= tol * max(1, abs(b)))
    print(f"{name:52} {ok:4}/{len(pairs)}")


k = int(W(0x12E, "f") + 0.5); wm, we = WEIGHTS[k]
print(f"pace mondiale {W(0x12E, 'f'):.3f} -> pesi {wm}/{we}")
act = [i for i in range(168) if C(i, 16) > 0]
check("influenza = wM*quota_mil + wE*quota_eco", ((wm * C(i, 56) + we * C(i, 88), C(i, 32)) for i in act))
avg = W(0x28) / W(0x10)
check("qualità_mil = sqrt(10*(spesa/truppe)/media)", ((math.sqrt(10 * C(i, 112) / troops[i] / avg), C(i, 104))
                                                       for i in act if troops[i] and C(i, 112)), 1e-4)
check("potere_mil = qualità_mil * truppe", ((C(i, 104) * troops[i], C(i, 8)) for i in act if troops[i]), 1e-4)
check("potere_nucleare = spesa_nuc/spesa_mil * potere_mil", ((C(i, 96) / C(i, 112) * C(i, 8), C(i, 0))
                                                              for i in act if C(i, 112)), 1e-4)
check("pc_PIL = [16]*1e5 / popolazione", ((C(i, 16) * 1e5 / N(i, 0x18, "d"), C(i, 120)) for i in act), 1e-3)
check("indice_infl = 5*b144 + 100*mult*(1+infl/10) - 100",
      ((5 * C(i, 144, "B") + 100 * C(i, 136) * (1 + C(i, 32) / 10) - 100, C(i, 198, "f")) for i in act), 2e-3)
check("quota_difesa = (prec + T[pace][etica]) / 2",
      (((C(i, 161, "f") + T[int(min(max(C(i, 145), 1), 6) + .5)][int(min(max(N(i, 0x30), 1), 6) + .5)]) / 2,
        C(i, 157, "f")) for i in act), 1e-3)
check("media3 = (d0+d1+d2)/3", (((C(i, 157, "f") + C(i, 161, "f") + C(i, 165, "f")) / 3, C(i, 153, "f")) for i in act), 1e-4)
check("Σ potere economico = W+0x00", [(sum(C(i, 16) for i in range(168)), W(0))], 1e-4)
check("Σ potere militare = W+0x20", [(sum(C(i, 8) for i in range(168)), W(0x20))], 1e-3)


# ---------------------------------------------------------------------------
# Coalizioni, orientamento, World Team, qualità della vita
# ---------------------------------------------------------------------------
ORIG_EXE = (G / "SHADOW.EXE").read_bytes()
IDEO = "ABCDEFGHJKLM"
FRIENDS = {'A': 'AGJ', 'B': '', 'C': 'C', 'D': 'D', 'E': 'E', 'F': 'F', 'G': 'A', 'H': '', 'J': 'A', 'K': 'K', 'L': '', 'M': 'M'}
ENEMIES = {'A': 'BDF', 'B': 'CAHJDEFM', 'C': 'HB', 'D': 'BGFA', 'E': 'HFB', 'F': 'EHADB', 'G': 'DMKL',
           'H': 'KLBCJEF', 'J': 'BH', 'K': 'HG', 'L': 'HG', 'M': 'GB'}


def world_coalition():
    """Coalizione minima vincente fra le grandi potenze (quota militare >= 5%), come FUN_ab78_0ced."""
    ms = [C(i, 56) for i in range(168)]
    gp = [i for i in range(168) if ms[i] >= 5][:15]
    tot = sum(ms[i] for i in gp)
    sh = {i: 100 * ms[i] / tot for i in gp}
    order = list(gp)
    for _ in range(len(order)):
        for b in range(len(order) - 1):
            if sh[order[b + 1]] > sh[order[b]]:
                order[b], order[b + 1] = order[b + 1], order[b]
    ldc = [sh[i] for i in order]; n = len(ldc)
    if not n:
        return []
    if ldc[0] > 50:
        return [order[0]]
    s = 0; e = 0
    while e < n and s < 50:
        s += ldc[e]; e += 1
    if s < 50:
        return []
    k = e; idx = [n - k + j for j in range(k)]
    s = 0.0; best = 65.0; res = []
    for j in range(k):
        while s != 50:
            if s < 50 and idx[j] > j:
                s = sum(ldc[idx[i]] for i in range(k))
                if 50 < s < 65 and s < best:
                    res = [order[idx[i]] for i in range(k)]; best = s
                idx[j] -= 1
                continue
            if 50 < s < 65:
                idx[j] += 1; s -= ldc[idx[j]]
            break
        if s == 50:
            break
    return res


saved = sorted(x for x in struct.unpack_from("<15h", wld, 0x80) if x != -1)
check("coalizione mondiale (WORLD+0x80)", [(1, 1 if sorted(world_coalition()) == saved else 0)])

ide = [chr(num[i * 61 + 0x34]) if num[i * 61 + 0x34] else "" for i in range(168)]
infl = [C(i, 32) for i in range(168)]
rank = sorted(IDEO, key=lambda k: -sum(infl[i] for i in range(168) if ide[i] == k))


def orientation(i):
    r = rank.index(ide[i]); c = 2 if ide[i] in FRIENDS[rank[0]] else 1 if ide[i] in ENEMIES[rank[0]] else 0
    o = 1 if r == 0 else (2 if c == 2 else 5) if r == 1 else (2 if c == 2 else 3) if r == 2 else (1 if c == 2 else 8 if c == 1 else 4)
    o -= 2 if ide[i] in "EH" else 0
    o -= 1 if i == 129 else 0          # Arabia Saudita
    o += 2 if i == 51 else 0           # Francia
    o += 1 if N(i, 0x30) < 2 and N(i, 0x35) >= 5 else 0
    return o


check("orientamento di politica estera (C+195)", ((orientation(i), C(i, 195, "H")) for i in range(168) if ide[i]))

cand = [i for i in range(168) if C(i, 56) >= 5 or C(i, 32) >= 5]
leaders = {}
for i in cand:
    key = (C(i, 195, "H"), ide[i])
    if key not in leaders or C(i, 32) > C(leaders[key], 32):
        leaders[key] = i
saved_l = sorted(x for x in struct.unpack_from("<15h", wld, 0xBC) if x != -1)
check("leader dei World Team (WORLD+0xBC)", [(1, 1 if sorted(leaders.values()) == saved_l else 0)])
coal = set(saved)
check("flag coalizione sulle squadre (C+197 bit 7)",
      ((1 if (cty[i * 202 + 197] >> 7) == (1 if i in coal else 0) else 0, 1) for i in leaders.values()))

raw = []
for i in range(168):
    e, a, n0 = N(i, 0x30), N(i, 0x35), N(i, 0, "d")
    raw.append((3737 / (7 - e) + 3737 / a + 3737 / n0) / 3 + C(i, 120) if a and n0 and e != 7 else 0)
mx = struct.unpack_from("<d", (G / f"MISC.{sfx}").read_bytes(), 8)[0]   # normalizzatore fisso (23134,4)
check("qualità della vita = raw / MISC+0x08", ((min(1, raw[i] / mx), C(i, 177)) for i in range(168) if C(i, 177) > 0), 1e-4)

# --- passo 8: stato commerciale (FUN_b04b_27a9) e passo 9: bilanci (FUN_b2e8_0000) ---
more = (G / f"MORENUMS.{sfx}").read_bytes(); strat = (G / f"STRATEGY.{sfx}").read_bytes()
asset = (G / f"ASSET.{sfx}").read_bytes()
S = lambda i, o: struct.unpack_from("<d", strat, i * 160 + o)[0]
AS = lambda i, k: sum(struct.unpack_from("<15h", asset, i * 180 + k * 30))   # somma dei 15 donatori, M$
donors = struct.unpack_from("<15h", wld, 0x9E)
team = lambda i: cty[i * 202 + 197] & 0x7F
check("commercio MORENUMS+0x10 (4 stessa squadra, 3, 2)",
      ((4 if team(i) == team(d) else 3 if 0 in (team(i), team(d)) else 2, more[i * 31 + 0x10 + k])
       for i in range(168) for k, d in enumerate(donors)))
bud = [i for i in range(168) if i != 156 and C(i, 16) and S(i, 0x28)]
econ0 = lambda i: C(i, 16) - AS(i, 1) * 10                 # PIL prima degli aiuti economici del passo 12
p_imp = lambda i: econ0(i) * 1e5 * 0.02 / S(i, 0x28) * 3 - N(i, 0x30) - 7 + N(i, 0x35)
check("bilancio estero +0x28: pace implicita intera", ((round(p_imp(i)), p_imp(i)) for i in bud))
thr = C(struct.unpack_from("<h", wld, 0xBA)[0], 32)        # influenza del 15° donatore
active = lambda i: econ0(i) * 1e5 / N(i, 0x18, "d") >= 4000 or C(i, 32) >= thr
check("bilancio attivo (pc >= 4000 o influenza >= 15° donatore)", (((S(i, 0x38) != 0), active(i)) for i in bud))
check("STRATEGY+0x30 = 3(7-pace)^2/100 * B/3",
      (((7 - C(i, 145)) ** 2 * 3 / 100 * S(i, 0x28) / 3 if active(i) else 0, S(i, 0x30)) for i in bud))
check("STRATEGY+0x40 = (6-(pace+7-amb)/2)/100 * B",
      (((6 - (C(i, 145) + 7 - N(i, 0x35)) / 2) / 100 * S(i, 0x28) if active(i) else 0, S(i, 0x40)) for i in bud))
check("STRATEGY+0x48 = B(50-etica*W+0x48)/200 + aiuti intel",
      ((S(i, 0x28) * (50 - N(i, 0x30) * W(0x48)) / 200 + AS(i, 2) * 1e6, S(i, 0x48)) for i in bud))
ms0 = lambda i: C(i, 112) - AS(i, 3) * 1e6
check("STRATEGY+0x58 aiuti militari = 24/(etica+0,01)% spesa mil",
      ((0 if C(i, 153, "f") < 1.5 else 24 / (N(i, 0x30) + 0.01) / 100 * ms0(i), S(i, 0x58)) for i in bud))
check("spesa nucleare = spesa_mil*amb*0,0027*(livello+1) + aiuti",
      (((0 if C(i, 153, "f") < 1.5 else ms0(i) * N(i, 0x35) * 0.0027 * (C(i, 193, "h") + 1)) + AS(i, 4) * 1e6, C(i, 96))
       for i in bud))

# --- fine mese: repressione e malcontento sociale (FUN_ed41_0000, "Receiving Social Outcry Levels...") ---
W48 = W(0x48)
check("repressione NUMBERS+0 = clamp((5-0,9*etica)*3/W+0x48, 0, 4)",
      ((min(max((5 - 0.9 * min(max(N(i, 0x30), 1), 6)) * 3 / W48, 0), 4), N(i, 0, "d")) for i in act))
check("malcontento NUMBERS+0x10 = 25*rep*min(3704/pc,1)*(0,03/(g+0,002))^2",
      ((min(N(i, 0, "d") * 25 * min(3704 / (C(i, 120) + 1e-6), 1) * (0.03 / (max(N(i, 0x28), 0.003) + 0.002)) ** 2, 100),
        N(i, 0x10, "d")) for i in act), 1e-6)

# --- passo 6: regioni (FUN_ab78_3692) ---
sys.path.insert(0, str(Path(__file__).resolve().parent))
from sp_anxiety import read_regions  # noqa: E402
regs, _, _ = read_regions()
reg = (G / f"REGION.{sfx}").read_bytes()
R = lambda k, o, t="d": struct.unpack_from("<" + t, reg, k * 210 + o)[0]
econ0 = lambda i: C(i, 16) - AS(i, 1) * 10               # PIL prima degli aiuti economici
fw = lambda i: 1 / 3 if i == 136 else 1                  # l'URSS conta per un terzo
RW = {1: (1.0, 0.0), 2: (1.0, 0.0), 3: (1.0, 0.0), 4: (0.9, 0.1), 5: (0.6, 0.4), 6: (0.3, 0.7)}   # 2A56:008A
last, rinf = {}, {}
for k, e in regs.items():
    sm = sum(C(i, 8) * fw(i) for i, _ in e); se = sum(econ0(i) * fw(i) for i, _ in e)
    wm, we = RW[min(max(int(R(k, 0xCE, "f") + 0.5), 1), 6)]
    for i, t in e:
        last[i] = (C(i, 8) * 100 / sm, econ0(i) * 100 / se)
        if t == "C":
            rinf[i] = wm * last[i][0] + we * last[i][1]
check("quota militare regionale C+0x30", ((last[i][0], C(i, 0x30)) for i in act))
check("quota economica regionale C+0x50", ((last[i][1], C(i, 0x50)) for i in act))
check("influenza regionale C+0x18", ((rinf[i], C(i, 0x18)) for i in act if i in rinf))
check("REGION+0x00 Σ PIL, +0x18 Σ potere militare (URSS/3)",
      [(sum(econ0(i) * fw(i) for i, _ in e), R(k, 0)) for k, e in regs.items()] +
      [(sum(C(i, 8) * fw(i) for i, _ in e), R(k, 0x18)) for k, e in regs.items()])
check("REGION+0xC6..CC detentori dei record nucleari/militari",
      [(max((i for i, _ in e), key=lambda i, o=o: C(i, o)), R(k, 0xC6 + 2 * j, "h"))
       for k, e in regs.items() for j, o in enumerate((0x44, 0x60, 0x38, 0x70))], 0)

# --- passo 11: spie (FUN_b04b_18d1) ---
net = lambda i: max(S(i, 0x48) - AS(i, 2) * 1e6 - AS(i, 5) * 1e6, 1)   # posizione d'intelligence netta al passo 11
check("REGION+0xA6 max posizione d'intelligence netta",
      ((max(net(i) for i, _ in e), R(k, 0xA6)) for k, e in regs.items()))
