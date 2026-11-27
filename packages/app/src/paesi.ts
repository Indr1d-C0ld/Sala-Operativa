/**
 * Nomi dei paesi con articoli e preposizioni. Italiano: tabella `testi/paesi.json`, prima stesura
 * da tools/build_paesi.py e poi rivista a mano. Inglese: tabella `testi/paesi.en.json` (nome e
 * "the"), dai nomi standard dell'inglese (Intl) e del Factbook, rivista a mano.
 *
 * Nei testi un nome si usa così, con `paese` (o `attore`, `altro`, `colpevole`) come radice:
 *   {paese}      Cina              nome nudo, per titoli ed elenchi
 *   {paese_il}   la Cina           soggetto o complemento oggetto
 *   {paese_di}   della Cina        {paese_a}  alla Cina      {paese_da}  dalla Cina
 *   {paese_su}   sulla Cina        {paese_in} in Cina / a Cuba / negli Stati Uniti
 */
import tabella from "./testi/paesi.json";
import tabellaEn from "./testi/paesi.en.json";

interface Voce { nome: string; art: string; in: string }
const TABELLA = tabella as Record<string, Voce>;
interface VoceEn { nome: string; the: boolean }
const TABELLA_EN = tabellaEn as Record<string, VoceEn>;

const ARTICOLATE: Record<string, Record<string, string>> = {
  di: { il: "del ", lo: "dello ", la: "della ", "l'": "dell'", i: "dei ", gli: "degli ", le: "delle " },
  a: { il: "al ", lo: "allo ", la: "alla ", "l'": "all'", i: "ai ", gli: "agli ", le: "alle " },
  da: { il: "dal ", lo: "dallo ", la: "dalla ", "l'": "dall'", i: "dai ", gli: "dagli ", le: "dalle " },
  su: { il: "sul ", lo: "sullo ", la: "sulla ", "l'": "sull'", i: "sui ", gli: "sugli ", le: "sulle " },
  in: { il: "nel ", lo: "nello ", la: "nella ", "l'": "nell'", i: "nei ", gli: "negli ", le: "nelle " },
};

export interface Forme { nome: string; il: string; di: string; a: string; da: string; su: string; in: string }

/** "a" davanti a una parola che comincia per a diventa "ad" (ad Aruba). */
const a = (nome: string) => (/^[aA]/.test(nome) ? `ad ${nome}` : `a ${nome}`);

/** Le forme di un nome dalla sua voce; senza voce, il nome nudo con le preposizioni semplici. */
export function forme(v: Voce | undefined, fallback: string): Forme {
  const nome = v?.nome ?? fallback;
  const art = v?.art ?? "";
  if (!art) {
    return { nome, il: nome, di: `di ${nome}`, a: a(nome), da: `da ${nome}`, su: `su ${nome}`,
      in: v?.in === "a" ? a(nome) : `in ${nome}` };
  }
  const con = (prep: string) => `${ARTICOLATE[prep]![art]}${nome}`;
  return {
    nome, il: art === "l'" ? `l'${nome}` : `${art} ${nome}`,
    di: con("di"), a: con("a"), da: con("da"), su: con("su"),
    in: v?.in === "art" ? con("in") : v?.in === "a" ? a(nome) : `in ${nome}`,
  };
}

/** Voce della tabella per un codice Factbook. */
export const voce = (code: string): Voce | undefined => TABELLA[code];

/** Voce inglese per un codice Factbook. */
export const voceEn = (code: string): VoceEn | undefined => TABELLA_EN[code];

/**
 * Le forme inglesi, con le stesse chiavi di quelle italiane: {paese_il} "the United States" o
 * "China", {paese_di} "of …", {paese_a} "to …", {paese_da} "from …", {paese_su} "on …",
 * {paese_in} "in …".
 */
export function formeEn(v: VoceEn | undefined, fallback: string): Forme {
  const nome = v?.nome ?? fallback;
  const il = v?.the ? `the ${nome}` : nome;
  return { nome, il, di: `of ${il}`, a: `to ${il}`, da: `from ${il}`, su: `on ${il}`, in: `in ${il}` };
}

/** Parametri per `fill` di un nome: {radice}, {radice_il}, {radice_di}, … (vuoti se manca). */
export function parametri(radice: string, f: Forme | undefined): Record<string, string> {
  const x = f ?? { nome: "", il: "", di: "", a: "", da: "", su: "", in: "" };
  return {
    [radice]: x.nome, [`${radice}_il`]: x.il, [`${radice}_di`]: x.di, [`${radice}_a`]: x.a,
    [`${radice}_da`]: x.da, [`${radice}_su`]: x.su, [`${radice}_in`]: x.in,
  };
}

/** Maiuscola all'inizio di una frase ("la Cina…" → "La Cina…"). */
export const maiuscola = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
