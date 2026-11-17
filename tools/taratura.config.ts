import { defineConfig } from "vitest/config";

/** Configurazione del banco di misura dell'IA (tools/taratura_ia.ts), fuori dai test normali. */
export default defineConfig({
  test: {
    include: [process.env.FILE ?? "tools/taratura_ia.ts"],
    reporters: ["dot"],
  },
});
