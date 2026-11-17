/** Sostituisce i segnaposto {nome} di un testo del catalogo; quelli senza valore restano vuoti. */
export const fill = (t: string, p: Record<string, string>): string => t.replace(/\{(\w+)\}/g, (_, k: string) => p[k] ?? "");
