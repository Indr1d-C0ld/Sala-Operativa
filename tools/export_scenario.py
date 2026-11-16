#!/usr/bin/env python3
"""Esporta il pacchetto di partenza di un anno (1990–2026) dal database Factbook.

Uso: python3 -I tools/export_scenario.py ANNO [cartella_uscita]
     (default uscita: packages/app/public/scenarios/ANNO.json)

Il pacchetto contiene, per ogni entità presente nell'edizione dell'anno:
- identità: codice Factbook, ISO2, tipo, chi la amministra;
- gli indicatori dell'anno (valore, anno di riferimento, se derivato);
- i valori iniziali del modello ricavabili dai dati (PIL/1e5, crescite, truppe, spesa militare,
  quota mondiale di petrolio). Ideologia, etica, ambizione e le altre grandezze senza dato restano
  null: le genera il gioco all'avvio (vedi docs/MODELLO.md, sezione 5).
I nomi restano quelli del Factbook (inglese): il gioco li mostra in italiano tramite ISO2.
"""
import json
import re
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB = ROOT / "data/worldbook.sqlite"


# Nomi usati nelle liste dei confini che non coincidono con il nome dell'entità.
BORDER_ALIASES = {
    "holy see": "VT", "vatican city": "VT", "holy see (vatican city)": "VT",
    "democratic republic of the congo": "CG", "republic of the congo": "CF", "congo": "CF",
    "zaire": "CG", "burma": "BM", "myanmar": "BM", "ivory coast": "IV", "cote d'ivoire": "IV",
    "czechia": "EZ", "czech republic": "EZ", "north macedonia": "MK", "macedonia": "MK",
    "eswatini": "WZ", "swaziland": "WZ", "timor-leste": "TT", "east timor": "TT",
    "the gambia": "GA", "gambia": "GA", "west bank": "WE", "gaza strip": "GZ",
    "south sudan": "OD", "kosovo": "KV", "serbia": "RI", "montenegro": "MJ",
    "east germany": "DDDE", "west germany": "GM", "soviet union": "SUHH", "ussr": "SUHH",
    "usSR".lower(): "SUHH", "pdry": "YDYE", "yar": "YEYE", "uae": "AE", "united arab emirates": "AE",
    "north korea": "KN", "south korea": "KS", "korea, north": "KN", "korea, south": "KS",
    "iraq - saudi arabia neutral zone": "NTHH", "neutral zone": "NTHH",
}


def norm(name: str) -> str:
    return re.sub(r"\s+", " ", name.lower().replace("’", "'")).strip(" .")


def parse_neighbours(text: str, by_name: dict[str, str]) -> list[str]:
    """Codici dei paesi confinanti dal campo "Land boundaries" (formati 1990 e successivi)."""
    if not text:
        return []
    m = re.search(r"border countries?(?: \(\d+\))?:?(.*)", text, re.I)
    body = m.group(1) if m else re.sub(r"^.*?km total;?", "", text)
    body = re.sub(r"\([^()]*\)", "", body)                  # note fra parentesi
    out = []
    # "Nome 1,458 km": il nome inizia dopo un separatore e finisce prima della lunghezza
    for mm in re.finditer(r"(?:^|[;,]\s*)([^;,\d]+?)\s+[\d][\d.,]*\s*km", body):
        raw = mm.group(1).strip()
        code = BORDER_ALIASES.get(norm(raw)) or by_name.get(norm(raw))
        if code and code not in out:
            out.append(code)
    return out


def muslim_share(text: str):
    """Quota di musulmani (0–1) dal campo "Religions"; None se il campo manca."""
    if not text:
        return None
    original = text
    text = re.sub(r"\([^()]*\)", "", text)                  # i dettagli fra parentesi non si sommano
    total = 0.0
    for item in re.split(r"[,;]", text):
        if not re.search(r"muslim|islam|sunni|shi'?a", item, re.I):
            continue
        m = re.search(r"(\d+(?:\.\d+)?)(?:\s*-\s*(\d+(?:\.\d+)?))?\s*%", item)
        if m:
            lo = float(m.group(1)); hi = float(m.group(2) or lo)
            total += (lo + hi) / 2
    if total == 0 and re.search(r"muslim|islam", original, re.I):
        # es. "Muslim (official; citizens are 85-90% Sunni and 10-15% Shia)": si sommano i rami
        for m in re.finditer(r"(\d+(?:\.\d+)?)(?:\s*-\s*(\d+(?:\.\d+)?))?\s*%\s*(?:Sunni|Shi'?a)", original, re.I):
            total += (float(m.group(1)) + float(m.group(2) or m.group(1))) / 2
        if total == 0 and re.search(r"(muslim|islam)\s*\(official", original, re.I):
            total = 90.0                                        # religione di stato senza percentuale
    return min(total / 100, 1.0)


# Per gli stati scomparsi posizione e area geografica si prendono dal successore principale.
POSITION_FROM = {"SUHH": "RS", "DDDE": "GM", "CSHH": "EZ", "YUCS": "RI", "YEYE": "YM", "YDYE": "YM", "NTHH": "KU", "PCHH": "RM"}


def parse_coords(text: str):
    """"33 00 N, 44 00 E" -> (33.0, 44.0)."""
    m = re.search(r"(\d+)\s+(\d+)\s*([NS])\s*,\s*(\d+)\s+(\d+)\s*([EW])", text or "")
    if not m:
        return None
    lat = int(m.group(1)) + int(m.group(2)) / 60
    lon = int(m.group(4)) + int(m.group(5)) / 60
    return [round(-lat if m.group(3) == "S" else lat, 3), round(-lon if m.group(6) == "W" else lon, 3)]


def latest_text(con, key: str) -> dict:
    """Valore più recente di un campo testuale per ogni entità (posizione e area non cambiano)."""
    out = {}
    for code, value in con.execute(
            "select code, value from indicator_text where key = ? order by year", (key,)):
        if value:
            out[code] = value
    return out


def export(year: int, out: Path) -> dict:
    con = sqlite3.connect(DB)
    ents = con.execute(
        """select cy.code, cy.name, e.iso2, e.type, e.administered_by
           from country_year cy join entity e on e.code = cy.code
           where cy.year = ? order by cy.code""", (year,)).fetchall()
    if not ents:
        raise SystemExit(f"nessuna edizione per l'anno {year}")
    ind = {}
    local_currency = set()                 # spese militari scritte in valuta locale (senza "$")
    for code, key, value, ref, derived, src in con.execute(
            "select code, key, value, ref_year, derived, src from indicator where year = ?", (year,)):
        ind.setdefault(code, {})[key] = {"value": value, "refYear": ref, "derived": bool(derived)}
        if key == "military_exp_usd" and not derived and src and "$" not in src and "*" not in src:
            local_currency.add(code)

    texts = {}
    for code, key, value in con.execute("select code, key, value from indicator_text where year = ?", (year,)):
        texts.setdefault(code, {})[key] = value
    coords_all = latest_text(con, "geographic_coordinates")
    mapref_all = latest_text(con, "map_references")
    by_name = {norm(n): c for c, n in con.execute("select code, name from entity")}
    by_name.update({norm(n): c for c, n in con.execute("select code, name from country_year where year = ?", (year,))})

    oil_total = sum(v.get("oil_production_bbl_day", {}).get("value") or 0 for v in ind.values())
    countries = []
    for code, name, iso2, typ, admin in ents:
        x = ind.get(code, {})
        val = lambda k: (x.get(k) or {}).get("value")
        gdp, pop = val("gdp_usd"), val("population")
        if gdp is None and pop:
            # PIL "NA" nell'edizione (Cina 1990): si prende l'edizione più vicina entro 3 anni
            near = con.execute(
                "select value, year from indicator where code = ? and key = 'gdp_usd' and abs(year - ?) <= 3 "
                "order by abs(year - ?), year limit 1", (code, year, year)).fetchone()
            if near:
                gdp = near[0]
                x = {**x, "gdp_usd": {"value": gdp, "refYear": near[1], "derived": True}}
        if not pop or typ in ("misc", "antarctic"):
            continue                       # mondo, Unione europea, oceani, Antartide, isole disabitate
        mil = val("military_exp_usd")
        # le economie pianificate del 1990 danno la spesa in valuta locale (zloty, fiorini, dinari):
        # in quel caso, o se supera metà del PIL, vale la percentuale del PIL, se c'è
        if mil is not None and gdp and (code in local_currency or mil > 0.5 * gdp):
            mil = None
        if mil is None and val("military_exp_pct") is not None and gdp:
            mil = gdp * val("military_exp_pct") / 100
        oil = val("oil_production_bbl_day")
        countries.append({
            "code": code, "iso2": iso2, "name": name, "type": typ, "administeredBy": admin,
            "indicators": x,
            "government": (texts.get(code, {}).get("government_type") or ""),
            "muslimShare": muslim_share(texts.get(code, {}).get("religions") or ""),
            "neighbours": parse_neighbours(texts.get(code, {}).get("land_boundaries") or "", by_name),
            "mapRef": (texts.get(code, {}).get("map_references") or mapref_all.get(POSITION_FROM.get(code, code))
                       or mapref_all.get(code) or ""),
            "coords": parse_coords(coords_all.get(code) or coords_all.get(POSITION_FROM.get(code, ""), "")),
            "initial": {
                "econPower": gdp / 1e5 if gdp else None,
                "population": pop,
                "gdpGrowth": val("gdp_growth_pct") / 100 if val("gdp_growth_pct") is not None else None,
                "popGrowth": val("pop_growth_pct") / 100 if val("pop_growth_pct") is not None else None,
                "pcGnp": gdp / pop if gdp else None,
                "troops": val("military_personnel"),
                "milSpend": mil,
                "oilReserves": 100 * oil / oil_total if oil and oil_total else 0,
                "ideology": None, "ethic": None, "ambition": None,
            },
        })
    # tutte le successioni (anche quelle future): la carta le usa per ricondurre i confini
    # attuali agli stati dell'anno
    lineage = [{"predecessor": p, "successor": s, "year": y} for p, s, y in con.execute(
        "select predecessor, successor, year from lineage where predecessor != successor order by year")]
    pack = {"format": "melchior-scenario/1", "year": year, "source": "CIA World Factbook (database data/worldbook.sqlite)",
            "countries": countries, "lineage": lineage}
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(pack, ensure_ascii=False, separators=(",", ":")))
    return pack


if __name__ == "__main__":
    y = int(sys.argv[1])
    out = Path(sys.argv[2]) / f"{y}.json" if len(sys.argv) > 2 else ROOT / f"packages/app/public/scenarios/{y}.json"
    p = export(y, out)
    print(f"{out}: {len(p['countries'])} paesi, {out.stat().st_size // 1024} KB")
