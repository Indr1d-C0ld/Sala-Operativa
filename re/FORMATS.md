# Shadow President (DOS, 1993): formati dei dati

Note di reverse engineering. Fonte: `pre_assets/Shadow-President_DOS_EN.zip`, estratto in `re/orig/SHADOW`.
Verifiche fatte confrontando i record con il CIA World Factbook 1990 (Gutenberg #14, `data/sources/gutenberg/fb1990.txt`).

## Eseguibile

`SHADOW.EXE`: MZ a 16 bit in modalità reale, compilato con Microsoft C (runtime del 1990), grafica Metagraphics MetaWINDOW, overlay **RTLink/Plus** (Pocket Soft).

- **Root (residente):** 247.924 byte a partire da 0x5400, 5.300 rilocazioni MZ. Entry point `2275:05C6`; il gestore degli overlay sta a `2275:0B1E` (codice residente) e `2275:0B38` (overlay). DGROUP = `2F15`.
- **Overlay:** 66 segmenti accodati all'immagine, da 0x41C80 alla fine del file (1.078.623 byte di codice). Ogni segmento ha questa struttura:
  - `u16 paragrafi_totali, u16 paragrafi_intestazione, u16 510, u16 0`
  - una tabella di `u32` con gli offset delle rilocazioni dentro il segmento (gli zeri sono riempimento)
  - il codice
  
  Le rilocazioni degli overlay puntano solo a 5 segmenti del root: `289F` (stub), `2F15` (DGROUP), `299F`, `2AA9`, `2A56`.
- **Stub** (segmento `289F`, 0x000–0x1B6C, tutti verificati su un prologo `55 8B EC`):
  - `9A 1E 0B 75 22  EA off seg` (10 byte): chiamata a una funzione residente
  - `9A 38 0B 75 22  EA off 0000  n` (12 byte): chiamata alla funzione `off` dell'overlay numero `n` (1-based, in ordine di file)
- **Virgola mobile:** emulatore x87 Microsoft. Al posto delle istruzioni FPU ci sono `INT 34h–3Bh` (= `FWAIT` + ESC `D8–DF`), `INT 3Ch` (prefisso di segmento + ESC: i bit 7-6 del byte successivo valgono 11 = ES, 10 = CS, 01 = SS, 00 = DS) e `INT 3Dh` (`FWAIT`). Circa 42.000 occorrenze.

`tools/sp_unpack.py` ricostruisce due MZ "piatti" per Ghidra (`re/work/shadow_ovlA.exe` con gli overlay 1–43, `shadow_ovlB.exe` con i 44–66), con le rilocazioni applicate, gli stub trasformati in salti diretti e le istruzioni x87 ripristinate. Lo script `tools/ghidra/ExportDecomp.java` esporta il C decompilato.

Sequenza di fine anno: l'orchestratore sta nell'overlay 15 (segmento 7124, offset 0x0000–0x0B5A; Ghidra non lo riconosce come funzione). Prima di ogni passo stampa una riga di `EOYCALC.TXT` presa da un array di puntatori sullo stack, quindi la corrispondenza è esatta:

| # | riga | funzione |
|---|---|---|
| 1 | Processing all country growth rates | `7124_377e`, `b04b_0a6d` |
| 2 | Calculating world information | `ab78_0000` |
| 3 | Processing all possible world coalitions | `ab78_0ced` |
| 4 | Calculating peace levels | `b2e8_0dc6` |
| 5 | Selecting foreign policy orientations | `7124_161a` |
| 6 | Processing all regional coalitions | `ab78_3692` |
| 7 | Calculating World Team Alliances | `7714_0000` → `7714_0286` |
| 8 | Updating Trade Status | `b04b_27a9` |
| 9 | Calculating budgets | `b2e8_0000` |
| 10 | Distributing foreign aid | `7556_0000` |
| 11 | Distributing money for spies | `b04b_18d1` |
| 12 | Adding foreign aid | `b04b_0000` |
| 13 | Calculating anxiety levels | `7714_10b4` |
| 14 | Calculating social unrest | `854f_138e`: nonostante il titolo convalida solo gli eventi in coda; il malcontento si calcola a fine mese |
| 15 | Eliminating aborted or expired events | `9962_01f6` |

La mappa completa degli stub (619 voci, stub → funzione) è in `re/work/stub_map.json`.

Ghidra non crea funzioni agli ingressi raggiunti solo attraverso gli stub, come i quattro esecutori delle azioni o il modulo guerra. Per questo `tools/ghidra/StubFuncs.java` le crea, prendendo gli indirizzi da `re/work/stub_targets_{A,B}.txt` (estratti dagli stub dell'EXE originale), e ne esporta il C in `re/work/decomp_stub_{A,B}.c`: 258 funzioni in più. Le funzioni grandi falliscono spesso nel decompilatore. Per quelle si usano gli strumenti in `tools/`:
- `sp_calls.py` annota un `.asm` con i nomi delle funzioni chiamate tramite stub e con le stringhe di DGROUP;
- `sp_xref.py FUN_x_y` trova chi chiama una funzione, anche passando dagli stub.

## Elenco paesi

- `CNAMES.TXT`: 168 righe, indice = id del paese (0 = Afghanistan, 157 = United States). Include entità del 1990: Soviet Union, Czechoslovakia, Yugoslavia, Zaire, Burma, Iraq-Saudi Neutral Zone…
- `RNAMES.TXT`: 17 regioni.
- `REGIONS.DAT`: per ogni regione un elenco di coppie `flag, id_paese`, con flag `'A'` o `'C'` (probabilmente "adiacente/attivo" e "contenuto"; da verificare).

## CIADATA.FIL: Factbook statico (66 byte per paese, little-endian, senza padding)

| off | tipo | campo | scala | verificato |
|---|---|---|---|---|
| 0 | u32 | superficie totale km² | 1 | ✓ |
| 4 | u32 | popolazione (luglio 1990) | 1 | ✓ |
| 8 | u8 | crescita popolazione % | ×0.1 | ✓ |
| 9 | u8 | natalità ‰ | 1 | ✓ |
| 10 | u8 | mortalità ‰ | 1 | ✓ |
| 11 | u8 | mortalità infantile ‰ | 1 | ✓ |
| 12 | u8 | speranza di vita M | 1 | ✓ |
| 13 | u8 | speranza di vita F | 1 | ✓ |
| 14 | u8 | fertilità | ×0.1 | ✓ |
| 15 | u8 | alfabetizzazione % | 1 | ✓ |
| 16 | u32 | forza lavoro | 1 | ✓ |
| 20 | u32 | GNP | ×100.000 $ | ✓ |
| 24 | u8 | disoccupazione % | ×1 o ×0.1 | ✓ ma incoerente: 50 paesi in % interi (Algeria 19), 52 in decimi (USA 52 = 5,2%). Errore di inserimento dati nell'originale |
| 25 | u32 | entrate di bilancio | ×100.000 $ | ✓ |
| 29 | u32 | uscite di bilancio | ×100.000 $ | ✓ |
| 33 | u32 | esportazioni | ×100.000 $ | ✓ |
| 37 | u32 | importazioni | ×100.000 $ | ✓ |
| 41 | u32 | debito estero | ×100.000 $ | ✓ |
| 45 | u32 | capacità elettrica kW | 1 | ✓ |
| 49 | f32 | cambio per 1 USD | 1 | ✓ |
| 53 | u32 | effettivi militari | 1 | probabile (USA 2.296.000, URSS 3.900.000, Giappone 241.000) |
| 57 | u16 | ? | | |
| 59 | u8 | ? | | |
| 60 | f32 | crescita reale GNP | frazione | ✓ |
| 64 | u8 | codice (1–4)? | | forse blocco/allineamento |
| 65 | u8 | codice (2–6)? | | forse tipo di governo/ideologia |

I valori "NA" del Factbook sono scritti come 0.

## COUNTRY.* : stato della simulazione (202 byte per paese)

`COUNTRY.0`/`.RUN` = partita in corso; `.S0`–`.S4` = scenari (`SCENARIO.TXT`: Virtual Earth 1990, Super-Iraq, Resource Wars, U.S. Economic Decline). Il `.0` di partenza è identico a `.S0`.

Il layout viene dagli accessi nel codice: 2.956 accessi con passo 202 (`mov ax,0CAh; imul`), classificati per offset e tipo di istruzione x87. La somma dei campi fa esattamente 202. Legenda della colonna "evidenza": **C** = confermato nel codice, **R** = relazione esatta nei dati, **D** = correlazione o ranking (ipotesi).

| off | tipo | campo | evidenza |
|---|---|---|---|
| 0 | f64 | stock nucleare | R: `[0]/[8] = [96]/[112]` |
| 8 | f64 | **potere militare** = [104] × truppe | C (`FUN_ab78_0ced`); R: esatto per 144 paesi su 148 con truppe (CIADATA+53) |
| 16 | f64 | potere economico = GNP₁₉₈₉·(1+g)²/10⁵ | R (Giappone 1,048² ✓, Iraq 1,05² ✓); C: se 0, il paese è inattivo |
| 24 | f64 | **influenza regionale** = `pm·[48] + pe·[80]`, pesi dalla tabella regionale per livello di pace della regione | C: passo 6, 165/165 |
| 32 | f64 | **influenza totale, quota %** = wM·[56] + wE·[88] | C; pesi dal livello di pace mondiale (vedi formule) |
| 40 | f64 | influenza totale dell'anno precedente | C: copiata da [32] prima del ricalcolo |
| 48 | f64 | **quota militare regionale**, % del potere militare della regione (URSS contata 1/3) | C: passo 6, 165/165 |
| 56 | f64 | **quota militare mondiale %** ≈ 100·[8]/Σ[8] | R |
| 64 | f32 | variazione relativa della quota militare ([56]−prec)/prec | C |
| 68 | f64 | **quota nucleare mondiale %** = 100·[0]/Σ[0] | C. Σ ≠ 100 perché i valori sono limitati a [0,100] e calcolati in sequenza |
| 76 | f32 | variazione relativa della quota nucleare | C |
| 80 | f64 | **quota economica regionale**, % del PIL della regione, prima degli aiuti del passo 12 | C: passo 6, 165/165 |
| 88 | f64 | **quota economica mondiale %** ≈ 100·[16]/Σ[16] | R |
| 96 | f64 | spesa nucleare $ | R (simmetrica a 112) |
| 104 | f64 | **Military Capital (MilCap)**, la qualità militare = √(10 · (spesa/truppe) / (W+0x28 / W+0x10)) | C (`FUN_ab78_3535`); R: W+0x28/W+0x10 = 35.276 = costante osservata |
| 112 | f64 | **spesa militare $**: per gli USA è il bilancio del giocatore, per gli altri PIL × [153]/100 | C (`FUN_ab78_34b1`) |
| 120 | f64 | **PIL pro capite** = [16]·10⁵ / NUMBERS.popolazione | C |
| 128 | f64 | **Oil Reserves (OR)**, quota % delle riserve mondiali di petrolio | D: Arabia S. 26, Iraq/Kuwait/EAU 10, Iran 9, Venezuela 6; Σ = 100 |
| 136 | f64 | **Strategic Reserves (SR)**, 1,0–1,53 | D: Sudafrica, Arabia S., URSS |
| 144 | u8 | ? (Israele, Egitto 10; 2–4 altri) | |
| 145 | f64 | **Net Peace**, livello di pace 1 (guerra) – 6 | C: clamp [1,6] a ogni passo; lo cambiano gli eventi (vedi formule); 1 = Libano, Etiopia, Cambogia, Afghanistan |
| 153 | f32 | **quota di PIL alla difesa %, media su 3 anni** | C: è l'argomento della funzione della spesa militare |
| 157 | f32 | **quota di PIL alla difesa %, anno corrente** | C |
| 161 | f32 | quota difesa, anno −1 | C |
| 165 | f32 | quota difesa, anno −2 | C |
| 169 | f64 | **LER, Leadership Effectiveness Rating** del manuale, in [0,1]; vale 0,5 per tutti all'inizio | C: limite massimo alla probabilità di quasi tutte le azioni (`100·[169]`). Sale con i successi (×1,01) e con le guerre vinte (+0,1), scende con i fallimenti (×0,99) e con le rese (−0,1). Cala con i disordini sociali e misura anche la capacità del governo di reprimerli. La finestra di reazione lo mostra come "LER: %.0f%%". Prima l'avevo chiamato "peso militare" e poi "LER" |
| 177 | f64 | **qualità della vita** 0–1 | C (`7124_161a`); R: esatta per 88–108 paesi per scenario |
| 185 | f64 | qualità della vita dell'anno precedente | C |
| 193 | u16 | **livello nucleare** 0–6 | D, coerente col manuale: USA/URSS/Cina 6, Israele 4, India 3, Iraq 2, Giappone 1 |
| 195 | u16 | **orientamento di politica estera** (1 blocco dominante … 5 blocco rivale, 8 ostile) | C; R: 167/167 in tutti gli scenari |
| 197 | u8 | **squadra World Team**: bit 0–6 = numero della squadra (0 = nessuna), bit 7 = il leader è nella coalizione mondiale | C (`7714_0286`); R: leader e flag esatti |
| 198 | f32 | **Strategic Value (Stratval)**, valore strategico (prima chiamato "indice di influenza") = 5·[144] + 100·[136]·(1 + [32]/10) − 100 | C; R: USA 249,6 calcolato contro 249,5 salvato |

## NUMBERS.* (61 byte per paese)

| off | tipo | campo | evidenza |
|---|---|---|---|
| 0x00 | f64 | **LastPolice**, repressione ("Police State" del manuale), 0–4: `clamp((5 − 0,9·etica)·3/WORLD+0x48, 0, 4)`, ricalcolata ogni mese | C: 165/165 in tutti gli scenari |
| 0x08 | f64 | **LastEconDif**, divario di PIL pro capite salvato dal calcolo mensile (scritto prima di essere ricalcolato: sembra contenere il valore del paese precedente) | C |
| 0x10 | f64 | **OutCry**, malcontento sociale ("Social Outcry"), 0–100 | C: formula mensile, 165/165 in tutti gli scenari |
| 0x18 | f64 | **popolazione** | C: pop' = round(pop·(1+[0x24])) |
| 0x20 | i32 | PIL di base in unità di 100.000 $ ("Current Gross National Product"; USA 52.528.900) | debug |
| 0x24 | f32 | **crescita della popolazione** (frazione) | C; USA 0,009 = Factbook |
| 0x28 | f32 | **crescita del PIL** (frazione) | C; USA 0,029 = Factbook |
| 0x2C | i32 | **Military Manpower**, truppe (USA 2.080.559) | debug |
| 0x30 | f32 | **Ethic** 1 (spietato) – 5 | C: coincide con `Ethic` in tutti gli eventi in coda, in tutti gli scenari |
| 0x34 | char | **ideologia di governo**, lettera A–M (I esclusa) che indicizza `IDEOLGYL.FIL` | C |
| 0x35 | f32 | **Ambition** 1–6 | C: idem (Iraq 6/1, Argentina 2/3, Pakistan 3/2) |
| 0x39 | i16 | **paese che lo controlla**: se stesso, oppure il conquistatore (Guam e Samoa americane → USA, Hong Kong e Falkland → Regno Unito) | C: passo 10, escluso dagli aiuti se ≠ se stesso |
| 0x3B | i16 | **testate nucleari** (USA e URSS 5000, Cina 436, Francia 389, Regno Unito 362, Israele 100; zero per gli altri) | C: ansia nucleare dei leader dei World Team |

Le scale di etica e ambizione sono capovolte rispetto al manuale. Il manuale dà l'etica da 1 "Selfless" a 6 "Treacherous", mentre nei dati l'Iraq ha 1. Quindi il valore mostrato è probabilmente `7 − etica`.

## QUEUE.* (eventi programmati, 31 × 24 byte)

Ricostruito dal printf di debug di `ProcessQueue` (overlay A, `"%-s EventType=%d, EventCode=%d, Acting=%d, Victim=%d, Ambition=%.4f, Ethic=%.4f, Status=%d"`).

| off | tipo | campo |
|---|---|---|
| 0 | u32 | quando: timestamp Unix. Il tempo 0 del gioco è 644256000 (`0x26669100`, 1 giugno 1990 16:00 UTC); l'orologio corrente è in secondi da lì |
| 4 | i16 | EventType (tabella sotto) |
| 6 | i16 | EventCode: per i tipi 1–2 è l'azione (indice 0-based in `ACTLST.FIL`) |
| 8 | i16 | paese che agisce (id `CNAMES`) |
| 10 | i16 | paese bersaglio |
| 12 | i16 | stato: 2 = annullato o non valido (per i tipi 1–2, chi agisce = bersaglio → 2) |
| 14 | f32 | ambizione di chi agisce (copia di NUMBERS[0x35]) |
| 18 | f32 | etica di chi agisce (copia di NUMBERS[0x30]) |
| 22 | i16 | parametro: numero di truppe per il codice 25 (es. 500); altrimenti 6594, ignorato |

`tools/sp_events.py` stampa coda, guerre e truppe di uno scenario. Lo scenario 1990 contiene in coda tutta la crisi del Golfo: condanne irachene a giugno e luglio, avvisi CIA il 28 luglio e il 1° agosto, invasione del Kuwait il 3 agosto 00:00 UTC, poi Arabia Saudita, Israele e Stati Uniti.

| EventType | significato | gestore (`ProcessQueue`, switch a 854f:3e9a) |
|---|---|---|
| 0 | vuoto | — |
| 1 | azione di un paese IA | esecutore per gruppo di codici (sotto); invasione riuscita → modulo guerra `FUN_5825_0000` |
| 2 | azione del giocatore, eseguita in differita | come il tipo 1, preceduta da una scheda descrittiva |
| 3 | **evento sociale** (stadi 1–10, sotto "Disordini sociali") | `FUN_6a19_155d` |
| 4 | variazione di popolarità del presidente | `FUN_8a38_0000` |
| 5 | conseguenze di un attacco nucleare (`nucdsc01.txt`) | codice 0 `FUN_8a38_17a2`, 1 `FUN_8a38_4c6a`, 2 `FUN_8a38_39b5` |
| 6 | avviso CIA prima di un attacco (`wrndsc01.txt`) | `FUN_6a19_34e8` + `FUN_8a38_5ba0`; codice 1 = preparativi, 2 = truppe al confine |

Codici azione (`ACTLST.FIL`, 0-based) ed esecutori. Gli esecutori ricevono `(chi agisce, bersaglio, codice, parametro, 0)` e restituiscono 1 se l'azione riesce:

| codici | azioni | esecutore |
|---|---|---|
| 0–7 | 0 riforma sociale, 1 diritti umani, 2 inviato di pace, 3 scambio culturale, 4 relazioni diplomatiche, 5 legami economici, 6 condanna, 7 investimenti | `FUN_b87a_0000` (overlay 37) |
| 8–13 | 8 nazione più favorita, 9 regolare il commercio, 10 limitarlo, 11 bloccarlo, 12 armi ai ribelli, 13 spionaggio | `FUN_dc78_0000` (overlay 41) |
| 14–20 | 14 sabotaggio, 15 colpo di stato, 16 assassinio, 17 negoziare la pace, 18–19 scoraggiare/incoraggiare la spesa militare, 20 attacco chirurgico | `FUN_c638_0000` (overlay 39) |
| 21–24 | 21 invasione ("Enter the War Room"), 22–23 scoraggiare/incoraggiare la spesa nucleare, 24 attacco nucleare | `FUN_d1a4_0000` (overlay 40) |
| 25 | schieramento di truppe (fuori da `ACTLST`: "%-s is increasing/decreasing their troop levels in %-s") | `FUN_5db5_0000` |

Prima dell'esecuzione `ProcessQueue` fa alcuni controlli:
- `FUN_854f_3fa3` valida l'evento.
- Per i codici 20, 21 e 25, `FUN_9bf8_150c` controlla se l'azione è stata bloccata.
- Per il 21, `FUN_854f_246c` (probabilmente la contiguità) controlla se l'invasione è possibile.
- Infine `FUN_a482_0890` apre la finestra in cui il giocatore può reagire (sotto, "Reazione del giocatore").

Se il bersaglio sono gli Stati Uniti (156) parte prima una notizia; con il codice 24 parte invece la sequenza di attacco nucleare contro gli USA (`FUN_854f_1af4`).

## CONFLICT.* (guerre in corso, 14 byte per partecipante)

| off | tipo | campo |
|---|---|---|
| 0 | u8 | 1 = attivo, 0xFF = guerra chiusa (scritto dalla resa) |
| 1 | u8 | lato: 0 attaccanti, 1 difensori |
| 2 | i16 | paese teatro della guerra |
| 4 | i16 | partecipante |
| 6 | u32 | inizio |
| 10 | u32 | ultimo aggiornamento |

Nel 1990 c'è una sola guerra: Somalia (attaccante) contro Etiopia (difensore), in Etiopia.

## TROOPS.* (truppe schierate fuori dai confini, 25 byte per contingente)

| off | tipo | campo |
|---|---|---|
| 0 | u8 | flag |
| 1 | i16 | paese proprietario (−1 = slot libero) |
| 3 | i16 | paese in cui si trovano (−1 = slot libero) |
| 5 | u32 | truppe |
| 9 | u32 | truppe iniziali |
| 13 | u32 | morti |
| 17 | u32 | data di invio |
| 21 | u32 | data di arrivo |

Il 1990 ha 60 contingenti: USA in Germania 240.000, URSS in Germania 380.000, Cuba in Angola, Siria in Libano e così via. "Super-Iraq" (S2) ne aggiunge 8 iracheni, e S4 ha le truppe USA all'estero azzerate.

## ASSET.* (180 byte per paese)

| off | tipo | campo | evidenza |
|---|---|---|---|
| 0x00 | 15 × i16 | aiuti **umanitari** ricevuti da ciascuno dei 15 donatori (WORLD+0x9E), M$ | C: passi 10 e 12 |
| 0x1E | 15 × i16 | aiuti **economici**, M$ | C: sommati al PIL dal passo 12; sottratti dalla base di crescita del passo 1 |
| 0x3C | 15 × i16 | aiuti all'**intelligence**, M$ | C: passo 12 → STRATEGY+0x48 |
| 0x5A | 15 × i16 | aiuti **militari**, M$ | C: passo 12 → spesa militare |
| 0x78 | 15 × i16 | aiuti **nucleari**, M$ | C: passo 12 → spesa nucleare |
| 0x96 | 15 × i16 | **spionaggio**: fondi che ciascun donatore spende in questo paese, M$ | C: azioni coperte 14–16 |

I cinque tipi seguono l'ordine del manuale ("Humanitarian, Economic, Intelligence, Military, Nuclear Aid").

## STRATEGY.* (160 byte per paese, f64)

| off | campo | evidenza |
|---|---|---|
| 0x00 | **ansia nucleare** 0–100 | C: passo 13, verificata 165/165 in tutti gli scenari |
| 0x08 | **ansia militare** 0–100 | idem |
| 0x10 | **ansia politica** (PTA, "Political Threat Anxiety"; il manuale la chiama "Government") 0–100 | idem |
| 0x18 | **ansia economica** 0–100 | idem |
| 0x20 | **ansia sociale** 0–100 | idem |
| 0x28 | **IntelBudget**, bilancio dell'intelligence totale, $ (USA 33,4 G$): `PIL·2% / ((pace + etica + 7 − amb)/3)` | C: passo 9; riferimento dell'ansia politica |
| 0x30 | **CAAG$**, azioni coperte contro i governi: `3·(7 − pace)²/100 · B/3` | C: passo 9 |
| 0x38 | **IntelAid$**, aiuti all'intelligence: `4%·amb · B` | C: passi 9 e 10 |
| 0x40 | **Insurg$**, finanziamento di insurrezioni all'estero: `(6 − (pace + 7 − amb)/2)% · B` | C: passo 9 |
| 0x48 | **ESP$_SELF**, bilancio di spionaggio interno, $: `B·(50 − etica·WORLD+0x48)/200` più gli aiuti all'intelligence ricevuti | C: passi 9 e 12; difesa dalle azioni coperte, azione 13 |
| 0x50 | **ESP$**, spionaggio all'estero: resto del bilancio, B − 0x30 − 0x38 − 0x40 − 0x48; il passo 11 li spende | C: passi 9 e 11 |
| 0x58 | bilancio degli aiuti militari: `24/(etica + 0,01) %` della spesa militare (0 se belligeranza media < 1,5) | C: passi 9 e 10 |
| 0x60 | bilancio degli aiuti economici: ⅔ · 0,084% del PIL | idem |
| 0x68 | bilancio degli aiuti umanitari: ⅓ · 0,084% del PIL | idem |
| 0x70 | bilancio degli aiuti nucleari: `1% spesa_mil · (1 + ansia_nucl/100) · (1 + (7 − amb)/100)`, 0 senza spesa nucleare | idem |
| 0x78 | **Hum_hunger**, aiuto umanitario desiderato, $ ("Desired Amount" del manuale) | C: passo 13 |
| 0x80 | aiuto economico desiderato | idem |
| 0x88 | aiuto all'intelligence desiderato | idem (154/165: diverge solo l'Oceania) |
| 0x90 | aiuto militare desiderato | idem |
| 0x98 | aiuto nucleare desiderato | idem |

I nomi ufficiali (tra parentesi) vengono dal visualizzatore di debug interno al gioco (overlay 22, 908F:11B3), che stampa ogni campo con la sua etichetta. Le ansie sono quelle del manuale ("Anxiety Level/Threat Anxieties"). Nelle soglie delle azioni, `L58` è l'ansia del bersaglio per la categoria dell'azione: le azioni diplomatiche usano l'ansia sociale, quelle nucleari l'ansia nucleare.

## MORENUMS.* (31 byte per paese)

| off | tipo | campo | evidenza |
|---|---|---|---|
| 0x00 | f32 | **EducationPercent**, spesa per l'istruzione in % del PIL (4,0) | debug |
| 0x04 | f64 | **SocialSpending**, spesa sociale, $: vi si accumulano gli aiuti umanitari ricevuti (Israele 4,29 G$); cresce con le riforme sociali | C: passo 12, azione 0 |
| 0x0C | f32 | **InvestmentPercent**, investimenti in % del PIL (3,0) | debug |
| 0x10 | 15 × u8 | **livello commerciale** con ciascuno dei 15 donatori: 4 nazione più favorita, 3 regolato, 2 limitato, 1 bloccato | C: passo 8, azioni 8–11 |

## REGIONS.DAT, REGION.*, CONTIG.FIL

`REGIONS.DAT` (757 byte) contiene le 17 regioni di `RNAMES.TXT`. Per ogni regione: `'@'`, id u16, numero di voci u16, poi le voci di 3 byte (paese u16, `'C'` membro o `'A'` adiacente). Un paese può stare in al massimo 4 regioni (l'URSS è in Europa orientale, Asia centrale, Asia meridionale e Asia nord-orientale). La regione "di casa" è l'ultima in cui il paese compare come `'C'`.

`REGION.*` ha 210 byte per regione. Somme e medie includono tutti i paesi elencati per la regione (membri 'C' e adiacenti 'A'); nelle somme l'URSS conta per un terzo.

| off | tipo | campo | verifica |
|---|---|---|---|
| 0x00 | f64 | Σ PIL (prima degli aiuti economici) | 17/17 |
| 0x08 | f64 | Σ popolazione | 17/17 |
| 0x10 | f64 | Σ truppe (fonte non ancora identificata) | |
| 0x18 | f64 | Σ potere militare | 17/17 |
| 0x20 | f64 | Σ PIL (copia di 0x00, usata per le quote) | 17/17 |
| 0x28 | f64 | Σ quote militari | 17/17 |
| 0x30 | f64 | Σ quote economiche | 17/17 |
| 0x40 | f64 | PIL pro capite massimo (prima degli aiuti umanitari) | 17/17 |
| 0x48 | f64 | Σ influenza totale | 17/17 |
| 0x50 | f64 | etica media (paesi con etica ≠ 0) | 17/17 |
| 0x58 | f64 | repressione media | 17/17 |
| 0x60 | f64 | qualità della vita media pesata per popolazione | 17/17 |
| 0x68 | 15 × i16 | **coalizione regionale** (−1 = vuoto) | vedi passo 6 |
| 0x86 | f64 | quota nucleare massima | 17/17 |
| 0x8E | f64 | spesa nucleare massima | |
| 0x96 | f64 | quota militare massima | 17/17 |
| 0x9E | f64 | spesa militare massima (prima degli aiuti militari) | 17/17 |
| 0xA6 | f64 | **posizione d'intelligence netta** massima (passo 11) | 16/17 |
| 0xAE | f64 | STRATEGY+0x28 massimo (bilancio di politica estera) | 17/17 |
| 0xB6 | f64 | crescita del PIL massima | 17/17 |
| 0xBE | f64 | PIL massimo | 17/17 |
| 0xC6 | 4 × i16 | detentori dei record: quota nucleare, spesa nucleare, quota militare, spesa militare | 68/68 |
| 0xCE | f32 | **livello di pace regionale** 1–6 | |

`CONTIG.FIL` ha 42 byte per paese: numero di vicini i16 e fino a 20 id i16 di paesi confinanti.

## WORLD.* (306 byte, totali mondiali)

Puntatore globale far in `[seg 6CD0]:10A6`. Valori verificati sommando `COUNTRY.0`.

| off | tipo | campo |
|---|---|---|
| 0x00 | f64 | Σ potere economico (204,9 M ✓) |
| 0x08 | f64 | popolazione mondiale (5,49 miliardi) |
| 0x10 | f64 | Σ truppe |
| 0x18 | f64 | Σ potere nucleare ✓ |
| 0x20 | f64 | Σ potere militare ✓ |
| 0x28 | f64 | Σ spesa militare |
| 0x30, 0x38 | f64 | PIL pro capite massimo (per normalizzazioni; 0x38 è il riferimento delle ansie) |
| 0x40 | f64 | somma delle quote militari delle grandi potenze (quota ≥ 5%) |
| 0xDC | f64 | quota nucleare massima |
| 0xEC | f64 | quota militare massima |
| 0x50 | f64 | etica del paese più influente dell'ideologia dominante |
| 0x58 | f64 | etica del paese più influente della seconda ideologia |
| 0x60 | f64 | qualità della vita media mondiale (pesata per popolazione) |
| 0x78 | f64 | influenza massima |
| 0x6C | 12 × char | lettere delle ideologie ordinate per influenza totale |
| 0x9E | 15 × i16 | **i 15 donatori** di aiuti: USA, URSS, Giappone, Cina, Germania, Francia, Regno Unito, Italia, India, Canada, Spagna, Corea del Sud, Polonia, Brasile, Iraq |
| 0xE4 | f64 | spesa nucleare massima |
| 0xF4 | f64 | spesa militare massima |
| 0x104 | f64 | STRATEGY+0x28 massimo |
| 0x10C | f64 | crescita del PIL massima |
| 0xFC | f64 | posizione d'intelligence netta massima (passo 11) |
| 0x80 | 15 × i16 | **coalizione mondiale** (id dei paesi, −1 = vuoto) |
| 0xBC | 15 × i16 | **leader dei World Team** |
| 0x12E | f32 | **livello di pace mondiale** 1–6 (3,92 nel 1990) |

## Formule ricavate

Verifica automatica: `python3 -I tools/verify_formulas.py [0|S0..S4]`. Influenza totale, indice di influenza e media triennale della quota difesa sono esatti per 165 paesi su 165 in tutti gli scenari. Questo vale anche per S2, dove la pace mondiale è 2,5 e quindi i pesi sono 0,6/0,4: è una conferma indipendente della tabella. Le altre relazioni (qualità militare, potere nucleare, PIL pro capite, totali mondiali) sono esatte solo per una parte dei paesi, perché i file salvati sono una fotografia presa a metà del ciclo di fine anno: crescita e spese vengono aggiornate dopo il calcolo degli indici.

Gli strumenti sono `tools/sp_disasm.py`, che disassembla una funzione con costanti e campi annotati, e `tools/sp_lift.py`, uno pseudo-lifter dello stack x87 che produce espressioni leggibili.

### Informazioni mondiali e influenza (`FUN_ab78_0ced`, overlay 33: "Calculating world information")

Per ogni paese, dopo un passo che porta ogni campo nel suo intervallo (quote in [0,100], pace in [1,6], etica in [1,6], ambizione in [0,6]):
```
spesa_mil      = (i == USA) ? bilancio_difesa_giocatore : PIL·[153]/100       # PIL = [16]·1e5
qualità_mil    = sqrt(10 · (spesa_mil/truppe) / (Σspesa_mil/Σtruppe))       # 0 se truppe = 0
potere_mil     = max(1, qualità_mil · truppe)
pc_PIL         = [16]·1e5 / popolazione
quota_mil      = 100·potere_mil / Σpotere_mil
quota_eco      = 100·[16] / Σ[16]
influenza_prec = influenza
k              = int(pace_mondiale + 0.5)
influenza      = PESI[k].mil·quota_mil + PESI[k].eco·quota_eco
pace_mondiale += pace_paese · influenza/100        # media pesata, clamp [1,6] a fine ciclo
spesa_nucleare = (STRAT+0/50) · spesa_mil · ambizione · 0,0027 · fattore    # con soglie e componenti casuali
potere_nucleare= spesa_nucleare/spesa_mil · potere_mil
quota_nucleare = 100·potere_nucleare / Σpotere_nucleare
indice_infl    = 5·[144] + 100·[136]·(1 + influenza/10) − 100
```
`PESI` (tabella `2A56:00FA`, coppie [militare, economico] indicizzate dal livello di pace mondiale): conferma la regola del manuale ("verso la guerra conta di più il potere militare").

| pace mondiale | 1 | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|
| peso militare | 1,0 | 0,7 | 0,6 | 0,5 | 0,3 | 0,1 |
| peso economico | 0,0 | 0,3 | 0,4 | 0,5 | 0,7 | 0,9 |

Nel 1990 la pace mondiale vale 3,92, che arrotondato dà 4: pesi 0,5/0,5, da cui `[32] = ([56]+[88])/2`, esatto sui dati.

### Crescita (`FUN_b04b_0a6d`, overlay 34: "Processing all country growth rates")

Per ogni paese:
```
aiuti   = Σ_{k<15} ASSET[i].aiuti[k] · 1e6
base    = PIL − aiuti;  se base ≤ 0 allora base = PIL
g       = smorza(NUMBERS.crescita_PIL)  → salvato (la crescita alta decade anno dopo anno)
PIL'    = base · (1 + g)                 # [16] = PIL'/1e5, min 0
pg      = smorza(NUMBERS.crescita_pop)
pop'    = round(pop · (1 + pg))

smorza(g): se g > 0,05:  g ·= 0,2 se g > 1;  0,3 se g > 0,5;  altrimenti 0,5;  poi g = max(g, 0,05)
           g = max(g, −0,15)            (solo per il PIL)
```
Verifica: gli scenari di partenza sono il Factbook 1990 dopo due anni di crescita: per 35 paesi [16]·1e5 = GNP·(1+g)² esatto; per gli altri si aggiungono gli aiuti ricevuti (passo successivo "Adding foreign aid").

### Coalizione mondiale (`FUN_ab78_0ced`, seconda metà: passo 3)

1. Le **grandi potenze** sono i paesi con quota militare mondiale ≥ 5% (al massimo 15). Le loro quote vengono rinormalizzate sul totale delle grandi potenze (`W+0x40`) e ordinate in modo decrescente (bubble sort).
2. Se la prima supera il 50%, la coalizione è lei da sola (egemone).
3. Altrimenti si calcola k, il numero minimo di potenze che, prese in ordine, superano il 50%; se neanche tutte insieme ci arrivano, non c'è coalizione.
4. Una ricerca a "contachilometri" sulle combinazioni di k potenze (con un ordine di visita particolare, emulato esattamente in `verify_formulas.py`) sceglie la combinazione con somma **compresa fra 50% e 65% e minima**. È la *coalizione minima vincente* (principio di Riker).
5. I membri vanno in `WORLD+0x80`.

Verifica: coalizione esatta in tutti gli scenari. 1990: USA + Cina (URSS 45,7%, USA 37,1%, Cina 17,2%). S2: URSS + Iraq. S4: USA + Cina, che una ricerca esaustiva non darebbe; la dà invece l'ordine di visita del gioco.

### Orientamento di politica estera e qualità della vita (`FUN_7124_161a`: passo 5)

```
classifica le 12 ideologie (NUMBERS+0x34) per Σ influenza dei paesi che le seguono
rel(x, y) = 2 se y ∈ AMICI[x], 1 se y ∈ NEMICI[x], 0 altrimenti     (FUN_7124_2d51)
r = posizione dell'ideologia del paese; top = ideologia dominante
orient = 1                                   se r = 0
       = 2 se rel(top, id) = 2, altrimenti 5 se r = 1
       = 2 se rel = 2,          altrimenti 3 se r = 2
       = 1 se rel = 2, 8 se rel = 1, altrimenti 4    se r ≥ 3
orient −= 2 per Democratic Islam (E) e "Imperialism" (H)
orient −= 1 per l'Arabia Saudita (id 129);  += 2 per la Francia (id 51)   ← casi scritti a mano nel codice
orient += 1 se etica < 2 e ambizione ≥ 5

qol = min(1, [ (3737/(7 − etica) + 3737/ambizione + 3737/NUMBERS+0x00) / 3 + PIL_pro_capite ] / MISC+0x08)
```
`MISC+0x08` vale 23.134,4: è il valore grezzo degli USA nel 1990, salvato una volta per tutte e non ricalcolato.

Tabelle (ricostruite dalle `memcpy` di `FUN_7124_2d51`):

| ideologia | amici | nemici |
|---|---|---|
| A Democratic Capitalism | A G J | B D F |
| B Communism | — | C A H J D E F M |
| C Democratic Socialism | C | H B |
| D Fascism | D | B G F A |
| E Democratic Islam | E | H F B |
| F Fundamental Islam | F | E H A D B |
| G Zionism | A | D M K L |
| H Imperialism | — | K L B C J E F |
| J Developing Capitalism | A | B H |
| K Democratic Nationalism | K | H G |
| L Developing Centralism | — | H G |
| M Centralized Islam | M | G B |

Verifica: orientamento esatto per 167 paesi su 167 in tutti gli scenari, compreso S2, dove la classifica delle ideologie cambia (A, C, K, B).

### World Team (`FUN_7714_0286`: passo 7)

1. **Candidati leader**: quota militare ≥ 5% oppure influenza ≥ 5%.
2. **Formazione**: i candidati con la stessa coppia (orientamento [195], ideologia NUMBERS+0x34) formano una squadra, guidata dal più influente. Al massimo 20 squadre.
3. **Numerazione**: le squadre vengono ordinate e numerate da 1. In [197] il leader riceve il numero della squadra, più 0x80 se è nella coalizione mondiale.
4. **Gli altri paesi** scelgono una squadra a caso, con pesi proporzionali all'influenza dei leader.
5. **In uscita**: i leader vanno in `WORLD+0xBC`.

Verifica: i leader e i flag di coalizione sono esatti in tutti gli scenari. Le appartenenze dei paesi non leader non sono verificabili, perché sono casuali.

### Regioni e coalizioni regionali (`FUN_ab78_3692`: passo 6)

Per ognuna delle 17 regioni il gioco legge il record REGION in una copia locale (bp−0x36A, quindi offset = 0x36A − locale). Poi, sui paesi elencati in `REGIONS.DAT` (membri e adiacenti; l'URSS pesa 1/3 nelle somme):

1. Calcola somme, medie e massimi (layout di REGION sopra).
2. Calcola, per ogni paese della regione:
   ```
   C[48] = 100·potere_militare / Σ potere_militare           # quota militare regionale
   C[80] = 100·PIL / Σ PIL                                    # quota economica regionale
   ```
3. Per i soli membri 'C' calcola l'influenza regionale, con il livello di pace regionale *letto dal record* (quello dell'anno prima):
   ```
   C[24] = pm·C[48] + pe·C[80]
   ```
   I pesi vengono dalla tabella 2A56:008A, diversa da quella mondiale (2A56:00FA):

   | pace regionale | 1–3 | 4 | 5 | 6 |
   |---|---|---|---|---|
   | militare/economico | 1/0 | 0,9/0,1 | 0,6/0,4 | 0,3/0,7 |

   Un paese che compare in più regioni conserva nel file i valori dell'ultima regione elaborata: per C[48] e C[80] l'ultima in assoluto, per C[24] l'ultima in cui è membro 'C'.
4. Calcola il nuovo livello di pace regionale `Σ_membri C pace·C[24]/100`, arrotondato e riportato in [1,6], e lo salva in REGION+0xCE.
5. Forma la **coalizione regionale** con lo stesso algoritmo della coalizione mondiale (egemone sopra il 50%, altrimenti la combinazione minima fra il 50% e il 65%). I candidati sono i paesi della regione, membri e adiacenti, con influenza regionale ≥ 5, e le quote sono le influenze regionali senza normalizzazione. Il risultato va in REGION+0x68.

Verifica (`verify_formulas.py`):
- **esatte 165/165 in tutti gli scenari:** C[24], C[48] e C[80];
- **esatti:** le somme e i massimi di REGION;
- **detentori dei record:** 66–68 su 68.

I livelli di pace regionali e le coalizioni salvati negli scenari non seguono invece le formule: le coalizioni tornano solo in 8–10 regioni su 17. Probabilmente gli scenari sono stati ritoccati dopo l'ultimo calcolo, come già visto per i livelli di pace nazionali. Nelle regioni dove il file ha una coalizione, i membri sono quelli previsti dall'algoritmo includendo gli adiacenti: per esempio l'URSS in Asia centrale, in Asia meridionale e in Asia nord-orientale.

### Variazioni del livello di pace (azioni ed eventi)

Il ciclo di fine anno non cambia il livello di pace [145]: si limita a riportarlo in [1,6]. Lo cambiano le azioni, la guerra e le conseguenze nucleari. Le azioni riuscite lo moltiplicano per piccoli fattori (A = chi agisce, B = bersaglio; i valori sono stati estratti dal codice degli esecutori):

| azione | effetto sulla pace |
|---|---|
| riforma sociale accettata | B ×1,02 |
| diritti umani: riuscita / tentativo | B ×1,02 / B ×1,01 |
| inviato di pace riuscito (se B > 1,5 e B < etica di A) | B ×1,05 |
| scambio culturale | B ×1,002 |
| relazioni diplomatiche | A ×1,005, B ×1,01 |
| legami economici | B ×1,01, A ×1,002 |
| investimenti | B ×1,01 |
| sabotaggio | A e B ×0,99 |
| colpo di stato riuscito | B ×0,95 |
| assassinio riuscito / fallito | B ×0,8 e A ×0,99 / A ×0,99 |
| meno spesa militare | B ×1,1, A ×1,01 |
| più spesa militare | B ×0,95, A ×0,995 |
| attacco chirurgico | B ×0,9, A ×0,99 |
| meno spesa nucleare | A e B ×1,05, B ×1,01 |
| commercio, armi ai ribelli, spionaggio, invasione, attacco nucleare | nessun effetto diretto: per guerra e armi nucleari vedi sotto |

### Probabilità di successo delle azioni

Ogni esecutore tira `r = rand(1,100)` (`FUN_1000_1bf3(1,100)`) e confronta `r` con una soglia S (`r < S` oppure `r ≤ S`, secondo l'azione), quindi P(successo) ≈ S/100. Se il bersaglio sono gli Stati Uniti decide il giocatore, e S vale 101 o 0. `tools/sp_odds.py [scenario] chi bersaglio` calcola S per le azioni di cui sono decodificati tutti gli ingressi. Non c'è DOSBox per confrontare i valori con il gioco in esecuzione: i numeri sono coerenti con il codice e plausibili, ma non misurati.

### Livello di relazione fra due paesi (`FUN_7124_0b5a`, overlay 15)

Il risultato va da 1 (ostile) a 7 (alleato) ed entra nelle soglie delle azioni 2–5. È il "Country Interaction Mood" del manuale, che ha la scala opposta (1 armonia di interessi, 2 amicizia, 3 cooperazione, 4 indifferenza, 5 competizione, 6 rivalità, 7 inimicizia): CIM = 8 − r. Il gioco ordina la coppia per influenza totale ([32]): "grande" è la più influente, "piccolo" l'altra. "Stessa squadra" significa che i bit 0–6 di C+197 coincidono, compreso il caso in cui entrambi valgono 0. "Coalizione" è la lista W+0x80 della coalizione mondiale.
```
se infl_grande ≥ 50:            r = int(etica_grande + 1)                       # egemone
altrimenti se infl_grande ≥ 5:  # grande potenza
    se infl_piccolo ≥ 5 o quota_mil_piccolo ≥ 5:      # due potenze
        r = 9 se entrambi in coalizione; 5 se solo il grande; 2 se solo il piccolo; altrimenti 4
    altrimenti se squadre diverse:
        r = (6 se reg_piccolo < 15 altrimenti 5) se il piccolo ha una squadra,
            altrimenti (7 se reg_piccolo < 5 altrimenti 6)
    altrimenti se quota_econ_piccolo < 4,4 e infl_piccolo < 4:  r = 6 se reg_piccolo > 10 altrimenti 5
    altrimenti r = 6
altrimenti se infl_grande ≥ 1:  # potenza media
    medio = 1 ≤ infl_piccolo < 5
    se il grande ha una squadra:  r = (6 se stessa squadra altrimenti 7) se medio, altrimenti (5 se stessa squadra altrimenti 7)
    altrimenti:                   r = (7 se il piccolo non ha squadra altrimenti 6) se medio, altrimenti (5 se non ha squadra altrimenti 6)
altrimenti se stessa squadra:   r = int(3 + etica_piccolo + etica_grande)      # due paesi minori
altrimenti se reg_grande ≥ 5:   r = int((etica_piccolo + etica_grande)/2) + rand(0,3)
altrimenti                      r = 4

r −= |orientamento_A − orientamento_T|      # C+195
r += 1 se hanno la stessa ideologia;  r += 1 per Stati Uniti–Israele;  r −= 1 se uno dei due è imperialista (H)
r = int(r·0,5) se il piccolo è Israele e il grande è di ideologia L, o se il grande è Israele e il piccolo è di ideologia K
r −= 2 per India–Pakistan;  r −= 3 per Cina–Vietnam, Cina–India, Grecia–Turchia
r = clamp(r, 1, 7)
```
"reg" è COUNTRY[24], l'influenza regionale. Nello scenario 1990 gli Stati Uniti risultano a 1 con Cuba, Etiopia, Iran, Corea del Nord, URSS e Sudan, e a 7 con Canada, Australia ed Europa occidentale; Israele–Siria vale 1 e URSS–Cuba 7. `tools/sp_odds.py` stampa la relazione per ogni coppia.

**Termini comuni**, calcolati prima dello switch sul codice (b87a:3bd2–3ff5, identici in c638). A = chi agisce, T = bersaglio, `cred` = COUNTRY[169]:

| termine | formula | significato |
|---|---|---|
| L28, L50 | stessa ideologia 80/5; amica 40/4; nemica 10/1; neutrale 20/2 | affinità ideologica (tabelle amici/nemici di `FUN_7124_2d51`, NUMBERS+0x34) |
| slot | posizione di A nella lista dei 15 donatori (WORLD+0x9E: USA, URSS, Giappone, Cina, Germania, Francia, Regno Unito, Italia, India, Canada, Spagna, Corea del Sud, Polonia, Brasile, Iraq), oppure −1 | `FUN_5caa_0857` |
| L60 | somma dei primi 5 array di ASSET[T] allo slot di A (M$) | aiuti e investimenti di A in T |
| categoria | codice 0–6 → 0, 7–11 → 1, 12–16 → 2, 17–21 → 3, 22–24 → 4 (tabella 2A56:0276) | |
| L58 | STRATEGY[T] +0x20 / +0x18 / +0x10 / +0x08 / +0x00 per categoria 0..4 (valori 0–100) | ansia di T nella categoria: sociale, economica, spie, militare, nucleare |
| L68 | `L60·1e6·L58 / (0,25·PIL_T) · L28`, con PIL_T = COUNTRY[16]·1e5 | leva economica |
| L70 | `(infl_A − infl_T)·(3 − L58/100)·L28 / 10⁴` | divario d'influenza |
| Lc2 | `FUN_7124_0b5a(A, T)`, da 1 a 7 | livello di relazione (sezione seguente) |
| Lb0 | +30 se A e T sono nella stessa World Team, +10 se T non ha squadra, altrimenti −30 | |

**Soglie S.** La notazione `max(x, minimo)` e `min(x, massimo)` riproduce l'ordine del codice, che applica prima il minimo e poi il massimo:

| codice | azione | S |
|---|---|---|
| 0 | riforma sociale | `min(max(L50·L68/20 + 5, 5 + infl_A), 100·LER_A)` |
| 1 | diritti umani (solo se etica_T < etica_A) | `L78 = L60/(0,025·econ_T)·100·L28/10` (10 se non ci sono asset); `min(max(L78, 5 + infl_A), 75·LER_A)`; r ≤ S |
| 2 | inviato di pace | `min(max((5·Lc2 − 5·amb_T + 10 − STRAT_T[+8]/5 + 4·pace_mondiale + 10·(pace_T − 1))·etica_A/4, 10 + infl_A), 100·LER_A)` |
| 3 | scambio culturale | `min(max(10·Lc2 − 5·amb_T + Lb0/2 + 10·(pace_T − 1), 10 + infl_A), 100)` |
| 4 | relazioni diplomatiche | come l'inviato di pace con STRAT_T[+16] e ×1,5; minimo 10; massimo `100·LER_A` |
| 5 | legami economici | `min(max(30·(Lc2 − 3) + 10·(7 − amb_T) + Lb0 + 10·(pace_T − 1), 10 + quota_econ_A), 100·LER_A)` |
| 6 | condanna | `70 + 100·LER_A − 100·LER_T` (r < S) |
| 7 | investimenti | `min(max(L68·L28/4, 10 + quota_econ_A/2), 100·LER_A)`; r ≤ S |
| 8–11 | nazione più favorita, regolare/limitare/bloccare il commercio | nessun tiro: riesce sempre se A è uno dei 15 donatori, e imposta il livello commerciale 4..1 |
| 12 | armi ai ribelli | `n10_T·(mil_A/max(mil_T,1))·(1 − LER_T)/n00_T/pace_T`, minimi `mil_A − mil_T/2·etica_A` e `n10_T/10 − 2`, massimo `100·LER_A` |
| 13 | spionaggio | aumenta STRATEGY[T]+72 (budget d'intelligence in T) del finanziamento ×1e6/3; poi un secondo tiro contro `min(100·LER_A + 25, 90)` (probabilmente la scoperta) |
| 14–16 | sabotaggio, colpo di stato, assassinio | difficoltà `D = (codice − 12)²/2` = 2, 4, 8.<br>`difesa = STRAT_T[+72]/10 · LER_T · n00_T · D`<br>`forza = spionaggio_A_in_T · 5e5 · LER_A / difesa / 2 · 100`, dove lo spionaggio è ASSET[T]+0x96 allo slot di A, in M$<br>`S = mil_A/(mil_T + 1) + 10·forza/((100 − L28)/2,5) − mil_T + n10_T/(n00_T + 10) − 2`, limitato a `[1, 100/D + D]` (al massimo 52%, 29%, 20,5%).<br>Il tentativo costa ad A etica ×(1 − D/100) e a entrambi pace ×0,99 |
| 17 | negoziare la pace | gestita dal modulo guerra (`FUN_6318_278b`) |
| 18 | scoraggiare la spesa militare (preceduta da un confronto fra la belligeranza di T e quella di A, di verso incerto) | `min(max(100·L70, 10), 100·LER_A)`; r ≤ S |
| 19 | incoraggiarla | `min(max(1,5·L68, 10), 100·LER_A)`; r ≤ S |
| 20 | attacco chirurgico | `50·(LER_A·qualità_mil_A)/(LER_T·qualità_mil_T)` (100 se il denominatore è 0), al massimo `200·LER_A`; la pace mondiale si riduce in proporzione all'influenza di T |
| 21 | invasione | nessun tiro: `FUN_5178_3c7c` verifica in modo deterministico che sia fattibile (truppe e confinanza); se fallisce: "%-s conducted military exercises near %-s." |
| 22 | scoraggiare la spesa nucleare | `nuc%PIL_T` contro `nuc%PIL_A`; riesce se `r ≤ 10 + (100 − STRAT_T[+0])/(7 − amb_T)` |
| 23 | incoraggiarla | `r < L58 − 20`, con varianti per il giocatore |
| 24 | attacco nucleare | sempre eseguito; mette in coda le ritorsioni di T (condanna, sabotaggio, assassinio) con date casuali |
| 25 | schieramento di truppe | serve un paese vicino al bersaglio che accetti le truppe (`FUN_5db5_0000`) |

Quando chi agisce è il giocatore, l'azione mette anche in coda un evento di tipo 4 (popolarità del presidente). L'entità dipende dall'affinità L50 e dalla pace mondiale. Per esempio, invadere un paese della stessa ideologia costa `−(infl_T + 4)·pace_mondiale` punti (al massimo −40), invadere un paese amico la metà (al massimo −20).

### Turno dei paesi IA (`FUN_b442_0000`, overlay 36)

È il turno "ShadowNetwork is receiving information about the activities of other nations around the world". Lo chiamano il codice residente (lin 0x12c33) e un comando di `9572` (overlay 24). Legge `BIGTABLE.TXT` (28 righe × 6, `"%d, %d, %d, %d, %d, %d"`) in una tabella locale a `bp−0x18c`.

**Tre fasi** (`bp−0x1c` = 0, 1, 2), ciascuna sceglie chi agisce:
- **fase 0:** scorre i 15 donatori (W+0x9E), saltando gli USA (156), e prende il primo con `rand(1,100) ≤ 2·ambizione + 10`; se nessuno passa, un donatore a caso diverso dagli USA;
- **fase 1:** se `rand(1,6) ≥ pace mondiale`, ordina le 17 regioni per un valore i16 per regione (array globale a `0x16a`, non identificato) e ne sceglie una con un doppio tiro (`rand(1,6) > valore + 2` e `rand(1,25) ≤ 10`); poi ordina i membri per influenza totale e prende il primo con `rand(1,100) ≤ influenza + 10`;
- **fase 2:** se `rand(1,6) ≥ pace mondiale`, un paese a caso della lista W+0xBC (leader delle squadre), diverso dagli USA.

**Bersaglio.**
- Influenza ≥ 5: si sceglie una regione con `rand(1,100) ≤ (7 − valore)·5`.
- Influenza ≥ 2,3: la regione di casa.
- Influenza minore: `FUN_5178_2d89` (probabilmente i paesi contigui).

Fra i candidati, ordinati per valore strategico (C+198), si prende il primo con `rand(1,100) < valore + 10`.

**Azione** (b442:1aae–1cdc), con `r` = `FUN_7124_0b5a` (relazione 1–7):
1. Se `rand(1,7) < etica`: ramo fuori tabella. Con `r > 4` si sceglie a caso fra {22, 16, 24, 14}, altrimenti fra {26, 27, 6, 22, 16, 24, 12}.
2. Altrimenti il gruppo è il primo k con `G[int(etica + 0,5)][k] ≥ rand(1,100)`, dove la tabella G ha 6 righe: 15 50 75 95 100 / 10 45 70 90 100 / 5 35 65 80 100 / 2 25 60 75 100 / 0 15 35 70 100 / 0 10 30 70 100.
3. La colonna è `P[int(pace_mondiale + 0,5) − 1][r − 1] − 1`, con le righe di P: 1 1 2 3 4 4 5 / 1 2 2 3 4 4 5 / 1 2 3 3 4 5 5 / 2 3 4 4 4 5 6 / 3 4 4 5 5 6 6 / 3 4 5 5 6 6 6.
4. Dalla prima riga del gruppo (0, 7, 14, 19, 23; fine 28) si sottraggono i pesi di BIGTABLE da `rand(1,100)` finché il resto è ≤ 0.

In ogni colonna i pesi di un gruppo sommano a 100. Le righe **non** sono codici d'azione: la tabella locale a bp−0x254 (b442:022b–02cd) le traduce a b442:1f0d:

    riga   0  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27
    codice 24 21 25 21 20  –  2 16 20 14 15 12  6  2  7 12  4  6 13 22 18  4  3  –  5  4  0  1

Prima della traduzione (b442:1f23) −1 vuol dire nessuna azione, la riga 5 apre il ramo "commercio giù" (1ce5) e la riga 23 il ramo "commercio su" (1df9). Anche il ramo fuori tabella passa dalla traduzione: {22, 16, 24, 14} diventano {3, 4, 5, 7}, {26, 27, 6, 22, 16, 24, 12} diventano {0, 1, 2, 3, 4, 5, 6}. La tabella G ha 6 righe ma è indicizzata con `int(etica + 0,5)`: con etica 6 si legge oltre, nei pesi della riga 0 di BIGTABLE (bp−0x18c), e il ciclo prosegue finché un valore supera il tiro; il gruppo è limitato a 5.

**Correzioni** (b442:1f23–2073):
- riga 5 → abbassa il livello commerciale di un passo (4→9, 3→10, altrimenti 11), solo se chi agisce è un donatore (livello da MORENUMS);
- riga 23 → lo alza (1→10, 2→9, altrimenti 8);
- poi, sui codici già tradotti:
- 24 → 16 se il livello nucleare di chi agisce è < 4;
- 20, 21, 25 → 12 se la quota militare di chi agisce è minore di quella del bersaglio;
- con quota < 2,3, una squadra e il controllo `FUN_5178_3c7c` fallito, diventano 14.

**Scale.** La colonna cresce con la relazione (colonne miti con gli amici), il gruppo diventa più mite con l'etica, e un mondo in pace sceglie colonne più miti. Una lettura precedente, che prendeva le righe per codici, faceva sembrare queste scale al contrario.

**Campagne coperte** (switch a b442:42a9). Sabotaggio, colpo di stato e assassinio non partono subito: dal ramo 21f6 il sabotaggio diventa spionaggio (49%, se donatore, 1,2× le spie già presenti), armi ai ribelli entro 0–4 giorni (40%), condanna entro 3–6 giorni (80%), avviso CIA (evento tipo 6) entro 7–14 giorni (40%) e l'operazione fra 15 e 25 giorni. Colpo di stato e assassinio seguono lo stesso schema. Il turno parte una volta a settimana, il martedì (1000:2bb4); la fase 1 sceglie la regione con `rand(1,6) > pace + 2` e `rand(1,25) ≤ 10` sulle regioni ordinate per pace (2A56:016A), altrimenti una fra le quattro meno pacifiche (b442:089c–0b1d).

**Messa in coda.** L'evento è di tipo 1 e scatta all'orario attuale più `rand(0,23)·3600 + rand(0,2)·86400` secondi (`FUN_854f_0300`); lo spionaggio porta come parametro un importo ×1,2.

### Reazione del giocatore a un'aggressione (`FUN_a482_0890` → `FUN_a482_25e6`, overlay 31)

Prima di un attacco chirurgico, di un'invasione o di uno schieramento di truppe IA, il giocatore può reagire. Le reazioni seguono i pulsanti 1–5 (switch a a482:4f9e): 1 protesta, 2 sanzioni ONU, 3 tagli commerciali, 4 minaccia militare, 5 minaccia nucleare.

Una reazione riuscita impedisce l'azione ("%-s has prevented %-s from %-s %-s."); una fallita la lascia procedere ("%-s has ignored the protests of %-s…", "%-s spurns the feeble economic threats…", "%-s vows to defeat %-s if war begins…", "The nuclear threats by %-s have not prevented…"). La finestra mostra "U.S. LER" e il LER dell'aggressore.

**Termini comuni.** P = giocatore (`ARG6`), A = aggressore (`ARG8`).
- k = 2 se le squadre coincidono (anche entrambe nessuna), 0,5 se A non ha squadra, 0,25 altrimenti.
- L = quota militare di A diviso 15 (se ha una squadra) o 20, poi ancora diviso 20.
- rel = `FUN_7124_0b5a(P, A)`.
- r = `rand(1,100)`; la reazione riesce se r ≤ S.

| reazione | soglia S | riuscita | fallita |
|---|---|---|---|
| protesta | `(2·rel·infl_P/(mil_A+1)·k/(amb_A+0,01) + infl_P·k) / (|int(etica_A − etica_P)| + 2) + 2·rel` | LER_P ×1,01 (×0,95 se k = 2) | LER_P ×0,95 |
| sanzioni ONU | veto se A è un membro permanente (id 30, 51, 136, 155, 156) o, se A ha una squadra, se uno di loro ne fa parte: LER_P ×0,98 per veto. Altrimenti, con Σ = somma delle influenze dei cinque: `((Σ − infl_A)/(infl_A+1)/(2·amb_A+0,01)²)·etica_A² + Σ/10` | LER_P ×1,02, mondo +0,1·L, pace_A −0,3·L; A condanna P | LER_P ×0,98, mondo −0,1·L, pace_A +0,3·L |
| tagli commerciali | solo se P è un donatore; amb_A ×1,045; `rel + econ_P/(econ_A+1)·(1 − (4 − livello)·c/100)/(amb_A+0,1)·(k+0,05)/2·(9 − etica_A)/3` (livello = commercio di A con P; c non letto, si usa 25) | LER_P ×1,1, mondo −L/4, pace_A −L/2 | LER_P ×0,98, mondo −L/2, pace_A −L |
| minaccia militare | amb_P ×1,01, etica_P ×0,95 se > 2,7; `rel·(mil_P/(mil_A+1))·k/(amb_A²+0,01) + 3 + mil_A/1,5·(7 − etica_P)/4` | LER_P ×1,03, amb_A ×0,96, mondo −L, pace_A −3·L | LER_P ×0,97, amb_A ×1,04, mondo −L/2, pace_A −1,5·L |
| minaccia nucleare | amb_P ×1,02, etica_P ×0,75 se > 1,5; `(nuc_P·amb_P/(amb_A+1) + 50 − 0,02·nuc_A + 2·rel)·(7 − etica_P)/3` | LER_P ×1,1, mondo −0,5 | LER_P ×0,9 |

Dopo le minacce, se `rand(1,100) ≤ amb_A`, l'aggressore mette in coda un attacco nucleare (codice 24) contro P entro 1–2 ore (a482:4698, a482:4eb4). Ci sono anche ritocchi a campi non identificati di A e P nel ramo nucleare. Alla fine pace mondiale, pace, etica e ambizione di A, ambizione ed etica di P vengono riportate in [1,6], e LER_P in [0,1].

### Guerra (`FUN_5825_0000`, overlay 46)

Un'invasione riuscita (codice 21) avvia il modulo guerra ("ShadowNetwork: Updating Conflict Data...", schermata "WAR IN: %-s" con truppe, morti e quartier generale). Il modulo tiene due strutture di lato (bp−0x4EC per gli attaccanti, lato 0 in CONFLICT; bp−0x4F0 per i difensori, lato 1) e le aggiorna a ogni tick.

**Composizione dei lati.** Per ogni contingente TROOPS di un partecipante:
1. Le truppe del contingente vengono limitate alla forza armata del paese (NUMBERS+0x2C).
2. Il lato somma:

| off | campo |
|---|---|
| +0x00 | truppe impegnate (somma dei contingenti) |
| +0x08 | riserve: forza armata − truppe impegnate |
| +0x10 | mobilitabili: 3% della popolazione, al massimo +0x38 |
| +0x18 | **forza %** (0–100) |
| +0x20 | morti dell'ultimo tick |
| +0x28 | vittime civili dell'ultimo tick |
| +0x30 | costo delle perdite: spesa/+0x38 · morti |
| +0x38 | forza totale |
| +0x40 | popolazione |
| +0x48 | spesa militare |
| +0x50 | LER medio (+0,1 per i difensori) |
| +0x58 | ambizione media (+2 per i difensori) |
| +0x60 | repressione media |
| +0x68 | numero di partecipanti |
| +0x6A… | copia dei valori iniziali |

**Potenza di combattimento** (q = spesa militare / forza totale del lato):
```
P_att = LER_att · (amb_att/20) · (q_att · truppe_att) · (1 − (rep_att − 1)/20)
P_dif = LER_dif · (amb_dif/20) · (q_dif · truppe_dif · 0,7) · (1 − (rep_dif − 1)/20) · (q_dif/q_att)
```
Il moltiplicatore 0,7 si applica alla struttura bp−0x4EC.

A ogni tick il gioco:
1. Sposta a caso 0,01 di LER da un lato all'altro.
2. Calcola il rapporto r = P_dif/P_att. Gli aggiunge un rumore di segno casuale (0,001, 0,14, 0,2 o 1 secondo la fascia di r), poi lo limita.
3. Ne ricava una riga e (0–20), con soglie 0,86; 0,72; 0,58; 0,44; 0,30; 0,16; 0,02; 0,01; 0,005; … fino a 5·10⁻⁶. Quattro tabelle danno i tassi della riga, divisi per 6:
   ```
   T1: 0,04 0,035 0,03 0,025 0,03 0,035 0,04 0,045 0,05 0,06 0,07 0,08 0,09 0,10 0,11 0,12 0,13 0,14 0,15 0,16 0,21
   T2: 0,08 0,05 0,04 0,03 0,02 0,015 0,012 0,009 0,007 0,004 0,003 0,002 0,001 0,0009 … 0,0003 0,0001
   T3: −1 −0,5 0,001 0,005 0,01 0,03 0,04 −0,05 −0,06 0,07 0,08 0,09 0,10 0,12 −0,14 −0,16 0,18 0,20 0,23 0,26 0,30
   T4: −0,1 −0,05 −0,012 … −0,5 −0,7 −0,9 −1,1 −1,3 −1,5 −1,7 −2,0
   ```
   Per rapporti estremi (sotto 2,5·10⁻⁶) le colonne di T1 e T2 si scambiano. T3 e T4 non sono usate nella parte letta.
4. Applica le perdite:
   ```
   morti_dif = truppe_att · T1[e]/6 / 8        (sotto 50: un numero casuale)
   morti_att = truppe_dif · T2[e]/6 · 1,6 / 8
   per ogni lato: truppe −= morti;  spesa ·= 1 − morti/forza_totale;  forza_totale −= morti
                  forza% = clamp(100 − 300·morti/truppe + ambizione², 0, 100)
                  civili = 0,2·morti (difensori) o 0,1·morti (attaccanti), sottratti alla popolazione
   ```
5. Riduce il PIL del paese teatro di 0,33% o 2% per tick. Quello che si perde finisce in COUNTRY+0 del paese teatro (il potere nucleare, usato qui come accumulatore dei danni?).
6. Applica le **perdite extra da leadership**. Se il LER del lato più debole è almeno 0,5, il gioco tira `rand < (ΔLER/k)·100` con k = 5, 3, 2,5 e 1,5. Se il tiro riesce, il lato con meno LER subisce `truppe_avversarie/8 · {0,1; 0,1; 0,075; 0,025} · (100·ΔLER + 10)/10` morti in più.

La direzione esatta di alcuni rami è ancora da confermare: per esempio quale lato è favorito quando il rapporto r scende. Gli scenari contengono una sola guerra (Somalia–Etiopia) e nessun morto nei file, quindi non c'è nulla su cui verificare.

Escalation nucleare: se un partecipante ha `nuclear_level` ≥ 4 e il suo lato ha forza% < 50, il gioco tira due dadi `rand(1,6)`. Quando `dado1 < ambizione` e `dado2 > pace`, mette in coda un **attacco nucleare** (tipo 1, codice 24) contro il nemico, da eseguire entro `rand(1,5)` ore.

La resa (`FUN_5db5_3cd2`) scatta per un lato in due casi:
- la sua forza totale (+0x38) non è nulla e `rand(1,100) > forza% + 2`;
- le sue truppe o la sua forza scendono sotto 1.

Se il teatro sono gli Stati Uniti decide il giocatore. Se perdono i difensori, prima della resa avviene l'annessione (`FUN_5db5_2ef9`).

### Resa (`FUN_5db5_3cd2`, overlay 47)

I messaggi sono "%-s has surrendered! %-s has successfully defended %-s!" e "%-s has lost! %-s has successfully taken possession of %-s!". Per ogni record CONFLICT di quel teatro:
```
CONFLICT.attivo = 0xFF
per ogni territorio coinvolto e ogni contingente TROOPS del partecipante lì:
    se il partecipante è nel lato sconfitto:  LER −= 0,1;  "%-s troops in %-s have surrendered."
    altrimenti:  LER += 0,1 (al massimo 1);  forza di occupazione impostata;
                 popolarità del presidente += 10 (al massimo 100)
    pace_mondiale −= pace_p · influenza_p/100
    pace_p = 2,5               se p è il paese teatro della guerra
             3                 se p è tra i territori coinvolti
             pace_p · 1,2      altrimenti (6 o più → 5,9)
    pace_mondiale += pace_p · influenza_p/100;   pace_p in [1,6]
    il contingente viene liberato (proprietario = luogo = −1)
```
Chi ha combattuto in casa resta quindi molto belligerante (2,5–3), mentre i partecipanti esterni tornano verso la pace.

### Schieramento di truppe e composizione dei lati (overlay 47 `5db5`, 45 `5178`, 46 `5825`)

- **Schieramento** (`FUN_5db5_0000`): con un contingente già nel bersaglio ne cambia il livello ordinato (`FUN_5178_31d0`); altrimenti `FUN_5db5_0be3(A,T,1)` chiede al bersaglio stesso, poi ai confinanti in ordine di CONTIG (il controllo di contiguità di A a 5db5:0f7c è un'assegnazione: codice morto). Accettazione (`FUN_5db5_1b0d`): `(etica_A > 3 o squadra_A == squadra_H)` e `rand(1,100) ≤ ansia_mil_H − 0,6·(8−rel)²·pace_H − 15·(8−rel) + 15·rel`; chi rifiuta: ansia militare ×1,05 (max 100), pace ×0,98 (min 1). Il tiro `33 + 5·ambizione` (5db5:05a8) è la reazione del bersaglio a uno schieramento fallito.
- **Crescita** (`FUN_5825_4af0`, da domenica a lunedì): il contingente nasce con truppe 0 e sale verso il livello ordinato di `min(120000, 62000·spesa_mil/forza/100000)` a ogni chiamata.
- **Invasione senza truppe vicine** (`FUN_854f_246c`): l'IA mette in coda uno schieramento a +0–23 ore e ritenta l'invasione dopo 14 giorni.
- **Lati** (`FUN_5178_3c7c`, chiamata dal ramo invasione d1a4:4019; zona = bersaglio e confinanti, `FUN_5178_2d89`): righe di CONFLICT per coppia (partecipante, teatro), quindi più fronti; chi difende impegna forza − truppe all'estero; chi attacca lo stesso se confina, altrimenti i contingenti nella zona; entrano i terzi con più di 1000 soldati nella zona e una squadra, e il leader della squadra del bersaglio. Se chi attacca guida la squadra del bersaglio: il bersaglio esce, etica_A = 1, ambizione_A +2.
- **Cedimento degli Stati Uniti** (5825:433e/43ce/44fc/45ac/467b): niente resa né annessione automatica; `[0xb4]=0`, `[0x50]=1` (interruzione) e la guerra continua. Dalla Sala della guerra: "Demand Opponent's Surrender", "Adjust Troop Level in Country", "Surrender to Opponent". Non esiste una mobilitazione generale.
- **Frequenze** (`FUN_1000_25cd`, a ogni nuovo giorno): martedì turno IA, mercoledì `FUN_5db5_2d33`, giovedì tick di guerra `FUN_5825_0000`, venerdì `FUN_5caa_0bff`; nella Sala della guerra (`FUN_5178_0122`) il tick di guerra è giornaliero.

### Conseguenze nucleari (EventType 5, overlay 21)

Dopo ogni attacco nucleare, del giocatore o dell'IA, il ramo 24 dell'esecutore (d1a4:7483–7584) mette in coda tre eventi (testi in `nucdsc01.txt`): il codice 0 a +4–18 ore, il codice 1 a +1 ora, il codice 2 solo se n > 8 e `rand(1,20) < n` (n = testate lanciate) a +7–14 giorni. Il codice 1 (`FUN_8a38_4c6a`) non sposta le alleanze: mette in coda le reazioni dei donatori contro chi ha colpito.

| codice | funzione | effetto |
|---|---|---|
| 0 | `FUN_8a38_17a2` | ricaduta sui paesi della regione: militare, spese e peso militare ×0,8, economia ×0,75, **pace ×0,5**, popolazione ×0,95, crescita del PIL ×0,8, ambizione ×1,3, etica ×0,8, n00 e n10 ×1,3; poi ricalcolo di pil pro capite e qualità della vita |
| 1 | `FUN_8a38_4c6a` | reazioni dei donatori contro chi ha colpito (con probabilità 15·influenza): atomica dai compagni di squadra con livello ≥ 5, altrimenti condanne, inviati, colpi di stato, assassinii, spionaggio, embarghi |
| 2 | `FUN_8a38_39b5` | effetto su tutti i 168 paesi: militare ×0,9, economia ×0,85, **pace ×0,5**, popolazione ×0,95, crescita ×0,9, ambizione ×1,1, etica ×0,9, n00 ×1,2, n10 ×1,1; STRATEGY +120..+152 ×1,1–1,2, +16/+24/+32 ×1,3; ricalcolo dei totali mondiali con pace mondiale ≥ 1 |

**Effetto diretto dell'attacco** (ramo 24 dell'esecutore `FUN_d1a4_0000`, d1a4:94e3):
- n = min(testate richieste, testate di chi lancia); chi lancia ne spende n, il bersaglio ne perde n (con una riserva per la ritorsione); se n ≥ 3·livello del bersaglio (1–4) il livello scende di 1, poi di un altro se ≤ 3 (d1a4:5900–6a9f, 73cd);
- morti `min(1,5 M·n + 3% pop, 95% pop)`, soldati persi `min(60000·n, 90% forza)`, FALLFLAG[bersaglio] += 50;
- pace mondiale = 1, e pace 1 per i due paesi;
- malcontento (N+0x10) = 100 per chi colpisce e per chi è colpito;
- ansia militare (S+8) e nucleare (S+0) = 100 per entrambi;
- la pace mondiale viene ricalcolata sostituendo i contributi `pace·influenza/100` dei due paesi, con minimo 1;
- la qualità della vita media (W+0x60) viene aggiornata.

Le ritorsioni del bersaglio (condanna, sabotaggio, assassinio) vanno in coda con date casuali.

Lo stesso overlay 21 gestisce la **popolarità** del presidente (globale +0x1F6 in percentuale, testi `popdsc01.txt`). Contiene il log di debug `popdebug.out` ("%d%% pop hit, reason=%d…") e gli avvisi CIA del tipo 6 (`FUN_8a38_5ba0`).

### Elezioni e mandato (overlay 44 `5000`, overlay 17 `77a0`)

- **Data:** `FUN_5000_0c7f` parte da 594.374.400 (1° novembre 1988), aggiunge 4 anni (126.230.400 s) finché non supera la data corrente e cerca con `ctime` il primo martedì di novembre ("Nov", "Tue"). Il risultato sono i giorni mostrati come "Days to Election: %d"; con le elezioni disattivate compare "ELECTIONS DISABLED".
- **Esito** (5000:0f76–1018), con la popolarità 2A56:01F6:
  - ≥ 50: rielezione;
  - < 40: sconfitta;
  - altrimenti sconfitta se `rand(1,100) > (popolarità − 40)·10`.
  
  `FUN_77a0_4918` riceve l'esito come argomento e mostra la sequenza (`elecan.scr`, `pics\election.pcx`, `eleccut.scr`, una mappa degli stati, `elect.txt`: "Access … is extended four more years" o "Further access … is DENIED!"). Dopo 25 mandati: "Congratulations! You have served 25 full terms!".
- **Impopolarità** (`FUN_5000_11cd`, 5000:11fd–13f9), a ogni nuovo giorno: se la popolarità è sotto 15 (registro `popdebug.out`, "Popularity has just fallen below 15%%"):
  - con `100 − 3·popolarità > rand(1,100)` il presidente cade;
  - poi `rand(1,50) > 15·x + popolarità + 5` porta all'assassinio (`FUN_77a0_2381`), altrimenti alla destituzione (`FUN_77a0_2d83`, `pics\impeach3.pcx`, `impnums.txt`);
  - x è il campo +0x78 del record caricato per il paese del giocatore, copia di NUMBERS+0x30: l'etica degli Stati Uniti (decomp_A.c:74954).

### Disastri (`FUN_9aba_0000`, overlay 27)

I testi sono in `DISASTRL.FIL` (siccità e carestia, terremoto, alluvione, incidente aereo, esplosione di un impianto chimico; "northern/southern/eastern/western"). La funzione è chiamata dal ciclo principale (lin 0x1295d) e da un comando di `9572`; si disattiva con "Turn Disasters" (`6263:48fe`). Le tabelle locali sono inizializzate a 9aba:00ea–019e:
- **tipo:** `rand(1,100)` contro le soglie cumulative 10/30/50/75/100;
- **gravità:** `s = rand(1,100)/100`;
- **danni:** PIL × {0,01; 0,005; 0,002; 0,0005; 0,0005}·s. Si accumulano nel campo +0 del paese, lo stesso usato dalla guerra;
- **vittime:** popolazione × {0,002; 0,0005; 0,0001; 0; 0}·s, almeno 2. Per l'incidente aereo `rand(1,250)`;
- **crescita:** cala di crescita × {0,01; 0,005; 0,002; 0,0001; 0,0002}·s;
- **terremoto:** magnitudo `6 + 2·s`.

Per i due disastri provocati dall'uomo (tipi 3–4) il gioco conta i paesi con ambizione ≥ 5 ed etica ≤ 1 e ne sceglie uno a caso come colpevole P:
- se `rand(1,100) < 50` e la relazione USA–P è sotto 3, il bersaglio sono gli Stati Uniti;
- altrimenti prova fino a 25 paesi a caso con relazione P–X sotto 3, poi li scorre in ordine;
- la notizia aggiunge "The CIA has determined that %-s was responsible for this disaster.";
- senza canaglie il paese colpito è a caso.

### Stato commerciale (`FUN_b04b_27a9`, overlay 34: passo 8, "Updating Trade Status")

Ogni anno, per ogni paese P e ciascun donatore D:
```
MORENUMS[P]+0x10+slot_D = 4  se P e D hanno la stessa World Team (bit 0–6 di C+197; vale anche se nessuno dei due ha squadra)
                          3  se solo uno dei due ha una squadra
                          2  se sono in squadre diverse
```
Esatto in 2520 coppie su 2520 in tutti gli scenari. Le misure commerciali del giocatore (azioni 8–11) quindi valgono solo fino alla fine dell'anno.

### Bilanci (`FUN_b2e8_0000`, overlay 35: passo 9, "Calculating budgets")

Per ogni paese esclusi gli Stati Uniti, con B = STRATEGY+0x28:
```
B     = PIL·0,02 / ((pace + etica + 7 − ambizione)/3)
attivo = pil_pro_capite ≥ 4000  oppure  influenza ≥ influenza del 15° donatore (WORLD+0xBA, l'Iraq nel 1990)
+0x30 = attivo ? 3·(7 − pace)²/100 · B/3 : 0
+0x38 = attivo ? 0,04·ambizione · B : 0                 # aiuti all'intelligence
+0x40 = attivo ? (6 − (pace + 7 − ambizione)/2)/100 · B : 0
+0x48 = B·(50 − etica·WORLD+0x48)/200                    # spionaggio
+0x50 = B − 0x30 − 0x38 − 0x40 − 0x48
spesa_nucleare  = belligeranza_media < 1,5 ? 0 : spesa_mil · ambizione · 0,0027 · (livello_nucleare + 1)
potere_nucleare = spesa_nucleare / spesa_mil · potere_militare
+0x70 = spesa_nucleare = 0 ? 0 : 0,01·spesa_mil · (1 + ansia_nucleare/100) · (1 + (7 − ambizione)/100)
+0x58 = belligeranza_media < 1,5 ? 0 : 24/(etica + 0,01)/100 · spesa_mil
+0x60, +0x68 = attivo ? ⅔ e ⅓ di 0,00084·PIL : 0
```
WORLD+0x48 è l'etica del paese più influente dell'ideologia dominante. WORLD+0x104 = max B.

Per gli Stati Uniti decide il giocatore: la spesa militare viene dal bilancio impostato nella schermata del bilancio, e gli aiuti economici e umanitari dal valore scelto. Gli importi vengono copiati nella storia `*0x10A2`, usata dal passo 10.

Verifica (`tools/verify_formulas.py`):
- **Esatti in tutti i paesi:** la parte attiva, +0x30, +0x40, +0x48 (riaggiungendo gli aiuti all'intelligence del passo 12).
- **Quasi tutti esatti:** +0x58, +0x38 e la spesa nucleare (153–159 su 164). Gli scarti sono i donatori, il cui residuo cambia al passo 10.
- **Totale B:** torna in ogni paese con un livello di pace **intero** diverso da quello salvato. Per esempio il Regno Unito è calcolato con pace 3 ma salvato con 4. Gli autori hanno quindi ritoccato a mano i livelli di pace dopo aver generato gli scenari; le quote +0x30 e +0x40 invece usano già la pace ritoccata.

### Distribuzione degli aiuti esteri (`FUN_7556_0000`, overlay 16: passo 10, "Distributing foreign aid")

Per ciascuno dei 15 donatori D (WORLD+0x9E):

- Se l'influenza di D è minore di 2,5, i suoi aiuti vengono azzerati in tutti i paesi.
- **Donatori IA** (e gli Stati Uniti nel primo anno, flag `FIRSTCALCS`):
  1. Ogni anno gli aiuti di D vengono azzerati e ridistribuiti da capo.
  2. Sono **idonei** i paesi R con popolazione > 0, non conquistati (NUMBERS+0x39 = R), ideologia non nemica di quella di D e `pil_pro_capite_D/2 > pil_pro_capite_R`.
  3. Il 75% di ciascun bilancio di aiuti va agli alleati idonei (stessa World Team, bit 0–6 di C+197); il 25% va a tutti gli idonei con squadra uguale o senza squadra.
  4. Dentro ogni gruppo la quota di R è `valore_strategico_R [198] / Σ [198]`.
  5. Il residuo non speso torna nel bilancio di D.
- **Stati Uniti negli anni successivi:** le assegnazioni per paese scelte dal giocatore restano in ASSET. Il gioco le riscala per `nuovo_bilancio/vecchio_bilancio` di ogni tipo, conservando la storia dei bilanci nella struttura puntata da `*0x10A2`.

`FUN_7556_1ed6` assegna a R ogni tipo di aiuto, se `desiderato_R > 0`:
```
dono = FUN_7556_23ce(bilancio_tipo, desiderato_R, quota):
    se bilancio ≤ 1e6:            0
    x = bilancio · quota
    se x > 1e6:                   x se x < desiderato, altrimenti x − desiderato   (così nel codice)
    altrimenti:                   1e6 se desiderato > 1e6, altrimenti 0
desiderato_R −= dono;  bilancio_tipo −= dono;  ASSET[R][tipo][slot di D] += int(dono/1e6)
```
Condizioni aggiuntive:
- aiuti militari: serve `orientamento_D − orientamento_R < 2`;
- aiuti nucleari, tutte insieme: la stessa condizione, `livello_nucleare_D ≥ 5`, `livello_nucleare_R < livello_nucleare_D`, `orientamento_D ≥ 5` e inoltre ambizione_D ≥ 4 oppure pace mondiale ≤ 2.

### Somma degli aiuti (`FUN_b04b_0000`, overlay 34: passo 12, "Adding foreign aid")

Per ogni paese il gioco somma i 15 donatori di ciascun tipo (M$) e aggiorna:
```
MORENUMS+4        += umanitari · 1e6
potere_economico  += economici · 10                  # = economici·1e6 / 1e5
pil_pro_capite     = (potere_economico·1e5 + umanitari·1e6) / popolazione
STRATEGY+0x48     += intelligence · 1e6
spesa_militare    += militari · 1e6
spesa_nucleare    += nucleari · 1e6
ansie STRATEGY+0x00..0x20 in [0,100]
```

### Ansie e aiuti desiderati (`FUN_7714_10b4`, overlay 51: passo 13, "Calculating anxiety levels")

Ricostruite e verificate con `tools/sp_anxiety.py`. Le cinque ansie sono esatte per 165 paesi su 165 in tutti e sei gli scenari; gli aiuti desiderati pure, salvo due eccezioni:
- l'aiuto all'intelligence desiderato in Oceania (154/165), dove il gioco usava un massimo regionale più basso di quello salvato in REGION;
- un aiuto economico in S2–S4.

Termini comuni:
```
fp       = 1,75 se pace_mondiale = 0, altrimenti (4/pace_mondiale + 3)/4
pesi(q)  = (0,8 mondo, 0,2 regione) se q ≥ 5;  altrimenti peso_regione = max(1 − 0,175·q, 0,2)
rif(q, campo_mondo, campo_regione) = peso_mondo·WORLD[campo] + peso_regione·max sulle regioni del paese di REGION[campo]
```
Ansie (tutte limitate a [0,100]):
```
nucleare  leader di una World Team: testate delle altre squadre / (testate della propria + 1) · 75
          in una squadra:           (7 − pace_mondiale)·amb·(7 − livello_nucleare)·(7 − pace)·fp
          senza squadra:            (7 − pace_mondiale)·(7 − pace)·2·amb·(7 − livello_nucleare)/7·fp,
                                    ×3 se un confinante (CONTIG) ha livello_nucleare ≥ 2
militare  leader: (100 − quota_mil)/(7 − amb)·(7 − pace) + quota_mil/5
          altri:  (100 − 100·quota_mil/Σ quote_mil della regione di casa) / pace · (amb + 10)/10 · fp
                  (l'URSS conta per un terzo, sia per sé sia nella somma regionale)
spie      (0,5/LER)·amb·(n00 + 1)/2·(7 − pace)·2,25·fp
economica 100·(max(0, 1 − pil_pc/rif(quota_econ, 0x38, 0x40)) + max(0, 1 − crescita_pil/rif(quota_econ, 0x10C, 0xB6)))/2
sociale   (crescita_pop/0,023)·n00·amb·6                        se crescita_pil ≤ 0,005
          (crescita_pop/0,023)·n00·10·amb·(0,03/crescita_pil)  altrimenti
```
Aiuti desiderati (0 se il riferimento è sotto il valore del paese):
```
nucleare     (rif(quota_nucl, 0xE4, 0x8E) − spesa_nucl)·100/(7 − amb) · ansia_nucl/100   (0 se amb = 1)
militare     ((rif(quota_mil, 0xF4, 0x9E) − spesa_mil)/pace/(7 − amb) + 100·amb·(7 − pace)) · ansia_mil/100
intelligence (rif(influenza, 0x104, 0xAE) − STRATEGY+0x28)/(7 − amb) · ansia_politica/100
economico    0 se pil_pc ≥ max(WORLD+0x38, 21000)/2;
             altrimenti min((rif(quota_econ, 0x38, 0x40) − pil_pc)·popolazione · ansia_econ/100, WORLD+0·1e5)
umanitario   q = 100·(infl/(rango_ideologia + 1)) / Σ_paesi infl/(rango_ideologia + 1)   (rango in WORLD+0x6C)
             rif = peso_mondo(q)·3000 + peso_regione(q)·max REGION+0x40
             popolazione·(rif − pil_pc) · ansia_sociale/100
```
Il resto della funzione (dopo 3EA2) scorre di nuovo i paesi, escludendo USA e Laos (76), e tiene i massimi di quote e bilanci per ciascun livello di relazione. Probabilmente prepara le liste del rapporto del Segretario di Stato ("U.S. Allies with greatest Foreign Aid needs"); non è stato ricostruito.

### Spie (`FUN_b04b_18d1`, overlay 34: passo 11, "Distributing money for spies")

Per ciascuno dei 15 donatori D, con budget B = STRATEGY[D]+0x50 (fondi per lo spionaggio all'estero, passo 9):

- **D senza World Team:** B si divide fra tutti gli altri paesi P in proporzione all'valore strategico:
  ```
  ASSET[P]+0x96[slot D] += int(B · [198]_P / (Σ[198] − [198]_D) / 1e6)      # M$
  ```
- **D in una squadra:** metà di B va ai paesi delle **altre** squadre (1–4), in proporzione a [198]_P / Σ [198] delle altre squadre. L'altra metà si divide fra tutti come sopra. Negli scenari, a parità d'influenza, un paese di una squadra rivale riceve circa 3 volte più spie.
- **Stati Uniti dal secondo anno:** le assegnazioni scelte dal giocatore restano e vengono riscalate per `B / spesa totale precedente`.
- In ogni caso B diminuisce di quanto speso, e non scende sotto 0.

Poi, regione per regione, il gioco calcola la **posizione d'intelligence netta** di ogni paese, `max(STRATEGY+0x48 − Σ spionaggio straniero ricevuto·1e6, 1)`. Ne conserva il massimo in REGION+0xA6 e in WORLD+0xFC, e il massimo di STRATEGY+0x28 in REGION+0xAE.

Verifica: gli importi in ASSET+0x96 sono proporzionali a [198] (rapporto costante a meno dell'arrotondamento al milione). REGION+0xA6 torna in 16–17 regioni su 17.

### Fine mese (radice 1000:2D80, "END OF MONTH DATA TRANSFER")

Ogni mese il gioco esegue in ordine:
1. "Economic Results Published...": `FUN_854f_138e`, che convalida la coda degli eventi.
2. "Public Reaction To Budget...":
   - `FUN_5f0c_308e`: economia USA, sotto;
   - `FUN_ed41_194d`: oscillazione del LER. Per ogni paese, dopo aver riportato i campi nei loro limiti, il gioco estrae `r = rand(1,100)` e `k = rand(1,8)`. Se `LER < 0,5` e `100·LER > r`, il LER sale di k/100. I governi deboli, ma non troppo, recuperano lentamente.
3. "Receiving Social Outcry Levels...": `FUN_ed41_0000`, il calcolo del malcontento.
4. "Processing Social Events...": `FUN_ed41_11fc`, la generazione degli eventi sociali.

### Bilancio USA (schermata "BUDGET VIEW")

Il giocatore regola quattro **aliquote** e quattro **linee di spesa** (pulsanti in `BUTNDEFS.TXT`). Le variabili sono globali; le aliquote sono frazioni arrotondate al millesimo. Ogni voce ha un valore nuovo, scelto dal giocatore, e il valore dell'anno prima:

| voce | nuovo (2A56:) | anno prima (2A56:) |
|---|---|---|
| imposta sul reddito delle persone | 02A8 | 0318 |
| imposta sulle società | 02B0 | 02E8 |
| imposta sulle vendite | 02B8 | 0320 |
| dazi sulle importazioni | 02C0 | 0328 |
| difesa | 02C8 | 02F8 |
| programmi sociali | 02D0 | 0300 |
| assistenza all'estero | 02D8 | 0310 |
| ricerca (ipotesi) | 02E0 | 0308 |

Altre variabili:
- **Stato dell'economia:** 2A56:02F0 è il saldo accumulato (negativo = debito; non sale mai sopra 0). 2A56:0350 sono i profitti delle società in % del PIL e 2A56:0358 le importazioni in % del PIL, entrambi in [5%, 15%].
- **Effetti mensili:** 2A56:0330 sulla popolarità, 0338 sulla crescita, 0340 sui profitti, 0348 sulle importazioni.
- **Dati della schermata (2AA9:):** PIL 349E, crescita 34A6, popolarità 34AE; gettito per imposta 34BE/34B6/34C6/34E6; spesa totale 34CE; saldo 34D6; entrate 34DE; obiettivi 352E (profitti), 3536 (crescita), 353E (importazioni), 3546 (popolarità).

**Valutazione (`FUN_5f0c_1842`, overlay 8).** È il riquadro a destra della schermata; il gioco la ripete 5 volte per far convergere crescita e saldo. Notazione:
- Δ = nuovo − vecchio di una voce;
- `rs` = spesa sociale nuova/vecchia;
- `ra` = assistenza all'estero / 18,6 G$;
- `rr` = (ricerca + 0,115·debito) / (ricerca vecchia − 172,5 G$);
- `d` = saldo/10¹³ + 0,0302.

```
PIL'     = PIL · (1 + crescita_obiettivo)
reddito  = 0,833 · PIL'
gettito: persone   = aliquota_persone · reddito
         società   = aliquota_società · PIL' · profitti
         vendite   = aliquota_vendite · (reddito − gettito_persone)
         dazi      = dazi · PIL' · importazioni
saldo    = Σ gettito − (difesa + sociale + ricerca + assistenza)

crescita_obiettivo = crescita
   − Δpersone·(0,3 se aumenta, 0,2 se cala) − Δsocietà·(0,2 / 0,1) − Δvendite·(0,2 / 0,5) − Δdazi·(0,3 / 0,7)
   − (rs − 1)·(0,06 / 0,1)  +  (rr − 1)·(0,011, al massimo 0,02 / 0,005)  −  (ra − 1)·(0,0005 / 0,001)
   + (d < 0 ? 1,3·d : d/5)
profitti_obiettivo     = profitti − 0,2·Δpersone + 0,7·Δdazi + (rr − 1)·(0,015, al massimo 0,05 / 0,025)
importazioni_obiettivo = importazioni − 0,2·Δpersone + 0,05·Δsocietà − Δdazi·(0,5 / 2)
popolarità_obiettivo   = popolarità/100 − Δpersone·(4 / 2) + 0,2·Δsocietà − Δvendite·(8 / 5)
   + effetto dei dazi + (rs − 1)·(0,9 / 5) + (rr − 1)·(0,01 / 0,005) − 0,05·(ra − 1) + saldo/10¹³ + 0,03
```
Il primo coefficiente vale quando la voce aumenta, il secondo quando cala: alzare le tasse pesa più che abbassarle. Il confronto della crescita con 3 (invece che con 0,03) è sempre vero, e il termine che ne esce fa parte dell'effetto dei dazi (5f0c:2773–289f): se i dazi salgono la popolarità cambia di `0,6·(Δdazi − d') + 0,1·(13·(crescita − 0,03) + 0,2 − dazi)`, se scendono di `20·Δdazi`.

**Alla fine dell'anno (`FUN_7124_377e`, inizio del passo 1):**
1. I valori nuovi diventano quelli correnti e il gioco rifà la valutazione.
2. Ogni effetto mensile cresce di `(obiettivo − valore attuale)/12`.
3. Il bilancio della difesa ridimensiona le truppe USA e fissa gli aiuti USA: intelligence 23%, militari 72%, nucleari 5%. L'assistenza all'estero si divide in 66% economica e 34% umanitaria. Gli importi già assegnati per paese vengono riscalati in proporzione.

### Economia USA a fine mese (`FUN_5f0c_308e`, overlay 8)

Lavora sul record NUMBERS degli Stati Uniti e su variabili globali del bilancio del giocatore (segmenti 2A56 e 2AA9):
- **Crescita:** `crescita_pil_USA += 2A56:0338`, cioè l'effetto del bilancio sulla crescita.
- **Evento economico:** se `rand(1,100) > 100·storia_bilancio[0] + 40` e la crescita è sotto 0,01, chiama `FUN_976b_14b0(6, −1, 1)`, probabilmente una notizia economica negativa.
- **Profitti e importazioni:** `2A56:0350 += 2A56:0340` e `2A56:0358 += 2A56:0348`, entrambi limitati a [0,05; 0,15], cioè 5–15% del PIL.
- **Saldo accumulato:** `2A56:02F0 += (entrate − spese)/12`; non sale mai sopra 0, e un valore negativo è il debito.
- **Popolarità** (2A56:01F6, %):
  1. Se supera 45, il gioco prende la crescita limitata a [−0,2; 0,1].
  2. Sotto il 3% il valore diventa `(crescita − 0,03)·50`; altrimenti è 0.
  3. Mette in coda un evento di popolarità (tipo 4) di `int((2A56:0330 + valore)·100/popolarità + 0,5)` punti.
  4. Moltiplica la popolarità per `1 + valore`.



### Disordini sociali

**Malcontento (`FUN_ed41_0000`, overlay 43).** Per ogni paese il gioco riporta prima i campi nei loro limiti (LER [0,1], quote [0,100], repressione [1,4], malcontento [0,100], etica, ambizione e pace [1,6]), poi calcola:
```
repressione = clamp((5 − 0,9·etica) · 3/WORLD+0x48, 0, 4)          # WORLD+0x48 = etica del leader dell'ideologia dominante
k           = min(3704 / pil_pro_capite, 1)                         # i paesi ricchi protestano meno
g           = max(crescita_pil, 0,003)
malcontento = min(25 · repressione · k · (0,03/(g + 0,002))², 100)
```
Entrambe le formule sono esatte per 165 paesi su 165 in tutti gli scenari (`verify_formulas.py`). La funzione calcola anche un divario di PIL pro capite rispetto al riferimento mondo/regione (pesi come per le ansie, con 0,2 al posto di 0,175). Ne ricava un indice di rabbia legato all'etica, che però non viene salvato.

Cosa cambia il malcontento fra un calcolo e l'altro:
- **lo aumentano:** armi ai ribelli (×(1 + (7 − pace_mondiale)/100)), sabotaggio (×1,05), nuove richieste sui diritti umani (in base alla repressione), conseguenze nucleari (×1,1–1,3);
- **lo riducono:** riforma sociale (×(1 − L70)).

**Generazione degli eventi (`FUN_ed41_11fc`).** Per ogni paese P:
1. Se `malcontento > 40 + rand(0,60)` e `rand(1,2) = 2`, il gioco prova gli stadi da 1 a 10.
2. Lo stadio s passa se `rand(1,100) > 100 − T[repressione][s]`. La tabella T dà la probabilità % di ogni stadio:
   ```
   repressione 1: 100  90  30  12   6   3   2   1   1   1
   repressione 2: 100 100  90  36  18   9   6   3   2   1
   repressione 3: 100 100 100 100  63  27  18   9   6   3
   repressione 4:  17  14   8   4   3  18  12   6   4   2
   ```
   Con repressione fuori da [1,5] nessuno stadio passa.
3. Fra gli stadi passati il gioco ne sceglie uno a caso e lo mette in coda come evento di tipo 3 (P → P, codice = stadio), da eseguire entro un mese: `rand(1,23)` ore più `rand(0,28)` giorni.

Gli stadi seguono `SOCEVTL3.FIL`; ciascuno ha un messaggio "è avvenuto" e uno "represso dal governo":

| stadio | evento | effetto se avviene |
|---|---|---|
| 1 | riunioni di protesta private | LER ×0,996 |
| 2 | dichiarazioni antigovernative | LER ×0,99 |
| 3 | piccole manifestazioni | LER ×0,99 |
| 4 | manifestazioni di massa nella capitale | LER ×0,98; **cambio di regime** se `rand ≥ 400·LER` |
| 5 | rivolte violente | LER ×0,97; cambio di regime se `rand ≥ 300·LER` |
| 6 | tentato assassinio del leader | LER ×0,97; tiri su etica (`rand < 19,6·etica`) e su `(LER + 0,5)·100`; contro gli USA: **assassinio del presidente** (`FUN_77a0_2381`, fine partita) |
| 7 | violenza organizzata | se `rand ≥ 100·LER`: LER ×0,97 |
| 8 | insurrezione | LER ×0,9; cambio di regime se `rand > (LER + 0,5)·100`; contro gli USA può destituire il presidente (`FUN_77a0_2d83`) |
| 9 | colpo di stato | se `rand > (LER + 0,5)·100`: presidente destituito (USA) o cambio di regime |
| 10 | guerra civile | se `rand > (LER + 0,5)·100`: fine partita (USA) o cambio di regime |

Il gestore (`FUN_6a19_155d`) decide prima se l'evento avviene:
```
soglia = 2·repressione · (etica + 1)/2 · stadio · (1 + ansia_sociale/100) · (LER + 0,5)
```
- **Se `rand < soglia`:** l'evento avviene, con gli effetti della tabella.
- **Altrimenti:** il governo lo reprime; per esempio "The government of %-s broke up several private protest meetings".

**Cambio di regime (`FUN_ed41_170a`).** Il gioco estrae una nuova ideologia di governo fra le lettere A–M:
- il Sionismo (G) solo per Israele, che lo conserva;
- le ideologie islamiche (E, F, M) solo in certi casi;
- su richiesta, solo ideologie compatibili con la precedente.

Poi estrae una nuova etica nell'intervallo dell'ideologia: A 4–6, B 1–2, C 3–5, D 1, E 3–6, F 2–3, G 2–4, H 1–3, J 1–3, K 2–4, L 1–2, M 1–2. La stessa funzione serve al colpo di stato del giocatore (azione 15).

### Annessioni (`FUN_6318_2381`, `FUN_5db5_2ef9`)

PIL, spesa militare e popolazione del paese conquistato passano al conquistatore. Il paese annesso eredita ambizione ed etica del conquistatore. Le crescite del PIL degli altri paesi vengono corrette in base alla quota petrolifera ([128]) e al moltiplicatore di risorse ([136]).

### Livello di belligeranza / quota di PIL alla difesa (`FUN_b2e8_0dc6`, overlay 35: passo 4, "Calculating peace levels")

È il passo "peace levels". Il livello di pace [145] viene solo riportato in [1,6]; il passo calcola invece la **belligeranza** [153–165]. L'IA usa direttamente questo valore come percentuale del PIL da spendere per la difesa. Prima di vedere chi lo usava l'avevo interpretato come "disordini sociali".

Per ogni paese:
```
peace   = clamp(COUNTRY[145], 1, 6)
ethic   = clamp(NUMBERS[0x30], 1, 6);  NUMBERS[0x35] (ambition) = clamp(…, 1, 6)
d2 ← d1; d1 ← d0
d0 = (d1 + T[int(peace + 0.5)][int(ethic + 0.5)]) / 2      # 0 se COUNTRY[16] == 0
avg3 = (d0 + d1 + d2) / 3                                   # → spesa militare = PIL·avg3/100
```
`T` = quota % del PIL che un paese "vuole" spendere per la difesa (7×7, riga = pace, colonna = etica; costanti in DGROUP 0x6E38–0x6FB4). Un paese spietato in guerra spende il 41%, una democrazia in pace il 2–3%:
```
        e0    e1    e2    e3    e4    e5    e6
p0    50.0  45.0  45.0  40.0  40.0  30.0  50.0
p1    50.0  41.0  25.0  17.0  12.7   9.3   8.0
p2    30.0  20.0  15.0  11.0   8.5   6.5   5.5
p3    20.0  13.0  10.0   7.7   6.0   4.5   3.7
p4    15.0   9.5   8.0   5.7   4.3   3.0   2.4
p5    12.0   7.3   6.0   4.3   3.1   2.0   1.4
p6    10.0   6.0   4.6   3.3   2.5   1.3   0.6
```
Verifica: la formula riproduce esattamente `d0` per 93 paesi su 165 negli scenari di partenza. Gli altri sono stati ritoccati a mano dagli autori o modificati da eventi.

## Altri file

- `TEXT.FIL` (920 KB): testo del Factbook 1990 compresso (schema tipo LZ). Non serve decomprimerlo: lo stesso testo è su Gutenberg.
- Dimensioni dei record (file / 168 paesi): `STRATEGY` 160 byte, `ASSET` 180, `NUMBERS` 61, `MORENUMS` 31. `CONTIG.FIL` contiene le confinanze, usate da `Threat_Anxiety_Calcs`. `TROOPS` e `CONFLICT` sono decodificati sopra. Restano da completare `REGION` (in parte sopra) e da analizzare `DAMAGE` (1344 byte, tutti zero negli scenari) e `FALLFLAG` (336 byte = 168 × 2, tutti zero: probabilmente i flag di ricaduta nucleare per paese).
- `BIGTABLE.TXT`: 28 righe × 6 colonne di pesi (probabilmente tabelle di reazione per livello di tensione).
- `*.PCX`/`*.PCC`: grafica; `*.SND`: audio. Asset protetti da copyright: non vanno riusati nel nuovo gioco.

Estrattore: `tools/sp_extract.py`.
