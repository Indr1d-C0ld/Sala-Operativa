#!/usr/bin/env python3
"""Estrae i dati paese di Shadow President (DOS, 1993) in JSON.

Uso:  python3 -I tools/sp_extract.py re/orig/SHADOW > re/sp_countries_1990.json

Layout ricavati confrontando i record con il CIA World Factbook 1990
(Gutenberg #14). Vedi re/FORMATS.md. I campi marcati "?" sono ipotesi.
"""
import json
import struct
import sys
from pathlib import Path

CIADATA_REC = 66   # CIADATA.FIL: dati Factbook statici, little-endian, record "packed"
COUNTRY_REC = 202  # COUNTRY.*: stato dinamico della simulazione (double IEEE)

# (offset, formato struct, nome, scala)  -> valore = raw * scala
CIADATA_FIELDS = [
    (0,  "<I", "area_km2", 1),
    (4,  "<I", "population", 1),
    (8,  "<B", "pop_growth_pct", 0.1),
    (9,  "<B", "birth_rate_per1000", 1),
    (10, "<B", "death_rate_per1000", 1),
    (11, "<B", "infant_mortality_per1000", 1),
    (12, "<B", "life_exp_male", 1),
    (13, "<B", "life_exp_female", 1),
    (14, "<B", "fertility_rate", 0.1),
    (15, "<B", "literacy_pct", 1),
    (16, "<I", "labor_force", 1),
    (20, "<I", "gnp_usd", 100_000),
    (24, "<B", "unemployment_pct?", 0.1),
    (25, "<I", "budget_revenues_usd", 100_000),
    (29, "<I", "budget_expenditures_usd", 100_000),
    (33, "<I", "exports_usd", 100_000),
    (37, "<I", "imports_usd", 100_000),
    (41, "<I", "external_debt_usd", 100_000),
    (45, "<I", "electricity_capacity_kw", 1),
    (49, "<f", "exchange_rate_per_usd", 1),
    (53, "<I", "troops?", 1),
    (57, "<H", "unknown_57", 1),
    (59, "<B", "unknown_59", 1),
    (60, "<f", "gnp_real_growth", 1),
    (64, "<B", "code_64?", 1),
    (65, "<B", "code_65?", 1),
]

# COUNTRY.*: layout completo (somma = 202), ricavato dagli accessi nel codice (tools/sp_unpack.py + Ghidra).
# Nomi con "?" = ipotesi da correlazioni sui dati; senza "?" = confermati da codice o da relazione esatta.
COUNTRY_FIELDS = [
    (0,   "<d", "nuclear_power", 1),            # 0/8 == 96/112: stock nucleare
    (8,   "<d", "military_power", 1),           # stock militare; 56 = sua quota mondiale
    (16,  "<d", "economic_power", 1),           # GNP * (1+g)^2 / 1e5; 0 => paese inattivo
    (24,  "<d", "regional_influence", 1),       # pm*[48] + pe*[80], pesi per pace regionale (passo 6)
    (32,  "<d", "total_influence_share", 1),    # = wM*[56] + wE*[88], pesi per livello di pace mondiale
    (40,  "<d", "total_influence_share_prev?", 1),
    (48,  "<d", "regional_military_share", 1),  # % del potere militare della regione (URSS 1/3)
    (56,  "<d", "military_share_pct", 1),       # ~ 100*[8]/sum[8]
    (64,  "<f", "military_share_delta", 1),     # (share - share_prev) / share_prev
    (68,  "<d", "nuclear_share_pct", 1),        # 100*[0]/sum[0]
    (76,  "<f", "nuclear_share_delta", 1),
    (80,  "<d", "regional_economic_share", 1),  # % del PIL della regione, prima degli aiuti
    (88,  "<d", "economic_share_pct", 1),       # ~ 100*[16]/sum[16]
    (96,  "<d", "nuclear_spending_usd", 1),
    (104, "<d", "military_capital", 1),         # sqrt(10*(spesa/truppe)/(media mondiale)); [8] = [104]*truppe
    (112, "<d", "military_spending_usd", 1),
    (120, "<d", "gnp_per_capita_usd", 1),
    (128, "<d", "oil_reserves", 1),  # Arabia S. 26, Iraq/Kuwait/EAU 10, Iran 9
    (136, "<d", "strategic_reserves", 1),
    (144, "<B", "flag_144?", 1),                # Israele/Egitto 10
    (145, "<d", "net_peace", 1),              # 1 (guerra) .. 6; cambiato dai gestori di eventi
    (153, "<f", "belligerence_avg3", 1),     # (d0+d1+d2)/3: spesa militare IA = PIL * questo / 100
    (157, "<f", "belligerence", 1),          # (d_prev + T[peace][ethic]) / 2
    (161, "<f", "belligerence_prev", 1),
    (165, "<f", "belligerence_prev2", 1),
    (169, "<d", "leadership_effectiveness", 1), # LER del manuale, [0,1]: limite alle azioni (100*LER), repressione dei disordini
    (177, "<d", "quality_of_life", 1),          # min(1, ((3737/(7-eth)+3737/amb+3737/n00)/3 + pc_gnp)/MISC+8)
    (185, "<d", "quality_of_life_prev", 1),
    (193, "<H", "nuclear_level", 1),            # 0 nessuno .. 6 portata mondiale (manuale: livelli 1-7)
    (195, "<H", "foreign_policy_orientation", 1),  # 1 blocco dominante, 5 rivale, 8 ostile
    (197, "<B", "world_team", 1),               # bit0-6 squadra, bit7 leader nella coalizione mondiale
    (198, "<f", "strategic_value", 1),          # 5*[144] + 100*[136]*(1+[32]/10) - 100
]

# NUMBERS.*: 61 byte per paese.
NUMBERS_REC = 61
NUMBERS_FIELDS = [
    (0x00, "<d", "last_police", 1),              # "Police State" [0,4]: clamp((5 - 0,9*etica)*3/WORLD+0x48, 0, 4), mensile
    (0x08, "<d", "last_econ_dif", 1),            # divario di PIL pro capite memorizzato dal calcolo mensile
    (0x10, "<d", "social_outcry", 1),           # "Social Outcry" 0-100: 25*rep*min(3704/pil_pc,1)*(0,03/(max(g,0,003)+0,002))^2
    (0x18, "<d", "population", 1),              # pop' = pop * (1 + pop_growth)
    (0x20, "<i", "gnp_base_1e5", 1),            # PIL di base in unità di 100.000 $
    (0x24, "<f", "pop_growth", 1),              # frazione; smorzata se > 0.05
    (0x28, "<f", "gdp_growth", 1),              # frazione; smorzata se > 0.05, minimo -0.15
    (0x2C, "<i", "military_manpower", 1),       # truppe
    (0x30, "<f", "ethic", 1),                   # 1 spietato .. 5; = Ethic negli eventi in coda
    (0x34, "<c", "ideology", 1),                # lettera A-M -> IDEOLGYL.FIL
    (0x35, "<f", "ambition", 1),                # 1 .. 6; = Ambition negli eventi in coda
    (0x39, "<h", "controlled_by", 1),           # id del paese che lo controlla (se stesso o il conquistatore)
    (0x3B, "<h", "nuclear_warheads", 1),        # testate: USA/URSS 5000, Cina 436, Francia 389, RU 362, Israele 100
]


def decode(rec, fields):
    out = {}
    for off, fmt, name, scale in fields:
        v = struct.unpack_from(fmt, rec, off)[0]
        if isinstance(v, bytes):
            v = v.decode("latin-1").strip("\x00")
        elif isinstance(v, float):
            v = round(v * scale, 6)
        elif scale != 1:
            v = round(v * scale, 3) if scale < 1 else v * scale
        out[name] = v
    return out


def main(game_dir: Path, state_file: str = "COUNTRY.0"):
    names = (game_dir / "CNAMES.TXT").read_text(encoding="latin-1").splitlines()
    cia = (game_dir / "CIADATA.FIL").read_bytes()
    cty = (game_dir / state_file).read_bytes()
    num = (game_dir / state_file.replace("COUNTRY", "NUMBERS")).read_bytes()
    assert len(cia) == len(names) * CIADATA_REC, "CIADATA size mismatch"
    assert len(cty) == len(names) * COUNTRY_REC, "COUNTRY size mismatch"
    result = []
    for i, name in enumerate(names):
        r1 = cia[i * CIADATA_REC:(i + 1) * CIADATA_REC]
        r2 = cty[i * COUNTRY_REC:(i + 1) * COUNTRY_REC]
        result.append({
            "id": i,
            "name": name,
            "factbook_1990": decode(r1, CIADATA_FIELDS),
            "sim_state": decode(r2, COUNTRY_FIELDS),
            "personality": decode(num[i * NUMBERS_REC:(i + 1) * NUMBERS_REC], NUMBERS_FIELDS),
        })
    json.dump(result, sys.stdout, indent=1, ensure_ascii=False)


if __name__ == "__main__":
    main(Path(sys.argv[1]), *(sys.argv[2:3]))
