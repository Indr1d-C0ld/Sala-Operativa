/**
 * Regole e tabelle della simulazione. Il nucleo non contiene costanti di gioco "speciali":
 * tutto ciò che è una scelta di bilanciamento o un'eccezione per singoli paesi arriva da qui,
 * così che il profilo "classico" (fedele all'originale) e quello "nuovo" si scambino senza
 * toccare il codice, e che i mod possano cambiarle.
 */
export interface Rules {
  /** Pesi [militare, economico] dell'influenza mondiale per livello di pace mondiale 1–6. */
  influenceWeights: Record<number, [number, number]>;
  /** Pesi [militare, economico] dell'influenza regionale per livello di pace regionale 1–6. */
  regionalWeights: Record<number, [number, number]>;
  /** % del PIL desiderata per la difesa, righe = pace 0–6, colonne = etica 0–6. */
  belligerenceTable: number[][];

  /** Soglie della coalizione minima vincente. */
  coalition: { candidateMin: number; maxCandidates: number; winMin: number; winMax: number };

  /** Ideologie: lettera e nome (italiano). */
  ideologies: { letter: string; name: string }[];
  /** Ideologie amiche e nemiche di ciascuna ideologia (lettere). */
  friends: Record<string, string>;
  enemies: Record<string, string>;

  /** Correzioni all'orientamento di politica estera. */
  orientationAdjust: {
    byIdeology: Record<string, number>;
    byCountry: Record<string, number>;
    /** Aggiunta per i paesi con etica < 2 e ambizione >= 5. */
    ruthlessAmbitious: number;
  };

  /** Regole del livello di relazione fra due paesi (1 ostile .. 7 alleato). */
  relation: {
    bonusPairs: { a: string; b: string; delta: number }[];
    rivals: { a: string; b: string; delta: number }[];
    /** Ideologia che costa 1 punto di relazione a chiunque la abbia (imperialismo). */
    penaltyIdeology: string;
    /** Dimezzamenti speciali: se `small` ha ideologia del grande `bigIdeology` (o viceversa). */
    halvings: { country: string; asSmallVsBigIdeology?: string; asBigVsSmallIdeology?: string }[];
  };

  /** Paesi che nelle somme militari ed economiche regionali contano per una frazione (URSS = 1/3). */
  regionalWeightOverrides: Record<string, number>;

  /** Aiuti esteri. */
  aid: {
    /** Influenza minima perché un donatore distribuisca aiuti (2,5). */
    minDonorInfluence: number;
    /** Riproduce l'errore dell'originale nel calcolo dell'importo (profilo classico). */
    classicBug: boolean;
  };

  /** Eventi sociali e cambio di regime. */
  social: {
    /** Probabilità % di ogni stadio 1–10, una riga per livello di repressione 1–4. */
    stageChance: number[][];
    /** Intervallo [min, max] dell'etica assegnata a un nuovo regime, per ideologia. */
    ethicRange: Record<string, [number, number]>;
    /** Ideologie riservate a certi paesi (il Sionismo a Israele). */
    reservedIdeologies: Record<string, string[]>;
    /** Ideologie islamiche: un nuovo regime le sceglie solo se lo era il precedente. */
    islamicIdeologies: string;
  };

  /** Ansie: costanti del calcolo. */
  anxiety: {
    humanitarianReference: number;   // PIL pro capite di riferimento per i bisogni umanitari (3000 $)
    economicCap: number;             // tetto del PIL pro capite mondiale per l'aiuto economico (21000 $)
  };

  /** Disastri (FUN_9aba_0000): tabelle per tipo (carestia, terremoto, alluvione, aereo, impianto chimico). */
  disasters: {
    /** ◇ Probabilità che un giorno porti un disastro da qualche parte. */
    dailyChance: number;
    cumulative: number[];
    damage: number[];
    casualties: number[];
    growth: number[];
    rogueAmbition: number;
    rogueEthic: number;
  };

  /** Guerra (FUN_5825_0000). */
  war: {
    /** Ogni quanti giorni si combatte un tick (non ricavato dall'originale). */
    tickEveryDays: number;
    /** Tabelle T1 (morti dei difensori) e T2 (degli attaccanti) per riga 0–20, poi divise per 6. */
    defenderLosses: number[];
    attackerLosses: number[];
    /** ◇ Quota militare oltre la quale si invade anche senza confine comune. */
    projectionShare: number;
    /** ◇ Quota delle truppe che chi attacca impegna. */
    commitShare: number;
  };

  /** Reazione del giocatore: membri permanenti del Consiglio di sicurezza (veto alle sanzioni). */
  reaction: { vetoPowers: string[] };

  /** Turno dei paesi IA (originale: FUN_b442_0000, overlay 36, e BIGTABLE.TXT). */
  ai: {
    /** Ogni quanti giorni gira il turno IA (non ricavato dall'originale: scelta di gioco). */
    turnEveryDays: number;
    /** Per etica arrotondata 0–6: soglie cumulative (su 100) dei 5 gruppi di azioni. */
    groupByEthic: number[][];
    /** Per pace mondiale 1–6 e livello 1–7: colonna (1–6) della tabella dei pesi. */
    columnByPeace: number[][];
    /** Prima riga di ogni gruppo nella tabella dei pesi (6 valori, l'ultimo è la fine). */
    groupStart: number[];
    /** Pesi delle azioni (righe = codici 0–27, colonne 1–6 dal meno al più ostile). */
    weights: number[][];
    /** Azioni "fuori tabella" se rand(1,7) < etica: livello > 4 / altrimenti. */
    rogueHostile: number[];
    rogueOther: number[];
    /**
     * L'IA dell'originale legge due scale al contrario rispetto al resto del gioco: usa il
     * livello di relazione (7 = alleato) come il "Country Interaction Mood" del manuale
     * (7 = inimicizia), e l'etica (6 = etico) come spietatezza. Così gli alleati si invadono e
     * i paesi etici scelgono più spesso assassinii e attacchi. true riproduce l'originale;
     * false capovolge entrambe le scale (8 − relazione, 7 − etica).
     */
    originalScales: boolean;
    /**
     * ◇ Fuori da una guerra l'IA non lancia l'atomica ma la minaccia (allerta nucleare). Senza
     * questo freno, con il turno settimanale, le potenze nucleari scelgono l'azione 24 più di
     * dieci volte l'anno e in pochi anni azzerano l'economia mondiale.
     */
    nuclearOnlyAtWar: boolean;
  };
}

/** Regole della generazione all'avvio (packages/data/src/generation.ts). */
export interface GenerationRules {
  /** Prima regola che corrisponde al tipo di governo; `chance` < 1 la applica solo a una parte dei paesi. */
  ideologyByGovernment: {
    pattern: string;
    ideology: string;
    muslimMin?: number;
    minPc?: number;
    maxPc?: number;
    minMilitaryPct?: number;
    chance?: number;
  }[];
  ideologyOverrides: { code: string; ideology: string; from?: number; to?: number }[];
  /** Indice dei prezzi per anno (2026 = 1): le soglie di reddito sono in dollari 2026. */
  priceIndex: [number, number][];
  /** Spesa militare in % del PIL dove il Factbook non la dà. */
  militaryPct: { code: string; pct: number; from?: number; to?: number }[];
  democracyPattern: string;
  authoritarianPattern: string;
  /** Regioni: prima regola che corrisponde all'area geografica del Factbook ("Map references") e alle coordinate. */
  regions: { name: string; mapRef: string[]; lat?: [number, number]; lon?: [number, number] }[];
  /** Regione imposta per codice, quando area e coordinate centrali ingannano (Russia). */
  regionByCode: Record<string, string>;
  /** Arsenali nucleari: livello e testate per anno (interpolate fra gli anni dati). */
  nuclear: { code: string; level: number; from?: number; to?: number; warheads: [number, number][] }[];
  teams: { joinChance: number; sameRegionBonus: number; sameIdeologyBonus: number };
  /** Contingenti all'estero all'inizio: soldati per anno, interpolati (stime pubbliche arrotondate). */
  deployments: { owner: string; location: string; from?: number; to?: number; troops: [number, number][] }[];
}
