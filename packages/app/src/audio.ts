/**
 * Audio del prototipo: effetti sonori legati agli eventi e musica di sottofondo.
 *
 * I file stanno in `public/suoni/<nome>.ogg` e `public/musica/<nome>.ogg`; quelli che mancano
 * vengono ignorati, così il gioco resta silenzioso ma funzionante. Il browser permette l'audio
 * solo dopo un gesto del giocatore: il contesto si crea al primo tasto o clic.
 */
export const SOUNDS = [
  // eventi del mondo
  "conferma", "fallimento", "notizia", "allarme", "guerra", "nucleare", "disastro", "vittoria", "sconfitta",
  "truppe", "disordini", "squillo", "mese",
  // interfaccia
  "clic", "cursore", "apri", "chiudi", "regola", "rifiuto", "ordine", "salvataggio", "avvio",
] as const;
export type SoundName = (typeof SOUNDS)[number];
export const TRACKS = ["tema", "crisi"] as const;
export type TrackName = (typeof TRACKS)[number];

const PREFS_KEY = "melchior-audio";

export class GameAudio {
  private ctx: AudioContext | null = null;
  private buffers = new Map<string, AudioBuffer | null>();
  private musicGain: GainNode | null = null;
  private music: { name: TrackName; source: AudioBufferSourceNode } | null = null;
  private wanted: TrackName | null = null;
  musicOn = true;
  soundOn = true;

  constructor(private base: string) {
    try {
      const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as { musicOn?: boolean; soundOn?: boolean };
      this.musicOn = p.musicOn ?? true;
      this.soundOn = p.soundOn ?? true;
    } catch {
      // preferenze illeggibili: valori predefiniti
    }
  }

  /** Da chiamare a ogni gesto del giocatore: crea il contesto audio la prima volta. */
  unlock(): void {
    if (this.ctx) return;
    try {
      this.ctx = new AudioContext();
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.35;
      this.musicGain.connect(this.ctx.destination);
      if (this.wanted) void this.playMusic(this.wanted);
    } catch {
      this.ctx = null;                         // niente audio in questo browser
    }
  }

  private async buffer(path: string): Promise<AudioBuffer | null> {
    if (!this.ctx) return null;
    if (this.buffers.has(path)) return this.buffers.get(path) ?? null;
    this.buffers.set(path, null);              // un solo tentativo per file
    try {
      const r = await fetch(`${this.base}${path}`);
      // un file mancante può tornare come pagina HTML (ripiego del server): non è audio
      if (!r.ok || (r.headers.get("content-type") ?? "").includes("text/html")) return null;
      const b = await this.ctx.decodeAudioData(await r.arrayBuffer());
      this.buffers.set(path, b);
      return b;
    } catch {
      return null;
    }
  }

  /**
   * Effetto sonoro (se attivo e se il file esiste). `rate` cambia velocità e intonazione
   * (1 = originale), `delay` lo fa partire dopo tanti secondi.
   */
  play(name: SoundName, volume = 0.8, rate = 1, delay = 0): void {
    if (!this.soundOn || !this.ctx) return;
    const asked = this.ctx.currentTime;
    void this.buffer(`suoni/${name}.ogg`).then((b) => {
      if (!b || !this.ctx) return;
      const src = this.ctx.createBufferSource();
      const gain = this.ctx.createGain();
      gain.gain.value = volume;
      src.buffer = b;
      src.playbackRate.value = rate;
      src.connect(gain).connect(this.ctx.destination);
      src.start(Math.max(this.ctx.currentTime, asked + delay));
    });
  }

  /** Musica in loop; cambiare brano sostituisce quello in corso. */
  async playMusic(name: TrackName): Promise<void> {
    this.wanted = name;
    if (!this.musicOn || !this.ctx || !this.musicGain) return;
    if (this.music?.name === name) return;
    const b = await this.buffer(`musica/${name}.ogg`);
    if (!b || this.wanted !== name || !this.musicOn) return;
    this.stopMusic();
    const src = this.ctx.createBufferSource();
    src.buffer = b;
    src.loop = true;
    src.connect(this.musicGain);
    src.start();
    this.music = { name, source: src };
  }

  stopMusic(): void {
    try {
      this.music?.source.stop();
    } catch {
      // già ferma
    }
    this.music = null;
  }

  toggleMusic(): void {
    this.musicOn = !this.musicOn;
    if (!this.musicOn) this.stopMusic();
    else if (this.wanted) void this.playMusic(this.wanted);
    this.savePrefs();
  }

  toggleSound(): void {
    this.soundOn = !this.soundOn;
    this.savePrefs();
  }

  private savePrefs(): void {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ musicOn: this.musicOn, soundOn: this.soundOn }));
    } catch {
      // nessuno spazio: le preferenze valgono solo per questa sessione
    }
  }
}
