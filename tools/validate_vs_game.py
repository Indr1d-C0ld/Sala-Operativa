#!/usr/bin/env python3
"""Confronta gli indicatori 1990 di worldbook.sqlite con CIADATA.FIL del gioco originale.
Uso: python3 -I tools/validate_vs_game.py   (richiede re/sp_countries_1990.json)"""
import json, sqlite3
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
g = {x["id"]: x for x in json.load(open(ROOT / "re/sp_countries_1990.json"))}
db = sqlite3.connect(ROOT / "data/worldbook.sqlite")
PAIRS = [("area_km2", "area_km2", 1), ("population", "population", 1), ("gnp_usd", "gdp_usd", 1),
         ("labor_force", "labor_force", 1), ("exports_usd", "exports_usd", 1), ("imports_usd", "imports_usd", 1),
         ("external_debt_usd", "external_debt_usd", 1), ("electricity_capacity_kw", "electricity_kw", 1),
         ("exchange_rate_per_usd", "exchange_per_usd", 1), ("literacy_pct", "literacy_pct", 1),
         ("life_exp_male", "life_exp_male", 1), ("life_exp_female", "life_exp_female", 1),
         ("birth_rate_per1000", "birth_rate", 1), ("budget_revenues_usd", "budget_revenues_usd", 1),
         ("budget_expenditures_usd", "budget_expenditures_usd", 1), ("gnp_real_growth", "gdp_growth_pct", 100),
         ("unemployment_pct?", "unemployment_pct", 1)]
tot_ok = tot_n = 0
for gk, wk, sc in PAIRS:
    n = ok = miss = 0; diff = []
    for gid, code in db.execute("SELECT game_id, code FROM sp1990_map WHERE code IS NOT NULL"):
        gv = g[gid]["factbook_1990"][gk] * sc
        if not gv or code in ("YM", "GM"):  # il gioco fonde le due Germanie/i due Yemen
            continue
        r = db.execute("SELECT value FROM indicator WHERE code=? AND year=1990 AND key=?", (code, wk)).fetchone()
        n += 1
        if r is None: miss += 1
        elif abs(gv - r[0]) <= max(0.02 * abs(gv), 0.11) or (wk == "unemployment_pct" and abs(gv * 10 - r[0]) <= 0.6): ok += 1
        else: diff.append((g[gid]["name"], round(gv, 3), r[0]))
    tot_ok += ok; tot_n += n
    print(f"{wk:26} {ok:4}/{n:<4} mancanti {miss:3}  es. diversi: {diff[:3]}")
print(f"TOTALE concordanza: {tot_ok}/{tot_n} = {100*tot_ok/tot_n:.1f}%")
