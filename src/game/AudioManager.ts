// Web Audio synth for all game sounds. Nothing here throws when audio is unavailable.
import type { Settings } from "./Types";

export type SoundName =
  | "uiHover"
  | "uiSelect"
  | "select"
  | "swap"
  | "invalid"
  | "match"
  | "bigMatch"
  | "specialCreate"
  | "specialActivate"
  | "cascade"
  | "blockerHit"
  | "seedDelivered"
  | "levelComplete"
  | "levelFail"
  | "reshuffle";

interface ToneOptions {
  type?: OscillatorType;
  freq: number;
  /** Glide target; the oscillator slides there exponentially over the tone's length. */
  freqEnd?: number;
  start?: number;
  duration: number;
  gain?: number;
  attack?: number;
  /** Lowpass cutoff; omitted means no filter. */
  lowpass?: number;
  lowpassEnd?: number;
  detune?: number;
}

interface NoiseOptions {
  start?: number;
  duration: number;
  gain?: number;
  filter?: BiquadFilterType;
  cutoff?: number;
  cutoffEnd?: number;
}

type AudioContextCtor = new () => AudioContext;

function findAudioContext(): AudioContextCtor | null {
  const w = globalThis as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

const MIN_GAP_MS = 28;

export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private soundOn = true;
  private ambientOn = false;
  private ambientNodes: { stop(): void } | null = null;
  private lastPlayed = new Map<string, number>();
  private readonly ctor: AudioContextCtor | null;

  constructor() {
    this.ctor = findAudioContext();
  }

  /** True when the browser offers an AudioContext at all. */
  get available(): boolean {
    return this.ctor !== null;
  }

  get unlocked(): boolean {
    return this.ctx !== null && this.ctx.state === "running";
  }

  /** Call from a user gesture. Creates or resumes the context. Safe to call repeatedly. */
  unlock(): void {
    try {
      if (!this.ctor) return;
      if (!this.ctx) {
        this.ctx = new this.ctor();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.soundOn ? 1 : 0;
        this.master.connect(this.ctx.destination);
      }
      this.resume();
      if (this.ambientOn && !this.ambientNodes) this.startAmbient();
    } catch {
      this.ctx = null;
      this.master = null;
    }
  }

  /** Resumes an existing context in any paused state, including Safari's "interrupted". */
  resume(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state === "running" || ctx.state === "closed") return;
    try {
      void ctx.resume().catch(() => undefined);
    } catch {
      // ignore
    }
  }

  setEnabled(on: boolean): void {
    this.soundOn = on;
    try {
      if (this.master && this.ctx) this.master.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.02);
    } catch {
      // ignore
    }
  }

  setAmbient(on: boolean): void {
    this.ambientOn = on;
    if (on) this.startAmbient();
    else this.stopAmbient();
  }

  applySettings(settings: Pick<Settings, "sound" | "ambient">): void {
    this.setEnabled(settings.sound);
    this.setAmbient(settings.ambient);
  }

  /** `level` only matters for "cascade": pitch rises with the cascade index. */
  play(name: SoundName, level = 0): void {
    if (!this.soundOn) return;
    const ctx = this.ctx;
    if (!ctx || !this.master || ctx.state !== "running") return;
    const key = name === "cascade" ? `cascade${level}` : name;
    const nowMs = performance.now();
    const last = this.lastPlayed.get(key) ?? -Infinity;
    if (nowMs - last < MIN_GAP_MS) return;
    this.lastPlayed.set(key, nowMs);
    try {
      this.synth(name, level);
    } catch {
      // A failed sound is not worth interrupting the game for.
    }
  }

  startAmbient(): void {
    try {
      const ctx = this.ctx;
      if (!ctx || !this.master || this.ambientNodes) return;
      const out = ctx.createGain();
      out.gain.value = 0;
      out.gain.setTargetAtTime(0.07, ctx.currentTime, 1.5);

      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 420;
      filter.Q.value = 1.2;
      filter.connect(out);
      out.connect(this.master);

      const lfo = ctx.createOscillator();
      lfo.type = "sine";
      lfo.frequency.value = 0.07;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 220;
      lfo.connect(lfoGain);
      lfoGain.connect(filter.frequency);
      lfo.start();

      const voices: OscillatorNode[] = [];
      const specs: [number, number][] = [
        [110, -6],
        [110, 7],
        [165, 4],
        [220.5, -3],
      ];
      for (const [freq, detune] of specs) {
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.value = freq;
        osc.detune.value = detune;
        osc.connect(filter);
        osc.start();
        voices.push(osc);
      }
      this.ambientNodes = {
        stop: () => {
          const t = ctx.currentTime;
          out.gain.cancelScheduledValues(t);
          out.gain.setTargetAtTime(0, t, 0.6);
          const end = t + 3;
          for (const v of voices) v.stop(end);
          lfo.stop(end);
          window.setTimeout(() => {
            try {
              out.disconnect();
            } catch {
              // already gone
            }
          }, 3500);
        },
      };
    } catch {
      this.ambientNodes = null;
    }
  }

  stopAmbient(): void {
    try {
      this.ambientNodes?.stop();
    } catch {
      // ignore
    }
    this.ambientNodes = null;
  }

  dispose(): void {
    this.stopAmbient();
    try {
      void this.ctx?.close().catch(() => undefined);
    } catch {
      // ignore
    }
    this.ctx = null;
    this.master = null;
    this.noiseBuffer = null;
  }

  // ---------------------------------------------------------------------------
  // Voices

  private synth(name: SoundName, level: number): void {
    switch (name) {
      case "uiHover":
        this.tone({ freq: 1250, duration: 0.03, gain: 0.04, attack: 0.003 });
        break;
      case "uiSelect":
        this.tone({ freq: 880, freqEnd: 1180, duration: 0.05, gain: 0.08, attack: 0.003 });
        break;
      case "select":
        this.tone({ freq: 660, duration: 0.08, gain: 0.16, attack: 0.005 });
        break;
      case "swap":
        this.tone({ freq: 440, freqEnd: 560, duration: 0.09, gain: 0.14 });
        this.tone({ freq: 660, duration: 0.07, gain: 0.12, start: 0.07 });
        break;
      case "invalid":
        this.tone({ type: "triangle", freq: 150, freqEnd: 85, duration: 0.17, gain: 0.26, lowpass: 420 });
        break;
      case "match":
        this.chord([523.25, 659.25, 783.99], "triangle", 0.2, 0.11);
        break;
      case "bigMatch":
        this.chord([523.25, 659.25, 783.99, 1046.5], "triangle", 0.28, 0.11);
        this.noise({ duration: 0.22, gain: 0.08, filter: "highpass", cutoff: 4200 });
        break;
      case "specialCreate":
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone({ freq: f, duration: 0.14, gain: 0.12, start: i * 0.05 }));
        break;
      case "specialActivate":
        this.tone({ type: "sawtooth", freq: 190, freqEnd: 920, duration: 0.32, gain: 0.13, lowpass: 500, lowpassEnd: 3400 });
        this.noise({ duration: 0.3, gain: 0.05, filter: "bandpass", cutoff: 1200, cutoffEnd: 3200 });
        break;
      case "cascade": {
        const semis = Math.min(16, Math.max(0, level) * 2);
        const root = 523.25 * Math.pow(2, semis / 12);
        this.chord([root, root * 1.25, root * 1.5], "triangle", 0.22, 0.1);
        break;
      }
      case "blockerHit":
        this.noise({ duration: 0.09, gain: 0.3, filter: "lowpass", cutoff: 900 });
        this.tone({ freq: 110, freqEnd: 70, duration: 0.09, gain: 0.2 });
        break;
      case "seedDelivered":
        this.tone({ freq: 880, duration: 0.5, gain: 0.14, attack: 0.004 });
        this.tone({ freq: 1760, duration: 0.22, gain: 0.05, attack: 0.004, detune: 6 });
        this.tone({ freq: 1320, duration: 0.35, gain: 0.05, attack: 0.004, start: 0.02 });
        break;
      case "levelComplete":
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone({ type: "triangle", freq: f, duration: 0.36, gain: 0.13, start: i * 0.13 }));
        this.chord([1046.5, 1318.5, 1568], "sine", 0.7, 0.07, 0.55);
        break;
      case "levelFail":
        [659.25, 523.25, 440, 329.63].forEach((f, i) => this.tone({ type: "triangle", freq: f, duration: 0.32, gain: 0.13, start: i * 0.17, lowpass: 1800 }));
        break;
      case "reshuffle": {
        for (let i = 0; i < 7; i++) {
          const f = 1200 + ((i * 617) % 1200);
          this.tone({ freq: f, duration: 0.09, gain: 0.06, start: i * 0.045, attack: 0.004 });
        }
        this.noise({ duration: 0.45, gain: 0.05, filter: "highpass", cutoff: 3000, cutoffEnd: 6000 });
        break;
      }
    }
  }

  private chord(freqs: number[], type: OscillatorType, duration: number, gain: number, start = 0): void {
    for (const f of freqs) this.tone({ type, freq: f, duration, gain, start, attack: 0.008 });
  }

  private tone(o: ToneOptions): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    const t0 = ctx.currentTime + (o.start ?? 0);
    const attack = o.attack ?? 0.006;
    const gain = o.gain ?? 0.1;
    const t1 = t0 + o.duration;

    const osc = ctx.createOscillator();
    osc.type = o.type ?? "sine";
    osc.frequency.setValueAtTime(o.freq, t0);
    if (o.freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.freqEnd), t1);
    if (o.detune) osc.detune.value = o.detune;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.linearRampToValueAtTime(gain, t0 + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t1);

    let head: AudioNode = osc;
    if (o.lowpass) {
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(o.lowpass, t0);
      if (o.lowpassEnd) filter.frequency.exponentialRampToValueAtTime(o.lowpassEnd, t1);
      head.connect(filter);
      head = filter;
    }
    head.connect(env);
    env.connect(master);
    osc.start(t0);
    osc.stop(t1 + 0.02);
    osc.onended = () => env.disconnect();
  }

  private noise(o: NoiseOptions): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    const buffer = this.getNoise(ctx);
    if (!buffer) return;
    const t0 = ctx.currentTime + (o.start ?? 0);
    const t1 = t0 + o.duration;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.linearRampToValueAtTime(o.gain ?? 0.1, t0 + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, t1);

    let head: AudioNode = src;
    if (o.filter) {
      const filter = ctx.createBiquadFilter();
      filter.type = o.filter;
      filter.frequency.setValueAtTime(o.cutoff ?? 1000, t0);
      if (o.cutoffEnd) filter.frequency.exponentialRampToValueAtTime(o.cutoffEnd, t1);
      head.connect(filter);
      head = filter;
    }
    head.connect(env);
    env.connect(master);
    src.start(t0);
    src.stop(t1 + 0.02);
    src.onended = () => env.disconnect();
  }

  private getNoise(ctx: AudioContext): AudioBuffer | null {
    if (this.noiseBuffer) return this.noiseBuffer;
    try {
      const length = Math.floor(ctx.sampleRate * 1);
      const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      // Fixed-seed LCG so the noise is the same every run; no need for Random here.
      let s = 0x9e3779b9;
      for (let i = 0; i < length; i++) {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        data[i] = (s / 0xffffffff) * 2 - 1;
      }
      this.noiseBuffer = buffer;
      return buffer;
    } catch {
      return null;
    }
  }
}
