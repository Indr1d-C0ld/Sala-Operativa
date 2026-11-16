# worldbook.sqlite: tutte le edizioni del CIA World Factbook per il motore di gioco

Copre 37 edizioni: dal 1990 al 2025 più l'edizione finale di gennaio 2026. La CIA ha chiuso il Factbook il 4 febbraio 2026, quindi non ne usciranno altre. In tutto 9.797 righe paese-anno e circa 237.000 valori numerici.

Rigenerazione (circa 30 s):

```bash
python3 -I tools/build_worldbook.py
```

```bash
python3 -I tools/validate_vs_game.py
```

## Fonti (in `data/sources/`, non versionate)

| file | origine | licenza |
|---|---|---|
| `factbook.db` (694 MB) | [MilkMp/CIA-World-Factbooks-Archive-1990-2025](https://github.com/MilkMp/CIA-World-Factbooks-Archive-1990-2025), release v3.5 | dati: pubblico dominio (opera del governo USA); ETL: MIT |
| `factbook.json-final/` | [factbook/factbook.json](https://github.com/factbook/factbook.json): snapshot finale | CC0 |
| `gutenberg/fb1990.txt` | Project Gutenberg #14 (edizione 1990) | pubblico dominio |
| `naturalearth/ne_50m_admin_0_countries/` | [Natural Earth](https://www.naturalearthdata.com/) 1:50m, confini degli stati (v5) | pubblico dominio |

Download:

```bash
gh release download v3.5 -R MilkMp/CIA-World-Factbooks-Archive-1990-2025 -p factbook.db -D data/sources
```

```bash
git clone --depth 1 https://github.com/factbook/factbook.json data/sources/factbook.json-final
```

```bash
curl -L https://naciscdn.org/naturalearth/50m/cultural/ne_50m_admin_0_countries.zip -o data/sources/naturalearth/ne_50m_admin_0_countries.zip && unzip -d data/sources/naturalearth/ne_50m_admin_0_countries data/sources/naturalearth/ne_50m_admin_0_countries.zip
```

La carta del gioco si rigenera con `python3 -I tools/build_map.py` (larghezza predefinita 640).

## Tabelle

| tabella | contenuto |
|---|---|
| `entity` | codice (GEC/FIPS; ISO 3166-3 per gli stati scomparsi), nome, ISO2, tipo, eventuale stato amministratore |
| `edition` | anno e fonte di ogni edizione |
| `country_year` | quali entità esistono in ogni edizione, con il nome di quell'anno |
| `indicator_def` | i 33 indicatori numerici e le loro unità |
| `indicator` | `(code, year, key) → value`, più l'anno di riferimento del dato (`ref_year`), il flag `derived`, il campo sorgente e il frammento di testo letto (`src`) |
| `indicator_text` | tipo di governo e capitale |
| `lineage` | successioni: URSS → 15 stati (1991), Jugoslavia (1992), Cecoslovacchia (1993), Serbia e Montenegro (2006), Sudan/Sud Sudan (2011)… |
| `sp1990_map` | id dei 168 paesi del gioco originale → codice entità |
| `factbook_text` | testo integrale di ogni campo; si riempie solo con `--with-text` |

`edition.year` è l'anno di pubblicazione. Il dato può riferirsi a un anno precedente: per esempio il PIL dell'edizione 1990 è del 1989. L'anno vero sta in `ref_year`.

## Qualità

- Contro `CIADATA.FIL` del gioco originale (valori del Factbook 1990 inseriti a mano da D.C. True), 17 indicatori su 164 paesi concordano al **98,9%**. Gli scarti restanti sono errori del gioco o dell'archivio, non del parser.
- L'archivio MilkMp aveva collisioni di codice nelle prime edizioni (Canada/Capo Verde, Somalia/URSS, le due Germanie, i due Yemen…). Qui sono corrette per nome, in `NAME_OVERRIDES`.

### Buchi noti, dovuti alle fonti

| indicatore | mancante | motivo |
|---|---|---|
| `electricity_kw` | 2001–2014 | il Factbook non pubblicava la capacità; usare `electricity_production_kwh` |
| `budget_*` | 2010 | campo assente nell'archivio; si può ricavare dallo zip grezzo `factbook-2010.zip` |
| `military_manpower_fit` | dal 2020 | rimosso dal Factbook; c'è `military_personnel` (forze attive) |
| `military_personnel` | prima del 2020 | il Factbook non lo pubblicava; per il 1990 c'è il valore del gioco (`CIADATA` offset 53) |
| `gdp_official_usd`, `internet_users`, `public_debt_pct_gdp` | anni '90 | campi introdotti più tardi |
| `literacy_pct` | dal 2015, in calo | la CIA non lo aggiorna più per molti paesi |

Il motore dovrebbe interpolare tra le edizioni e usare `ref_year`, non l'anno dell'edizione.
