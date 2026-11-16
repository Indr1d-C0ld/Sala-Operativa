#!/usr/bin/env python3
"""Costruisce data/worldbook.sqlite: serie storiche degli indicatori di gioco
da tutte le edizioni del CIA World Factbook (1990–2025 + edizione finale 2026).

Fonti (pubblico dominio; ETL dell'archivio sotto licenza MIT):
  data/sources/factbook.db            MilkMp/CIA-World-Factbooks-Archive-1990-2025 v3.5
  data/sources/factbook.json-final    factbook/factbook.json (snapshot finale, gen 2026, CC0)

Uso:  python3 -I tools/build_worldbook.py [--with-text]

Ogni valore viene estratto dal testo originale del campo, con le stesse regole per tutte
le edizioni; il frammento sorgente resta in `indicator.src` per il controllo.
"""
import argparse
import html
import json
import re
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC_DB = ROOT / "data/sources/factbook.db"
SRC_JSON = ROOT / "data/sources/factbook.json-final"
OUT_DB = ROOT / "data/worldbook.sqlite"
FINAL_EDITION = 2026

MULT = {"trillion": 1e12, "billion": 1e9, "million": 1e6, "thousand": 1e3}
NUM = r"(-?\d[\d,]*(?:\.\d+)?)"
RE_MONEY = re.compile(r"(\$\s*)?" + NUM + r"(?:\s*-\s*\$?\d[\d,]*(?:\.\d+)?)?\s*(trillion|billion|million)?", re.I)
RE_PCT = re.compile(NUM + r"(?:\s*-\s*\d[\d,]*(?:\.\d+)?)?\s*%")
RE_YEAR = re.compile(r"\(([^()]*?)\)")
RE_Y4 = re.compile(r"\b(19[5-9]\d|20[0-4]\d)\b")
RE_FY = re.compile(r"\bFY\s?(\d{2})(?:/\d{2})?\b")


def clean(text):
    text = html.unescape(re.sub(r"<[^>]+>", " ", text or ""))
    return re.sub(r"\s+", " ", text.replace("|", " | ")).strip()


def strip_noise(s):
    """Toglie ranking e intervalli d'età, che altrimenti sembrano valori."""
    s = re.sub(r"country comparison to the world:\s*\|?\s*\d+", " ", s, flags=re.I)
    s = re.sub(r"\b\d+\s*-\s*\d+\b(?=\s*(years|:|\)))", " ", s)
    s = re.sub(r"\(\s*\d+\s*\)", " ", s)  # "military age (18)"
    return s


def ref_year(s, start):
    """Primo anno tra parentesi dopo la posizione `start` (es. '(2023 est.)', '(FY04)')."""
    for m in RE_YEAR.finditer(s, start):
        inner = m.group(1)
        y = RE_Y4.search(inner)
        if y:
            return int(y.group(1))
        fy = RE_FY.search(inner)
        if fy:
            n = int(fy.group(1))
            return 1900 + n if n > 40 else 2000 + n
    return None


def after(s, labels):
    if not labels:
        return s
    low = s.lower()
    for lab in labels:
        i = low.find(lab)
        if i >= 0:
            return s[i + len(lab):]
    return None


def to_float(txt):
    return float(txt.replace(",", ""))


def parse_money(s, need_unit=False):
    for m in RE_MONEY.finditer(s):
        dollar, num, unit = m.group(1), m.group(2), m.group(3)
        if not dollar and not unit:
            continue
        tail = s[m.end():m.end() + 3]
        if tail.lstrip().startswith("%"):
            continue
        if need_unit and not unit:
            continue
        v = to_float(num) * MULT.get((unit or "").lower(), 1)
        return v, ref_year(s, m.end()), m.group(0)
    return None


def parse_pct(s):
    m = RE_PCT.search(s)
    if not m:
        return None
    return to_float(m.group(1)), ref_year(s, m.end()), m.group(0)


def parse_number(s, unit_word=None):
    """Numero puro, con eventuale 'million'/'billion' (es. '12.008 million')."""
    pat = NUM + r"\s*(trillion|billion|million|thousand)?" + (r"\s*" + unit_word if unit_word else "")
    for m in re.finditer(pat, s, re.I):
        if s[m.end():m.end() + 2].lstrip().startswith("%"):
            continue
        v = to_float(m.group(1)) * MULT.get((m.group(2) or "").lower(), 1)
        end, text = m.end(), m.group(0)
        # intervallo "1.1-1.2 million", "40-50,000": l'unità del secondo estremo vale per entrambi,
        # e si prende l'estremo inferiore, come faceva il gioco originale (forza lavoro 1990)
        r = None if m.group(2) else re.match(r"\s*[-–]\s*" + NUM + r"\s*(trillion|billion|million|thousand)?", s[end:], re.I)
        if r:
            hi = to_float(r.group(1)) * MULT.get((r.group(2) or "").lower(), 1)
            lo = to_float(m.group(1))
            if lo < 1000:
                lo *= MULT.get((r.group(2) or "").lower(), 1)
                if not r.group(2) and hi >= 1000 > lo:
                    lo *= 1000
            v, end, text = lo, end + r.end(), text + r.group(0)
        return v, ref_year(s, end), text
    return None


def parse_kw(s):
    m = re.search(NUM + r"\s*(million|billion)?\s*kW\b", s)
    if not m:
        return None
    return to_float(m.group(1)) * MULT.get((m.group(2) or "").lower(), 1), ref_year(s, m.end()), m.group(0)


def parse_exchange(s):
    """Valuta locale per 1 USD. Salta la riga '1 dinar = 1,000 fils'."""
    low = s.lower()
    i = max(low.find("per us$1"), low.find("per us dollar"))
    if i < 0:
        if "us$1 =" in low:
            i = low.find("us$1 =")
        else:
            return None
    seg = s[i:]
    seg = re.sub(r"^per us(\$1| dollar)[\s:–-]*", " ", seg, flags=re.I)
    seg = re.sub(r"^us\$1\s*=", " ", seg, flags=re.I)
    return parse_number(seg)


# ---------------------------------------------------------------------------
# Indicatori del gioco. Ognuno: campi canonici candidati (in ordine), etichetta
# opzionale dentro il testo, parser. Nomi e unità sono il contratto con il motore.
# ---------------------------------------------------------------------------
def parse_kwh(s):
    m = re.search(NUM + r"\s*(trillion|billion|million)?\s*kWh\b", s)
    if not m:
        return None
    return to_float(m.group(1)) * MULT.get((m.group(2) or "").lower(), 1), ref_year(s, m.end()), m.group(0)


def parse_life(sex):
    """1990-92: '66 years male, 68 years female (1990)'."""
    def f(s):
        m = re.search(NUM + r"\s*years\s+" + sex + r"\b", s)
        return (to_float(m.group(1)), ref_year(s, m.end()), m.group(0)) if m else None
    return f


P = {"lifeM": parse_life("male"), "lifeF": parse_life("female"), "kwh": parse_kwh, "money": parse_money, "pct": parse_pct, "num": parse_number, "kw": parse_kw, "fx": parse_exchange}

INDICATORS = [
    # chiave, unità, [(campo canonico, [etichette], parser)]
    ("area_km2", "km2", [("Area", ["total area:", "total :", "total:"], "num"), ("Area", None, "num")]),
    ("population", "persons", [("Population", ["total:"], "num"), ("Population", None, "num")]),
    ("pop_growth_pct", "%", [("Population growth rate", None, "pct"), ("Population", ["growth rate"], "pct")]),
    ("birth_rate", "per 1000", [("Birth rate", None, "num")]),
    ("death_rate", "per 1000", [("Death rate", None, "num")]),
    ("infant_mortality", "per 1000", [("Infant mortality rate", ["total:", "total population:"], "num"), ("Infant mortality rate", None, "num")]),
    ("life_exp", "years", [("Life expectancy at birth", ["total population:"], "num")]),
    ("life_exp_male", "years", [("Life expectancy at birth", ["male:"], "num"), ("Life expectancy at birth", None, "lifeM")]),
    ("life_exp_female", "years", [("Life expectancy at birth", ["female:"], "num"), ("Life expectancy at birth", None, "lifeF")]),
    ("fertility", "children/woman", [("Total fertility rate", None, "num")]),
    ("literacy_pct", "%", [("Literacy", ["total population:"], "pct"), ("Literacy", None, "pct")]),
    ("labor_force", "persons", [("Labor force", None, "num")]),
    ("unemployment_pct", "%", [("Unemployment rate", None, "pct")]),
    ("inflation_pct", "%", [("Inflation rate (consumer prices)", None, "pct")]),
    ("gdp_usd", "USD", [("Real GDP (purchasing power parity)", None, "money"), ("GNP", None, "money"),
                        ("Gross national product", None, "money"), ("Gross domestic product", None, "money"),
                        ("Gross national product (GNP)", None, "money"), ("Gross domestic product (GDP)", None, "money")]),
    ("gdp_official_usd", "USD", [("GDP (official exchange rate)", None, "money")]),
    ("gdp_per_capita_usd", "USD", [("Real GDP per capita", None, "money"), ("Real GDP (purchasing power parity)", ["per capita"], "money"), ("GNP", ["per capita"], "money"),
                                   ("Gross national product", ["per capita"], "money"), ("Gross domestic product", ["per capita"], "money")]),
    ("gdp_growth_pct", "%", [("Real GDP growth rate", None, "pct"), ("Real GDP (purchasing power parity)", ["real growth rate"], "pct"), ("GNP", ["real growth rate"], "pct"),
                             ("Gross national product", ["real growth rate"], "pct"), ("Gross domestic product", ["real growth rate"], "pct")]),
    ("budget_revenues_usd", "USD", [("Budget", ["revenues"], "money")]),
    ("budget_expenditures_usd", "USD", [("Budget", ["expenditures"], "money")]),
    ("exports_usd", "USD", [("Exports", None, "money")]),
    ("imports_usd", "USD", [("Imports", None, "money")]),
    ("external_debt_usd", "USD", [("Debt - external", None, "money")]),
    ("public_debt_pct_gdp", "%", [("Public debt", None, "pct")]),
    ("electricity_kw", "kW", [("Electricity - installed generating capacity", None, "kw"), ("Electricity - capacity", None, "kw"),
                              ("Electricity", ["capacity"], "kw"), ("Electricity", None, "kw")]),
    ("exchange_per_usd", "LCU/USD", [("Exchange rates", None, "fx")]),
    ("military_exp_usd", "USD", [("Military expenditures - dollar figure", None, "money"), ("Military expenditures", None, "money")]),
    ("military_exp_pct", "% GDP", [("Military expenditures - percent of GDP", None, "pct"), ("Military expenditures", None, "pct")]),
    ("military_manpower_fit", "persons", [("Manpower fit for military service", ["males age", "males:"], "num"),
                                          ("Military manpower - fit for military service", ["males age", "males:"], "num"),
                                          ("Military manpower", ["fit for military service"], "num"),
                                          ("Manpower availability", ["fit for military service"], "num")]),
    ("military_personnel", "persons", [("Military and security service personnel strengths", None, "num")]),
    ("oil_production_bbl_day", "bbl/day", [("Crude oil - production", None, "num"), ("Oil - production", None, "num"),
                                           ("Petroleum", ["crude oil production:", "total petroleum production:"], "num")]),
    ("electricity_production_kwh", "kWh", [("Electricity - production", None, "kwh"), ("Electricity", ["production:", "kwh produced"], "kwh"),
                                           ("Electricity", None, "kwh")]),
    ("internet_users", "persons", [("Internet users", ["total:"], "num"), ("Internet users", None, "num")]),
]

TEXT_INDICATORS = [
    ("government_type", [("Government type", None)]),
    ("capital", [("Capital", ["name:"]), ("Capital", None)]),
]

# Testi lunghi conservati interi (servono alla generazione all'avvio: confini e religioni).
LONG_TEXT_INDICATORS = [
    ("land_boundaries", "Land boundaries", 2000),
    ("religions", "Religions", 800),
    ("map_references", "Map references", 120),
    ("geographic_coordinates", "Geographic coordinates", 120),
]


def extract(fields, spec_list):
    """fields: dict canonico -> testo pulito. Restituisce (valore, anno_rif, frammento, campo)."""
    for canon, labels, kind in spec_list:
        txt = fields.get(canon)
        if not txt:
            continue
        txt = txt.replace(" | ", " ")
        seg = after(strip_noise(txt), labels)
        if seg is None:
            continue
        if labels and canon.startswith("Military manpower") and "fit for military service" in labels:
            # 1990: "males 15-49, 4,097,190; 2,284,417 fit for military service" -> numero prima dell'etichetta
            m = re.search(NUM + r"\s*fit for military service", strip_noise(txt))
            if m:
                return to_float(m.group(1)), ref_year(txt, m.end()), m.group(0), canon
        r = P[kind](seg)
        if r:
            return (*r, canon)
    return None


# ---------------------------------------------------------------------------
# Identità delle entità. L'archivio assegna lo stesso codice a entità diverse nelle
# prime edizioni (Canada/Cape Verde, Somalia/Soviet Union, le due Germanie...) e
# fonde gli stati dissolti nei successori. Qui si corregge per nome.
# Stati scomparsi: codici ISO 3166-3 (4 lettere), così non collidono con i GEC.
# ---------------------------------------------------------------------------
HISTORIC = {
    "SUHH": ("Soviet Union", "dissolved"),
    "DDDE": ("German Democratic Republic", "dissolved"),
    "CSHH": ("Czechoslovakia", "dissolved"),
    "YUCS": ("Yugoslavia", "dissolved"),
    "YEYE": ("Yemen Arab Republic", "dissolved"),
    "YDYE": ("People's Democratic Republic of Yemen", "dissolved"),
    "NTHH": ("Iraq - Saudi Arabia Neutral Zone", "dissolved"),
    "PCHH": ("Trust Territory of the Pacific Islands", "dissolved"),
}

NAME_OVERRIDES = {
    "soviet union": "SUHH",
    "german democratic republic": "DDDE",
    "germany, federal republic of": "GM",
    "czechoslovakia": "CSHH",
    "yugoslavia": "YUCS",
    "yemen arab republic": "YEYE",
    "yemen, people's democratic republic of": "YDYE",
    "iraq - saudi arabia neutral zone": "NTHH",
    "pacific islands, trust territory of the": "PCHH",
    "canada": "CA", "cape verde": "CV",
    "madagascar": "MA", "man, isle of": "IM",
    "somalia": "SO", "iraq": "IZ", "paraguay": "PA",
    "st. helena": "SH", "st. kitts and nevis": "SC", "st. lucia": "ST",
    "st. pierre and miquelon": "SB", "st. vincent and the grenadines": "VC",
    "cocos islands": "CK", "colombia": "CO",
    "georgia": "GG", "south georgia and the": "SX",
    "namibia": "WA", "wake atoll": "WQ", "wake island": "WQ",
}

# Successioni: (predecessore, anno, [successori]). Serve al motore per seguire un
# paese da un'edizione all'altra e per gli scenari "storici".
LINEAGE = [
    ("DDDE", 1990, ["GM"]),
    ("YEYE", 1990, ["YM"]), ("YDYE", 1990, ["YM"]),
    ("NTHH", 1991, ["IZ", "SA"]),
    ("SUHH", 1991, ["AM", "AJ", "BO", "EN", "GG", "KZ", "KG", "LG", "LH", "MD", "RS", "TI", "TX", "UP", "UZ"]),
    ("YUCS", 1992, ["BK", "HR", "MK", "SI", "YI"]),
    ("CSHH", 1993, ["EZ", "LO"]),
    ("ET", 1993, ["ET", "ER"]),
    ("PCHH", 1994, ["RM", "FM", "PS", "CQ"]),
    ("HK", 1997, ["CH"]), ("MC", 1999, ["CH"]),
    ("ID", 2002, ["ID", "TT"]),
    ("YI", 2006, ["RI", "MJ"]),
    ("RI", 2008, ["RI", "KV"]),
    ("NT", 2010, ["UC", "NN"]),
    ("SU", 2011, ["SU", "OD"]),
]


def norm(name):
    return re.sub(r"\s+", " ", (name or "").strip().lower())


def load_archive(con, mapping):
    """Itera (codice, anno, nome, {canonico: testo}) dall'archivio 1990-2025."""
    cur = con.execute("""
        SELECT c.CountryID, c.Year, mc.CanonicalCode, c.Name
        FROM Countries c JOIN MasterCountries mc USING (MasterCountryID)
        ORDER BY c.Year, mc.CanonicalCode""")
    raw = cur.fetchall()
    rows = []
    for cid, year, code, name in raw:
        code = NAME_OVERRIDES.get(norm(name), code)
        rows.append((cid, year, code, name))
    fields_by_cid = {}
    for cid, fname, content in con.execute("SELECT CountryID, FieldName, Content FROM CountryFields"):
        canon = mapping.get(fname, fname)
        d = fields_by_cid.setdefault(cid, {})
        # tiene il primo campo con quel nome canonico (l'archivio a volte duplica)
        if canon not in d:
            d[canon] = clean(content)
        elif canon == "Exchange rates" and "per US" in (content or "") and "per US" not in d[canon]:
            d[canon] = clean(content)
    for cid, year, code, name in rows:
        yield code, year, name, fields_by_cid.get(cid, {})


def json_field_text(node):
    """Converte un nodo di factbook.json nel formato 'sub: testo | sub: testo' dell'archivio."""
    if isinstance(node, dict):
        if set(node) == {"text"}:
            return node["text"]
        parts = []
        for k, v in node.items():
            if k == "text":
                parts.append(v)
            elif isinstance(v, dict) and "text" in v and len(v) == 1:
                parts.append(f"{k}: {v['text']}")
            elif isinstance(v, str):
                parts.append(v)
            else:
                parts.append(f"{k}: {json_field_text(v)}")
        return " | ".join(parts)
    return str(node)


def load_final_json(mapping):
    for f in sorted(SRC_JSON.glob("*/*.json")):
        if f.parent.name == "meta":
            continue
        data = json.loads(f.read_text(encoding="utf-8"))
        code = f.stem.upper()
        name = None
        fields = {}
        for cat, block in data.items():
            if not isinstance(block, dict):
                continue
            for fname, node in block.items():
                if fname == "Country name" and isinstance(node, dict):
                    cs = node.get("conventional short form", {}).get("text")
                    name = cs if cs and cs.lower() != "none" else None
                # "Real GDP (purchasing power parity) 2024": chiavi con anno annidate
                base = re.sub(r"\s+\d{4}$", "", fname)
                canon = mapping.get(fname, mapping.get(base, base))
                txt = clean(json_field_text(node))
                if canon not in fields:
                    fields[canon] = txt
        yield code, FINAL_EDITION, name or code, fields


SCHEMA = """
CREATE TABLE entity (code TEXT PRIMARY KEY, name TEXT, iso2 TEXT, type TEXT, administered_by TEXT);
CREATE TABLE edition (year INTEGER PRIMARY KEY, source TEXT, entities INTEGER);
CREATE TABLE country_year (code TEXT, year INTEGER, name TEXT, PRIMARY KEY (code, year));
CREATE TABLE indicator_def (key TEXT PRIMARY KEY, unit TEXT);
CREATE TABLE indicator (code TEXT, year INTEGER, key TEXT, value REAL, ref_year INTEGER,
                        derived INTEGER DEFAULT 0, field TEXT, src TEXT,
                        PRIMARY KEY (code, year, key));
CREATE TABLE indicator_text (code TEXT, year INTEGER, key TEXT, value TEXT, PRIMARY KEY (code, year, key));
CREATE TABLE factbook_text (code TEXT, year INTEGER, field TEXT, content TEXT);
CREATE TABLE lineage (predecessor TEXT, year INTEGER, successor TEXT);
CREATE TABLE sp1990_map (game_id INTEGER PRIMARY KEY, game_name TEXT, code TEXT);
CREATE INDEX ix_ind_key ON indicator (key, year);
"""


SP_CNAMES = ROOT / "re/orig/SHADOW/CNAMES.TXT"
SP_ALIASES = {
    # nomi del gioco (1990) -> codice; il gioco unisce già le due Germanie e i due Yemen
    "Bahamas": "BF", "Burkina Faso": "UV", "Gambia": "GA", "Falkland Islands": "FK",
    "Isle of Man": "IM", "Iraq-Saudi Neutral Zone": "NTHH", "Soviet Union": "SUHH",
    "Czechoslovakia": "CSHH", "Yugoslavia": "YUCS", "Germany": "GM", "Yemen": "YM",
    "North Korea": "KN", "South Korea": "KS", "Ivory Coast": "IV", "Burma": "BM",
    "Zaire": "CG", "Congo": "CF", "Western Samoa": "WS", "Swaziland": "WZ",
    "Canada": "CA", "Madagascar": "MA", "Somalia": "SO", "Iraq": "IZ", "Paraguay": "PA",
}


def map_shadow_president(out):
    """Tabella id paese del gioco originale -> codice entità (per confronti e import)."""
    if not SP_CNAMES.exists():
        return
    by_name = {norm(n): c for c, n in out.execute("SELECT code, name FROM country_year WHERE year IN (1990, 1991)")}
    by_name.update({norm(n): c for c, n in out.execute("SELECT code, name FROM entity")})
    rows = []
    for i, name in enumerate(SP_CNAMES.read_text(encoding="latin-1").splitlines()):
        code = SP_ALIASES.get(name) or by_name.get(norm(name)) or by_name.get("the " + norm(name))
        rows.append((i, name, code))
    out.executemany("INSERT INTO sp1990_map VALUES (?,?,?)", rows)
    missing = [n for _, n, c in rows if not c]
    if missing:
        print("sp1990_map senza codice:", missing, file=sys.stderr)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--with-text", action="store_true", help="copia anche il testo integrale di ogni campo")
    args = ap.parse_args()

    src = sqlite3.connect(f"file:{SRC_DB}?mode=ro", uri=True)
    mapping = dict(src.execute("SELECT OriginalName, CanonicalName FROM FieldNameMappings WHERE IsNoise = 0"))

    OUT_DB.unlink(missing_ok=True)
    out = sqlite3.connect(OUT_DB)
    out.executescript(SCHEMA)
    out.executemany("INSERT INTO entity VALUES (?,?,?,?,?)", src.execute("""
        SELECT m.CanonicalCode, m.CanonicalName, m.ISOAlpha2, m.EntityType, a.CanonicalCode
        FROM MasterCountries m LEFT JOIN MasterCountries a ON a.MasterCountryID = m.AdministeringMasterCountryID"""))
    out.executemany("INSERT INTO indicator_def VALUES (?,?)", [(k, u) for k, u, _ in INDICATORS])
    out.executemany("INSERT INTO entity (code, name, type) VALUES (?,?,?)", [(c, n, t) for c, (n, t) in HISTORIC.items()])
    out.executemany("INSERT INTO lineage VALUES (?,?,?)", [(p, y, s) for p, y, ss in LINEAGE for s in ss])
    known = {r[0] for r in out.execute("SELECT code FROM entity")}

    counts = {}
    sources = {}

    def ingest(stream, source):
        for code, year, name, fields in stream:
            if source == "factbook.json-final" and code not in known:
                out.execute("INSERT OR IGNORE INTO entity (code, name, type) VALUES (?,?,?)", (code, name, "unknown"))
                known.add(code)
            out.execute("INSERT OR REPLACE INTO country_year VALUES (?,?,?)", (code, year, name))
            counts[year] = counts.get(year, 0) + 1
            sources[year] = source
            vals = {}
            for key, unit, specs in INDICATORS:
                r = extract(fields, specs)
                if r:
                    v, ry, frag, canon = r
                    vals[key] = v
                    out.execute("INSERT OR REPLACE INTO indicator VALUES (?,?,?,?,?,0,?,?)",
                                (code, year, key, v, ry, canon, frag))
            # Spesa militare in $ dalle % del PIL, quando il Factbook dà solo la percentuale.
            if "military_exp_usd" not in vals and "military_exp_pct" in vals:
                base = vals.get("gdp_official_usd") or vals.get("gdp_usd")
                if base:
                    out.execute("INSERT OR REPLACE INTO indicator VALUES (?,?,?,?,NULL,1,?,?)",
                                (code, year, "military_exp_usd", base * vals["military_exp_pct"] / 100,
                                 "derived", "military_exp_pct * gdp"))
            for key, specs in TEXT_INDICATORS:
                for canon, labels in specs:
                    t = fields.get(canon)
                    if t:
                        seg = after(t, labels) if labels else t
                        if seg:
                            out.execute("INSERT OR REPLACE INTO indicator_text VALUES (?,?,?,?)",
                                        (code, year, key, seg.split(" | ")[0].strip(" :;")[:200]))
                            break
            for key, canon, limit in LONG_TEXT_INDICATORS:
                t = fields.get(canon)
                if t:
                    out.execute("INSERT OR REPLACE INTO indicator_text VALUES (?,?,?,?)",
                                (code, year, key, t.replace(" | ", " ").strip()[:limit]))
            if args.with_text:
                out.executemany("INSERT INTO factbook_text VALUES (?,?,?,?)",
                                [(code, year, k, t) for k, t in fields.items()])

    ingest(load_archive(src, mapping), "MilkMp archive v3.5")
    ingest(load_final_json(mapping), "factbook.json-final")
    out.executemany("INSERT INTO edition VALUES (?,?,?)", [(y, sources[y], n) for y, n in sorted(counts.items())])
    map_shadow_president(out)
    out.commit()
    n = out.execute("SELECT COUNT(*) FROM indicator").fetchone()[0]
    print(f"{OUT_DB}: {len(counts)} edizioni, {sum(counts.values())} paese-anno, {n} valori", file=sys.stderr)


if __name__ == "__main__":
    main()
