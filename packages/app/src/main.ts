/**
 * Prototipo: carica il pacchetto di partenza di un anno (tools/export_scenario.py), costruisce il
 * mondo, fa girare la simulazione e mostra elenco dei paesi, scheda e notizie in stile SVGA 640×480.
 */
import {
  ACTIONS, ADVISORS, REACTIONS, Simulation, advisorReport, cabinetBriefing, initialBudget, type AdvisorId, type AdvisorLine, actionRefusal, actionThreshold, tileOwners, warOf, worldFromPack, type Report, type ScenarioPack,
} from "@melchior/core";
import { classicRules, generationRules } from "@melchior/data";
import {
  BitmapFont, CELL_H, DEFAULT_THEME, Framebuffer, HEIGHT, ITALIAN_CHARSET, RAMP, Screen, WIDTH,
  defaultPalette, drawGauge, drawList, drawMap, drawWindow, tileAt, windowToMap, type MapEmphasis, type MapRaster, type MapStyle,
  type MapWindow,
} from "@melchior/ui";
import testi from "./testi/it.json";
import { GameAudio, type SoundName } from "./audio.js";
import { forme, maiuscola, parametri, voce, type Forme } from "./paesi.js";
import { fill } from "./testo.js";

type PackCountry = ScenarioPack["countries"][number];

// Nomi italiani: dal codice ISO tramite Intl; gli stati scomparsi non hanno un ISO attuale.
const regionNames = new Intl.DisplayNames(["it"], { type: "region" });
/** Nome italiano: dalla tabella dei paesi; per un codice che non c'è, da Intl o dal Factbook. */
function italianName(c: PackCountry): string {
  const v = voce(c.code);
  if (v) return v.nome;
  try {
    const n = c.iso2 ? regionNames.of(c.iso2) : undefined;
    if (n && n !== c.iso2) return n;
  } catch {
    // codice ISO non riconosciuto: si usa il nome del Factbook
  }
  return c.name;
}

const num = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 0 });
const dec = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 1 });
const dateFmt = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const dayMonth = new Intl.DateTimeFormat("it-IT", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
const shortDate = new Intl.DateTimeFormat("it-IT", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
const money = (x: number | null): string => {
  if (x === null) return testi.nd;
  if (x >= 1e12) return `${dec.format(x / 1e12)} T$`;
  if (x >= 1e9) return `${dec.format(x / 1e9)} G$`;
  if (x >= 1e6) return `${dec.format(x / 1e6)} M$`;
  return `${num.format(x)} $`;
};
const pct = (x: number) => `${dec.format(x * 100)}%`;

const canvas = document.getElementById("schermo") as HTMLCanvasElement;
const screen = new Screen(canvas, defaultPalette());
const fb = new Framebuffer();
const font = BitmapFont.fromSystemFont(ITALIAN_CHARSET);
const theme = DEFAULT_THEME;

let pack: ScenarioPack | null = null;
let sim: Simulation | null = null;
let names: string[] = [];
let nameForms: Forme[] = [];      // nomi con articoli e preposizioni, per le frasi
/** Parametri di testo di un paese ({radice}, {radice_il}, {radice_di}, …), vuoti se manca. */
const np = (radice: string, i?: number) => parametri(radice, i !== undefined && i >= 0 ? nameForms[i] : undefined);
let order: number[] = [];       // indici dei paesi ordinati per PIL
let selected = 0;
let top = 0;
let message = testi.caricamento;
const audio = new GameAudio(import.meta.env.BASE_URL);
let lastReport: Report | undefined;      // ultima notizia già "suonata"
let lastPending: unknown = null;
let uiSound: { name: SoundName; volume: number; rate: number } | null = null;   // suono del tasto appena premuto
const UI_VOLUME: Partial<Record<SoundName, number>> = { cursore: 0.45, clic: 0.5, regola: 0.5, apri: 0.6, chiudi: 0.6 };
/** Suono d'interfaccia per il tasto o il clic in corso; l'ultimo scelto vince. `rate` lo intona. */
function ui(name: SoundName, rate = 1): void {
  uiSound = { name, volume: UI_VOLUME[name] ?? 0.7, rate };
}
let view: "elenco" | "mappa" = "mappa";
let colorMode = 0;                // 0 ideologia, 1 squadre, 2 regioni
let carta: MapRaster | null = null;
let owners: number[] = [];        // per ogni tessera della carta, il paese dello scenario
let hovered = -1;
let menu: number | null = null;
let choice = 0;                   // opzione evidenziata nella finestra di scelta (reazione o proposta)   // indice in ACTIONS dell'azione evidenziata, null = menu chiuso
const SPY_FUNDING = 50;           // M$ per lo spionaggio, finché non c'è il bilancio del giocatore
const MENU_SPLIT = ACTIONS.findIndex((a) => a.group === "covert");  // prima colonna: diplomazia e commercio

const MAP_Y = CELL_H + 6;
const MAP_STYLE: MapStyle = {
  seaA: RAMP.blue + 2, seaB: RAMP.blue + 4, neutral: RAMP.grey + 7, coast: RAMP.blue + 0, border: RAMP.grey + 3,
  highlight: RAMP.grey + 15,
  view: "politica",                // V passa alla vista fisica (rilievo PixelLab velato)
};
// colori originali per le ideologie (lettere delle regole)
const IDEOLOGY_COLOR: Record<string, number> = {
  A: RAMP.blue + 12, B: RAMP.red + 11, C: RAMP.violet + 12, D: RAMP.brown + 5, E: RAMP.olive + 12, F: RAMP.green + 8,
  G: RAMP.cyan + 12, H: RAMP.violet + 8, J: RAMP.amber + 11, K: RAMP.amber + 14, L: RAMP.brown + 10, M: RAMP.olive + 8,
};
const CYCLE = [RAMP.red + 11, RAMP.blue + 12, RAMP.amber + 12, RAMP.olive + 11, RAMP.violet + 11, RAMP.cyan + 11,
  RAMP.brown + 11, RAMP.green + 9, RAMP.red + 7, RAMP.blue + 8, RAMP.amber + 8, RAMP.violet + 7];

async function loadMap(): Promise<void> {
  const base = `${import.meta.env.BASE_URL}mappa/`;
  const [meta, bin, rilievo] = await Promise.all([
    fetch(`${base}carta.json`).then((r) => r.json() as Promise<Omit<MapRaster, "pixels">>),
    fetch(`${base}carta.bin`).then((r) => r.arrayBuffer()),
    // rilievo pixel-art (tools/build_relief.py): se manca si torna alla carta a campiture piene
    fetch(`${base}rilievo.bin`).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null),
  ]);
  const pixels = new Uint8Array(bin);
  const relief = rilievo && rilievo.byteLength === pixels.length ? new Uint8Array(rilievo) : undefined;
  carta = relief ? { ...meta, pixels, relief } : { ...meta, pixels };
}

// Vista ingrandita (Z, rotella): finestra sulla carta 4× (tools/build_map.py 2560), caricata la
// prima volta che serve. Livello 1 "regione" a 1:1, livello 2 "paese" con i pixel raddoppiati.
let zoom = 0;
let dettaglio: MapRaster | null = null;
let dettaglioInCarica = false;
let centro: [number, number] = [0, 0];      // centro della vista, in pixel della carta 4×
let tileStats: { n: number; cx: number; sx: number; hx: Float64Array; hy: Float64Array }[] = [];
let drag: { x: number; y: number; centro: [number, number]; moved: boolean } | null = null;

async function loadDetail(): Promise<void> {
  if (dettaglio || dettaglioInCarica) return;
  dettaglioInCarica = true;
  notice = testi.caricamentoCarta;
  render();
  const base = `${import.meta.env.BASE_URL}mappa/`;
  try {
    const [meta, bin, rilievo] = await Promise.all([
      fetch(`${base}carta_2560.json`).then((r) => r.json() as Promise<Omit<MapRaster, "pixels">>),
      fetch(`${base}carta_2560.bin`).then((r) => r.arrayBuffer()),
      fetch(`${base}rilievo_2560.bin`).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null),
    ]);
    const pixels = new Uint8Array(bin);
    const relief = rilievo && rilievo.byteLength === pixels.length ? new Uint8Array(rilievo) : undefined;
    // per ogni tessera gli istogrammi delle colonne e delle righe (per la mediana) e la direzione
    // media in x, perché la carta si ripete (Russia, Figi). Ogni pixel pesa per la superficie vera
    // che copre: nella proiezione di Miller le terre del nord sono ingrandite (l'Alaska).
    const w = meta.width, h = meta.height;
    const scale = w / (2 * Math.PI);
    const yTop = 1.25 * Math.log(Math.tan(Math.PI / 4 + 0.4 * (84 * Math.PI) / 180));
    const rowWeight = Array.from({ length: h }, (_, y) => {
      const lat = 2.5 * Math.atan(Math.exp((yTop - (y + 0.5) / scale) / 1.25)) - 0.625 * Math.PI;
      return Math.cos(lat) * Math.cos(0.8 * lat);
    });
    tileStats = meta.tiles.map(() => ({ n: 0, cx: 0, sx: 0, hx: new Float64Array(w), hy: new Float64Array(h) }));
    for (let p = 0; p < pixels.length; p++) {
      const t = pixels[p]!;
      if (!t) continue;
      const s = tileStats[t - 1]!;
      const x = p % w, y = Math.floor(p / w);
      const a = (x / w) * 2 * Math.PI;
      const k = rowWeight[y]!;
      s.n += k;
      s.cx += k * Math.cos(a);
      s.sx += k * Math.sin(a);
      s.hx[x]! += k;
      s.hy[y]! += k;
    }
    dettaglio = relief ? { ...meta, pixels, relief } : { ...meta, pixels };
    centerOn(order[selected]);
  } catch {
    zoom = 0;
  }
  dettaglioInCarica = false;
  if (notice === testi.caricamentoCarta) notice = "";
  render();
}

/**
 * Centro di un paese nella carta 4×: la mediana dei pixel delle tessere che governa, così le
 * terre lontane (l'Alaska per gli Stati Uniti) non spostano il centro fuori dal paese. In x la
 * mediana parte dal punto opposto alla direzione media, perché la carta si ripete.
 */
function countryCenter(i: number): [number, number] | null {
  if (!dettaglio) return null;
  const { width: w, height: h } = dettaglio;
  const hx = new Float64Array(w), hy = new Float64Array(h);
  let n = 0, cx = 0, sx = 0;
  owners.forEach((o, t) => {
    const s = tileStats[t];
    if (!s || s.n <= 0 || ruler(o) !== i) return;
    n += s.n; cx += s.cx; sx += s.sx;
    for (let k = 0; k < w; k++) hx[k]! += s.hx[k]!;
    for (let k = 0; k < h; k++) hy[k]! += s.hy[k]!;
  });
  if (n <= 0) return null;
  const median = (hist: Float64Array, start: number) => {
    let acc = 0;
    for (let k = 0; k < hist.length; k++) {
      const j = (start + k) % hist.length;
      acc += hist[j]!;
      if (acc * 2 >= n) return j + 0.5;
    }
    return start;
  };
  const opposite = Math.round(((Math.atan2(sx, cx) / (2 * Math.PI)) * w + w * 1.5)) % w;
  return [median(hx, opposite), median(hy, 0)];
}

function centerOn(i: number | undefined): void {
  const c = i === undefined ? null : countryCenter(i);
  if (c) centro = c;
}

/** Carta e finestra da disegnare: il mondo, o la finestra sulla carta 4× attorno a `centro`. */
function mapView(): { map: MapRaster; win?: MapWindow } | null {
  if (!carta) return null;
  if (zoom === 0 || !dettaglio) return { map: carta };
  const scale = zoom;
  const vw = WIDTH / scale, vh = Math.ceil(carta.height / scale);
  const x = Math.round(centro[0] - vw / 2);
  const y = Math.round(Math.min(Math.max(centro[1] - vh / 2, 0), dettaglio.height - vh));
  return { map: dettaglio, win: { x, y, w: WIDTH, h: carta.height, scale } };
}

/** Cambia livello di ingrandimento; `at` è un punto della carta sullo schermo da mettere al centro. */
function setZoom(z: number, at?: [number, number]): void {
  z = Math.min(Math.max(z, 0), 2);
  if (z === zoom) return;
  if (at && carta) {
    const v = mapView();
    if (v?.win && dettaglio) {
      const m = windowToMap(dettaglio, v.win, at[0], at[1]);
      if (m) centro = [m[0] + 0.5, m[1] + 0.5];
    } else if (z > 0) {
      const k = (dettaglio?.width ?? carta.width * 4) / carta.width;
      centro = [(at[0] + 0.5) * k, (at[1] + 0.5) * k];
    }
  } else if (z > zoom) centerOn(order[selected]);
  zoom = z;
  if (zoom > 0 && !dettaglio) void loadDetail();
}

function countryEmphasis(i: number): MapEmphasis {
  if (order[selected] === i) return "scelto";
  return i === hovered ? "sopra" : "normale";
}

/** Chi governa davvero un paese: un territorio annesso passa al conquistatore. */
function ruler(i: number): number {
  if (!sim || i < 0) return i;
  let o = i;
  for (let k = 0; k < 4; k++) {
    const c = sim.world.countries[o];
    if (!c || c.econPower || c.controlledBy < 0 || c.controlledBy === o) break;
    o = c.controlledBy;
  }
  return o;
}

function countryColor(i: number): number {
  if (!sim) return MAP_STYLE.neutral;
  const war = warOf(sim.world, i);
  if (war && order[selected] !== i && i !== hovered) return war.theater === i ? RAMP.red + 13 : RAMP.red + 9;
  if (order[selected] === i) return RAMP.green + 15;
  if (i === hovered) return RAMP.grey + 15;
  const w = sim.world;
  const c = w.countries[i]!;
  if (colorMode === 0) return IDEOLOGY_COLOR[c.ideology] ?? MAP_STYLE.neutral;
  if (colorMode === 1) return c.team ? CYCLE[(c.team - 1) % CYCLE.length]! : RAMP.grey + 9;
  const r = w.regions.findIndex((r) => r.members.some((m) => m.core && m.country === i));
  return r >= 0 ? CYCLE[r % CYCLE.length]! : MAP_STYLE.neutral;
}

// ---- avvio, partite e salvataggi ----
interface Setup { year: number; seed: number; drift: number; elections: boolean; disasters?: boolean }
const DRIFT_LEVELS = [0, 0.15, 0.35, 0.6, 1];
const SAVE_KEY = "melchior-partita";
let setup: Setup = { year: 1990, seed: randomSeed(), drift: 0, elections: true };
let title: number | null = 0;      // voce evidenziata nella schermata iniziale, null = in partita
let notice = "";                   // avviso nella barra in basso fino al prossimo tasto

function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000);
}

/** Carica il pacchetto di un anno: nomi italiani e collegamento della carta. */
async function preparePack(year: number): Promise<ScenarioPack> {
  const res = await fetch(`${import.meta.env.BASE_URL}scenarios/${year}.json`);
  if (!res.ok) throw new Error(String(res.status));
  const p = (await res.json()) as ScenarioPack;
  nameForms = p.countries.map((c) => forme(voce(c.code), italianName(c)));
  names = nameForms.map((f) => f.nome);
  if (!carta) await loadMap();
  if (!Object.keys(portraits).length) await loadPortraits();
  owners = carta ? tileOwners(carta.tiles, p.countries.map((c) => c.code), p.lineage ?? [], year) : [];
  return p;
}

/** Nuova partita: mondo generato dal Factbook dell'anno, con seme e deriva. */
async function newGame(s0: Setup): Promise<void> {
  message = testi.caricamento;
  title = null;
  render();
  try {
    pack = await preparePack(s0.year);
    const world = worldFromPack(pack, classicRules, generationRules, s0.seed, { drift: DRIFT_LEVELS[s0.drift] ?? 0, protect: ["US"] });
    const player = world.countries.findIndex((c) => c.key === "US");
    const ind = pack.countries[player]?.indicators ?? {};
    const budget = player >= 0 ? initialBudget(world.countries[player]!, ind["budget_revenues_usd"]?.value, ind["budget_expenditures_usd"]?.value) : undefined;
    sim = new Simulation({
      world, rules: classicRules, seed: s0.seed, start: new Date(Date.UTC(s0.year, 0, 1)), player, interactive: true,
      elections: s0.elections, disasters: s0.disasters ?? true, ...(budget ? { budget } : {}),
    });
    setup = { ...s0 };
    afterLoad();
    save();
  } catch {
    pack = null;
    sim = null;
    message = testi.erroreCaricamento;
  }
  render();
}

function afterLoad(): void {
  lastReport = sim?.reports.at(-1);
  lastPending = null;
  sortCountries();
  selected = Math.max(0, order.indexOf(sim?.player ?? -1));
  top = 0;
  menu = null;
  budgetRow = null;
  advisorView = null;
  message = "";
  ui("avvio");
}

interface SavedGame { version: 1; setup: Setup; snapshot: ReturnType<Simulation["save"]> }

/** Data della partita salvata (in cache: rileggere il salvataggio costa mezzo megabyte). */
let savedDay: number | null | undefined;
function savedGameDay(): number | null {
  if (savedDay === undefined) savedDay = readSave()?.snapshot.day ?? null;
  return savedDay;
}
let confirmNew = false;          // c'è una partita salvata: il secondo Invio la sostituisce

function readSave(): SavedGame | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    const g = raw ? (JSON.parse(raw) as SavedGame) : null;
    return g?.version === 1 ? g : null;
  } catch {
    return null;
  }
}

/** Salva la partita nel browser (le notizie più vecchie si scartano per stare nello spazio). */
function save(): boolean {
  if (!sim) return false;
  const snapshot = sim.save();
  snapshot.reports = snapshot.reports.filter((r) => r.key !== "endOfMonth").slice(-300);
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ version: 1, setup, snapshot } satisfies SavedGame));
    savedDay = snapshot.day;
    return true;
  } catch {
    return false;
  }
}

async function loadSaved(): Promise<void> {
  const g = readSave();
  if (!g) {
    notice = testi.nessunSalvataggio;
    ui("rifiuto");
    render();
    return;
  }
  message = testi.caricamento;
  title = null;
  render();
  try {
    pack = await preparePack(g.setup.year);
    sim = Simulation.load(g.snapshot, classicRules);
    setup = g.setup;
    afterLoad();
  } catch {
    pack = null;
    sim = null;
    message = testi.erroreCaricamento;
  }
  render();
}

/** Schermata iniziale: anno, seme, deriva, elezioni; poi inizio o ripresa. */
function renderTitle(): void {
  const saved = savedGameDay();
  const area = drawWindow(fb, font, theme, 96, 60, 448, 330, testi.nuovaPartita);
  let y = area.y + 10;
  const center = (t: string, color: number) => { font.draw(fb, t, area.x + (area.w - 8 * t.length) / 2, y, color); y += CELL_H; };
  center(testi.titolo, theme.textHighlight);
  center(testi.sottotitoloGioco, theme.textDim);
  y += 14;
  const rows: [string, string][] = [
    [testi.voceAnno, `◄ ${setup.year} ►`],
    [testi.voceSeme, `◄ ${setup.seed} ►`],
    [testi.voceDeriva, `◄ ${testi.livelliDeriva[setup.drift]} ►`],
    [testi.voceElezioni, `◄ ${setup.elections ? testi.si : testi.no} ►`],
    [testi.voceDisastri, `◄ ${setup.disasters ?? true ? testi.si : testi.no} ►`],
  ];
  rows.forEach(([label, value], k) => {
    if (title === k) fb.fillRect(area.x + 8, y, area.w - 16, CELL_H, theme.selection);
    font.draw(fb, label, area.x + 16, y, title === k ? theme.textHighlight : theme.text);
    font.draw(fb, value, area.x + area.w - 16 - 8 * value.length, y, title === k ? theme.textHighlight : theme.text);
    y += CELL_H + 2;
  });
  y += 4;
  for (const row of wrap(testi.spiegaDeriva[setup.drift] ?? "", Math.floor((area.w - 32) / 8))) {
    font.draw(fb, row, area.x + 16, y, theme.textDim);
    y += CELL_H;
  }
  y = area.y + area.h - CELL_H * 3 - 8;
  const actions = [testi.inizia, saved !== null ? fill(testi.continua, { data: shortDate.format(new Date(saved * 86_400_000)) }) : ""];
  actions.forEach((t, k) => {
    if (!t) return;
    const row = 5 + k;
    if (title === row) fb.fillRect(area.x + 8, y, area.w - 16, CELL_H, theme.selection);
    font.draw(fb, t, area.x + (area.w - 8 * t.length) / 2, y, title === row ? theme.textHighlight : theme.text);
    y += CELL_H + 4;
  });
}

function titleKey(key: string): boolean {
  if (title === null) return false;
  const last = savedGameDay() !== null ? 6 : 5;
  if (key !== "Enter") confirmNew = false;
  const step = key === "ArrowRight" ? 1 : key === "ArrowLeft" ? -1 : 0;
  if (key === "ArrowDown") title = Math.min(last, title + 1);
  else if (key === "ArrowUp") title = Math.max(0, title - 1);
  else if (key === "r" || key === "R") {
    setup = { ...setup, seed: randomSeed() };
    ui("clic");
  }
  else if (step && title === 0) setup = { ...setup, year: Math.min(2026, Math.max(1990, setup.year + step)) };
  else if (step && title === 1) setup = { ...setup, seed: Math.max(0, setup.seed + step) };
  else if (step && title === 2) setup = { ...setup, drift: Math.min(DRIFT_LEVELS.length - 1, Math.max(0, setup.drift + step)) };
  else if (step && title === 3) setup = { ...setup, elections: !setup.elections };
  else if (step && title === 4) setup = { ...setup, disasters: !(setup.disasters ?? true) };
  if (step && title <= 4) ui("regola", step > 0 ? 1.12 : 0.89);
  else if (key === "Enter" && title === 6) void loadSaved();
  else if (key === "Enter") {
    // una partita salvata non si perde senza conferma
    if (savedGameDay() !== null && !confirmNew) {
      confirmNew = true;
      notice = testi.confermaNuova;
      ui("rifiuto");
    } else {
      confirmNew = false;
      void newGame(setup);
    }
  }
  else if (key === "Escape" && sim) title = null;          // torna alla partita in corso
  return true;
}

function sortCountries(): void {
  if (!sim) return;
  const cs = sim.world.countries;
  order = cs.map((_, i) => i).sort((a, b) => cs[b]!.econPower - cs[a]!.econPower);
}

/** Nome dell'azione dentro una frase: iniziale minuscola, senza la nota sul costo del giocatore. */
const aiActionName = (code: number): string => {
  const n = (testi.azioni[code] ?? "").replace(/ \(.*\)$/, "");
  return n.charAt(0).toLowerCase() + n.slice(1);
};

function reportText(r: Report): string {
  const country = r.country !== undefined ? names[r.country] ?? "" : "";
  const actor = r.actor !== undefined ? names[r.actor] ?? "" : "";
  const stage = r.stage ? testi.stadi[r.stage - 1] ?? "" : "";
  const ctx = { ...np("paese", r.country), ...np("attore", r.actor), ...np("colpevole", r.actor) };
  /** Frase con i nomi dei paesi (articoli e preposizioni) e la maiuscola iniziale. */
  const f = (t: string, p: Record<string, string> = {}) => maiuscola(fill(t, { ...ctx, ...p }));
  switch (r.key) {
    case "endOfMonth": return testi.fineMese;
    case "endOfYear": return testi.fineAnno;
    case "socialHappened": return f(testi.socialeAvvenuto, { paese: country, stadio: stage.charAt(0).toUpperCase() + stage.slice(1) });
    case "socialSuppressed": return f(testi.socialeRepresso, { paese: country, stadio: stage });
    case "regimeChange": return f(testi.cambioRegime, { paese: country });
    case "playerKilled": return testi.presidenteUcciso;
    case "playerOusted": return testi.presidenteDestituito;
    case "playerConquered": return testi.paeseConquistato;
    case "actionSucceeded":
    case "actionFailed":
      return f(r.key === "actionSucceeded" ? testi.azioneRiuscita : testi.azioneFallita,
        { azione: testi.azioni[r.action ?? 0] ?? "", paese: country });
    case "aiActionSucceeded":
    case "aiActionFailed":
      return f(r.key === "aiActionSucceeded" ? testi.azioneIaRiuscita : testi.azioneIaFallita,
        { attore: actor, azione: aiActionName(r.action ?? 0), paese: country });
    case "reactionPrevented":
    case "reactionFailed":
      return f(r.key === "reactionPrevented" ? testi.reazioneRiuscita : testi.reazioneFallita,
        { reazione: (testi.reazioni[r.reaction ?? 0] ?? "").toLowerCase(), attore: actor, paese: country });
    case "sanctionsVetoed": return f(testi.vetoSanzioni, { attore: actor });
    case "proposalAccepted":
    case "proposalRefused":
      return f(r.key === "proposalAccepted" ? testi.propostaAccettata : testi.propostaRespinta,
        { attore: actor, azione: aiActionName(r.action ?? 0) });
    case "electionWon": return f(testi.rielezione, { n: String(r.stage ?? 2) });
    case "electionLost": return f(testi.sconfittaElettorale, { v: String(r.stage ?? 0) });
    case "termsCompleted": return testi.mandatiCompleti;
    case "disaster": {
      const p = {
        tipo: testi.disastri[r.stage ?? 0] ?? "", dir: testi.direzioni[r.action ?? 0] ?? "", paese: country,
        vittime: num.format(r.value ?? 0), danni: money(r.value2 ?? 0), m: dec.format(r.value3 ?? 0),
      };
      const base = f(r.stage === 1 ? testi.notiziaTerremoto : testi.notiziaDisastro, p);
      return r.actor !== undefined ? base + f(testi.colpevole, { colpevole: actor }) : base;
    }
    case "troopsApproaching": return f(testi.truppeAlConfine, { attore: actor, paese: country });
    case "troopsDeployed": return f(testi.truppeSchierate, { attore: actor, paese: country });
    case "troopsIncreased": return f(testi.truppeAumentate, { attore: actor, paese: country });
    case "deployRefused": return f(testi.schieramentoRifiutato, { attore: actor, paese: country });
    case "warJoined": return f(testi.entraInGuerra, { attore: actor, paese: country });
    case "troopsSurrendered": return f(testi.truppeArrese, { attore: actor, paese: country });
    case "mobilization": return fill(testi.mobilitazione, { n: num.format(r.value ?? 0) });
    case "surrenderDemandRefused": return f(testi.resaRifiutata, { attore: actor });
    case "playerConquered": return testi.paeseConquistato;
    case "nuclearStrike": return f(testi.attaccoNucleare, { attore: actor, paese: country });
    case "nuclearFallout": return f(testi.ricaduta, { n: String(r.stage ?? 0), paese: country });
    case "nuclearWinter": return testi.invernoNucleare;
    case "nuclearAlert": return f(testi.allertaNucleare, { attore: actor, paese: country });
    case "warStarted": return f(testi.guerraIniziata, { attore: actor, paese: country });
    case "warWon": return f(testi.guerraVinta, { attore: actor, paese: country });
    case "warRepelled": return f(testi.guerraRespinta, { attore: actor, paese: country });
    case "peaceNegotiated": return f(testi.paceNegoziata, { attore: actor, paese: country });
    case "ciaWarning": return r.action !== undefined
      ? f(testi.avvisoCiaOperazione, { attore: actor, paese: country, azione: aiActionName(r.action) })
      : f(testi.avvisoCia, { attore: actor, paese: country });
    case "covertExposed": return f(testi.scandaloCoperta, { paese: country });
    case "militaryExercises": return f(testi.esercitazioni, { attore: actor, paese: country });
  }
}

/** Priorità dei suoni: il più importante fra le notizie nuove. */
const SOUND_OF: Partial<Record<Report["key"], SoundName>> = {
  nuclearStrike: "nucleare", nuclearWinter: "nucleare",
  warStarted: "guerra", warJoined: "guerra", troopsApproaching: "allarme",
  electionLost: "sconfitta", playerKilled: "sconfitta", playerOusted: "sconfitta", playerConquered: "sconfitta",
  troopsSurrendered: "sconfitta", warRepelled: "notizia", warWon: "guerra",
  disaster: "disastro", nuclearFallout: "disastro", electionWon: "vittoria", termsCompleted: "vittoria", peaceNegotiated: "vittoria",
  ciaWarning: "allarme", nuclearAlert: "allarme", mobilization: "allarme", covertExposed: "fallimento",
  troopsDeployed: "truppe", troopsIncreased: "truppe", militaryExercises: "truppe", deployRefused: "fallimento",
  socialHappened: "disordini", socialSuppressed: "notizia",
  actionSucceeded: "conferma", actionFailed: "fallimento", reactionPrevented: "conferma", reactionFailed: "fallimento",
  proposalAccepted: "conferma", proposalRefused: "fallimento", sanctionsVetoed: "notizia",
  regimeChange: "notizia", aiActionSucceeded: "notizia",
  endOfMonth: "mese", endOfYear: "mese",
};
const SOUND_RANK: SoundName[] = [
  "nucleare", "guerra", "sconfitta", "disastro", "vittoria", "allarme", "squillo", "disordini", "truppe",
  "conferma", "fallimento", "notizia", "mese",
];

/**
 * Suona il tasto appena premuto e l'effetto più importante fra le notizie arrivate dall'ultimo
 * disegno, e sceglie la musica. Un evento copre il suono del tasto, tranne un ordine appena
 * dato: prima si sente l'ordine partire, poco dopo l'esito.
 */
function updateAudio(): void {
  const pressed = uiSound;
  uiSound = null;
  if (title !== null || !sim) {
    void audio.playMusic("tema");
    if (pressed) audio.play(pressed.name, pressed.volume, pressed.rate);
    return;
  }
  const reports = sim.reports;
  const from = lastReport ? reports.lastIndexOf(lastReport) + 1 : reports.length;
  const fresh = from > 0 || !lastReport ? reports.slice(from) : reports.slice(-5);
  lastReport = reports.at(-1);
  const candidates = fresh.map((r) => SOUND_OF[r.key]).filter((x): x is SoundName => !!x);
  if (sim.pending && sim.pending !== lastPending) candidates.push("squillo");    // una decisione chiama al telefono
  lastPending = sim.pending;
  const best = SOUND_RANK.find((x) => candidates.includes(x));
  const afterOrder = pressed?.name === "ordine";
  if (pressed && (!best || afterOrder)) audio.play(pressed.name, pressed.volume, pressed.rate);
  if (best) {
    const newYear = best === "mese" && fresh.some((r) => r.key === "endOfYear");
    audio.play(best, best === "mese" ? 0.6 : 0.8, newYear ? 0.8 : 1, afterOrder ? 0.45 : 0);
  }
  const atWar = sim.player >= 0 && sim.world.wars.some((w) => w.sides.some((side) => side.countries.includes(sim!.player)));
  void audio.playMusic(atWar || sim.world.worldPeace <= 2 || sim.gameOver ? "crisi" : "tema");
}

function render(): void {
  updateAudio();
  fb.ditherRect(0, 0, WIDTH, HEIGHT, RAMP.blue + 0, RAMP.blue + 2, 6);
  fb.fillRect(0, 0, WIDTH, CELL_H + 4, RAMP.grey + 2);
  fb.hline(0, CELL_H + 4, WIDTH, RAMP.grey + 9);
  font.draw(fb, `${testi.titolo} · ${testi.sottotitolo}`, 8, 2, theme.text);

  if (title !== null) {
    renderTitle();
    fb.fillRect(0, HEIGHT - CELL_H - 8, WIDTH, CELL_H + 8, RAMP.grey + 2);
    font.draw(fb, notice || testi.aiutoTitolo, 8, HEIGHT - CELL_H - 4, theme.text);
    screen.present(fb);
    return;
  }
  if (!pack || !sim) {
    font.draw(fb, message, 40, 220, theme.text);
    screen.present(fb);
    return;
  }
  const date = dateFmt.format(sim.date);
  font.draw(fb, date, WIDTH - 8 * (date.length + 1), 2, theme.textHighlight);
  if (sim.budget) {
    const pop = fill(testi.popolarita, { v: `${num.format(sim.budget.popularity)}%` });
    const popX = WIDTH - 8 * (date.length + pop.length + 4);
    font.draw(fb, pop, popX, 2, sim.budget.popularity < 30 ? RAMP.red + 13 : theme.text);
    const days = sim.daysToElection;
    if (days !== null) {
      const el = fill(testi.giorniElezioni, { n: num.format(days) });
      font.draw(fb, el, popX - 8 * (el.length + 3), 2, days <= 30 ? theme.textHighlight : theme.textDim);
    }
  }

  if (view === "mappa" && carta) renderMap();
  else renderList();
  if (menu !== null) renderMenu();
  if (budgetRow !== null) renderBudget();
  if (advisorView !== null) renderAdvisor();
  if (sim.pending) renderChoice();
  if (sim.gameOver) renderGameOver();
  fb.fillRect(0, HEIGHT - CELL_H - 8, WIDTH, CELL_H + 8, RAMP.grey + 2);
  font.draw(fb, notice ? notice : sim.pending ? testi.aiutoScelta : advisorView !== null ? testi.aiutoConsiglieri : budgetRow !== null ? testi.aiutoBilancio : menu !== null ? testi.aiutoMenu : view === "mappa" ? fill(testi.aiutoMappa, { colori: testi.modiColore[colorMode] ?? "" }) : testi.aiuto, 8, HEIGHT - CELL_H - 4, theme.text);
  screen.present(fb);
}

/** Probabilità di successo in % (la soglia S vale su un tiro 1..100), o null se non si tira. */
function chance(code: number, target: number): number | null {
  if (!sim) return null;
  const s = actionThreshold(sim.world, classicRules, sim.player, target, code);
  return s === null ? null : Math.round(Math.min(Math.max(s - 1, 0), 100));
}

function renderMenu(): void {
  const target = order[selected];
  if (!sim || menu === null || target === undefined) return;
  const area = drawWindow(fb, font, theme, 8, 40, 624, 330, fill(testi.menuAzioni, { ...np("paese", target) }));
  const colW = Math.floor(area.w / 2);
  const columns = [ACTIONS.slice(0, MENU_SPLIT), ACTIONS.slice(MENU_SPLIT)];
  columns.forEach((list, col) => {
    let y = area.y + 2;
    let group = "";
    list.forEach((a) => {
      const x = area.x + 4 + col * colW;
      if (a.group !== group) {
        group = a.group;
        if (y > area.y + 2) y += 4;
        font.draw(fb, testi.gruppiAzioni[a.group], x, y, theme.textDim);
        y += CELL_H;
      }
      const k = ACTIONS.indexOf(a);
      const refused = actionRefusal(sim!.world, classicRules, sim!.player, target, a.code);
      const p = refused ? null : chance(a.code, target);
      const value = refused ? "—" : p === null ? testi.sempre : `${p}%`;
      if (k === menu) fb.fillRect(x - 2, y, colW - 8, CELL_H, theme.selection);
      const color = k === menu ? theme.textHighlight : refused ? theme.textDim : theme.text;
      font.draw(fb, testi.azioni[a.code] ?? "", x, y, color);
      font.draw(fb, value, x + colW - 12 - 8 * value.length, y, color);
      y += CELL_H;
    });
  });
  const current = ACTIONS[menu]!;
  const why = actionRefusal(sim.world, classicRules, sim.player, target, current.code);
  if (why) font.draw(fb, testi.rifiuti[why], area.x + 4, area.y + area.h - CELL_H - 2, theme.textHighlight);
}

/** Finestra che ferma il tempo: reazione a un'aggressione o proposta rivolta a noi. */
function renderChoice(): void {
  const p = sim?.pending;
  if (!sim || !p) return;
  const options = p.kind === "reaction" ? testi.reazioni : p.kind === "surrender" ? testi.scelteResa : testi.scelteProposta;
  const h = CELL_H * (options.length + (p.kind === "reaction" ? 7 : 5)) + 16;
  const title = p.kind === "reaction" ? testi.titoloReazione : p.kind === "surrender" ? testi.titoloResa
    : fill(testi.titoloProposta, { ...np("attore", p.actor) });
  const area = drawWindow(fb, font, theme, 120, 120, 400, h, title);
  let y = area.y + 2;
  // le righe lunghe vanno a capo (al massimo due righe)
  const line = (text: string, color: number) => {
    for (const row of wrap(text, Math.floor((area.w - 8) / 8)).slice(0, 2)) {
      font.draw(fb, row, area.x + 4, y, color);
      y += CELL_H;
    }
  };
  if (p.kind === "reaction") {
    line(fill(testi.testoReazione, { ...np("attore", p.actor), azione: aiActionName(p.code) }), theme.textHighlight);
    line(fill(testi.bersaglio, { ...np("paese", p.target) }), theme.text);
    const us = sim.world.countries[sim.player]!;
    const them = sim.world.countries[p.actor]!;
    line(fill(testi.lerConfronto, { ...np("paese", sim.player), valore: pct(us.ler) }), theme.textDim);
    line(fill(testi.lerConfronto, { ...np("paese", p.actor), valore: pct(them.ler) }), theme.textDim);
  } else if (p.kind === "surrender") {
    const war = sim.world.wars.find((x) => x.id === p.war);
    line(fill(testi.testoResa, { ...np("attore", p.actor) }), theme.textHighlight);
    if (war) line(fill(testi.testoResa2, { truppe: num.format(Math.round(war.sides[1].troops)), morti: num.format(Math.round(war.sides[1].totalDead)) }), theme.text);
  } else {
    line(fill(testi.testoProposta, { ...np("attore", p.actor), azione: aiActionName(p.code) }), theme.textHighlight);
  }
  y += 4;
  options.forEach((o, k) => {
    if (k === choice) fb.fillRect(area.x + 2, y, area.w - 4, CELL_H, theme.selection);
    line(o, k === choice ? theme.textHighlight : theme.text);
  });
}

function renderGameOver(): void {
  if (!sim?.gameOver) return;
  const area = drawWindow(fb, font, theme, 120, 150, 400, 130, testi.fineTitolo);
  const P = sim.world.countries[sim.player];
  let y = area.y + 6;
  const line = (t: string, c: number) => { font.draw(fb, t, area.x + 8, y, c); y += CELL_H + 4; };
  line(testi.fineMotivo[sim.gameOver] ?? "", theme.textHighlight);
  line(fill(testi.fineDati, {
    ler: P ? pct(P.ler) : "-", pop: sim.budget ? `${num.format(sim.budget.popularity)}%` : "-", n: String(sim.terms),
  }), theme.text);
  line(dateFmt.format(sim.date), theme.textDim);
  line(testi.fineAiuto, theme.textDim);
}

// ---- consiglieri ----
type AdvisorView = { kind: "report"; who: AdvisorId } | { kind: "briefing"; code: number };
let advisorView: AdvisorView | null = null;
const PORTRAIT = 64;
const portraits: Partial<Record<AdvisorId, Uint8Array>> = {};

/** Ritratti 64×64 indicizzati sulla palette del gioco (public/consiglieri/<id>.bin), se ci sono. */
async function loadPortraits(): Promise<void> {
  await Promise.all(ADVISORS.map(async (id) => {
    try {
      const r = await fetch(`${import.meta.env.BASE_URL}consiglieri/${id}.bin`);
      if (!r.ok) return;
      const bytes = new Uint8Array(await r.arrayBuffer());
      if (bytes.length === PORTRAIT * PORTRAIT) portraits[id] = bytes;
    } catch {
      // nessun ritratto: resta il riquadro con le iniziali
    }
  }));
}

/** Va a capo fra le parole entro `cols` caratteri. */
function wrap(text: string, cols: number): string[] {
  const rows: string[] = [];
  let row = "";
  for (const word of text.split(" ")) {
    if (row && row.length + 1 + word.length > cols) {
      rows.push(row);
      row = word;
    } else row = row ? `${row} ${word}` : word;
  }
  if (row) rows.push(row);
  return rows;
}

function drawPortrait(who: AdvisorId, x: number, y: number): void {
  const img = portraits[who];
  fb.bevel(x - 2, y - 2, PORTRAIT + 4, PORTRAIT + 4, theme.windowLight, theme.windowDark, true);
  if (img) {
    fb.blit(img, PORTRAIT, PORTRAIT, x, y);
    return;
  }
  fb.ditherRect(x, y, PORTRAIT, PORTRAIT, RAMP.grey + 3, RAMP.grey + 5, 8);
  const name = testi.consiglieri[who].nome;
  const initials = name.split(" ").map((w) => w[0]).join("");
  font.draw(fb, initials, x + (PORTRAIT - 8 * initials.length) / 2, y + PORTRAIT / 2 - 8, theme.textHighlight);
}

/** Volto ritagliato 32×32 dal ritratto, per i pareri della riunione di gabinetto. */
const FACE = 32;
const faces: Partial<Record<AdvisorId, Uint8Array>> = {};
function drawFace(who: AdvisorId, x: number, y: number): void {
  const img = portraits[who];
  if (!img) return;
  let face = faces[who];
  if (!face) {
    // ritaglio centrato in orizzontale, appena sotto il bordo superiore: testa e colletto
    const ox = (PORTRAIT - FACE) / 2, oy = 6;
    face = new Uint8Array(FACE * FACE);
    for (let r = 0; r < FACE; r++) face.set(img.subarray((oy + r) * PORTRAIT + ox, (oy + r) * PORTRAIT + ox + FACE), r * FACE);
    faces[who] = face;
  }
  fb.bevel(x - 1, y - 1, FACE + 2, FACE + 2, theme.windowLight, theme.windowDark, true);
  fb.blit(face, FACE, FACE, x, y);
}

function advisorText(l: AdvisorLine, news: Report[]): string {
  if (l.key === "pressNews") {
    const r = l.ref !== undefined ? news[l.ref] : undefined;
    return r ? `${dayMonth.format(new Date(r.day * 86_400_000))} ${reportText(r)}` : "";
  }
  const name = (i?: number) => (i !== undefined && i >= 0 ? names[i] ?? "" : "");
  const v = l.value ?? 0;
  const v2 = l.value2 ?? 0;
  const t = (testi.rapporti as Record<string, string>)[l.key] ?? l.key;
  return maiuscola(fill(t, {
    paese: name(l.country), altro: name(l.other), ...np("paese", l.country), ...np("altro", l.other),
    v: dec.format(v), v0: num.format(v), vp: pct(v), v2: dec.format(v2), pv2: pct(v2), soldi2: money(v2),
    umore: testi.umori[v - 1] ?? "", azione: aiActionName(v), tipo: (testi.disastri[v2] ?? "").toLowerCase(),
    squadra: v ? fill(testi.squadraN, { n: String(v) }) : testi.nessunaSquadra,
    coalizione: [l.country, l.other].filter((i) => i !== undefined && i >= 0).map(name).join(" + ") || "-",
  }));
}

function renderAdvisor(): void {
  const view = advisorView;
  const target = order[selected];
  if (!sim || !view || target === undefined) return;
  const ctx = sim.advisorContext();
  // la riunione copre per intero il menu delle azioni da cui si apre
  const area = drawWindow(fb, font, theme, 8, 28, 624, view.kind === "report" ? 300 : 346,
    view.kind === "report"
      ? fill(testi.rapportoTitolo, { ruolo: testi.consiglieri[view.who].ruolo, ...np("paese", target) })
      : fill(testi.riunione, { azione: testi.azioni[view.code] ?? "", ...np("paese", target) }));
  const cols = Math.floor((area.w - PORTRAIT - 40) / 8);
  if (view.kind === "report") {
    drawPortrait(view.who, area.x + 6, area.y + 6);
    // nome e cognome su due righe, per non invadere la colonna del testo
    testi.consiglieri[view.who].nome.split(" ").forEach((w, k) =>
      font.draw(fb, w, area.x + 6, area.y + PORTRAIT + 12 + k * CELL_H, theme.textDim));
    let y = area.y + 4;
    const tx = area.x + PORTRAIT + 32;
    for (const l of advisorReport(ctx, view.who, target)) {
      for (const row of wrap(advisorText(l, ctx.news as Report[]), cols)) {
        if (y > area.y + area.h - CELL_H) break;
        font.draw(fb, row, tx, y, theme.text);
        y += CELL_H;
      }
      y += 3;
    }
    return;
  }
  // riunione di gabinetto: un parere per consigliere
  const brief = cabinetBriefing(ctx, target, view.code);
  const chance = brief.chance === null ? testi.sempre : `${brief.chance}%`;
  let y = area.y + 3;
  for (const o of brief.opinions) {
    if (y + 2 * CELL_H > area.y + area.h) break; // niente testo fuori dalla finestra
    const color = o.stance > 0 ? RAMP.green + 13 : o.stance < 0 ? RAMP.red + 13 : theme.textDim;
    const who = testi.consiglieri[o.advisor];
    // con il ritratto il testo scorre a destra del volto; senza, resta il rientro di prima
    const face = portraits[o.advisor] !== undefined;
    const tx = face ? area.x + FACE + 12 : area.x + 4;
    const top = y;
    if (face) drawFace(o.advisor, area.x + 4, y);
    font.draw(fb, `${who.ruolo}:`, tx, y, theme.textDim);
    y += CELL_H;
    const sum = brief.opinions.reduce((t, x) => t + x.stance, 0);
    const text = fill((testi.pareri as Record<string, string>)[o.reason] ?? o.reason, {
      chance, sintesi: testi.sintesi[Math.sign(sum) + 1] ?? "",
    });
    for (const row of wrap(text, Math.floor((area.x + area.w - tx - 20) / 8))) {
      font.draw(fb, row, tx + 12, y, color);
      y += CELL_H;
    }
    y = Math.max(y, face ? top + FACE + 2 : y) + 2;
  }
}

function advisorKey(key: string): boolean {
  if (!sim) return false;
  const n = Number(key);
  if (advisorView === null) {
    if (menu === null && budgetRow === null && n >= 1 && n <= 7) {
      advisorView = { kind: "report", who: ADVISORS[n - 1]! };
      ui("apri");
      return true;
    }
    if (menu !== null && (key === "g" || key === "G")) {
      // per un'azione non ammessa il motivo è già nel menu: niente riunione
      const target = order[selected];
      const code = ACTIONS[menu]!.code;
      if (target !== undefined && !actionRefusal(sim.world, classicRules, sim.player, target, code)) {
        advisorView = { kind: "briefing", code };
        ui("apri");
      } else ui("rifiuto");
      return true;
    }
    return false;
  }
  if (key === "Escape" || key === "g" || key === "G") {
    advisorView = null;
    ui("chiudi");
  } else if (n >= 1 && n <= 7) {
    advisorView = { kind: "report", who: ADVISORS[n - 1]! };
    ui("clic");
  }
  return true;                      // con un consigliere aperto gli altri tasti non fanno nulla
}

let budgetRow: number | null = null;     // voce evidenziata nella schermata del bilancio
const RATE_KEYS = ["personal", "corporate", "sales", "tariffs"] as const;
const SPEND_KEYS = ["defense", "social", "aid", "research"] as const;

function renderBudget(): void {
  const b = sim?.budget;
  if (!sim || !b || budgetRow === null) return;
  const area = drawWindow(fb, font, theme, 8, 28, 624, 300, testi.bilancio);
  const p = sim.evaluateBudget()!;
  const colL = area.x + 4;
  const valA = area.x + 8 * 30;        // in vigore
  const valB = area.x + 8 * 40;        // proposto
  let y = area.y + 2;
  const right = (text: string, x: number, color: number) => font.draw(fb, text, x - 8 * text.length, y, color);
  font.draw(fb, testi.imposte, colL, y, theme.textDim);
  right(testi.inVigore, valA, theme.textDim);
  right(testi.proposto, valB, theme.textDim);
  y += CELL_H;
  const row = (k: number, now: string, next: string) => {
    if (k === budgetRow) fb.fillRect(area.x + 1, y, 8 * 41, CELL_H, theme.selection);
    const color = k === budgetRow ? theme.textHighlight : theme.text;
    font.draw(fb, testi.vociBilancio[k] ?? "", colL, y, color);
    right(now, valA, theme.textDim);
    right(next, valB, now === next ? color : RAMP.amber + 14);
    y += CELL_H;
  };
  RATE_KEYS.forEach((key, k) => row(k, pct(b.rates[key]), pct(b.proposed.rates[key])));
  y += 6;
  font.draw(fb, testi.spese, colL, y, theme.textDim);
  y += CELL_H;
  SPEND_KEYS.forEach((key, k) => row(4 + k, money(b.spending[key]), money(b.proposed.spending[key])));
  // proiezione
  const px = area.x + 8 * 43;
  y = area.y + 2;
  const line = (label: string, value: string, color = theme.text) => {
    font.draw(fb, label, px, y, theme.textDim);
    font.draw(fb, value, area.x + area.w - 6 - 8 * value.length, y, color);
    y += CELL_H;
  };
  font.draw(fb, testi.proiezione, px, y, theme.textDim);
  y += CELL_H;
  line(testi.entrate, money(p.totalRevenue));
  line(testi.uscite, money(p.totalSpending));
  line(testi.saldo, `${p.balance < 0 ? "-" : ""}${money(Math.abs(p.balance))}`, p.balance < 0 ? RAMP.red + 12 : theme.text);
  line(testi.debito, money(Math.abs(b.debt)));
  y += 6;
  line(testi.crescitaAttesa, pct(p.target.growth), p.target.growth < 0 ? RAMP.red + 12 : theme.text);
  line(testi.popolaritaAttesa, `${num.format(p.target.popularity)}%`, p.target.popularity < 30 ? RAMP.red + 12 : theme.text);
  line(testi.profitti, pct(p.target.profits));
  line(testi.importazioni, pct(p.target.imports));
  font.draw(fb, testi.notaBilancio, colL, area.y + area.h - CELL_H - 2, theme.textDim);
}

function budgetKey(key: string): boolean {
  const b = sim?.budget;
  if (!sim || !b || budgetRow === null) return false;
  if (key === "Escape" || key === "b" || key === "B") {
    budgetRow = null;
    ui("chiudi");
  }
  else if (key === "ArrowDown") budgetRow = Math.min(7, budgetRow + 1);
  else if (key === "ArrowUp") budgetRow = Math.max(0, budgetRow - 1);
  else if (key === "ArrowLeft" || key === "ArrowRight") {
    const sign = key === "ArrowRight" ? 1 : -1;
    ui("regola", sign > 0 ? 1.12 : 0.89);           // più alto quando la voce cresce
    const rates = { ...b.proposed.rates };
    const spending = { ...b.proposed.spending };
    if (budgetRow < 4) {
      const k = RATE_KEYS[budgetRow]!;
      rates[k] = Math.min(Math.max(Math.round((rates[k] + sign * 0.005) * 1000) / 1000, 0), 0.9);
    } else {
      const k = SPEND_KEYS[budgetRow - 4]!;
      spending[k] = Math.max(0, spending[k] + sign * 0.025 * Math.max(b.spending[k], 1e9));
    }
    sim.proposeBudget(rates, spending);
  }
  return true;                      // con il bilancio aperto gli altri tasti non fanno nulla
}

function choiceKey(key: string): boolean {
  const p = sim?.pending;
  if (!sim || !p) return false;
  const n = p.kind === "reaction" ? REACTIONS.length : p.kind === "surrender" ? testi.scelteResa.length : 2;
  if (key === "ArrowDown") choice = Math.min(n - 1, choice + 1);
  else if (key === "ArrowUp") choice = Math.max(0, choice - 1);
  else if (key === "Enter") {
    ui("ordine");
    if (p.kind === "reaction") sim.react(REACTIONS[choice]!);
    else if (p.kind === "surrender") sim.decideSurrender((["demand", "troops", "surrender"] as const)[choice] ?? "troops");
    else sim.decide(choice === 0);
    choice = 0;
    sortCountries();
  }
  return true;                    // con una scelta aperta gli altri tasti non fanno nulla
}

function menuKey(key: string): boolean {
  if (menu === null) return false;
  const target = order[selected];
  if (key === "Escape") menu = null;
  else if (key === "ArrowDown") menu = Math.min(ACTIONS.length - 1, menu + 1);
  else if (key === "ArrowUp") menu = Math.max(0, menu - 1);
  else if (key === "ArrowRight" && menu < MENU_SPLIT) menu = Math.min(ACTIONS.length - 1, menu + MENU_SPLIT);
  else if (key === "ArrowLeft" && menu >= MENU_SPLIT) menu = Math.max(0, menu - MENU_SPLIT);
  else if (key === "Enter" && sim && target !== undefined) {
    const a = ACTIONS[menu]!;
    const out = sim.act(a.code, target, a.funded ? SPY_FUNDING : 0);
    if (typeof out !== "string") menu = null;
    ui(typeof out === "string" ? "rifiuto" : "ordine");
  } else return false;
  return true;
}

function renderNews(x: number, y: number, w: number, h: number, rows: number, compact = false): void {
  if (!sim) return;
  const news = drawWindow(fb, font, theme, x, y, w, h, testi.notizie);
  const recent = sim.reports.filter((r) => r.key !== "endOfMonth").slice(-rows).reverse();
  if (!recent.length) font.draw(fb, testi.nessunaNotizia, news.x + 4, news.y + 2, theme.textDim);
  recent.forEach((r, k) => {
    const when = (compact ? dayMonth : shortDate).format(new Date(r.day * 86_400_000));
    const cols = Math.floor((news.w - 8) / 8);
    let text = `${when} ${reportText(r)}`;
    if (text.length > cols) text = `${text.slice(0, cols - 1)}…`;
    font.draw(fb, text, news.x + 4, news.y + 2 + k * CELL_H, k === 0 ? theme.textHighlight : theme.text);
  });
}

function renderMap(): void {
  if (!sim || !carta) return;
  const v = mapView()!;
  drawMap(fb, v.map, 0, MAP_Y, owners.map(ruler), countryColor, MAP_STYLE, countryEmphasis, v.win);
  if (v.win) {
    const label = testi.zoom[zoom] ?? "";
    fb.fillRect(0, MAP_Y, 8 * label.length + 8, CELL_H + 2, RAMP.grey + 2);
    font.draw(fb, label, 4, MAP_Y + 1, theme.textHighlight);
  }
  fb.hline(0, MAP_Y + carta.height, WIDTH, RAMP.grey + 9);
  const top = MAP_Y + carta.height + 4;
  const h = HEIGHT - CELL_H - 12 - top;
  const card = drawWindow(fb, font, theme, 8, top, 220, h, testi.schedaPaese);
  const idx = order[selected];
  if (idx !== undefined) {
    const c = sim.world.countries[idx]!;
    const at = (k: number) => card.y + 2 + k * CELL_H;
    font.draw(fb, names[idx]!.toUpperCase(), card.x + 4, at(0), theme.textHighlight);
    // il nome dell'ideologia sta nella larghezza della scheda, con i puntini se è troppo lungo
    const ideology = classicRules.ideologies.find((x) => x.letter === c.ideology)?.name ?? testi.nd;
    const cols = Math.floor((card.w - 8) / 8);
    font.draw(fb, ideology.length > cols ? `${ideology.slice(0, cols - 1)}…` : ideology, card.x + 4, at(1), theme.text);
    const pair = (k: number, label: string, value: string) => {
      font.draw(fb, label, card.x + 4, at(k), theme.textDim);
      font.draw(fb, value, card.x + card.w - 4 - 8 * value.length, at(k), theme.text);
    };
    pair(2, testi.pil, money(c.econPower * 1e5));
    const war = warOf(sim.world, idx);
    if (war) {
      const [a, d] = war.sides;
      pair(3, testi.inGuerra, fill(testi.statoGuerra, { a: num.format(a.strength), b: num.format(d.strength) }));
    } else pair(3, testi.influenza, `${dec.format(c.influence)}%`);
  }
  renderNews(236, top, 396, h, Math.floor((h - CELL_H - 4) / CELL_H), true);
}

function renderList(): void {
  if (!sim) return;
  const cs = sim.world.countries;
  const list = drawWindow(fb, font, theme, 8, 28, 264, 300, testi.elencoPaesi);
  const visible = Math.floor(list.h / CELL_H);
  if (selected < top) top = selected;
  if (selected >= top + visible) top = selected - visible + 1;
  drawList(fb, font, theme, list, order.map((i) => `${names[i]!.padEnd(20).slice(0, 20)} ${money(cs[i]!.econPower * 1e5).padStart(10)}`), selected, top);

  const card = drawWindow(fb, font, theme, 280, 28, 352, 300, testi.schedaPaese);
  const idx = order[selected];
  if (idx !== undefined) {
    const c = cs[idx]!;
    let y = card.y + 4;
    font.draw(fb, names[idx]!.toUpperCase(), card.x + 6, y, theme.textHighlight);
    y += CELL_H + 6;
    const line = (label: string, value: string) => {
      font.draw(fb, label, card.x + 6, y, theme.textDim);
      font.draw(fb, value, card.x + 6 + 8 * 19, y, theme.text);
      y += CELL_H;
    };
    const gauge = (label: string, v: number, text: string) => {
      font.draw(fb, label, card.x + 6, y, theme.textDim);
      drawGauge(fb, card.x + 6 + 8 * 19, y + 2, 80, v, RAMP.green + 5, RAMP.green + 11);
      font.draw(fb, text, card.x + 6 + 8 * 19 + 88, y, theme.text);
      y += CELL_H;
    };
    line(testi.pil, money(c.econPower * 1e5));
    line(testi.pilProCapite, money(c.pcGnp));
    line(testi.popolazione, num.format(c.population));
    line(testi.crescitaPil, pct(c.gdpGrowth));
    line(testi.spesaMilitare, money(c.milSpend));
    line(testi.truppe, num.format(c.troops));
    line(testi.influenza, `${dec.format(c.influence)}%`);
    line(testi.ideologia, classicRules.ideologies.find((x) => x.letter === c.ideology)?.name ?? testi.nd);
    line(testi.paceEticaAmbizione, `${dec.format(c.peace)} / ${dec.format(c.ethic)} / ${dec.format(c.ambition)}`);
    line(testi.regione, sim.world.regions.find((r) => r.members.some((m) => m.core && m.country === idx))?.name ?? testi.nessuna);
    line(testi.squadra, !c.team ? testi.nessuna
      : fill(sim.world.teamLeaders.includes(idx) ? testi.guidaSquadra : testi.membroSquadra, { n: String(c.team) }));
    if (c.warheads) line(testi.testate, num.format(c.warheads));
    const war = warOf(sim.world, idx);
    if (war) {
      const [a, d] = war.sides;
      line(testi.inGuerra, fill(testi.statoGuerra, { a: num.format(a.strength), b: num.format(d.strength) }));
      line(testi.mortiGuerra, num.format(Math.round(a.totalDead + d.totalDead)));
    }
    gauge(testi.ler, c.ler, pct(c.ler));
    gauge(testi.malcontento, c.outcry / 100, dec.format(c.outcry));
    gauge(testi.ansiaSociale, c.anxiety.social / 100, dec.format(c.anxiety.social));
  }

  renderNews(8, 334, 624, 118, 5);
}

function advanceMonth(): void {
  if (!sim) return;
  const month = sim.date.getUTCMonth();
  while (!sim.gameOver && !sim.pending && sim.date.getUTCMonth() === month) sim.advanceDay();
  sortCountries();
  if (sim.date.getUTCMonth() !== month) save();      // il mondo persiste: salvataggio a ogni mese
}

window.addEventListener("keydown", (e) => {
  notice = "";
  audio.unlock();
  if (e.key === "m" || e.key === "M") {
    audio.toggleMusic();
    ui("clic");
    notice = fill(testi.musicaOnOff, { v: audio.musicOn ? testi.si : testi.no });
    e.preventDefault();
    render();
    return;
  }
  if ((e.key === "u" || e.key === "U") && budgetRow === null) {
    audio.toggleSound();
    ui("clic");
    notice = fill(testi.suoniOnOff, { v: audio.soundOn ? testi.si : testi.no });
    e.preventDefault();
    render();
    return;
  }
  // suono predefinito del tasto; le schermate lo precisano (apri, chiudi, regola, ordine, rifiuto)
  if (/^(Arrow|Page)/.test(e.key)) ui("cursore");
  else if (e.key === "Escape") ui("chiudi");
  else if (e.key === "Tab" || e.key === " " || /^[cCvVzZ]$/.test(e.key)) ui("clic");
  if (titleKey(e.key)) {
    e.preventDefault();
    render();
    return;
  }
  if (e.key === "F5" && sim) {
    const ok = save();
    notice = ok ? testi.salvato : testi.salvataggioFallito;
    ui(ok ? "salvataggio" : "rifiuto");
    e.preventDefault();
    render();
    return;
  }
  if (e.key === "F9") {
    ui("salvataggio");
    e.preventDefault();
    void loadSaved();
    return;
  }
  if (!sim?.pending && advisorKey(e.key)) {
    e.preventDefault();
    render();
    return;
  }
  if (budgetKey(e.key)) {
    e.preventDefault();
    render();
    return;
  }
  if (choiceKey(e.key)) {
    e.preventDefault();
    render();
    return;
  }
  if (menuKey(e.key)) {
    e.preventDefault();
    render();
    return;
  }
  const before = selected;
  const page = 16;
  const n = order.length;
  if (e.key === "ArrowDown") selected = Math.min(n - 1, selected + 1);
  else if (e.key === "ArrowUp") selected = Math.max(0, selected - 1);
  else if (e.key === "PageDown") selected = Math.min(n - 1, selected + page);
  else if (e.key === "PageUp") selected = Math.max(0, selected - page);
  else if (e.key === " " && sim) {
    const month = sim.date.getUTCMonth();
    sim.advanceDay();
    if (sim.date.getUTCMonth() !== month) save();
  }
  else if (e.key === "Enter") advanceMonth();
  else if ((e.key === "a" || e.key === "A") && sim) {
    menu = 0;
    ui("apri");
  } else if ((e.key === "b" || e.key === "B") && sim?.budget) {
    budgetRow = 0;
    ui("apri");
  }
  else if (e.key === "Tab") view = view === "mappa" ? "elenco" : "mappa";
  else if (e.key === "c" || e.key === "C") colorMode = (colorMode + 1) % 3;
  else if (e.key === "v" || e.key === "V") MAP_STYLE.view = MAP_STYLE.view === "fisica" ? "politica" : "fisica";
  else if ((e.key === "z" || e.key === "Z") && view === "mappa") setZoom((zoom + 1) % 3);
  else if (e.key === "Escape") title = savedGameDay() !== null ? 6 : 5;
  else return;
  if (zoom > 0 && selected !== before) centerOn(order[selected]);
  e.preventDefault();
  render();
});

/** Punto del framebuffer sotto il mouse. */
function pointer(e: MouseEvent): [number, number] {
  const r = canvas.getBoundingClientRect();
  return [((e.clientX - r.left) * WIDTH) / r.width, ((e.clientY - r.top) * HEIGHT) / r.height];
}
function countryUnder(e: MouseEvent): number {
  if (view !== "mappa" || !carta) return -1;
  const [x, y] = pointer(e);
  const v = mapView()!;
  const t = tileAt(v.map, x, y - MAP_Y, v.win);
  return t >= 0 ? ruler(owners[t] ?? -1) : -1;
}
canvas.addEventListener("mousedown", (e) => {
  if (e.button === 0 && zoom > 0 && dettaglio) {
    const [x, y] = pointer(e);
    drag = { x, y, centro: [...centro], moved: false };
  }
});
window.addEventListener("mouseup", () => {
  if (drag && !drag.moved) drag = null;
});
canvas.addEventListener("mousemove", (e) => {
  if (drag && dettaglio && (e.buttons & 1)) {
    // trascinando si sposta la vista ingrandita (in orizzontale la carta si ripete)
    const [x, y] = pointer(e);
    if (Math.abs(x - drag.x) + Math.abs(y - drag.y) > 3) drag.moved = true;
    if (drag.moved) {
      const w = dettaglio.width;
      centro = [(((drag.centro[0] - (x - drag.x) / zoom) % w) + w) % w,
        Math.min(Math.max(drag.centro[1] - (y - drag.y) / zoom, 0), dettaglio.height)];
      render();
      return;
    }
  }
  const h = countryUnder(e);
  if (h !== hovered) {
    hovered = h;
    render();
  }
});
canvas.addEventListener("click", (e) => {
  audio.unlock();
  if (drag?.moved) {
    drag = null;
    return;
  }
  drag = null;
  const i = countryUnder(e);
  if (i < 0) return;
  const k = order.indexOf(i);
  if (k >= 0) selected = k;
  ui("cursore");
  render();
});

canvas.addEventListener("wheel", (e) => {
  if (view !== "mappa" || !carta || title !== null) return;
  const [x, y] = pointer(e);
  if (y < MAP_Y || y >= MAP_Y + carta.height) return;
  e.preventDefault();
  setZoom(zoom + (e.deltaY < 0 ? 1 : -1), [x, y - MAP_Y]);
  ui("clic");
  render();
}, { passive: false });

const fit = () => screen.fitInteger(window.innerWidth, window.innerHeight);
window.addEventListener("resize", fit);
fit();
render();
void loadMap().then(loadPortraits);
