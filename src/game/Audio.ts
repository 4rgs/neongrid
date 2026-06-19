/**
 * Audio.ts — Web Audio synth for retro SFX + streamed music loops
 * (OGG Opus, decoded once and looped via AudioBufferSourceNode).
 *
 * Lazy AudioContext on first user gesture (browser autoplay
 * policy). The music is split into two layers:
 *   - SFX (pickup, slash, hit, boom, hurt, warning, victory) stay
 *     as cheap oscillator calls — fire-and-forget, no assets, no
 *     decode cost, no perceptible latency.
 *   - Music (gameplay loop, boss loop) is streamed from
 *     /public/audio as OGG Opus, decoded once into an
 *     AudioBuffer, then played with loop=true. Crossfade between
 *     tracks uses a gain ramp on each layer's GainNode so the
 *     swap is sample-accurate and never audible as a click.
 */
export class AudioBus {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  // Master volume (0..1), persisted by Settings.
  volume = 0.7;

  // ── Music layer state ───────────────────────────────────────────
  // Each track has a decoded buffer (loaded async on demand) and a
  // currently-playing source. crossfadeTo() starts the new source
  // and ramps the gains so the two layers overlap briefly.
  private musicA: AudioBuffer | null = null;
  private musicB: AudioBuffer | null = null;
  private musicGainA: GainNode | null = null;
  private musicGainB: GainNode | null = null;
  private musicSourceA: AudioBufferSourceNode | null = null;
  private musicSourceB: AudioBufferSourceNode | null = null;
  private currentTrack: 'A' | 'B' | null = null;
  // Pending fetch promises so concurrent calls don't double-decode.
  private musicAPromise: Promise<AudioBuffer | null> | null = null;
  private musicBPromise: Promise<AudioBuffer | null> | null = null;

  ensure(): AudioContext {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
      // Music gain nodes hang off the master so the master volume
      // slider affects music too.
      this.musicGainA = this.ctx.createGain();
      this.musicGainB = this.ctx.createGain();
      this.musicGainA.gain.value = 0;
      this.musicGainB.gain.value = 0;
      this.musicGainA.connect(this.master);
      this.musicGainB.connect(this.master);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master) this.master.gain.value = this.volume;
  }

  // ── Music API (replaces the old synth drone + chord pad) ──────
  /**
   * Pre-decode both music tracks in parallel. Safe to call from
   * the first user gesture (audio.ensure must already have been
   * called). Returns a promise that resolves once both buffers
   * are ready; crossfade/playlist calls await this internally
   * so the player never waits on decode at gameplay time.
   */
  async preloadMusic(): Promise<void> {
    if (!this.musicAPromise) this.musicAPromise = this.loadTrack('audio/neongrid_A.ogg');
    if (!this.musicBPromise) this.musicBPromise = this.loadTrack('audio/neongrid_B.ogg');
    const [a, b] = await Promise.all([this.musicAPromise, this.musicBPromise]);
    this.musicA = a;
    this.musicB = b;
  }

  private async loadTrack(url: string): Promise<AudioBuffer | null> {
    try {
      const ctx = this.ensure();
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const ab = await res.arrayBuffer();
      // decodeAudioData is async but the decode itself happens
      // on a worker thread internally — the main thread is free
      // during this await, so the rest of the game keeps running.
      return await ctx.decodeAudioData(ab);
    } catch (e) {
      // Silent failure: music is non-essential. Don't break the
      // game over a network blip or missing asset.
      console.warn('[audio] failed to load', url, e);
      return null;
    }
  }

  /**
   * Start the gameplay music loop (neongrid_A). No-op if already
   * playing this track.
   */
  playGameplayLoop(): void {
    this.playTrack('A');
  }

  /**
   * Start the boss-arena music loop (neongrid_B). No-op if already
   * playing this track.
   */
  playBossLoop(): void {
    this.playTrack('B');
  }

  /**
   * Internal: start a track from scratch (no crossfade). Used by
   * playGameplayLoop / playBossLoop when no music is playing yet.
   * The decoded buffer must already exist; if it doesn't, the
   * call silently no-ops so we never block gameplay on a decode.
   */
  private playTrack(track: 'A' | 'B'): void {
    if (this.currentTrack === track) return;
    const ctx = this.ensure();
    const buffer = track === 'A' ? this.musicA : this.musicB;
    const gain = track === 'A' ? this.musicGainA : this.musicGainB;
    if (!buffer || !gain) return;
    const t0 = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(gain);
    gain.gain.cancelScheduledValues(t0);
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(0.8, t0 + 0.6);
    source.start(t0);
    if (track === 'A') this.musicSourceA = source;
    else this.musicSourceB = source;
    this.currentTrack = track;
  }

  /**
   * Stop whichever music track is currently playing, with a
   * short fadeout to avoid a click.
   */
  stopMusic(): void {
    if (!this.ctx || this.currentTrack === null) return;
    const t0 = this.ctx.currentTime;
    const dur = 0.6;
    if (this.currentTrack === 'A' && this.musicSourceA && this.musicGainA) {
      this.musicGainA.gain.cancelScheduledValues(t0);
      this.musicGainA.gain.setValueAtTime(this.musicGainA.gain.value, t0);
      this.musicGainA.gain.linearRampToValueAtTime(0, t0 + dur);
      const src = this.musicSourceA;
      try { src.stop(t0 + dur + 0.05); } catch {}
      this.musicSourceA = null;
    } else if (this.currentTrack === 'B' && this.musicSourceB && this.musicGainB) {
      this.musicGainB.gain.cancelScheduledValues(t0);
      this.musicGainB.gain.setValueAtTime(this.musicGainB.gain.value, t0);
      this.musicGainB.gain.linearRampToValueAtTime(0, t0 + dur);
      const src = this.musicSourceB;
      try { src.stop(t0 + dur + 0.05); } catch {}
      this.musicSourceB = null;
    }
    this.currentTrack = null;
  }

  /**
   * Crossfade from the current track to the requested one over
   * `duration` seconds. Sample-accurate: the new source starts
   * at the same ctx.currentTime the old gain starts ramping down,
   * so there's no gap. If the requested track isn't decoded yet,
   * we await its decode so the call still works — just slightly
   * delayed the first time.
   */
  async crossfadeTo(track: 'A' | 'B', duration = 1.5): Promise<void> {
    if (track === this.currentTrack) return;
    const ctx = this.ensure();
    // Make sure the requested track is decoded. If the caller is
    // triggering this from gameplay, preloadMusic() should have
    // already been called — but be defensive.
    if (track === 'A' && !this.musicA) {
      this.musicAPromise ??= this.loadTrack('audio/neongrid_A.ogg');
      this.musicA = await this.musicAPromise;
    } else if (track === 'B' && !this.musicB) {
      this.musicBPromise ??= this.loadTrack('audio/neongrid_B.ogg');
      this.musicB = await this.musicBPromise;
    }
    const buffer = track === 'A' ? this.musicA : this.musicB;
    if (!buffer) return;  // decode failed, silent skip

    // Stop the old track (or fade it out) and start the new one.
    const t0 = ctx.currentTime;
    const oldGain = track === 'A' ? this.musicGainB : this.musicGainA;
    const oldSource = track === 'A' ? this.musicSourceB : this.musicSourceA;
    const newGain = track === 'A' ? this.musicGainA : this.musicGainB;
    if (!newGain) return;
    // Fade in the new track (gain from 0 -> 0.8, where 0.8
    // leaves headroom under master volume 1.0 to avoid clipping
    // when both layers briefly overlap).
    newGain.gain.cancelScheduledValues(t0);
    newGain.gain.setValueAtTime(0, t0);
    newGain.gain.linearRampToValueAtTime(0.8, t0 + duration);
    const newSource = ctx.createBufferSource();
    newSource.buffer = buffer;
    newSource.loop = true;
    newSource.connect(newGain);
    // start(when) schedules sample-accurate playback; when=0
    // means start at the beginning of the buffer, when=t0 means
    // start at the crossfade midpoint.
    newSource.start(t0);
    if (track === 'A') this.musicSourceA = newSource;
    else this.musicSourceB = newSource;
    this.currentTrack = track;

    // Fade out the old track.
    if (oldGain && oldSource) {
      oldGain.gain.cancelScheduledValues(t0);
      oldGain.gain.setValueAtTime(oldGain.gain.value, t0);
      oldGain.gain.linearRampToValueAtTime(0, t0 + duration);
      try { oldSource.stop(t0 + duration + 0.05); } catch {}
      if (track === 'A') this.musicSourceB = null;
      else this.musicSourceA = null;
    }
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
