# Motore e linguaggio

**Decisione (15/11/2026): TypeScript + Canvas 2D, senza motore di gioco.** Il resto del documento è la proposta da cui è nata.

## Requisiti

Dal concept (conversazione Grok), dalla [sintesi del modello](MODELLO.md) e da quanto già deciso:

1. **Simulazione profonda e verificabile.** Il nucleo deve riprodurre esattamente le formule verificate sugli scenari originali, che usano numeri in virgola mobile a 64 e 32 bit, e deve essere testabile senza interfaccia.
2. **Determinismo.** Il caso deve passare da un generatore con seme salvato, così che le partite siano ripetibili.
3. **Estetica "486 + SVGA".** Risoluzione logica 640×480 con pixel netti, palette limitata ma più ampia della VGA, dithering, font bitmap, testo verde su nero. Lo schermo va scalato solo per multipli interi.
4. **Dati 1990–2026.** Il database Factbook in SQLite va convertito in pacchetti per anno.
5. **Personalizzabile in ogni forma.** Regole, tabelle, scenari, testi e grafica devono stare in file modificabili, non nel codice.
6. **Tutto in italiano**, con i testi in file separati.
7. **Piattaforme.** Su questa macchina ci sono Node 26, Godot 4.7, JDK 21 con l'Android SDK e Bubblewrap (che trasforma un'app web in un APK). Mancano Rust e .NET.

## Opzioni

| | **A. TypeScript + Canvas** | **B. Godot 4.7 (GDScript)** | **C. Kotlin (JVM/Android)** |
|---|---|---|---|
| Numeri come l'originale | `number` è f64; f32 esatto con `Math.fround` | float f64; f32 solo approssimabile | Double/Float nativi |
| Test del nucleo | Vitest, rapido, in riga di comando | GUT, dentro il motore | JUnit |
| Pixel art 640×480 | Canvas con scala intera: controllo totale, ma il rendering si scrive a mano | viewport 640×480 con stretch intero, già pronto | da scrivere (libGDX o Compose) |
| Interfaccia a finestre e pannelli | da costruire (semplice in stile retro) | nodi Control e temi | da costruire |
| Piattaforme | browser, desktop (PWA), Android con Bubblewrap già configurato | desktop, Android, web (export più pesante) | Android, desktop JVM |
| Mod | JSON e script caricabili senza ricompilare | risorse e script, ma legati all'editor | più rigido |
| Strumenti già installati | sì | sì | sì |
| Rischio | ci vuole disciplina per l'architettura dell'interfaccia | logica della simulazione accoppiata al motore; GDScript più lento sui cicli su 168 paesi × molti campi | più codice di contorno |

## Raccomandazione: A, TypeScript + Canvas 2D, senza motore di gioco

1. **Il nucleo è la parte preziosa, ed è puro calcolo.** In TypeScript è una libreria senza dipendenze, eseguibile in Node per i test e nel browser per il gioco. I test d'accettazione possono riprodurre i risultati verificati sugli scenari originali, attraverso un convertitore dei file del 1990 usato solo in sviluppo.
2. **Fedeltà numerica.** Il tipo `number` è un double IEEE, come gli f64 dell'originale; `Math.fround` riproduce gli f32. Gli altri candidati non offrono un controllo così diretto.
3. **L'estetica si ottiene meglio a mano.** Un framebuffer 640×480 a palette, con dithering e font bitmap, si disegna facilmente su un canvas e si scala a multipli interi. Un motore generico non aiuta molto in questo, e lo stile anni '90 a finestre e pulsanti è semplice da riprodurre.
4. **Una sola base di codice per tutte le piattaforme**: browser, desktop come PWA, Android con Bubblewrap già pronto sulla macchina.
5. **Mod naturali.** Regole e tabelle in JSON, testi italiani in file di catalogo, grafica in PNG indicizzati; tutto si carica senza ricompilare.

Godot resta una buona alternativa se si preferisce un editor visuale. In quel caso conviene comunque tenere il nucleo della simulazione separato e testato fuori dal motore.

## Architettura proposta

```
melchior-shadow/
  packages/
    core/        simulazione pura (TypeScript, nessuna dipendenza): stato, regole, cicli, RNG con seme
    data/        tabelle e regole in JSON (ideologie, pesi, tabelle di perdita…), schema validato
    ui/          framebuffer 640×480 a palette, finestre, widget, font bitmap, input
    app/         il gioco: schermate, consiglieri, testi italiani, salvataggi
  tools/
    build_worldbook.py      (esistente) Factbook → SQLite
    export_scenario.py      SQLite → pacchetto di partenza per un anno (JSON)
  re/, docs/                reverse engineering e documentazione (fuori dalle build)
```

- **Strumenti:** npm workspaces, Vite per il gioco, Vitest per i test, ESLint e Prettier. Salvataggi in IndexedDB nel browser e in file esportabili.
- **Simulazione:** il motore avanza per giorni. Gli eventi vengono letti dalla coda in ordine di data, poi girano i cicli di fine mese e fine anno. Lo stato è serializzabile per intero, così salvataggi e replay sono gratuiti.
- **Prestazioni:** 200 paesi × un centinaio di campi per pochi cicli al mese sono un carico trascurabile anche su un telefono.
- **Fedeltà come opzione:** un profilo di regole "classico" riproduce l'originale, compresi i difetti che danno carattere; un profilo "nuovo" applica le correzioni proposte in [MODELLO.md](MODELLO.md).

## Primi passi (fatti)

1. ✓ Scheletro del monorepo (core, data, ui, app) con test e build: TypeScript 6.0.3, Vite 8.3.5, Vitest 5.0.5.
2. ✓ Sistemi verificati portati in `core`, con 67 test di accettazione sui sei scenari originali.
3. ✓ Prototipo di `ui` e `app`: framebuffer 640×480 a palette, dithering, font bitmap generato all'avvio, elenco paesi e scheda.
4. ✓ `tools/export_scenario.py`: pacchetto di partenza per un anno qualsiasi dal database Factbook.
5. ✓ Ciclo di gioco (`Simulation`): calendario, coda degli eventi, fine mese e fine anno, salvataggio.
6. ✓ Generazione all'avvio: `worldFromPack(pack, regole, regoleDiGenerazione, seme)`, deterministica a parità di seme; regole in `packages/data/src/generation.ts`.
7. ✓ Carta politica: `tools/build_map.py` (Natural Earth 1:50m, pubblico dominio, in `data/sources/naturalearth/`) produce `public/mappa/carta.bin` e `carta.json`; `tileOwners` in `core` collega le tessere ai paesi dell'anno, `drawMap` in `ui` la disegna con confini fra stati, coste e mare a dithering.
8. ✓ Rilievo pixel-art della carta: `tools/build_relief.py`, in tre fasi.
   - `sorgente`: dalla maschera terra/mare di `carta.bin` dipinge una carta fisica senza confini (fondali più chiari vicino alle coste, fasce climatiche per latitudine, deserti, steppe e foreste pluviali come macchie in longitudine e latitudine, catene montuose con ombreggiatura da nord-ovest, calotta della Groenlandia) e la divide in due tasselli 320×321, ingranditi 2× per l'invio, in `data/sources/rilievo/`.
   - Conversione con PixelLab: `image_to_pixelart` con `faithful` e `init_image_strength` 200, uscita 320×321 per tassello (1 generazione ciascuno); i risultati vanno salvati come `pixellab_0.png` e `pixellab_1.png`.
   - `rilievo`: rimonta i tasselli e li riduce alla palette (rampe marrone, oliva, verde scuro e grigi chiari per la terra, blu per il mare). È la maschera della carta a decidere terra e mare, quindi le coste del rilievo coincidono pixel per pixel con quelle della carta politica (lo controlla un test in `packages/ui/test/map.test.ts`). Scrive `public/mappa/rilievo.bin`, un indice di palette per pixel. `anteprima` fa lo stesso partendo dalla sorgente, senza PixelLab.

   `drawMap` usa `MapRaster.relief` come base, se c'è: il colore del paese (ideologia, squadra o regione, tasto C) è una velatura a dithering di Bayer che copre 4 pixel su 16, 6 per il paese sotto il mouse e 10 per quello scelto, che ha anche il contorno in `MapStyle.highlight`. Confini e coste restano quelli della carta politica. Senza `rilievo.bin` il prototipo torna alle campiture piene.
9. ✓ Azioni del giocatore: `ACTIONS`, `actionThreshold`, `actionRefusal`, `performAction` in `core`, `Simulation.act`; menu delle azioni nel prototipo (tasto A).
10. ✓ Turno dei paesi IA: `planAiTurn` in `core` (fasi, bersaglio, azione, correzioni), eventi `action` nella coda della simulazione; tabelle e opzione `originalScales` in `rules.ai`.
11. ✓ Reazione del giocatore: `resolveReaction` in `core`; `Simulation` con `interactive`, `pending`, `react` e `decide` (il tempo si ferma finché il giocatore non sceglie); finestra di scelta nel prototipo.
12. ✓ Guerra: `startWar`, `warTick`, `endWar`, `canInvade`, `peaceThreshold` in `core`; tick nella simulazione, invasione e negoziato fra le azioni; guerre in rosso sulla carta, territori annessi col colore del conquistatore.
13. ✓ Armi nucleari: `nuclearStrike`, `warEscalation`, `hasNukes` in `core`; escalation e ritorsioni nella simulazione, allerta nucleare per l'IA fuori dalle guerre.
14. ✓ Bilancio del giocatore: `initialBudget`, `evaluateBudget`, `applyBudget`, `monthlyBudget` in `core`; `Simulation.budget`, `proposeBudget`, `evaluateBudget`; schermata del bilancio (tasto B) e popolarità nella barra in alto.
15. ✓ Mandato: `nextElection`, `holdElection`, `unpopularityCheck` in `core`; `Simulation.daysToElection`, `terms`, fine partita per elezioni perse o 25 mandati; finestra di fine presidenza nel prototipo.
16. ✓ Consiglieri: `advisorReport`, `cabinetBriefing`, `Simulation.advisorContext` in `core`; rapporti (tasti 1–7) e riunione di gabinetto (G) nel prototipo. I ritratti 64×64 si caricano da `public/consiglieri/<id>.bin` (un indice di palette per pixel); senza file compare un riquadro con le iniziali.
17. ✓ Ritratti dei consiglieri: generati con PixelLab (`create_image_pro`, canvas 64×64 con sfondo pieno e la palette del gioco passata come colori esadecimali, così ogni candidato è già sulla palette); il candidato scelto va in `data/sources/consiglieri/<id>.png` e `tools/build_portraits.py` scrive `packages/app/public/consiglieri/<id>.bin` (4096 byte, indici 0 e 16–159) più un'anteprima. Nella riunione di gabinetto ogni parere ha accanto il volto, ritagliato 32×32 dal ritratto (`drawFace` in `main.ts`), senza cambiare la logica di `core`.
17. ✓ Generatore di scenari: `applyDrift` e `worldFromPack(…, { drift, protect })` in `core`; nel prototipo schermata iniziale (anno, seme, deriva, elezioni), salvataggio automatico mensile in `localStorage` con le ultime 300 notizie, Esc per il menu, F5/F9.
18. ✓ Carta politica: `MapStyle.view` "politica" (predefinita: ogni paese a tinta piena, il rilievo sposta il tono di ±2 nella rampa del colore) o "fisica" (il rilievo PixelLab con una velatura); tasto V.
19. ✓ Truppe e alleati: `deployTroops`, `homeTroops`, `reinforce`, `releaseDeployments` in `core`; `WorldState.deployments`, contributi per partecipante nelle guerre, `Simulation.decideSurrender`; azione "Schieramento di truppe" nel menu e finestra di resa o mobilitazione.
20. ✓ Disastri: `strikeDisaster` in `core`, opzione `disasters` della simulazione e della schermata iniziale, azione "Aiuti d'emergenza"; `Simulation.migrate` per i vecchi salvataggi.
21. ✓ Audio: `GameAudio` (Web Audio) carica `public/suoni/<nome>.ogg` e `public/musica/<nome>.ogg` se ci sono. `play(nome, volume, rate, delay)`: `rate` cambia l'intonazione, `delay` ritarda la partenza. Il contesto audio nasce al primo tasto, come chiedono i browser; M musica, U effetti, preferenze in `localStorage`.
   - Eventi (`SOUND_OF` in `main.ts`), in ordine di priorità: nucleare (attacco, ricaduta, inverno), guerra, sconfitta, disastro, vittoria, allarme, squillo (una decisione in attesa: proposta, reazione o resa), disordini, truppe (schieramenti, rinforzi, esercitazioni), conferma, fallimento, notizia, mese (fine mese; a fine anno più grave, `rate` 0,8). A ogni disegno suona solo il più importante fra le notizie nuove.
   - Interfaccia (`ui()` nei gestori dei tasti): cursore (frecce, pagine, clic sulla carta), clic (Tab, spazio, C, V, R, M, U), apri e chiudi (azioni, bilancio, consiglieri, riunione), regola (bilancio e schermata iniziale, più acuto quando il valore sale), ordine (azione, reazione o decisione inviata), rifiuto (azione non ammessa, nessun salvataggio, conferma richiesta), salvataggio (F5, F9) e avvio (nuova partita o caricata). Un evento copre il suono del tasto. Fa eccezione l'ordine: si sente subito e l'esito arriva 0,45 s dopo.
   - Musiche: `tema` e `crisi` (giocatore in guerra, pace mondiale ≤ 2 o fine partita).
22. ✓ Suoni e musiche: `tools/build_audio.py` li produce da zero, senza campioni esterni e senza PixelLab (l'audio di PixelLab richiede il Tier 2). Ci sono due strade:
   - sintesi FM a due operatori alla OPL2 (inviluppi esponenziali, retroazione del modulatore, rumore filtrato) per i suoni elettronici e meccanici;
   - partiture MIDI scritte nello script e suonate da FluidSynth con un soundfont General MIDI (predefinito `FluidR3_GM.sf2`, oppure `SOUNDFONT=…`) per ottoni, archi, timpani e tamburi, cioè guerra, vittoria, sconfitta, truppe, disordini, avvio e le due musiche.

   Le musiche sono loop esatti: la coda che supera l'ultima battuta si somma all'inizio. I livelli sono equilibrati: loudness momentanea di picco −14 dBFS per gli eventi, da −18 a −24 per l'interfaccia, −20 dBFS RMS per le musiche, picco sempre sotto −1 dBFS. Lo script scrive Vorbis mono a 44,1 kHz (`ffmpeg`, qualità 4) e lascia MIDI e WAV in `data/sources/audio/`. Il rumore usa un seme per nome, quindi `python3 tools/build_audio.py <nome>` rifà un solo file identico.

La grafica pixel-art (ritratti dei consiglieri, icone, mappa, elementi d'interfaccia) si genera con PixelLab, riducendo poi i colori alla palette del gioco.
