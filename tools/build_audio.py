#!/usr/bin/env python3
"""
Effetti sonori e musiche del prototipo, composti e sintetizzati qui: nessun campione esterno.

Due strade, entrambe "da scheda audio anni '90":
- sintesi FM a due operatori in stile OPL2/Sound Blaster (numpy), per i suoni elettronici e
  di rumore: clic, conferma, fallimento, notizia, allarme, nucleare, disastro;
- partiture MIDI originali scritte in questo file e suonate da FluidSynth con un soundfont
  General MIDI, nello spirito dei moduli MIDI dell'epoca, per guerra, vittoria, sconfitta e
  per le due musiche (tema e crisi).

Le musiche sono loop senza stacchi: la coda (riverbero, rilasci) che supera la fine del
loop viene sommata all'inizio, così l'ultimo campione si collega al primo.

Sorgenti scritte in data/sources/audio/ (MIDI e WAV a 44,1 kHz prima della normalizzazione);
uscite in packages/app/public/suoni/<nome>.ogg e packages/app/public/musica/<nome>.ogg
(Vorbis mono, livelli equilibrati: effetti al picco di loudness momentanea −14 dBFS,
musiche a −20 dBFS RMS, picco sempre sotto −1 dBFS).

Richiede: python3 con numpy, fluidsynth, ffmpeg con libvorbis, un soundfont GM
(predefinito /usr/share/sounds/sf2/FluidR3_GM.sf2, cambiabile con SOUNDFONT=...).

Uso: python3 tools/build_audio.py [nome ...]   (senza nomi rifà tutti i file)
"""
from __future__ import annotations

import os
import struct
import subprocess
import sys
import wave
import zlib
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data/sources/audio"
OUT_SFX = ROOT / "packages/app/public/suoni"
OUT_MUS = ROOT / "packages/app/public/musica"
SOUNDFONT = os.environ.get("SOUNDFONT", "/usr/share/sounds/sf2/FluidR3_GM.sf2")
SR = 44100
RNG = np.random.default_rng(1990)


# ---------------------------------------------------------------------------- note e MIDI

NOTE = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def n(name: str) -> int:
    """'C#4' → numero MIDI (C4 = 60)."""
    base = NOTE[name[0]]
    i = 1
    while i < len(name) and name[i] in "#b":
        base += 1 if name[i] == "#" else -1
        i += 1
    return base + 12 * (int(name[i:]) + 1)


def hz(midi: float) -> float:
    return 440.0 * 2 ** ((midi - 69) / 12)


class Song:
    """Scrittore minimo di file MIDI (formato 0, 480 tick per semiminima)."""

    PPQ = 480

    def __init__(self, bpm: float):
        self.bpm = bpm
        self.events: list[tuple[int, int, bytes]] = []   # (tick, ordine, dati)
        tempo = round(60_000_000 / bpm)
        self.events.append((0, 0, b"\xff\x51\x03" + tempo.to_bytes(3, "big")))

    def tick(self, beat: float) -> int:
        return round(beat * self.PPQ)

    def seconds(self, beats: float) -> float:
        return beats * 60.0 / self.bpm

    def program(self, ch: int, prog: int, volume: int = 100, pan: int = 64, reverb: int = 40) -> None:
        self.events.append((0, 1, bytes([0xC0 | ch, prog])))
        self.events.append((0, 1, bytes([0xB0 | ch, 7, volume])))
        self.events.append((0, 1, bytes([0xB0 | ch, 10, pan])))
        self.events.append((0, 1, bytes([0xB0 | ch, 91, reverb])))

    def note(self, ch: int, beat: float, dur: float, pitch: int | str, vel: int) -> None:
        p = n(pitch) if isinstance(pitch, str) else pitch
        vel = max(1, min(127, round(vel)))
        self.events.append((self.tick(beat), 3, bytes([0x90 | ch, p, vel])))
        self.events.append((self.tick(beat + dur) - 1, 2, bytes([0x80 | ch, p, 0])))

    def chord(self, ch: int, beat: float, dur: float, pitches: list, vel: int) -> None:
        for p in pitches:
            self.note(ch, beat, dur, p, vel)

    def cc(self, ch: int, beat: float, num: int, value: int) -> None:
        self.events.append((self.tick(beat), 1, bytes([0xB0 | ch, num, max(0, min(127, round(value)))])))

    def bend(self, ch: int, beat: float, semis: float) -> None:
        """Pitch bend, con l'estensione predefinita di ±2 semitoni."""
        v = max(0, min(16383, round(8192 + semis / 2 * 8191)))
        self.events.append((self.tick(beat), 1, bytes([0xE0 | ch, v & 0x7F, v >> 7])))

    def end(self, beat: float) -> None:
        """Evento muto finale: FluidSynth smette di registrare all'ultimo evento."""
        self.events.append((self.tick(beat), 1, bytes([0xBF, 110, 0])))

    def write(self, path: Path) -> None:
        def vlq(x: int) -> bytes:
            out = [x & 0x7F]
            x >>= 7
            while x:
                out.append(0x80 | (x & 0x7F))
                x >>= 7
            return bytes(reversed(out))

        data = bytearray()
        last = 0
        for t, _, ev in sorted(self.events, key=lambda e: (e[0], e[1])):
            data += vlq(t - last) + ev
            last = t
        data += b"\x00\xff\x2f\x00"
        head = b"MThd" + struct.pack(">IHHH", 6, 0, 1, self.PPQ)
        path.write_bytes(head + b"MTrk" + struct.pack(">I", len(data)) + bytes(data))


def render_midi(song: Song, name: str) -> np.ndarray:
    mid = SRC / f"{name}.mid"
    raw = SRC / f"{name}.fluidsynth.wav"
    song.write(mid)
    subprocess.run(
        ["fluidsynth", "-ni", "-q", "-g", "0.5", "-r", str(SR), "-O", "s16", "-T", "wav",
         "-F", str(raw), SOUNDFONT, str(mid)],
        check=True, stdout=subprocess.DEVNULL,
    )
    with wave.open(str(raw)) as w:
        ch = w.getnchannels()
        x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float64) / 32768
    raw.unlink()
    return x.reshape(-1, ch).mean(axis=1)


# ---------------------------------------------------------------------------- sintesi FM

def t_axis(seconds: float) -> np.ndarray:
    return np.arange(int(seconds * SR)) / SR


def env(t: np.ndarray, attack: float, decay: float, sustain: float = 0.0,
        release_at: float | None = None, release: float = 0.05) -> np.ndarray:
    """Inviluppo esponenziale ADSR, come quelli dell'OPL."""
    e = np.where(t < attack, t / max(attack, 1e-6),
                 sustain + (1 - sustain) * np.exp(-(t - attack) / max(decay, 1e-6)))
    if release_at is not None:
        e = np.where(t < release_at, e, e * np.exp(-(t - release_at) / release))
    return e


def fm(t: np.ndarray, f: float | np.ndarray, ratio: float, index: float | np.ndarray,
       feedback: float = 0.0) -> np.ndarray:
    """Due operatori: modulatore a f·ratio sulla fase della portante a f (anche f variabile)."""
    phase_c = 2 * np.pi * np.cumsum(np.broadcast_to(f, t.shape)) / SR
    phase_m = phase_c * ratio
    mod = np.sin(phase_m + feedback * np.sin(phase_m))
    return np.sin(phase_c + index * mod)


def lowpass(x: np.ndarray, cutoff: float | np.ndarray) -> np.ndarray:
    """Passa-basso a un polo (anche con taglio variabile nel tempo)."""
    c = np.broadcast_to(np.asarray(cutoff, dtype=np.float64), x.shape)
    a = 1 - np.exp(-2 * np.pi * c / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i in range(len(x)):
        acc += a[i] * (x[i] - acc)
        y[i] = acc
    return y


def highpass(x: np.ndarray, cutoff: float) -> np.ndarray:
    return x - lowpass(x, cutoff)


def at(total: float, parts: list[tuple[float, np.ndarray]]) -> np.ndarray:
    """Somma frammenti posti agli istanti dati in un buffer lungo `total` secondi."""
    out = np.zeros(int(total * SR))
    for start, x in parts:
        i = int(start * SR)
        m = min(len(x), len(out) - i)
        x = x[:m].copy()
        f = min(m, int(0.004 * SR))
        x[m - f:] *= np.linspace(1, 0, f)           # niente scatti dove un frammento finisce
        out[i:i + m] += x
    return out


def fm_note(f: float, dur: float, ratio: float, index: float, attack=0.003, decay=0.15,
            sustain=0.0, idx_decay=0.08, feedback=0.0) -> np.ndarray:
    t = t_axis(dur)
    idx = index * (0.25 + 0.75 * np.exp(-t / idx_decay))    # il timbro si scurisce col tempo
    return at(dur, [(0.0, fm(t, f, ratio, idx, feedback) * env(t, attack, decay, sustain))])


def sfx_clic() -> np.ndarray:
    t = t_axis(0.09)
    noise = highpass(RNG.uniform(-1, 1, len(t)), 2500) * env(t, 0.0003, 0.004)
    blip = fm(t, 1850, 3.0, 1.5) * env(t, 0.0005, 0.007)
    thump = np.sin(2 * np.pi * 160 * t) * env(t, 0.001, 0.012)
    return 0.6 * noise + 0.45 * blip + 0.5 * thump


def sfx_conferma() -> np.ndarray:
    a = fm_note(hz(n("C5")), 0.16, 1.0, 2.2, decay=0.09, sustain=0.25)
    b = fm_note(hz(n("G5")), 0.45, 1.0, 2.2, decay=0.18, sustain=0.0)
    return at(0.55, [(0.0, a * 0.8), (0.11, b)])


def sfx_fallimento() -> np.ndarray:
    a = fm_note(hz(n("G4")), 0.2, 2.0, 2.6, decay=0.12, sustain=0.3, feedback=0.6)
    b = fm_note(hz(n("C#4")), 0.5, 2.0, 2.6, decay=0.22, sustain=0.0, feedback=0.6)
    return at(0.62, [(0.0, a * 0.9), (0.15, b)])


def sfx_notizia() -> np.ndarray:
    total = 1.45
    bell = fm_note(1320, 0.7, 3.5, 2.0, attack=0.001, decay=0.25, idx_decay=0.15)
    parts = [(0.0, bell * 0.55)]
    when = 0.18
    while when < total - 0.08:
        t = t_axis(0.05)
        bang = (highpass(RNG.uniform(-1, 1, len(t)), 1800) * env(t, 0.0003, 0.006) * 0.7
                + np.sin(2 * np.pi * RNG.uniform(170, 210) * t) * env(t, 0.001, 0.015) * 0.6
                + fm(t, RNG.uniform(850, 1000), 1.41, 2.0) * env(t, 0.0005, 0.005) * 0.3)
        parts.append((when, bang * RNG.uniform(0.7, 1.0)))
        when += RNG.choice([0.055, 0.07, 0.085, 0.07, 0.14])  # ritmo irregolare della telescrivente
    out = at(total, parts)
    t = t_axis(total)
    motor = lowpass(RNG.uniform(-1, 1, len(t)), 300) * 0.25 * env(t, 0.05, 10, 1.0, total - 0.15, 0.05)
    return out + motor


def sfx_allarme() -> np.ndarray:
    total = 1.7
    t = t_axis(total)
    step = 0.2
    hi = (np.floor(t / step) % 2) == 0
    f = np.where(hi, 960.0, 720.0)
    f = lowpass(f, 120)                                   # piccolo glissato fra le due note
    tone = fm(t, f, 2.0, 1.8, feedback=0.8)               # quasi quadra: allarme elettronico
    gate = 0.75 + 0.25 * np.cos(2 * np.pi * (t % step) / step)
    return tone * gate * env(t, 0.01, 10, 1.0, total - 0.12, 0.04)


def sfx_nucleare() -> np.ndarray:
    total = 3.2
    t = t_axis(total)
    crack = RNG.uniform(-1, 1, len(t)) * env(t, 0.001, 0.04)
    boom_f = 30 + 30 * np.exp(-t / 0.5)
    boom = np.sin(2 * np.pi * np.cumsum(boom_f) / SR) * env(t, 0.004, 1.3)
    brown = np.cumsum(RNG.uniform(-1, 1, len(t)))
    brown = highpass(brown / np.abs(brown).max(), 20)
    rumble = lowpass(brown, 80 + 900 * np.exp(-t / 0.35))
    rumble = rumble / np.abs(rumble).max() * env(t, 0.03, 1.1, 0.0)
    wobble = 0.8 + 0.2 * np.sin(2 * np.pi * 3.1 * t + 2 * np.sin(2 * np.pi * 0.7 * t))
    out = 0.35 * crack + 0.9 * boom + 1.0 * rumble * wobble
    return out * env(t, 0.0, 10, 1.0, total - 0.6, 0.18)


def sfx_disastro() -> np.ndarray:
    total = 2.6
    t = t_axis(total)
    brown = np.cumsum(RNG.uniform(-1, 1, len(t)))
    brown = highpass(brown / np.abs(brown).max(), 25)
    rumble = lowpass(brown, 160)
    rumble /= np.abs(rumble).max()
    shake = 0.6 + 0.4 * np.abs(lowpass(RNG.uniform(-1, 1, len(t)), 8)) * 6
    drone = fm(t, hz(n("E1")), 1.41, 1.2 * np.exp(-t / 1.5) + 0.3)     # rapporto non armonico: cupo
    swell = np.minimum(t / 0.45, 1.0) * np.exp(-np.maximum(t - 0.45, 0) / 0.8)
    return (rumble * np.clip(shake, 0, 1.4) + 0.45 * drone) * swell


def sweep(f0: float, f1: float, dur: float, ratio: float, index: float, decay: float) -> np.ndarray:
    t = t_axis(dur)
    f = f0 * (f1 / f0) ** (t / dur)
    return fm(t, f, ratio, index * np.exp(-t / (dur * 0.6))) * env(t, 0.002, decay, 0.0)


def sfx_cursore() -> np.ndarray:
    t = t_axis(0.04)
    return fm(t, 2400, 2.0, 0.8) * env(t, 0.0005, 0.006) + 0.3 * np.sin(2 * np.pi * 300 * t) * env(t, 0.001, 0.006)


def sfx_apri() -> np.ndarray:
    return at(0.16, [(0.0, sfx_cursore() * 0.6), (0.01, sweep(420, 1260, 0.14, 1.0, 1.6, 0.06))])


def sfx_chiudi() -> np.ndarray:
    return at(0.14, [(0.0, sweep(1100, 380, 0.12, 1.0, 1.6, 0.05)), (0.09, sfx_cursore() * 0.5)])


def sfx_regola() -> np.ndarray:
    return fm_note(880, 0.07, 2.0, 1.2, attack=0.001, decay=0.025, feedback=0.5)


def sfx_rifiuto() -> np.ndarray:
    def buzz() -> np.ndarray:
        t = t_axis(0.09)
        return fm(t, 140, 1.0, 3.5, feedback=1.2) * env(t, 0.002, 10, 1.0, 0.075, 0.008)
    return at(0.24, [(0.0, buzz()), (0.13, buzz())])


def sfx_ordine() -> np.ndarray:
    """Telegrafo: un relè e una breve sequenza di punti e linee."""
    total = 0.62
    parts = [(0.0, sfx_clic() * 0.7)]
    when = 0.06
    for length in (0.035, 0.035, 0.09, 0.035, 0.09, 0.035):
        t = t_axis(length)
        beep = fm(t, 1180, 1.0, 0.9) * env(t, 0.003, 10, 1.0, length - 0.006, 0.003)
        parts.append((when, beep * 0.8))
        when += length + 0.035
    return at(total, parts)


def sfx_squillo() -> np.ndarray:
    """Linea diretta: due squilli elettronici a trillo."""
    total = 1.5
    t = t_axis(0.62)
    trill = np.where((np.floor(t * 22) % 2) == 0, 1020.0, 1290.0)
    ring = fm(t, lowpass(trill, 400), 1.0, 1.2) * env(t, 0.01, 10, 1.0, 0.56, 0.02)
    return at(total, [(0.0, ring), (0.85, ring)])


def sfx_mese() -> np.ndarray:
    """Cambio di mese: tre palette che scattano e un rintocco basso."""
    parts = []
    for k in range(3):
        t = t_axis(0.03)
        flap = highpass(RNG.uniform(-1, 1, len(t)), 1200) * env(t, 0.0003, 0.005) + \
            np.sin(2 * np.pi * 240 * t) * env(t, 0.001, 0.008) * 0.6
        parts.append((k * 0.045, flap * (0.6 + 0.2 * k)))
    chime = fm_note(hz(n("G4")), 0.9, 3.5, 1.4, attack=0.002, decay=0.3, idx_decay=0.12)
    chime2 = fm_note(hz(n("D5")), 0.8, 3.5, 1.0, attack=0.002, decay=0.25, idx_decay=0.12)
    parts += [(0.14, chime * 0.6), (0.14, chime2 * 0.35)]
    return at(1.05, parts)


def sfx_salvataggio() -> np.ndarray:
    """Unità a dischetti: passi del motore della testina e rotazione."""
    total = 1.3
    parts = []
    when = 0.0
    for burst in (6, 3, 9, 4):
        step = RNG.choice([0.014, 0.018, 0.022])
        for _ in range(burst):
            t = t_axis(0.012)
            tick = fm(t, 1600 / (step * 100), 1.0, 2.5, feedback=1.0) * env(t, 0.0005, 0.004) + \
                highpass(RNG.uniform(-1, 1, len(t)), 3000) * env(t, 0.0002, 0.002) * 0.4
            parts.append((when, tick))
            when += step
        when += 0.12
    out = at(total, parts)
    t = t_axis(total)
    spin = (np.sin(2 * np.pi * 300 * t) * 0.08 + lowpass(RNG.uniform(-1, 1, len(t)), 900) * 0.4)
    return out + spin * env(t, 0.08, 10, 1.0, total - 0.2, 0.06)


# ---------------------------------------------------------------------------- effetti MIDI
# Programmi General MIDI (da 0): 47 timpani, 48 archi, 56 tromba, 57 trombone, 61 ottoni.
DRUMS = 9


def sfx_guerra() -> np.ndarray:
    s = Song(120)
    s.program(0, 47, 110, reverb=50)
    s.program(1, 57, 100, reverb=50)
    s.program(2, 61, 90, reverb=50)
    roll_end = 2.5
    k = 0
    beat = 0.0
    while beat < roll_end - 1e-6:
        s.note(DRUMS, beat, 0.1, 38, 35 + 80 * (beat / roll_end) ** 1.5 + (8 if k % 2 == 0 else 0))
        beat += 0.125
        k += 1
    s.note(DRUMS, roll_end, 1.0, 36, 127)
    s.note(DRUMS, roll_end, 2.0, 49, 115)
    s.note(0, roll_end, 1.5, "C2", 127)
    s.chord(1, roll_end, 0.6, ["C2", "C3"], 120)
    s.chord(2, roll_end, 0.6, ["G3", "C4"], 100)
    s.end(roll_end + 2.6)
    return render_midi(s, "guerra")


def sfx_vittoria() -> np.ndarray:
    s = Song(126)
    s.program(0, 56, 110, pan=54, reverb=60)
    s.program(1, 61, 100, pan=74, reverb=60)
    s.program(2, 47, 100, reverb=60)
    for i in range(3):
        s.note(0, i / 3, 0.3, "G4", 90 + 8 * i)
    s.note(0, 1.0, 0.5, "C5", 112)
    s.note(0, 1.5, 0.5, "E5", 112)
    s.note(0, 2.0, 1.8, "G5", 120)
    s.chord(1, 2.0, 1.8, ["C4", "E4", "G4", "C3"], 105)
    s.note(1, 1.0, 1.0, "G3", 90)
    s.note(2, 0.0, 0.5, "G1", 90)
    s.note(2, 2.0, 1.0, "C2", 120)
    s.note(DRUMS, 2.0, 1.5, 49, 80)
    s.end(5.5)
    return render_midi(s, "vittoria")


def sfx_sconfitta() -> np.ndarray:
    s = Song(100)
    s.program(0, 48, 115, reverb=70)
    s.program(1, 61, 75, reverb=70)
    s.program(2, 47, 90, reverb=70)
    s.chord(0, 0.0, 3.9, ["C3", "G3", "C4", "Eb4", "G4"], 100)
    s.chord(1, 0.0, 3.6, ["C3", "Eb3", "G3"], 85)
    s.note(2, 0.0, 1.0, "C2", 95)
    for ch in (0, 1):
        s.cc(ch, 0.0, 11, 127)
        for i in range(31):
            b = 0.8 + i * 0.1
            s.bend(ch, b, -2.0 * (i / 30) ** 1.3)          # l'accordo cala di un tono
            s.cc(ch, b, 11, 127 * (1 - (i / 30) ** 2) + 10)
    s.end(6.5)
    return render_midi(s, "sconfitta")


def sfx_truppe() -> np.ndarray:
    """Movimenti di truppe: una battuta di marcia con pedale di ottoni gravi."""
    s = Song(116)
    s.program(0, 57, 95, reverb=40)
    pattern = [(0, 110), (0.75, 60), (1, 85), (1.5, 70), (1.75, 60), (2, 105), (2.75, 60), (3, 85), (3.25, 70), (3.5, 90)]
    for beat, vel in pattern:
        s.note(DRUMS, beat, 0.1, 38, vel)
    for beat in (0, 2, 4):
        s.note(DRUMS, beat, 0.3, 36, 100)
    s.note(0, 0, 0.45, "G2", 90)
    s.note(0, 2, 0.45, "G2", 85)
    s.note(0, 4, 0.9, "C2", 100)
    s.end(6.5)
    return render_midi(s, "truppe")


def sfx_disordini() -> np.ndarray:
    """Disordini interni: archi in tremolo su un tritono e tamburi bassi irregolari."""
    s = Song(100)
    s.program(0, 44, 105, reverb=60)          # archi in tremolo
    s.chord(0, 0, 3.0, ["C3", "F#3", "C4"], 95)
    s.cc(0, 0, 11, 60)
    for i in range(12):
        s.cc(0, i * 0.2, 11, 60 + 60 * min(1, i / 6) - (50 if i > 9 else 0))
    for beat, note, vel in [(0, 41, 110), (0.5, 41, 70), (0.75, 43, 90), (1.5, 41, 100), (2.0, 45, 80), (2.25, 41, 115)]:
        s.note(DRUMS, beat, 0.2, note, vel)
    s.end(5.5)
    return render_midi(s, "disordini")


def sfx_avvio() -> np.ndarray:
    """Nuova partita o partita caricata: rullo di timpani e accordo che si apre."""
    s = Song(96)
    s.program(0, 47, 105, reverb=60)
    s.program(1, 48, 100, reverb=70)
    s.program(2, 61, 85, reverb=70)
    for k in range(12):
        s.note(0, k * 0.125, 0.12, "D2", 40 + k * 6)
    s.note(0, 1.5, 1.0, "D2", 120)
    s.chord(1, 0.0, 3.6, ["D3", "A3", "D4", "F4"], 70)
    s.cc(1, 0, 11, 40)
    for i in range(10):
        s.cc(1, i * 0.15, 11, 40 + 87 * i / 9)
    s.chord(2, 1.5, 2.0, ["D3", "A3", "D4"], 100)
    s.end(6.5)
    return render_midi(s, "avvio")


# ---------------------------------------------------------------------------- musiche

def triad(root: str, kind: str) -> list[int]:
    r = n(root)
    return {"m": [r, r + 3, r + 7], "M": [r, r + 4, r + 7], "sus4": [r, r + 5, r + 7],
            "maj7": [r, r + 4, r + 7, r + 11]}[kind]


def music_tema() -> tuple[np.ndarray, float]:
    """Sala operativa: Re minore, 92 bpm, 32 battute. Ostinato FM, archi, corno, ping radar."""
    s = Song(92)
    s.program(0, 5, 70, pan=44, reverb=50)    # piano elettrico FM: ostinato
    s.program(1, 49, 78, pan=84, reverb=70)   # archi lenti: tappeto
    s.program(2, 38, 92, reverb=20)           # basso sintetico
    s.program(3, 60, 82, pan=58, reverb=70)   # corno
    s.program(4, 48, 80, pan=70, reverb=70)   # archi: melodia
    s.program(5, 11, 60, pan=96, reverb=90)   # vibrafono: ping radar
    s.program(6, 47, 80, reverb=60)           # timpani
    p1 = [("D3", "m"), ("D3", "m"), ("Bb2", "M"), ("Bb2", "M"), ("G2", "m"), ("G2", "m"), ("A2", "sus4"), ("A2", "M")]
    p2 = [("D3", "m"), ("D3", "m"), ("Bb2", "maj7"), ("Bb2", "M"), ("G2", "m"), ("Eb3", "M"), ("A2", "sus4"), ("A2", "M")]
    form = [p1, p2, p2, p1]                     # A: ostinato e archi; B: +basso e ritmo; C: +corno; D: +melodia
    horn = [[(1, 1, "A3"), (2, 2, "D4")], [(0, 1.5, "E4"), (1.5, .5, "F4"), (2, 2, "E4")],
            [(0, 3, "D4"), (3, 1, "C4")], [(0, 4, "D4")], [(0, 1, "G3"), (1, 1, "Bb3"), (2, 2, "D4")],
            [(0, 2, "G3"), (2, 1, "Bb3"), (3, 1, "G3")], [(0, 2, "D4"), (2, 2, "E4")], [(0, 4, "C#4")]]
    strings = [[(0, 2, "F4"), (2, 1, "E4"), (3, 1, "D4")], [(0, 4, "A4")], [(0, 2, "Bb4"), (2, 1, "A4"), (3, 1, "G4")],
               [(0, 2, "F4"), (2, 2, "D4")], [(0, 2, "G4"), (2, 2, "Bb4")], [(0, 1.5, "A4"), (1.5, .5, "G4"), (2, 2, "F4")],
               [(0, 4, "E4")], [(0, 2, "E4"), (2, 2, "C#4")]]
    bar = 0
    for sec, prog in enumerate(form):
        for i, (root, kind) in enumerate(prog):
            b0 = bar * 4.0
            ch = triad(root, kind)
            r = ch[0] + 12 if ch[0] < n("C3") else ch[0]
            third, fifth = ch[1] - ch[0], ch[2] - ch[0]
            pattern = [r, r + fifth, r + 12, r + fifth, r + third, r + fifth, r + 14, r + fifth]
            for k, p in enumerate(pattern):
                s.note(0, b0 + k * 0.5, 0.45, p, (58 if k % 4 == 0 else 46) - (8 if sec == 3 and i >= 6 else 0))
            if i % 2 == 0:
                s.chord(1, b0, 7.9, [p + 12 for p in ch] if ch[0] < n("F3") else ch, 52)
            if sec >= 1:
                low = ch[0] - 12 if ch[0] >= n("C3") else ch[0]
                s.note(2, b0, 1.4, low, 90)
                s.note(2, b0 + 1.5, 0.45, low, 70)
                s.note(2, b0 + 2, 1.4, low, 84)
                s.note(2, b0 + 3.5, 0.45, low + 12, 66)
                for k in range(8):
                    s.note(DRUMS, b0 + k * 0.5, 0.2, 42, 34 if k % 2 == 0 else 24)
                s.note(DRUMS, b0, 0.3, 36, 70)
                s.note(DRUMS, b0 + 2.5, 0.3, 36, 50)
                if sec == 2:
                    s.note(DRUMS, b0 + 1, 0.2, 37, 45)
                    s.note(DRUMS, b0 + 3, 0.2, 37, 45)
            if sec == 2:
                for off, dur, p in horn[i]:
                    s.note(3, b0 + off, dur - 0.05, p, 82)
            if sec == 3:
                for off, dur, p in strings[i]:
                    s.note(4, b0 + off, dur - 0.05, n(p) + 12, 74)
            if i % 4 == 0:
                s.note(5, b0, 1.5, "A6", 50)
                s.note(5, b0 + 0.75, 1.0, "A6", 26)              # eco del ping
            if i == 0 and sec >= 1:
                s.note(6, b0, 1.5, "D2", 72)
            if i == 7 and sec == 2:
                for k in range(16):
                    s.note(6, b0 + 2 + k * 0.125, 0.12, "A1", 30 + k * 3)
            bar += 1
    loop_beats = bar * 4.0
    s.end(loop_beats + 8)
    return render_midi(s, "tema"), s.seconds(loop_beats)


def music_crisi() -> tuple[np.ndarray, float]:
    """Crisi: Do minore, 120 bpm, 40 battute. Ostinato a sedicesimi, rullante, ottoni, timpani."""
    s = Song(120)
    s.program(0, 81, 62, pan=40, reverb=40)   # sega: ostinato
    s.program(1, 48, 82, pan=88, reverb=60)   # archi: tappeto
    s.program(2, 38, 98, reverb=20)           # basso sintetico
    s.program(3, 61, 92, pan=56, reverb=60)   # ottoni
    s.program(4, 47, 96, reverb=60)           # timpani
    s.program(5, 48, 88, pan=72, reverb=60)   # archi: melodia
    p1 = [("C3", "m"), ("C3", "m"), ("Ab2", "M"), ("Bb2", "M"), ("C3", "m"), ("C3", "m"), ("Db3", "M"), ("G2", "M")]
    p2 = [("Ab2", "M"), ("Ab2", "M"), ("F2", "m"), ("F2", "m"), ("Db3", "M"), ("Db3", "M"), ("G2", "M"), ("G2", "M")]
    form = [p1, p1, p2, p1, p2]                 # A: pulsazione; B: +ottoni e timpani; C: +archi; D: +ottoni in melodia; E: si dirada
    strings = [[(0, 2, "C5"), (2, 2, "Eb5")], [(0, 3, "Ab5"), (3, 1, "G5")], [(0, 2, "F5"), (2, 1, "Eb5"), (3, 1, "C5")],
               [(0, 4, "Ab4")], [(0, 2, "Db5"), (2, 2, "F5")], [(0, 2, "Ab5"), (2, 1, "G5"), (3, 1, "F5")],
               [(0, 4, "G5")], [(0, 2, "B4"), (2, 2, "D5")]]
    brass = [[(0, 1.5, "G4"), (1.5, .5, "G4"), (2, 2, "C5")], [(0, 2, "Eb5"), (2, 1, "D5"), (3, 1, "C5")],
             [(0, 2, "C5"), (2, 2, "Ab4")], [(0, 3, "D5"), (3, 1, "F5")], [(0, 1.5, "Eb5"), (1.5, .5, "D5"), (2, 2, "C5")],
             [(0, 4, "G4")], [(0, 2, "Ab4"), (2, 2, "F4")], [(0, 2, "B4"), (2, 2, "D5")]]
    snare = [1, 0, 0, 1, 1, 0, 1, 0, 1, 0, 0, 1, 1, 1, 1, 1]          # marziale, per sedicesimi
    bar = 0
    for sec, prog in enumerate(form):
        for i, (root, kind) in enumerate(prog):
            b0 = bar * 4.0
            ch = triad(root, kind)
            r = ch[0]
            third, fifth = ch[1] - ch[0], ch[2] - ch[0]
            cell = [r, r + 12, r + fifth, r + 12, r + third + 12, r + 12, r + fifth, r + 12]
            for k in range(16):
                s.note(0, b0 + k * 0.25, 0.2, cell[k % 8], (60 if k % 4 == 0 else 44) - (10 if sec == 4 else 0))
            for k in range(8):
                p = ch[0] - 12 if k != 6 else ch[0]
                s.note(2, b0 + k * 0.5, 0.4, p, 96 if k % 2 == 0 else 78)
            for k, hit in enumerate(snare):
                if hit and (sec > 0 or k >= 8 or i % 2 == 1):
                    s.note(DRUMS, b0 + k * 0.25, 0.1, 38, (70 if k % 4 == 0 else 48) - (12 if sec == 4 else 0))
            s.note(DRUMS, b0, 0.3, 36, 100)
            s.note(DRUMS, b0 + 2, 0.3, 36, 90)
            if i == 0:
                s.note(DRUMS, b0, 2.0, 49, 90)
            if sec in (1, 2, 3):
                s.note(4, b0, 0.9, ch[0] - 12 if ch[0] >= n("C3") else ch[0], 100)
                if i == 7:
                    for k in range(16):
                        s.note(4, b0 + k * 0.25, 0.22, "G1", 50 + k * 4)
            if sec == 1 or (sec == 2 and i % 2 == 0):
                s.chord(3, b0, 0.4, [p + 12 for p in ch], 96)
                s.chord(3, b0 + 1.5, 0.4, [p + 12 for p in ch], 88)
            if sec in (2, 3, 4):
                if i % 2 == 0:
                    s.chord(1, b0, 7.9, [p + 12 for p in ch], 64 if sec != 4 else 50)
            if sec == 2:
                for off, dur, p in strings[i]:
                    s.note(5, b0 + off, dur - 0.05, p, 88)
            if sec == 3:
                for off, dur, p in brass[i]:
                    s.note(3, b0 + off, dur - 0.05, p, 104)
            bar += 1
    loop_beats = bar * 4.0
    s.end(loop_beats + 8)
    return render_midi(s, "crisi"), s.seconds(loop_beats)


# ---------------------------------------------------------------------------- uscita

def db(x: float) -> float:
    return 20 * np.log10(max(x, 1e-12))


def fold_loop(x: np.ndarray, seconds: float) -> np.ndarray:
    """Taglia al punto di loop e somma all'inizio la coda che lo supera."""
    L = round(seconds * SR)
    x = np.concatenate([x, np.zeros(max(0, L - len(x)))])
    out = x[:L].copy()
    tail = x[L:]
    while len(tail):
        m = min(len(tail), L)
        out[:m] += tail[:m]
        tail = tail[m:]
    return out


def trim(x: np.ndarray, floor_db: float = -60, longest: float = 3.2) -> np.ndarray:
    """Toglie il silenzio iniziale e finale e limita la durata; dissolvenza in coda."""
    thr = np.abs(x).max() * 10 ** (floor_db / 20)
    idx = np.nonzero(np.abs(x) > thr)[0]
    x = x[max(0, idx[0] - 32): idx[-1] + 1].copy()
    if len(x) > longest * SR:
        x = x[: int(longest * SR)]
        f = int(0.5 * SR)
    else:
        f = min(len(x), int(0.01 * SR))
    x[-f:] *= np.linspace(1, 0, f) ** 2
    return x


def normalize_sfx(x: np.ndarray, target_db: float = -14.0) -> np.ndarray:
    win = int(0.1 * SR)
    power = np.convolve(x ** 2, np.ones(win) / win, mode="same")
    loud = np.sqrt(power.max())
    gain = 10 ** (target_db / 20) / loud
    gain = min(gain, 10 ** (-1 / 20) / np.abs(x).max())
    return x * gain


def normalize_music(x: np.ndarray, target_db: float = -20.0) -> np.ndarray:
    gain = 10 ** (target_db / 20) / np.sqrt(np.mean(x ** 2))
    gain = min(gain, 10 ** (-1 / 20) / np.abs(x).max())
    return x * gain


def save(x: np.ndarray, wav: Path, ogg: Path) -> None:
    pcm = (np.clip(x, -1, 1) * 32767).astype("<i2")
    with wave.open(str(wav), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    ogg.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(wav), "-c:a", "libvorbis",
                    "-q:a", "4", str(ogg)], check=True)


SFX = {
    "cursore": sfx_cursore, "apri": sfx_apri, "chiudi": sfx_chiudi, "regola": sfx_regola, "rifiuto": sfx_rifiuto,
    "ordine": sfx_ordine, "squillo": sfx_squillo, "mese": sfx_mese, "salvataggio": sfx_salvataggio,
    "truppe": sfx_truppe, "disordini": sfx_disordini, "avvio": sfx_avvio,
    "clic": sfx_clic, "conferma": sfx_conferma, "fallimento": sfx_fallimento, "notizia": sfx_notizia,
    "allarme": sfx_allarme, "guerra": sfx_guerra, "nucleare": sfx_nucleare, "disastro": sfx_disastro,
    "vittoria": sfx_vittoria, "sconfitta": sfx_sconfitta,
}
MUSIC = {"tema": music_tema, "crisi": music_crisi}
# Loudness momentanea di picco (dBFS) per effetto: l'interfaccia resta discreta, gli eventi gravi pieni.
LEVEL = {"cursore": -24, "regola": -22, "apri": -20, "chiudi": -20, "clic": -18, "rifiuto": -18, "ordine": -19,
         "salvataggio": -20, "mese": -18, "allarme": -16, "squillo": -16}


def main(names: list[str]) -> None:
    SRC.mkdir(parents=True, exist_ok=True)
    wanted = names or [*SFX, *MUSIC]
    global RNG
    for name in wanted:
        RNG = np.random.default_rng(zlib.crc32(name.encode()))   # stesso rumore a ogni ricostruzione
        if name in SFX:
            x = normalize_sfx(trim(SFX[name]()), LEVEL.get(name, -14))
            save(x, SRC / f"{name}.wav", OUT_SFX / f"{name}.ogg")
        elif name in MUSIC:
            raw, loop = MUSIC[name]()
            x = normalize_music(fold_loop(raw, loop))
            save(x, SRC / f"{name}.wav", OUT_MUS / f"{name}.ogg")
        else:
            sys.exit(f"nome sconosciuto: {name}")
        print(f"{name:11s} {len(x) / SR:6.2f} s  picco {db(np.abs(x).max()):6.1f} dBFS  "
              f"RMS {db(np.sqrt(np.mean(x ** 2))):6.1f} dBFS")


if __name__ == "__main__":
    main(sys.argv[1:])
