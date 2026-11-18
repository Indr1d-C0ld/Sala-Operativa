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
  };

  /**
   * Ritorsioni (FUN_976b_044d e FUN_976b_0ef2): chi subisce un'azione risponde, sempre se è
   * riuscita e con probabilità `failureChance`% se è fallita; con lui il leader della sua squadra.
   */
  retaliation: {
    /** APPACT.FIL: per codice subito, 3 righe (0 mite … 2 dura) di 5 risposte; −1 nessuna. */
    responses: number[][][];
    /** Gravità del codice subito (0, 1, 2), che si somma ad ambizione/4 − etica per la riga. */
    gravity: number[];
    failureChance: number;
    /** Azione in più del bersaglio dopo un'azione riuscita (codice subito → risposta). */
    afterwards: Record<number, number>;
  };

  /** Reazione del giocatore: membri permanenti del Consiglio di sicurezza (veto alle sanzioni). */
  reaction: { vetoPowers: string[] };

  /** Turno dei paesi IA (originale: FUN_b442_0000, overlay 36, e BIGTABLE.TXT). */
  ai: {
    /**
     * Ogni quanti giorni gira il turno IA. L'originale lo chiama una volta a settimana, il
     * martedì (1000:2bb4).
     */
    turnEveryDays: number;
    /**
     * Per etica: soglie cumulative (su 100) dei 5 gruppi di righe, dal più ostile al più mite.
     * L'originale usa la riga int(etica + 0,5): la riga 0 non serve mai, e l'etica 6 legge oltre
     * la tabella (i pesi della prima riga di BIGTABLE), cioè 3% gruppo ostile e altrimenti il più
     * mite. La settima riga lo riproduce.
     */
    groupByEthic: number[][];
    /** Per pace mondiale 1–6 e relazione 1–7: colonna (1–6) della tabella dei pesi. */
    columnByPeace: number[][];
    /** Prima riga di ogni gruppo nella tabella dei pesi (6 valori, l'ultimo è la fine). */
    groupStart: number[];
    /**
     * Pesi delle 28 righe di BIGTABLE.TXT nelle 6 colonne, dalla più ostile (1) alla più mite
     * (6). Le righe non sono codici d'azione: li dà `rowToCode`.
     */
    weights: number[][];
    /**
     * Codice d'azione di ogni riga (tabella locale di b442:022b); −1 per le due righe del
     * commercio, `tradeDownRow` (un passo verso l'embargo) e `tradeUpRow` (verso la nazione più
     * favorita), che valgono solo per i donatori.
     */
    rowToCode: number[];
    tradeDownRow: number;
    tradeUpRow: number;
    /**
     * Righe "fuori tabella" se rand(1, rogueDie) < etica: con relazione > 4 / altrimenti. Sono
     * righe miti (diplomazia): il ramo lo prendono i paesi etici.
     */
    rogueFriendly: number[];
    rogueOther: number[];
    /** Dado del ramo fuori tabella; l'originale usa 7. */
    rogueDie: number;
    /**
     * ◇ Fuori da una guerra l'IA non lancia l'atomica ma la minaccia (allerta nucleare). Senza
     * questo freno, con il turno settimanale, le potenze nucleari scelgono l'azione 24 più di
     * dieci volte l'anno e in pochi anni azzerano l'economia mondiale.
     */
    nuclearOnlyAtWar: boolean;
    /**
     * ◇ Anche in guerra l'IA lancia per prima solo se il suo lato sta perdendo (forza < 50%),
     * come nell'escalation del modulo guerra; altrimenti minaccia (allerta nucleare). Senza,
     * le guerre fra potenze nucleari finiscono quasi sempre con più attacchi atomici.
     */
    nuclearOnlyWhenLosing: boolean;
    /**
     * ◇ Deterrenza: l'IA non invade un paese con un arsenale credibile (livello nucleare ≥ 4 e
     * testate); al posto dell'invasione conduce esercitazioni militari al confine.
     */
    nuclearDeterrence: boolean;
    /**
     * ◇ L'IA non conduce attacchi chirurgici né invasioni contro un paese amico (relazione ≥ 5).
     * Le tabelle dell'originale lasciano un po' di peso all'invasione anche nelle colonne miti,
     * e i paesi europei finivano per annettersi fra loro.
     */
    friendlyRestraint: boolean;
    /**
     * ◇ Pace democratica: due paesi con queste ideologie non si attaccano né si invadono (vuoto:
     * regola spenta). Le tabelle dell'originale non rendono amiche fra loro le democrazie
     * (capitalismo e socialismo democratico sono neutrali), e senza questa regola Regno Unito,
     * Germania o Turchia invadevano i vicini europei.
     */
    democraticPeace: string[];
    /**
     * ◇ Oltre i confini l'IA invade solo dove ha già truppe schierate vicino al bersaglio, come
     * nell'originale che legge i contingenti TROOPS; la soglia `war.projectionShare` vale solo
     * per il giocatore. Senza, la prima potenza militare dopo gli Stati Uniti conquista paesi in
     * ogni continente.
     */
    projectionNeedsTroops: boolean;
    /**
     * ◇ L'allerta nucleare (l'atomica trattenuta da `nuclearOnlyAtWar` o `nuclearOnlyWhenLosing`)
     * scatta solo se la relazione è al massimo questo livello; altrimenti l'azione cade (7: sempre).
     */
    nuclearAlertMaxRelation: number;
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
