#!/usr/bin/env python3
"""
Prima stesura della tabella dei nomi italiani dei paesi (packages/app/src/testi/paesi.json):
per ogni codice il nome, l'articolo e il modo di dire "in" (in Cina, a Cuba, nel Regno Unito).

Il nome parte da quello di Intl (passato in ingresso come JSON [codice, nome]) con le correzioni
di NOMI; articolo e preposizione vengono da regole semplici (genere dalla desinenza, plurali,
isole e città-stato senza articolo) e dalle eccezioni sotto. La tabella va poi rivista a mano:
lo script non sovrascrive le voci già presenti nel file, salvo --tutto.

Uso: python3 -I tools/build_paesi.py nomi.json [--tutto]
"""
import json
import sys
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "packages/app/src/testi/paesi.json"

# Nomi da correggere o da tradurre (duplicati di Intl, nomi rimasti in inglese, forme ufficiali)
NOMI = {
    "CR": "Isole del Mar dei Coralli", "AT": "Isole Ashmore e Cartier", "NT": "Antille Olandesi",
    "JQ": "Atollo Johnston", "MQ": "Isole Midway", "WQ": "Isola di Wake", "FQ": "Isola Baker",
    "DQ": "Isola Jarvis", "HQ": "Isola Howland", "BQ": "Isola Navassa", "KQ": "Reef Kingman",
    "LQ": "Atollo Palmyra", "TE": "Isola Tromelin", "IP": "Isola di Clipperton", "GK": "Guernsey",
    "IM": "Isola di Man", "JE": "Jersey", "BS": "Bassas da India", "EU": "Isola Europa",
    "GO": "Isole Gloriose", "JU": "Isola Juan de Nova", "YI": "Serbia e Montenegro",
    "SV": "Svalbard", "JN": "Jan Mayen", "GZ": "Striscia di Gaza", "WE": "Cisgiordania",
    "UM": "Isole del Pacifico statunitensi", "PF": "Isole Paracel", "PG": "Isole Spratly",
    "CG": "Repubblica Democratica del Congo", "CF": "Congo", "HK": "Hong Kong", "MC": "Macao",
    "BM": "Myanmar", "EZ": "Repubblica Ceca", "TT": "Timor Est", "VT": "Città del Vaticano",
    "UC": "Curaçao",
    # stati scomparsi
    "SUHH": "Unione Sovietica", "DDDE": "Germania Est", "CSHH": "Cecoslovacchia", "YUCS": "Jugoslavia",
    "YEYE": "Yemen del Nord", "YDYE": "Yemen del Sud", "NTHH": "Zona neutrale", "PCHH": "Isole del Pacifico",
}

# Nomi in -a maschili, e altre eccezioni di genere
MASCHILI_IN_A = {"Canada", "Venezuela", "Guatemala", "Nicaragua", "Panama", "Kenya", "Ghana", "Botswana",
                 "Ruanda", "Zambia", "Malaysia", "Burkina Faso", "Sahara Occidentale"}
FEMMINILI = {"Nuova Zelanda", "Costa d’Avorio", "Costa Rica", "Giamaica", "Guyana Francese", "Polinesia Francese",
             "Nuova Caledonia", "Martinica", "Guadalupa", "Riunione", "Città del Vaticano", "Striscia di Gaza",
             "Cisgiordania", "Isola di Man", "Isola Europa", "Isola di Wake", "Isola Baker", "Isola Jarvis",
             "Isola Howland", "Isola Navassa", "Isola Tromelin", "Isola di Clipperton", "Isola Juan de Nova",
             "Isola Bouvet", "Isola Christmas", "Isola Norfolk", "Zona neutrale", "Unione Sovietica",
             "Sierra Leone", "Repubblica Ceca", "Repubblica Centrafricana", "Repubblica Dominicana",
             "Repubblica Democratica del Congo", "Macedonia del Nord", "Bosnia ed Erzegovina",
             "Guinea Equatoriale", "Papua Nuova Guinea", "Corea del Nord", "Corea del Sud", "Germania Est",
             "Arabia Saudita"}
# Senza articolo, con "a": isole, città-stato e piccoli stati che in italiano si usano così
SENZA_ARTICOLO_A = {"Cuba", "Malta", "Cipro", "Singapore", "Taiwan", "Haiti", "Gibuti", "Monaco", "San Marino",
                    "Hong Kong", "Macao", "Madagascar", "Tonga", "Nauru", "Tuvalu", "Kiribati", "Vanuatu", "Palau",
                    "Aruba", "Curaçao", "Grenada", "Dominica", "Saint Lucia", "Saint Kitts e Nevis",
                    "Saint Vincent e Grenadine", "Antigua e Barbuda", "Trinidad e Tobago", "Mauritius",
                    "São Tomé e Príncipe", "Capo Verde", "Guam", "Portorico", "Barbados", "Jersey", "Guernsey",
                    "Gibilterra", "Anguilla", "Montserrat", "Niue", "Tokelau", "Mayotte", "Sant’Elena",
                    "Saint Martin", "Sint Maarten", "Saint-Barthélemy", "Saint-Pierre e Miquelon",
                    "Wallis e Futuna", "Samoa", "Akrotiri", "Dhekelia", "Svalbard", "Jan Mayen", "Bassas da India",
                    "Timor Est", "Andorra"}
# Senza articolo, con "in"
SENZA_ARTICOLO_IN = {"Israele", "El Salvador"}
PLURALI_F = {"Filippine", "Maldive", "Seychelles", "Bahamas", "Comore", "Figi", "Bermuda", "Samoa Americane",
             "Antille Olandesi", "Terre Australi Francesi"}
PLURALI_M = {"Stati Uniti", "Paesi Bassi", "Emirati Arabi Uniti", "Territori Palestinesi"}
# "In" con l'articolo per i nomi composti e per alcuni nomi
IN_ARTICOLATO = {"Regno Unito", "Sahara Occidentale", "Vaticano", "Territorio Britannico dell’Oceano Indiano",
                 "Burkina Faso", "Sud Sudan", "Corea del Nord", "Corea del Sud", "Myanmar", "Congo", "Costa d’Avorio",
                 "Kosovo", "Montenegro", "Libano", "Golfo"}


def lo_davanti(nome):
    n = nome.lower()
    return n[:1] in "zxy" or n[:2] in ("gn", "ps", "pn") or (n[:1] == "s" and n[1:2] not in "aeiouàèéìòù")


def articolo(nome):
    if nome in SENZA_ARTICOLO_A or nome in SENZA_ARTICOLO_IN:
        return ""
    vocale = nome[:1].lower() in "aeiouàèéìòù" or nome.startswith("H")
    if nome in PLURALI_F or nome.startswith("Isole"):
        return "le"
    if nome in PLURALI_M:
        return "gli" if vocale or lo_davanti(nome) else "i"
    femminile = nome in FEMMINILI or (nome.split()[0].endswith("a") and nome not in MASCHILI_IN_A) \
        or nome.startswith(("Isola", "Repubblica", "Città", "Costa", "Nuova"))
    if vocale:
        return "l'"
    if femminile:
        return "la"
    return "lo" if lo_davanti(nome) else "il"


def prep_in(nome, art):
    if nome in SENZA_ARTICOLO_A:
        return "a"
    if not art or nome in SENZA_ARTICOLO_IN:
        return "in"
    composto = " " in nome and not nome.startswith(("Arabia", "Nuova", "Papua", "Guinea", "Germania"))
    if art in ("i", "gli", "le") or nome in IN_ARTICOLATO or composto:
        return "art"
    return "in"


def main():
    nomi = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    tutto = "--tutto" in sys.argv
    old = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() and not tutto else {}
    table = dict(old)
    for code, nome in nomi:
        if code in table:
            continue
        nome = NOMI.get(code, nome)
        art = articolo(nome)
        table[code] = {"nome": nome, "art": art, "in": prep_in(nome, art)}
    for code, nome in NOMI.items():
        if code not in table:
            art = articolo(nome)
            table[code] = {"nome": nome, "art": art, "in": prep_in(nome, art)}
    OUT.write_text(json.dumps(dict(sorted(table.items(), key=lambda kv: kv[1]["nome"])), ensure_ascii=False, indent=1) + "\n",
                   encoding="utf-8")
    print(f"{OUT}: {len(table)} paesi")


if __name__ == "__main__":
    main()
