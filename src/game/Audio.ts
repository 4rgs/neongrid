/**
 * Audio.ts — minimal Web Audio synth for retro SFX (no asset files).
 * Lazy AudioContext on first user gesture (browser policy).
 */
export class AudioBus {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  // Master volume (0..1), persisted by Settings.
  volume = 0.7;

  ensure(): AudioContext {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master) this.master.gain.value = this.volume;
  }

  /** Short blip: collectible pickup. */
  pickup() {
    const ctx = this.ensure();
    const t0 = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'square';
    o.frequency.setValueAtTime(880, t0);
    o.frequency.exponentialRampToValueAtTime(1760, t0 + 0.08);
    g.gain.setValueAtTime(0.0, t0);
    g.gain.linearRampToValueAtTime(0.3, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.15);
    o.connect(g).connect(this.master!);
    o.start(t0); o.stop(t0 + 0.16);
  }

  /** Slash: disc-whip attack. */
  slash() {
    const ctx = this.ensure();
    const t0 = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(220, t0);
    o.frequency.exponentialRampToValueAtTime(110, t0 + 0.18);
    g.gain.setValueAtTime(0.0, t0);
    g.gain.linearRampToValueAtTime(0.25, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.2);
    // slight noise layer
    const n = ctx.createBufferSource();
    const buf = ctx.createBuffer(1, 1024, ctx.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / ch.length);
    n.buffer = buf;
    const ng = ctx.createGain();
    ng.gain.value = 0.08;
    o.connect(g).connect(this.master!);
    n.connect(ng).connect(this.master!);
    o.start(t0); o.stop(t0 + 0.2);
    n.start(t0);
  }

  /** Hit enemy: short noise burst. */
  hit() {
    const ctx = this.ensure();
    const t0 = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'square';
    o.frequency.setValueAtTime(440, t0);
    o.frequency.exponentialRampToValueAtTime(80, t0 + 0.12);
    g.gain.setValueAtTime(0.0, t0);
    g.gain.linearRampToValueAtTime(0.35, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.15);
    o.connect(g).connect(this.master!);
    o.start(t0); o.stop(t0 + 0.16);
  }

  /** Explosion on enemy death. */
  boom() {
    const ctx = this.ensure();
    const t0 = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(200, t0);
    o.frequency.exponentialRampToValueAtTime(40, t0 + 0.5);
    g.gain.setValueAtTime(0.0, t0);
    g.gain.linearRampToValueAtTime(0.4, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.55);
    o.connect(g).connect(this.master!);
    o.start(t0); o.stop(t0 + 0.6);
  }

  /** Player hurt. */
  hurt() {
    const ctx = this.ensure();
    const t0 = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(660, t0);
    o.frequency.exponentialRampToValueAtTime(220, t0 + 0.3);
    g.gain.setValueAtTime(0.0, t0);
    g.gain.linearRampToValueAtTime(0.35, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.35);
    o.connect(g).connect(this.master!);
    o.start(t0); o.stop(t0 + 0.36);
  }

  /** Ambient drone — two detuned saws through a lowpass, looping. */
  private ambientNodes: { osc1: OscillatorNode; osc2: OscillatorNode; lpf: BiquadFilterNode; lfo: OscillatorNode; lfoGain: GainNode } | null = null;

  /** Music layer: a slowly evolving chord pad on top of the drone. */
  private musicNodes: { oscs: OscillatorNode[]; gain: GainNode; lfo: OscillatorNode; lfoGain: GainNode; filter: BiquadFilterNode } | null = null;
  private currentChord = 0;
  private chordTimer = 0;
  // Four chords: i - VI - III - VII in A minor (A, F, C, G)
  private readonly CHORDS = [
    [220.00, 261.63, 329.63], // A minor (A C E)
    [174.61, 220.00, 261.63], // F major (F A C)
    [130.81, 196.00, 246.94], // C major (C G B)
    [196.00, 246.94, 293.66], // G major (G B D)
  ];

  ambientStart() {
    const ctx = this.ensure();
    if (this.ambientNodes) return;
    const t0 = ctx.currentTime;
    // Drone
    const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 55;
    const o2 = ctx.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = 55 * 1.005;
    const lpf = ctx.createBiquadFilter(); lpf.type = 'lowpass'; lpf.frequency.value = 220; lpf.Q.value = 4;
    const g = ctx.createGain(); g.gain.value = 0.0;
    o1.connect(lpf); o2.connect(lpf); lpf.connect(g); g.connect(this.master!);
    const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 0.18;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 80;
    lfo.connect(lfoGain); lfoGain.connect(lpf.frequency);
    g.gain.linearRampToValueAtTime(0.10, t0 + 1.0);
    o1.start(t0); o2.start(t0); lfo.start(t0);
    this.ambientNodes = { osc1: o1, osc2: o2, lpf, lfo, lfoGain };

    // Chord pad
    const chordG = ctx.createGain();
    chordG.gain.value = 0.0;
    const chordFilter = ctx.createBiquadFilter();
    chordFilter.type = 'lowpass';
    chordFilter.frequency.value = 1200;
    chordFilter.Q.value = 2;
    chordG.connect(chordFilter);
    chordFilter.connect(this.master!);
    chordG.gain.linearRampToValueAtTime(0.06, t0 + 2.0);
    const oscs: OscillatorNode[] = [];
    for (let i = 0; i < 3; i++) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = this.CHORDS[0][i];
      const og = ctx.createGain();
      og.gain.value = 0.33;
      osc.connect(og).connect(chordG);
      osc.start(t0);
      oscs.push(osc);
    }
    // gentle LFO on the chord filter for movement
    const clfo = ctx.createOscillator();
    clfo.type = 'sine';
    clfo.frequency.value = 0.1;
    const clfoG = ctx.createGain();
    clfoG.gain.value = 400;
    clfo.connect(clfoG);
    clfoG.connect(chordFilter.frequency);
    clfo.start(t0);
    this.musicNodes = { oscs, gain: chordG, lfo: clfo, lfoGain: clfoG, filter: chordFilter };
  }
  ambientStop() {
    if (this.ambientNodes) {
      const ctx = this.ctx!;
      const t0 = ctx.currentTime;
      this.ambientNodes.lpf.disconnect();
      const { osc1, osc2, lfo } = this.ambientNodes;
      try { osc1.stop(t0 + 0.5); osc2.stop(t0 + 0.5); lfo.stop(t0 + 0.5); } catch {}
      this.ambientNodes = null;
    }
    if (this.musicNodes) {
      const ctx = this.ctx!;
      const t0 = ctx.currentTime;
      this.musicNodes.gain.gain.linearRampToValueAtTime(0, t0 + 0.5);
      const all: OscillatorNode[] = [...this.musicNodes.oscs, this.musicNodes.lfo];
      try { all.forEach(o => o.stop(t0 + 0.6)); } catch {}
      this.musicNodes = null;
    }
  }

  /** Advance the chord progression (called from the game loop). */
  musicTick(dt: number) {
    if (!this.musicNodes) return;
    this.chordTimer += dt;
    if (this.chordTimer >= 4.0) { // 4-second chord
      this.chordTimer = 0;
      this.currentChord = (this.currentChord + 1) % this.CHORDS.length;
      const ctx = this.ctx!;
      const t = ctx.currentTime;
      for (let i = 0; i < 3; i++) {
        const target = this.CHORDS[this.currentChord][i];
        this.musicNodes.oscs[i].frequency.linearRampToValueAtTime(target, t + 1.0);
      }
    }
  }

  /** Increase music intensity (called during boss fight). */
  musicIntensity(mul: number) {
    if (!this.musicNodes) return;
    this.musicNodes.gain.gain.value = 0.06 * mul;
  }

  /** Boss warning — descending square arpeggio. */
  warning() {
    const ctx = this.ensure();
    const t0 = ctx.currentTime;
    const notes = [880, 660, 440, 220];
    for (let i = 0; i < notes.length; i++) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'square';
      o.frequency.value = notes[i];
      const t = t0 + i * 0.12;
      g.gain.setValueAtTime(0.0, t);
      g.gain.linearRampToValueAtTime(0.18, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      o.connect(g).connect(this.master!);
      o.start(t); o.stop(t + 0.2);
    }
  }

  /** Victory — ascending major arpeggio. */
  victory() {
    const ctx = this.ensure();
    const t0 = ctx.currentTime;
    const notes = [440, 554, 659, 880, 1108];
    for (let i = 0; i < notes.length; i++) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.value = notes[i];
      const t = t0 + i * 0.15;
      g.gain.setValueAtTime(0.0, t);
      g.gain.linearRampToValueAtTime(0.20, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
      o.connect(g).connect(this.master!);
      o.start(t); o.stop(t + 0.55);
    }
  }
}
