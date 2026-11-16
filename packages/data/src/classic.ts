import type { Rules } from "@melchior/core";

/**
 * Profilo "classico": tabelle ed eccezioni ricavate dal gioco originale (re/FORMATS.md).
 * Le chiavi dei paesi sono quelle dell'elenco originale; il profilo "nuovo" le sostituirà con
 * codici ISO e regole generali.
 */
// Le eccezioni per paese compaiono due volte: col nome dei file originali (test di accettazione)
// e col codice Factbook (mondi generati dagli scenari).
export const classicRules: Rules = {
  influenceWeights: { 1: [1.0, 0.0], 2: [0.7, 0.3], 3: [0.6, 0.4], 4: [0.5, 0.5], 5: [0.3, 0.7], 6: [0.1, 0.9] },
  regionalWeights: { 1: [1.0, 0.0], 2: [1.0, 0.0], 3: [1.0, 0.0], 4: [0.9, 0.1], 5: [0.6, 0.4], 6: [0.3, 0.7] },
  belligerenceTable: [
    [50, 45, 45, 40, 40, 30, 50],
    [50, 41, 25, 17, 12.7, 9.3, 8],
    [30, 20, 15, 11, 8.5, 6.5, 5.5],
    [20, 13, 10, 7.7, 6, 4.5, 3.7],
    [15, 9.5, 8, 5.7, 4.3, 3, 2.4],
    [12, 7.3, 6, 4.3, 3.1, 2, 1.4],
    [10, 6, 4.6, 3.3, 2.5, 1.3, 0.6],
  ],
  coalition: { candidateMin: 5, maxCandidates: 15, winMin: 50, winMax: 65 },
  ideologies: [
    { letter: "A", name: "Capitalismo democratico" },
    { letter: "B", name: "Comunismo" },
    { letter: "C", name: "Socialismo democratico" },
    { letter: "D", name: "Fascismo" },
    { letter: "E", name: "Islam democratico" },
    { letter: "F", name: "Islam fondamentalista" },
    { letter: "G", name: "Sionismo" },
    { letter: "H", name: "Imperialismo" },
    { letter: "J", name: "Capitalismo in via di sviluppo" },
    { letter: "K", name: "Nazionalismo democratico" },
    { letter: "L", name: "Centralismo in via di sviluppo" },
    { letter: "M", name: "Islam centralizzato" },
  ],
  friends: { A: "AGJ", B: "", C: "C", D: "D", E: "E", F: "F", G: "A", H: "", J: "A", K: "K", L: "", M: "M" },
  enemies: {
    A: "BDF", B: "CAHJDEFM", C: "HB", D: "BGFA", E: "HFB", F: "EHADB", G: "DMKL",
    H: "KLBCJEF", J: "BH", K: "HG", L: "HG", M: "GB",
  },
  orientationAdjust: {
    byIdeology: { E: -2, H: -2 },
    byCountry: { "Saudi Arabia": -1, France: 2, SA: -1, FR: 2 },
    ruthlessAmbitious: 1,
  },
  relation: {
    bonusPairs: [{ a: "United States", b: "Israel", delta: 1 }, { a: "US", b: "IS", delta: 1 }],
    rivals: [
      { a: "India", b: "Pakistan", delta: -2 },
      { a: "Vietnam", b: "China", delta: -3 },
      { a: "India", b: "China", delta: -3 },
      { a: "Greece", b: "Turkey", delta: -3 },
      { a: "IN", b: "PK", delta: -2 },
      { a: "VM", b: "CH", delta: -3 },
      { a: "IN", b: "CH", delta: -3 },
      { a: "GR", b: "TU", delta: -3 },
    ],
    penaltyIdeology: "H",
    halvings: [
      { country: "Israel", asSmallVsBigIdeology: "L", asBigVsSmallIdeology: "K" },
      { country: "IS", asSmallVsBigIdeology: "L", asBigVsSmallIdeology: "K" },
    ],
  },
  regionalWeightOverrides: { "Soviet Union": 1 / 3, SUHH: 1 / 3 },
  aid: { minDonorInfluence: 2.5, classicBug: true },
  social: {
    stageChance: [
      [100, 90, 30, 12, 6, 3, 2, 1, 1, 1],
      [100, 100, 90, 36, 18, 9, 6, 3, 2, 1],
      [100, 100, 100, 100, 63, 27, 18, 9, 6, 3],
      [17, 14, 8, 4, 3, 18, 12, 6, 4, 2],
    ],
    ethicRange: {
      A: [4, 6], B: [1, 2], C: [3, 5], D: [1, 1], E: [3, 6], F: [2, 3],
      G: [2, 4], H: [1, 3], J: [1, 3], K: [2, 4], L: [1, 2], M: [1, 2],
    },
    reservedIdeologies: { G: ["Israel", "IS"] },
    islamicIdeologies: "EFM",
  },
  anxiety: { humanitarianReference: 3000, economicCap: 21000 },
  // tabelle locali di FUN_9aba_0000 (9aba:00ea–019e)
  disasters: {
    dailyChance: 0.05,
    cumulative: [10, 30, 50, 75, 100],
    damage: [0.01, 0.005, 0.002, 0.0005, 0.0005],
    casualties: [0.002, 0.0005, 0.0001, 0, 0],
    growth: [0.01, 0.005, 0.002, 0.0001, 0.0002],
    rogueAmbition: 5,
    rogueEthic: 1,
  },
  war: {
    tickEveryDays: 1,
    defenderLosses: [0.04, 0.035, 0.03, 0.025, 0.03, 0.035, 0.04, 0.045, 0.05, 0.06, 0.07, 0.08, 0.09, 0.1, 0.11,
      0.12, 0.13, 0.14, 0.15, 0.16, 0.21],
    attackerLosses: [0.08, 0.05, 0.04, 0.03, 0.02, 0.015, 0.012, 0.009, 0.007, 0.004, 0.003, 0.002, 0.001, 0.0009,
      0.0008, 0.0007, 0.0006, 0.0005, 0.0004, 0.0003, 0.0001],
    projectionShare: 15,
    commitShare: 0.5,
  },
  // id 30, 51, 136, 155, 156 nell'originale; con i codici Factbook anche la Russia dopo l'URSS
  reaction: {
    vetoPowers: ["China", "France", "Soviet Union", "United Kingdom", "United States", "CH", "FR", "SUHH", "RS", "UK", "US"],
  },
  ai: {
    turnEveryDays: 7,
    // tabelle locali di FUN_b442_0000 (inizializzate a b442:005d–0225)
    groupByEthic: [
      [15, 50, 75, 95, 100], [10, 45, 70, 90, 100], [5, 35, 65, 80, 100],
      [2, 25, 60, 75, 100], [0, 15, 35, 70, 100], [0, 10, 30, 70, 100],
    ],
    columnByPeace: [
      [1, 1, 2, 3, 4, 4, 5], [1, 2, 2, 3, 4, 4, 5], [1, 2, 3, 3, 4, 5, 5],
      [2, 3, 4, 4, 4, 5, 6], [3, 4, 4, 5, 5, 6, 6], [3, 4, 5, 5, 6, 6, 6],
    ],
    groupStart: [0, 7, 14, 19, 23, 28],
    // BIGTABLE.TXT: in ogni colonna i pesi di ciascun gruppo sommano a 100
    weights: [
      [3, 0, 0, 0, 0, 0], [7, 4, 2, 0, 0, 0], [10, 5, 0, 0, 0, 0], [10, 8, 0, 0, 0, 0],
      [55, 48, 43, 0, 0, 0], [15, 15, 0, 0, 0, 0], [0, 20, 55, 100, 100, 100],
      [10, 5, 2, 0, 0, 0], [15, 10, 3, 0, 0, 0], [25, 20, 15, 0, 0, 0], [20, 10, 5, 0, 0, 0],
      [30, 30, 25, 0, 0, 0], [0, 15, 25, 60, 50, 35], [0, 10, 25, 40, 50, 65],
      [0, 0, 1, 10, 20, 30], [30, 25, 15, 0, 0, 0], [5, 10, 15, 35, 40, 50],
      [25, 30, 35, 30, 25, 15], [40, 35, 34, 25, 15, 5],
      [64, 64, 50, 20, 10, 0], [31, 21, 20, 10, 0, 0], [5, 10, 20, 50, 60, 60], [0, 5, 10, 20, 30, 40],
      [0, 0, 0, 5, 10, 15], [0, 5, 10, 35, 50, 60], [5, 10, 25, 35, 30, 20], [10, 15, 20, 20, 10, 5],
      [85, 70, 45, 5, 0, 0],
    ],
    rogueHostile: [22, 16, 24, 14],
    rogueOther: [26, 27, 6, 22, 16, 24, 12],
    originalScales: false,
    nuclearOnlyAtWar: true,
  },
};
