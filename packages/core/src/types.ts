/**
 * Stato della simulazione. I nomi seguono quelli ufficiali del modello originale
 * (visualizzatore di debug dell'originale, vedi docs/MODELLO.md), in inglese come gli
 * identificatori del codice; commenti e testi del gioco sono in italiano.
 */

/** Le cinque ansie, 0–100. */
export interface Anxieties {
  nuclear: number;
  military: number;
  political: number;
  economic: number;
  social: number;
}

/** I cinque bisogni d'aiuto ("hunger"), in $. */
export interface Hungers {
  humanitarian: number;
  economic: number;
  intelligence: number;
  military: number;
  nuclear: number;
}

/** Bilancio dell'intelligence e bilanci d'aiuto di un paese, in $. */
export interface Budgets {
  intel: number;        // IntelBudget: totale
  covertAction: number; // CAAG$: azioni coperte contro i governi
  intelAid: number;     // IntelAid$
  insurgency: number;   // Insurg$: insurrezioni all'estero
  espSelf: number;      // ESP$_SELF: spionaggio interno
  espForeign: number;   // ESP$: spionaggio all'estero
  militaryAid: number;
  economicAid: number;
  humanitarianAid: number;
  nuclearAid: number;
}

/** Tipi di aiuto nell'ordine dei dati: umanitario, economico, intelligence, militare, nucleare. */
export const AID_TYPES = ["humanitarian", "economic", "intelligence", "military", "nuclear"] as const;
export type AidType = (typeof AID_TYPES)[number];

export interface Country {
  /** Chiave stabile del paese (codice o nome), usata dalle regole e dagli scenari. */
  key: string;
  name: string;

  // --- economia ---
  econPower: number;      // PIL / 1e5
  gdpGrowth: number;      // frazione annua
  population: number;
  popGrowth: number;      // frazione annua
  pcGnp: number;          // PIL pro capite, $
  qol: number;            // qualità della vita 0–1
  socialSpending: number; // $
  oilReserves: number;    // % delle riserve mondiali
  strategicReserves: number;

  // --- forza ---
  troops: number;         // forza armata (Military Manpower)
  milSpend: number;       // $
  milCapital: number;     // qualità militare
  milPower: number;
  nucSpend: number;       // $
  nucPower: number;
  nucLevel: number;       // 0–6
  warheads: number;

  // --- peso nel mondo (percentuali) ---
  milShare: number;
  econShare: number;
  nucShare: number;
  influence: number;      // TI
  influencePrev: number;  // OLDTI
  regInfluence: number;   // TRI
  regMilShare: number;    // RMI
  regEconShare: number;   // REI
  stratValue: number;     // Stratval
  flag144: number;        // byte senza nome ufficiale, entra nel valore strategico

  // --- governo e società ---
  ideology: string;       // lettera A–M, "" se inattivo
  ethic: number;          // 1–6
  ambition: number;       // 1–6
  ler: number;            // Leadership Effectiveness Rating 0–1
  repression: number;     // LastPolice 0–4
  outcry: number;         // Social Outcry 0–100
  peace: number;          // Net Peace 1–6
  /** Belligeranza (% del PIL desiderata per la difesa): [anno corrente, precedente, due anni fa]. */
  belligerence: [number, number, number];
  belligerenceAvg: number;

  // --- politica estera ---
  orientation: number;    // 1–8
  team: number;           // 0 = nessuna squadra, altrimenti numero di squadra
  teamLeaderInCoalition: boolean;
  controlledBy: number;   // indice del paese che lo controlla

  anxiety: Anxieties;
  hunger: Hungers;
  budget: Budgets;

  /** Per ciascun tipo d'aiuto, M$ ricevuti da ogni slot donatore. */
  aidReceived: Record<AidType, number[]>;
  /** M$ di spionaggio di ogni slot donatore in questo paese. */
  spiesReceived: number[];
  /** Livello commerciale con ogni slot donatore (1 bloccato … 4 nazione più favorita). */
  tradeLevel: number[];
}

export interface RegionDef {
  id: number;
  name: string;
  /** Membri: `core` true = membro ('C'), false = adiacente ('A'). */
  members: { country: number; core: boolean }[];
}

export interface RegionState {
  peace: number;           // livello di pace regionale 1–6
  coalition: number[];
  maxPcGnp: number;
  maxNucShare: number;
  maxNucSpend: number;
  maxMilShare: number;
  maxMilSpend: number;
  maxIntelBudget: number;
  maxGdpGrowth: number;
  maxEcon: number;
  sumEcon: number;
  sumMilPower: number;
}

export interface WorldState {
  countries: Country[];
  regions: RegionDef[];
  regionState: RegionState[];
  /** Confinanti di ogni paese (indici). */
  neighbours: number[][];

  worldPeace: number;
  /** Indici dei 15 donatori (slot 0..14). */
  donors: number[];
  coalition: number[];
  teamLeaders: number[];
  /** Ideologie ordinate per influenza totale. */
  ideologyRanking: string;
  /** Etica del paese più influente dell'ideologia dominante. */
  leaderEthic: number;

  /** Normalizzatore fisso della qualità della vita (MISC+0x08 nell'originale: 23.134,4). */
  qolNormalizer: number;

  totals: { econPower: number; milPower: number; nucPower: number; population: number };
  maxima: { pcGnp: number; nucSpend: number; milSpend: number; intelBudget: number; gdpGrowth: number };

  /** Guerre in corso (CONFLICT nell'originale). */
  wars: War[];
  /** Truppe schierate fuori dai confini (TROOPS nell'originale). */
  deployments: Deployment[];
  /** Disastri recenti (paese, giorno, tipo): servono agli aiuti d'emergenza. */
  disasters: { country: number; day: number; type: number }[];
}

/** Un contingente all'estero. */
export interface Deployment {
  owner: number;
  location: number;
  troops: number;
  initial: number;
  /** Giorno di partenza e di arrivo: prima di arrivare non combatte. */
  sent: number;
  arrive: number;
  /** Livello ordinato: il contingente cresce ogni settimana fino a questo numero di soldati. */
  ordered?: number;
}

/** Un lato di una guerra (struttura di lato di FUN_5825_0000). */
export interface WarSide {
  countries: number[];
  /** Truppe portate da ciascun partecipante (stesso ordine di `countries`). */
  contributions: number[];
  troops: number;        // +0x00 truppe impegnate
  reserves: number;      // +0x08 forza armata − truppe impegnate
  mobilizable: number;   // +0x10 3% della popolazione, al massimo la forza totale
  strength: number;      // +0x18 forza % 0–100
  dead: number;          // +0x20 morti dell'ultimo tick
  civilians: number;     // +0x28 vittime civili dell'ultimo tick
  force: number;         // +0x38 forza totale
  population: number;    // +0x40
  spending: number;      // +0x48 spesa militare
  ler: number;           // +0x50 LER medio (+0,1 per i difensori)
  ambition: number;      // +0x58 ambizione media (+2 per i difensori)
  repression: number;    // +0x60 repressione media
  totalDead: number;
  totalCivilians: number;
}

export interface War {
  id: number;
  /** Paese in cui si combatte (di solito il difensore). */
  theater: number;
  /** Giorno d'inizio. */
  start: number;
  /** [attaccanti, difensori]. */
  sides: [WarSide, WarSide];
  /** Mobilitazioni generali già ordinate dal giocatore difensore. */
  mobilized?: number;
}
