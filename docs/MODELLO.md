# Il modello di simulazione: sintesi per il nuovo gioco

Questo documento riassume il modello di simulazione del gioco originale (Shadow President, 1993), ricostruito con il reverse engineering, e indica come portarlo nel nuovo gioco.

L'originale serve solo da riferimento per le regole; nome, testi, grafica e suoni del nuovo gioco saranno originali. Il nuovo gioco sarà interamente in italiano. I dettagli tecnici (offset, funzioni, codice) sono in [`re/FORMATS.md`](../re/FORMATS.md); qui c'è il modello a livello di progetto.

Legenda della verifica:
- **✓** formula riprodotta esattamente sui sei scenari salvati del gioco;
- **≈** riprodotta in gran parte, con scarti spiegati (dati ritoccati a mano dagli autori, ordine dei passi);
- **◇** ricostruita dal codice ma non verificabile sui dati.

---

## 1. Struttura generale

Il mondo è fatto di **168 paesi** (165 attivi nel 1990), **17 regioni** che si sovrappongono e uno **stato mondiale** con totali, massimi e classifiche. Il giocatore guida gli Stati Uniti; tutti gli altri paesi sono IA.

Il tempo è un orologio in secondi. Il gioco avanza su tre scale:

| scala | cosa succede |
|---|---|
| **istante** (coda degli eventi) | azioni dei paesi, avvisi, eventi sociali, conseguenze nucleari, popolarità: ogni evento ha data, tipo, codice, chi agisce e il bersaglio |
| **fine mese** | economia USA, oscillazione della leadership, malcontento sociale, generazione degli eventi sociali |
| **fine anno** | 15 passi: crescita, informazioni mondiali, coalizioni, belligeranza, orientamento, regioni, World Team, commercio, bilanci, aiuti, spie, somma degli aiuti, ansie, controllo degli eventi |

Il modello è **deterministico, a parte i dadi**: tutto il caso passa per un solo generatore `rand(a,b)`. Con un seme fisso il nuovo gioco può essere riproducibile.

## 2. Lo stato di un paese

I nomi ufficiali tra parentesi vengono dal visualizzatore di debug interno all'originale.

**Economia**
- PIL (*Economic Power* = PIL/10⁵), crescita del PIL, popolazione e sua crescita;
- PIL pro capite, qualità della vita (*QOL*);
- spesa sociale, quote di PIL per istruzione e investimenti;
- riserve petrolifere (% mondiale), riserve strategiche.

**Forza**
- forza armata (truppe), spesa militare, *Military Capital* (qualità), potere militare = qualità × truppe;
- spesa nucleare, potere nucleare, livello nucleare 0–6, testate.

**Peso nel mondo**
- quote mondiali: militare, economica, nucleare;
- influenza totale (*TI*) e quelle regionali (*TRI*, *RMI*, *REI*);
- valore strategico (*Stratval*).

**Governo e società**
- ideologia (12 tipi), etica (1–6), ambizione (1–6);
- **LER**, l'efficacia della leadership (0–1);
- repressione (*Police State*, 0–4), malcontento (*Social Outcry*, 0–100);
- livello di pace (*Net Peace*, 1 guerra … 6 pace), belligeranza (% del PIL che il paese vuole spendere in difesa, media su 3 anni).

**Politica estera**
- orientamento (1 allineato al blocco dominante … 8 ostile);
- World Team (squadra di alleanza) e appartenenza alla coalizione mondiale;
- livello commerciale con ciascun donatore (1 bloccato … 4 nazione più favorita).

**Paure e bisogni**
- cinque **ansie** (nucleare, militare, politica, economica, sociale; 0–100);
- cinque **bisogni d'aiuto** (umanitario, economico, intelligence, militare, nucleare).

**Intelligence e aiuti**
- bilancio dell'intelligence e le sue parti: azioni coperte, aiuti all'intelligence, insurrezioni all'estero, spionaggio interno ed estero;
- bilanci d'aiuto per tipo;
- per ciascuno dei 15 donatori: aiuti ricevuti per tipo e spie presenti.

**Lo stato del mondo**
- totali (PIL, popolazione, potere militare e nucleare) e massimi (PIL pro capite, spesa militare e nucleare, crescita);
- livello di pace mondiale;
- coalizione mondiale, leader dei World Team, classifica delle ideologie, i 15 donatori.

Ogni regione tiene le stesse cose in piccolo: somme, medie, massimi, coalizione regionale, pace regionale.

## 3. I sistemi

### 3.1 Economia e crescita (fine anno, passo 1) ≈

- Il PIL cresce al proprio tasso; la popolazione pure.
- Ogni crescita sopra il 5% viene smorzata: ×0,2 sopra il 100%, ×0,3 sopra il 50%, altrimenti ×0,5, con un minimo del 5%. La crescita del PIL non scende sotto −15%.
- Gli aiuti economici ricevuti si sottraggono dalla base su cui si calcola la crescita.

Nel corso dell'anno la crescita cambia solo per eventi, azioni e (per gli USA) il bilancio.

### 3.2 Forza militare e nucleare ≈

- Spesa militare IA = PIL × belligeranza media / 100.
- Qualità = √(10·(spesa/truppe)/media mondiale); potere = qualità × truppe.
- Spesa nucleare = spesa militare × ambizione × 0,0027 × (livello nucleare + 1), ma zero per i paesi poco belligeranti.
- Potere nucleare = spesa nucleare / spesa militare × potere militare.

**Belligeranza** ✓: `(belligeranza precedente + T[pace][etica]) / 2`. La tabella 7×7 va dal 41% del PIL (spietato in guerra) allo 0,6% (onesto in pace).

### 3.3 Influenza e pace mondiale ✓

- Influenza = p_mil·quota militare + p_eco·quota economica.
- I pesi dipendono dalla pace mondiale: in guerra conta solo la forza (1/0), in piena pace soprattutto l'economia (0,1/0,9).
- Pace mondiale = Σ pace × influenza/100, in [1,6]; nel 1990 vale 3,92.
- Valore strategico = 5·[campo 144] + 100·riserve strategiche·(1 + influenza/10) − 100.

### 3.4 Coalizioni e World Team ✓

**Coalizione mondiale.** Le grandi potenze (quota militare ≥ 5%) formano la **coalizione minima vincente**: un egemone se supera il 50%, altrimenti la combinazione più piccola fra il 50% e il 65%. Nel 1990 sono USA + Cina.

**Regioni.** Lo stesso algoritmo vale per ogni regione, sull'influenza regionale (≥ 5%). L'influenza regionale usa pesi propri che dipendono dalla pace regionale: da 1/0 in guerra a 0,3/0,7.

**World Team.** I leader (quota militare o influenza ≥ 5%) si raggruppano per orientamento e ideologia. Gli altri paesi si uniscono a caso, con probabilità proporzionale all'influenza del leader.

### 3.5 Orientamento e relazioni ✓

**Orientamento.** Il gioco classifica le 12 ideologie per influenza totale. L'orientamento di un paese dipende dal posto della sua ideologia in classifica e dall'amicizia o inimicizia con quella dominante (tabella fissa), più alcune correzioni scritte a mano per singoli paesi.

**Relazione fra due paesi** (1 inimicizia … 7 armonia di interessi).
- Dipende da coalizione, squadra, influenza, etica e differenza di orientamento.
- Bonus per la stessa ideologia e per la coppia USA–Israele; malus per l'imperialismo.
- **Rivalità storiche scritte a mano**: India–Pakistan, Cina–Vietnam, Cina–India, Grecia–Turchia.

### 3.6 Ansie e bisogni (passo 13) ✓

Ogni paese confronta la propria situazione con un riferimento misto mondo/regione. Il peso dipende dalla taglia: le grandi potenze guardano al mondo per l'80%, i piccoli soprattutto alla regione.

| ansia | cosa la fa salire |
|---|---|
| nucleare | testate delle squadre rivali (per i leader); altrimenti ambizione, guerra, pochi armamenti propri, vicini nucleari (×3 senza squadra) |
| militare | quota militare piccola rispetto alla regione, guerra, ambizione |
| politica | LER basso, ambizione, repressione, guerra |
| economica | PIL pro capite e crescita sotto il riferimento |
| sociale | crescita demografica alta, repressione, ambizione, economia ferma |

I **bisogni d'aiuto** misurano quanto manca per arrivare al riferimento, moltiplicato per l'ansia corrispondente.

### 3.7 Aiuti esteri (passi 9, 10, 12) ✓/≈

- I **15 donatori** sono una lista fissa nello scenario.
- **Distribuzione:** ogni anno un donatore IA ridistribuisce tutto, ai paesi più poveri della metà e non nemici. Il 75% va agli alleati della propria squadra, il 25% ai paesi della stessa squadra o senza squadra. La quota di ciascuno è proporzionale al valore strategico, fino a coprire il bisogno.
- **Condizioni:** aiuti militari solo a orientamenti vicini; aiuti nucleari solo da potenze nucleari ambiziose a paesi meno armati.
- **Effetti degli aiuti ricevuti:**
  - economici → PIL;
  - umanitari → PIL pro capite e spesa sociale;
  - militari → spesa militare;
  - nucleari → spesa nucleare;
  - intelligence → spionaggio interno.

### 3.8 Commercio (passo 8) ✓

Il livello commerciale verso ogni donatore si ricalcola ogni anno dalle squadre: 4 se stessa squadra, 3 se una sola delle due ha una squadra, 2 se squadre diverse. Le misure commerciali scelte durante l'anno vengono quindi cancellate.

### 3.9 Bilanci (passo 9) ≈

Per ogni paese IA:
- bilancio dell'intelligence = 2% del PIL / media(pace, etica, 7 − ambizione);
- le sue parti: azioni coperte, aiuti all'intelligence (cresce con l'ambizione), insurrezioni, spionaggio interno, spionaggio all'estero (il resto);
- bilanci d'aiuto militari, economici, umanitari e nucleari, dalla spesa militare e dal PIL.

Ricevono i fondi per azioni coperte, insurrezioni e aiuti all'intelligence solo i paesi ricchi (PIL pro capite ≥ 4000 $) o influenti (almeno quanto il 15° donatore).

### 3.10 Spionaggio (passo 11) ≈

- I fondi per lo spionaggio all'estero si distribuiscono in proporzione al valore strategico dei paesi.
- Chi è in una squadra spia circa 3 volte di più le squadre rivali.
- La **posizione d'intelligence netta** di un paese è lo spionaggio interno meno le spie straniere che ospita.

### 3.11 Leadership, malcontento e cambio di regime (fine mese) ✓/◇

- **Repressione** = (5 − 0,9·etica)·3 / etica del leader dell'ideologia dominante, in [0,4]. ✓
- **Malcontento** = 25·repressione·min(3704/PIL pro capite, 1)·(0,03/(crescita + 0,002))². In pratica: povertà, repressione ed economia ferma. ✓
- **Eventi sociali:** con malcontento alto parte uno di dieci stadi (riunioni di protesta, dichiarazioni, manifestazioni, manifestazioni di massa, rivolte, attentato, violenza organizzata, insurrezione, colpo di stato, guerra civile). La tabella delle probabilità dipende dalla repressione. ◇
- **Esito:**
  - l'evento avviene o viene represso, secondo LER, repressione, etica, stadio e ansia sociale;
  - se avviene, il LER cala;
  - dalle manifestazioni di massa in su può seguire un **cambio di regime**: nuova ideologia e nuova etica nell'intervallo tipico dell'ideologia.
- **Recupero:** il LER risale lentamente se è sotto 0,5.

### 3.12 Azioni e probabilità ◇

Il catalogo comprende **26 azioni**, in cinque gruppi:
- **diplomatiche:** riforme, diritti umani, inviato di pace, scambio culturale, relazioni, legami economici, condanna, investimenti;
- **commerciali:** nazione più favorita … blocco;
- **coperte:** armi ai ribelli, spionaggio, sabotaggio, colpo di stato, assassinio;
- **militari:** negoziato di pace, pressioni sulla spesa militare, attacco chirurgico, invasione;
- **nucleari:** pressioni sulla spesa nucleare, attacco nucleare; più lo schieramento di truppe.

Ogni azione riesce se `rand(1,100)` resta sotto una soglia. La soglia dipende da diverse cose:
- affinità ideologica e relazione;
- leva economica: aiuti e investimenti del paese che agisce nel bersaglio, rispetto al PIL del bersaglio;
- divario d'influenza;
- ansie del bersaglio;
- LER: il tetto è 100 × LER, cioè il 50% all'inizio.

Le azioni coperte hanno un tetto fisso: sabotaggio 52%, colpo di stato 29%, assassinio 20,5%. Il commercio e l'invasione non tirano dadi: dipendono da requisiti (essere un donatore; avere truppe vicine o confini comuni).

Ogni azione riuscita sposta di poco la pace del bersaglio e di chi agisce (tra −20% e +10%), insieme a crescita, ambizione, etica e malcontento.

### 3.13 Eventi (coda) ◇

Oltre al tipo vuoto ci sono sei tipi di evento: azione IA, azione del giocatore (eseguita in differita), evento sociale, popolarità, conseguenze nucleari, avviso CIA. Gli scenari sono **sceneggiature scritte come eventi in coda**: per esempio la crisi del Golfo del 1990 con condanne, avvisi CIA e invasione del Kuwait il 2 agosto.

### 3.14 Guerra ◇

- I due lati sommano truppe, riserve, spesa e mobilitabili, e fanno la media di LER, ambizione e repressione. Chi difende in casa ha un piccolo vantaggio.
- **Potenza** = LER × ambizione × (truppe × spesa per soldato) × (1 − repressione/20).
- **Ogni tick:**
  1. il rapporto fra le potenze sceglie una riga nelle tabelle delle perdite;
  2. il gioco calcola morti militari e civili e il calo della forza %;
  3. il PIL del paese teatro perde lo 0,33% o il 2%;
  4. la leadership migliore infligge perdite extra.
- **Uscita:**
  - resa, quando la forza crolla;
  - annessione, se perdono i difensori;
  - escalation nucleare, se chi perde ha armi nucleari, ambizione alta e pace bassa.
- **Fine della guerra:** il teatro e i territori coinvolti restano belligeranti (pace 2,5–3), gli altri partecipanti tornano verso la pace.

### 3.15 Conseguenze nucleari ≈

Un attacco nucleare apre una sequenza di tre fasi:
1. **ricaduta regionale:** pace ×0,5 ed economia ×0,75 nella regione;
2. **spostamento delle alleanze;**
3. **effetti su tutti i paesi:** pace ×0,5, economia ×0,85, popolazione ×0,95, ansie nucleare e militare al massimo.

### 3.16 Il giocatore: bilancio USA e popolarità ≈

**Il bilancio.** Il giocatore regola quattro imposte (persone, società, vendite, dazi) e quattro spese (difesa, programmi sociali, assistenza estera, ricerca).
- Il gettito dipende dal PIL, dai profitti delle società e dalle importazioni.
- Il saldo si accumula nel debito.
- La **valutazione** calcola obiettivi di crescita, profitti, importazioni e popolarità, e l'economia vi converge in 12 mesi. Alzare le tasse pesa più che abbassarle.
- La difesa fissa anche gli aiuti esteri militari, nucleari e d'intelligence; l'assistenza estera quelli economici e umanitari.

**La popolarità.** Scende con le crisi, la crescita bassa e le guerre perse; sale con i successi.

**La fine della partita.** Arriva con l'assassinio del presidente, la destituzione (colpo di stato o insurrezione) o la guerra civile negli USA.

## 4. Difetti e stranezze dell'originale

Da correggere, o da tenere solo come scelta voluta:

| difetto | effetto |
|---|---|
| bonus di popolarità per crescita > 3% confrontato con `3` invece di `0,03` | non scatta mai |
| aiuto assegnato `x − richiesta` invece della richiesta quando la quota supera il bisogno | aiuti sballati per i paesi con bisogni piccoli |
| saldo del bilancio USA mai positivo | gli avanzi spariscono |
| commercio ricalcolato ogni anno dalle squadre | le misure commerciali del giocatore durano un anno |
| il campo `LastEconDif` viene scritto prima del ricalcolo | contiene il valore del paese precedente |
| scenari con pace e coalizioni regionali ritoccati a mano | i dati salvati non rispettano le formule |
| eccezioni per singoli paesi nel codice (Francia, Arabia Saudita, USA–Israele, URSS al 33%, rivalità) | il modello non è generale |
| tabella degli eventi sociali con la riga di repressione 4 irregolare | probabilmente un errore di inserimento |
| alcune scale capovolte rispetto al manuale (etica, relazione) | confusione nell'interfaccia |

## 5. I dati 1990–2026

Il database [`data/worldbook.sqlite`](../data/worldbook.sqlite) contiene 37 edizioni del CIA World Factbook, con 33 indicatori e le successioni fra stati (URSS, Jugoslavia, Cecoslovacchia, le due Germanie, i due Yemen…).

| campo del modello | fonte |
|---|---|
| popolazione, crescita della popolazione | `population`, `pop_growth_pct` |
| PIL, crescita, PIL pro capite | `gdp_usd`, `gdp_growth_pct`, `gdp_per_capita_usd` |
| bilancio (entrate/uscite), debito | `budget_revenues_usd`, `budget_expenditures_usd`, `public_debt_pct_gdp`, `external_debt_usd` |
| commercio | `exports_usd`, `imports_usd` |
| spesa militare, truppe | `military_exp_usd`, `military_exp_pct`, `military_personnel`, `military_manpower_fit` |
| petrolio (riserve → quota mondiale) | `oil_production_bbl_day` (approssimazione) |
| qualità della vita (componenti) | `life_exp`, `infant_mortality`, `literacy_pct`, `unemployment_pct`, `inflation_pct` |
| modernità (nuova dimensione) | `internet_users`, `electricity_production_kwh` |

Mancano nel Factbook, e vanno **derivati o generati**:
- ideologia, etica, ambizione, repressione: da una classificazione dei regimi, oppure procedurali con una deriva;
- testate e livello nucleare: tabella storica esterna;
- squadre, coalizioni, relazioni, orientamento: si calcolano già dal modello;
- regioni e confini: da costruire una volta, in modo simile a `REGIONS.DAT` e `CONTIG.FIL`.

## 6. Indicazioni per il nuovo gioco

**Da tenere**
- La catena **economia → forza → influenza → pace mondiale → pesi dell'influenza**. È il cuore elegante del modello: in un mondo in pace conta l'economia, in guerra la forza.
- Le **coalizioni minime vincenti**, mondiali e regionali, e i **World Team**: danno al mondo una struttura che si riorganizza da sola.
- **Ansie → bisogni → aiuti → crescita e stabilità**: rende sensato l'aiuto estero.
- **LER come risorsa di governo**: limita le azioni, cala con i disordini, si recupera lentamente.
- **Malcontento → eventi sociali a stadi → cambio di regime**: produce storia in modo procedurale.
- La coda degli eventi con timestamp e le "sceneggiature" degli scenari.

**Da cambiare**
- **Generalità.** Togliere le eccezioni per singoli paesi (rivalità, Francia, Israele, URSS al 33%). Sostituirle con dati, per esempio una matrice di rivalità storica caricata dallo scenario, e con regole valide per tutti.
- **Donatori dinamici.** I 15 donatori diventano i primi N paesi per PIL o influenza, ricalcolati ogni anno.
- **Qualunque paese giocabile.** Il bilancio "alla USA" diventa un modello di bilancio pubblico generale, con dati Factbook (entrate, spese, debito), e il giocatore può guidare qualunque paese.
- **Scale coerenti.** Una sola convenzione per etica (alta = onesta), relazione (alta = amicizia) e percentuali.
- **Correggere i difetti** della sezione 4, conservando come opzione "classica" solo quelli che danno carattere al gioco.
- **Casualità con seme.** Il seme di partita va salvato, così ogni simulazione è ripetibile e verificabile.
- **Partenza da qualunque anno 1990–2026.** Stato iniziale dal Factbook di quell'anno. Le grandezze del modello senza dato (etica, ambizione, LER, ansie) vanno inizializzate facendo girare il modello per qualche anno "a vuoto" fino all'equilibrio.
- **Deriva procedurale.** Dopo l'avvio il mondo diverge dalla storia reale secondo le regole, senza copioni fissi; le sceneggiature storiche diventano opzionali.
- **Interfaccia e testi originali, in italiano**: nomi dei campi, consiglieri, eventi e messaggi riscritti da capo.

**Stato del nuovo gioco (15/11/2026)**
Il ciclo di gioco gira in `packages/core` (classe `Simulation`): i sistemi delle sezioni 3.1–3.11 sono portati e testati, quelli ✓ contro gli scenari originali. Le azioni (3.12) sono portate in `systems/actions.ts`: le soglie coincidono con `tools/sp_odds.py` su quattro coppie dello scenario 1990 (test di accettazione), e gli effetti sulla pace sono quelli estratti dagli esecutori. Alcuni effetti secondari non documentati sono scelte nostre, marcate nel codice:
- riforma sociale: malcontento ×0,9;
- condanna: LER del bersaglio −0,02;
- investimenti: crescita +0,2 punti;
- armi ai ribelli: malcontento +10;
- sabotaggio: PIL ×0,99;
- assassinio: LER del nuovo capo 0,5;
- pressioni sulla spesa militare e nucleare: spesa ×0,9 o ×1,1;
- attacco chirurgico: qualità militare ×0,9.

Il colpo di stato riuscito usa il cambio di regime degli eventi sociali. Negoziato, invasione e attacco nucleare aspettano il modulo guerra; lo spionaggio costa per ora 50 M$ fissi, senza bilancio del giocatore. L'azione del giocatore si esegue subito, non in differita come nell'originale.

Il turno dei paesi IA è in `systems/ai.ts`. Viene da `FUN_b442_0000` (overlay 36), che legge `BIGTABLE.TXT`: 28 righe, una per codice d'azione, e 6 colonne di ostilità; in ogni colonna i pesi di ciascun gruppo sommano a 100.

- **Chi agisce.** Tre fasi:
  1. un donatore, scelto se `rand(1,100) ≤ 2·ambizione + 10`;
  2. se `rand(1,6) ≥ pace mondiale`, un paese influente di una regione agitata;
  3. con la stessa condizione, un leader di squadra.
- **Bersaglio.** Le grandi potenze cercano in una regione agitata, le medie nella regione di casa, le minori fra i vicini; si preferiscono i paesi di valore strategico alto.
- **Azione.** Con l'etica si sceglie uno di 5 gruppi, con pace mondiale e relazione la colonna, con i pesi di BIGTABLE l'azione dentro il gruppo. Un ramo "fuori tabella" (`rand(1,7) < etica`) pesca fra sabotaggio, assassinio e azioni nucleari.
- **Correzioni dopo la scelta.** 5 e 23 spostano il livello commerciale di un passo; l'attacco nucleare senza livello nucleare 4 diventa un assassinio; gli attacchi contro un paese più forte diventano armi ai ribelli.
- **Esecuzione.** Dopo `rand(0,23)` ore più `rand(0,2)` giorni.

**Quirk importante.** L'IA legge al contrario tre scale:
- la relazione, trattata come il "Country Interaction Mood" del manuale (7 = inimicizia);
- l'etica, trattata come spietatezza;
- la pace mondiale nella tabella delle colonne: un mondo in pace (6) sceglie le colonne più ostili, mentre nel resto del gioco 1 è il mondo in subbuglio (l'atomica porta la pace a 1, e con pace bassa agiscono più paesi).

Così gli alleati si condannano e si invadono, e i paesi etici prendono più spesso il ramo estremo. `rules.ai.originalScales = false` (predefinito) capovolge le tre scale; `true` riproduce l'originale. La tabella dei gruppi per etica ha 6 righe ma l'originale la indicizza con l'etica 1–6, e la 6 cade fuori: con le scale corrette la riga è spietatezza − 1 (◇).

**Taratura (◇, novembre 2026).** `npm run taratura` (`tools/taratura_ia.ts`) simula molte partite senza interfaccia, con un giocatore automatico che non reagisce, respinge le proposte e alla resa mobilita. Conta azioni IA per tipo ed esito, guerre, annessioni, atomiche, allerte, cambi di regime, pause per il giocatore, PIL e paesi rimasti. Le opzioni (anni, durata, semi, deriva, regole da sovrascrivere) passano nella variabile `TARATURA`.

Prima della taratura, in 8 partite di 10 anni per anno di partenza:
- nel 2026 c'erano 3–4 attacchi atomici a partita e il PIL mondiale finiva a ×0,54;
- nel 2008 la Cina annetteva in media 5 paesi a partita (Germania, Brasile, Messico, Iran);
- il Regno Unito annetteva l'Irlanda, l'Italia San Marino e l'Austria, la Francia il Lussemburgo.

Le atomiche venivano quasi tutte da guerre fra potenze nucleari (Cina–Russia, India–Cina), dove il ramo estremo sceglie l'azione 24 una volta su quattro. Le conquiste lontane venivano da `war.projectionShare`, che lasciava invadere ovunque la prima potenza militare dopo gli Stati Uniti. Le guerre fra europei nascevano dalla generazione: parte delle democrazie parlamentari ricche diventa socialismo democratico (C), che nelle tabelle originali non è amico del capitalismo democratico (A).

Regole aggiunte, tutte in `rules.ai` e disattivabili:
- **`nuclearOnlyWhenLosing`:** anche in guerra l'IA lancia per prima solo se il suo lato è sotto il 50% di forza; altrimenti minaccia;
- **`nuclearDeterrence`:** nessuno invade un paese con livello nucleare ≥ 4 e testate; al posto dell'invasione, esercitazioni militari al confine;
- **`projectionNeedsTroops`:** oltre i confini l'IA invade solo dove ha truppe schierate vicino al bersaglio, come l'originale che legge i contingenti TROOPS; la soglia `war.projectionShare` vale ora solo per il giocatore;
- **`friendlyRestraint`:** niente attacchi chirurgici né invasioni contro un paese amico (relazione ≥ 5);
- **`democraticPeace`:** due paesi con ideologia democratica (A, C, E, K) non si attaccano né si invadono;
- **`nuclearAlertMaxRelation`** (1): l'allerta nucleare, cioè l'atomica trattenuta, scatta solo fra nemici; altrimenti l'azione cade;
- **`rogueDie`** (7, come l'originale): il dado del ramo fuori tabella. Provato a 10 e 14, cambia poco: le operazioni coperte vengono soprattutto da BIGTABLE.

Dopo la taratura (8 partite di 10 anni, deriva 0, valori per anno):

| partenza | guerre | annessioni | atomiche | allerte | PIL dopo 10 anni | allarmi / proposte al giocatore |
|---|---|---|---|---|---|---|
| 1990 | 0,42 | 0,14 | 0 | 4,6 | ×1,33 | 2,5 / 5,5 |
| 2008 | 0,07 | 0,01 | 0 | 1,0 | ×1,28 | 0,7 / 0,7 |
| 2026 | 0,39 | 0,16 | 0,01 | 1,7 | ×1,34 | 2,5 / 0,8 |

Su partite di 20 anni e con deriva 0,35 o 1 i valori restano simili, e il PIL mondiale circa raddoppia. Il 2008 è quieto perché parte con la pace mondiale più alta. Le azioni IA restano in maggioranza operazioni coperte (45–60%), quasi sempre fallite: è la tabella originale, e non l'ho toccata.

Parti incerte, da rivedere (◇):
- la frequenza del turno (7 giorni, scelta nostra: il ciclo principale che chiama la funzione non è decifrato);
- la scelta della regione nella fase 1, dove uso la pace regionale al posto di un valore per regione non identificato;
- il senso delle correzioni 5 e 23.

Il giocatore non è mai bersaglio, perché nell'originale decide lui l'esito e quella finestra non c'è ancora. L'invasione dà solo la notizia di manovre militari; negoziato e attacco nucleare restano senza effetto fino al modulo guerra.

La reazione del giocatore è in `systems/reaction.ts`. In una partita interattiva (`interactive: true`) le azioni IA possono prendere di mira gli Stati Uniti e il tempo si ferma in due casi:
- **prima di un attacco chirurgico o di un'invasione**, ovunque nel mondo: il giocatore sceglie fra nessuna reazione, protesta, sanzioni ONU, tagli commerciali, minaccia militare e minaccia nucleare. Se la reazione riesce, l'azione non avviene. Soglie ed effetti sono in `re/FORMATS.md`;
- **quando un paese propone agli USA un'azione diplomatica o economica** (codici 0–5, 7, 18, 19, 22, 23): il giocatore accetta o respinge, come nell'originale dove la soglia diventa 101 o 0.

Le azioni ostili contro gli USA (condanne, operazioni coperte) tirano i dadi normalmente.

Restano fuori:
- la ritorsione nucleare dopo una minaccia (`rand(1,100) ≤ ambizione`), finché non c'è il modulo nucleare;
- alcuni ritocchi a campi non identificati nel ramo nucleare;
- la condanna dell'aggressore dopo sanzioni riuscite;
- il fattore c dei tagli commerciali, non letto: uso 25.

La guerra (3.14) è in `systems/war.ts`. Composizione dei lati, potenza, rumore sul rapporto, righe e tabelle delle perdite, civili, danni al PIL, perdite da leadership, resa e annessione seguono `re/FORMATS.md`. Il tick è giornaliero (scelta nostra: la frequenza dell'originale non è decifrata).

Scelte nostre (◇), dove l'originale non è decifrato:
- **fattibilità dell'invasione:** serve un confine comune, oppure chi attacca deve avere una quota militare ≥ 15 (oggi solo gli Stati Uniti). L'originale legge i contingenti TROOPS, che non ricostruiamo;
- **truppe impegnate:** chi attacca impegna metà delle sue truppe, chi difende tutte;
- **un fronte alla volta per paese:** chi è in guerra non apre né subisce altre invasioni;
- **negoziato di pace:** soglia `min(100·LER, 10 + 10·relazione + (100 − forza minore)/2)`.

Annessione: PIL, spesa militare e popolazione passano al conquistatore, che il paese conquistato riconosce come governo (`controlledBy`). Sulla carta il territorio prende il colore del conquistatore.

In tre anni del 2026 l'IA apre qualche guerra l'anno fra vicini; finiscono in vittorie, invasioni respinte e paci negoziate, e durano da pochi giorni a più di un anno. Restano fuori l'escalation nucleare (`rand(1,6) < ambizione` e `rand(1,6) > pace` per chi ha livello nucleare ≥ 4 e forza < 50%), gli alleati che entrano in guerra, lo schieramento di truppe (codice 25) e la decisione del giocatore quando il teatro sono gli Stati Uniti.

Il Factbook scriveva le truppe a volte come intervalli ("1.1-1.2 million", "40-50,000"). Il parser ora prende l'estremo inferiore con l'unità del secondo, come faceva il gioco originale con la forza lavoro; prima la Russia del 2026 risultava con 1,1 soldati. Nel 1990 e nel 2008 il Factbook non dà le truppe e resta la stima dello 0,3% della popolazione.

Le armi nucleari (3.15) sono in `systems/nuclear.ts`. Servono livello nucleare ≥ 1 e almeno una testata; ogni attacco ne consuma una (scelta nostra). Un attacco ha tre livelli di effetti:
- **diretto:** pace mondiale 1, malcontento e ansie militare e nucleare al massimo per i due paesi;
- **ricaduta sulla regione del bersaglio:** economia ×0,75, pace ×0,5, popolazione ×0,95, militare ×0,8 e il resto della tabella;
- **effetti su tutto il mondo:** economia ×0,85, pace ×0,5, popolazione ×0,95.

Poi il bersaglio mette in coda condanna, sabotaggio e assassinio contro l'attaccante, e si arriva all'atomica anche in altri due modi:
- **escalation in guerra:** il lato sotto il 50% di forza, se ha livello nucleare ≥ 4, colpisce quando `rand(1,6) < ambizione` e `rand(1,6) > pace`;
- **risposta a una minaccia:** dopo una minaccia militare o nucleare del giocatore, l'aggressore lo colpisce se `rand(1,100) ≤ ambizione`.

Scelte nostre (◇):
- le tre fasi valgono per ogni attacco, non solo per quelli del giocatore, e sono immediate;
- lo spostamento delle alleanze (fase 1) è lasciato alla ricomposizione annuale delle squadre;
- **`rules.ai.nuclearOnlyAtWar`** (attivo): fuori da una guerra contro il bersaglio l'IA non lancia, ma dà un'allerta nucleare. Senza questo freno, con il turno settimanale, le potenze nucleari sceglievano l'azione 24 una decina di volte l'anno e in cinque anni azzeravano il PIL mondiale. Con il solo freno restavano 3–4 attacchi a partita in dieci anni, tutti in guerre fra potenze nucleari; con la taratura dell'IA (sopra) sono quasi spariti.

Il bilancio del giocatore (3.16) è in `systems/budget.ts`. Segue la valutazione di `FUN_5f0c_1842`, l'applicazione di fine anno e il mese di `FUN_5f0c_308e`. Valori iniziali:
- l'aliquota sulle persone è quella che fa tornare le entrate del Factbook (per il 2026: 4,9 T$ di entrate, 6,9 T$ di uscite, aliquota 18,2%);
- la difesa è la spesa militare, gli aiuti esteri sono quelli calcolati per gli USA, la ricerca è il 3% delle uscite e i programmi sociali il resto;
- profitti 10% e importazioni 12% del PIL, debito pari al 60% del PIL, popolarità 55%.

Scelte nostre (◇):
- le costanti in dollari del 1990 diventano rapporti con i valori iniziali della partita: aiuti / aiuti iniziali, ricerca / ricerca dell'anno prima, (saldo/PIL − saldo/PIL iniziale)/1,92;
- l'effetto dei dazi sulla popolarità, che non è decifrato, vale 0;
- il calo mensile per crescita sotto il 3% è `(crescita − 0,03)·50` punti per cento invece che un fattore, altrimenti la popolarità si dimezzerebbe ogni mese;
- la popolarità per azione: l'invasione segue l'originale (stessa ideologia `−(infl + 4)·pace mondiale`, al massimo −40; amico la metà). Le altre azioni sono stime: atomica −30, azioni ostili verso amici −3, diplomazia +0,5;
- la vittoria in guerra vale +10 (originale), la sconfitta −10.

L'originale punisce i tagli molto più degli aumenti: tagliare del 10% la spesa sociale porta la popolarità attesa da 55 a 7, mentre la crescita attesa sale al 4%. Lo lascio così. Senza shock, il bilancio invariato tiene crescita e popolarità stabili per anni; un crollo del PIL (per esempio una guerra nucleare) invece allarga il deficit e frena ancora la crescita, finché il giocatore non taglia la spesa.

Il mandato è in `systems/term.ts`:
- **elezioni:** ogni quattro anni dal 1988, il primo martedì dopo il primo lunedì di novembre (l'originale cerca il primo martedì dal 1° novembre: differisce solo quando il 1° novembre è un martedì). Con popolarità ≥ 50 si vince, sotto 40 si perde, in mezzo si vince con probabilità `(popolarità − 40)·10` %. Dopo 25 mandati la partita è vinta. Le elezioni si possono disattivare (`elections: false`), come nel menu della simulazione dell'originale;
- **impopolarità:** sotto il 15% di popolarità, ogni mese (◇ la frequenza dell'originale non è nota), il presidente cade con probabilità `100 − 3·popolarità` %, assassinato o destituito secondo un secondo tiro contro `15·LER + popolarità + 5` (◇ LER al posto di una variabile non identificata).

I consiglieri sono in `systems/advisors.ts`. Ruoli e argomenti seguono il manuale dell'originale (sette consiglieri, ciascuno con il suo rapporto, più il parere sulle azioni del "Cabinet Briefing"), ma nomi, testi e criteri dei giudizi sono nostri:
- **rapporti:** il nucleo produce righe con chiave e numeri, e l'interfaccia le traduce dal catalogo italiano. Un test verifica che ogni chiave abbia il suo testo;
- **riunione di gabinetto:** un parere per consigliere, da −2 a +2.
  - La Segretaria di Stato guarda la coerenza con la politica estera (relazione e affinità ideologica).
  - Il Portavoce guarda la popolarità.
  - L'esperto del settore guarda la probabilità di riuscita: la Difesa per le azioni militari, la CIA per le operazioni coperte, l'Economia per commercio e investimenti.
  - Il Capo di gabinetto riassume, o mette in guardia quando la popolarità è sotto il 40%.

Il generatore di scenari parte da qualsiasi anno fra il 1990 e il 2026. Ha un seme del mondo e una deriva procedurale (`systems/drift.ts`, opzione `drift` di `worldFromPack`), che va da 0 (storica) a 1 (alternativa). In proporzione alla deriva cambiano:
- economia, popolazione ed eserciti (fattori log-normali);
- crescita, etica, ambizione, pace e LER;
- i regimi: nuova ideologia con probabilità 0,15·deriva per paese;
- gli arsenali: nuove potenze nucleari fra i paesi ricchi.

La deriva usa un flusso casuale separato, quindi con deriva 0 il mondo è identico a quello storico. Il giocatore è protetto: conserva ideologia e arsenale. Tutti i 37 anni si generano e reggono un anno di gioco (test). Partendo nel 1992 la recessione del 1991 fa perdere le elezioni di novembre, come nella storia vera.

Truppe all'estero e alleati sono in `systems/troops.ts`. Nell'originale (TROOPS, azione 25 `FUN_5db5_0000`) una guerra la combatte chi ha truppe sul teatro. Qui:
- **all'inizio:** i principali contingenti noti, da una tabella delle regole di generazione interpolata per anno, come per gli arsenali. Per esempio USA in Germania, Giappone e Corea del Sud, URSS nei paesi del Patto di Varsavia fino al ritiro, Turchia a Cipro;
- **schieramento (azione 25):** verso un amico (relazione ≥ 5) le truppe vanno nel paese; verso gli altri vanno in un vicino che le accetti, con il tiro dell'originale `33 + 5·ambizione` (◇ l'ambizione è del paese ospite). Arrivano dopo 7–21 giorni (◇). Prima di un ammassamento ostile il giocatore può reagire, come per attacchi e invasioni;
- **guerra:** chi ha truppe arrivate presso il bersaglio può invaderlo anche senza confine comune. I contingenti presenti nel paese invaso lo difendono, anche se arrivano a guerra iniziata, e le perdite si ripartiscono in proporzione alle truppe portate. A fine guerra i contingenti degli sconfitti si arrendono e i loro soldati sono perduti; gli altri tornano a casa;
- **difesa degli Stati Uniti:** quando cede, decide il giocatore, come nell'originale. Se si arrende, il paese viene annesso e la partita finisce; se ordina la mobilitazione generale (◇), il 2% della popolazione va al fronte, la forza torna al 60% e la popolarità perde 5 punti.

I disastri sono in `systems/disasters.ts` e seguono `FUN_9aba_0000` (tabelle in `re/FORMATS.md`): carestie, terremoti, alluvioni, disastri aerei ed esplosioni chimiche. Quelli provocati dall'uomo hanno un colpevole fra i paesi "canaglia", e prendono di mira volentieri gli Stati Uniti o i nemici del colpevole. Scelte nostre (◇):
- la frequenza: probabilità giornaliera 1/20, circa 18 disastri l'anno;
- i danni tolti subito al PIL;
- il malcontento che sale di 10·gravità;
- gli **aiuti d'emergenza** (azione 26, 50 M$): si possono mandare entro 60 giorni dal disastro. Riducono di 10 malcontento e ansia sociale, contano come aiuti umanitari e valgono un punto di popolarità.

I disastri si disattivano dalla schermata iniziale, come nell'originale.

`Simulation.load` migra i salvataggi delle versioni precedenti, aggiungendo i campi nati dopo (contingenti, disastri, contributi nelle guerre).

Mancano gli altri eventi (3.13), guerra (3.14), conseguenze nucleari (3.15) e il bilancio del giocatore (3.16). Il mondo costruito dal Factbook (`worldFromPack`) genera all'avvio, con un seme e le regole modificabili di `packages/data/src/generation.ts`, le grandezze che il Factbook non contiene:

- **ideologia**: prima regola che corrisponde al tipo di governo, con condizioni su quota musulmana, reddito pro capite (soglie in dollari 2026, deflazionate con un indice dei prezzi) e spesa militare; eccezioni per codice (Israele, Russia dal 2000, Bielorussia); i territori prendono l'ideologia di chi li amministra; il fascismo (D) non si assegna mai all'avvio;
- **etica**: centro dell'intervallo dell'ideologia ±1 casuale, +1 alle democrazie ricche, −1 ai regimi autoritari;
- **ambizione e pace**: dalla quota di PIL spesa per la difesa e dal livello nucleare;
- **LER**: 0,5 ± 0,1, un po' più alto nei regimi autoritari;
- **nucleare**: testate interpolate per anno da una tabella di stime pubbliche (anche Ucraina, Kazakistan e Bielorussia nei primi anni Novanta);
- **regioni**: 17 regioni da area geografica e coordinate (con eccezioni per codice: URSS e Russia in Europa orientale); i confinanti di un'altra regione ne diventano membri adiacenti, al massimo 4 regioni per paese; chi non ha un'area riconosciuta prende la regione del paese più vicino;
- **squadre**: dopo i leader, ogni paese aderisce con probabilità 0,6 a un leader di ideologia uguale o amica, con peso la radice dell'influenza, ×2 per la stessa ideologia e ×3 per una regione in comune.

Limiti noti: la spesa militare dell'URSS nel 1990 manca nel Factbook ed è fissata al 12% del PIL; le squadre risultano ancora molto sbilanciate verso gli Stati Uniti.

**Prossimi passi tecnici**
1. Scegliere motore e linguaggio (vedi README).
2. Scrivere il nucleo della simulazione come libreria testabile. Il primo test è riprodurre i risultati ✓ di questo documento sugli scenari originali, attraverso un modulo di conversione dei dati del 1990 che si usa solo durante lo sviluppo.
3. Costruire il generatore di scenari dal Factbook e le tabelle derivate (regioni, confini, ideologie).
