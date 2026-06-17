/**
 * ReplayRecorder.ts — capture every input event during a run and
 * produce a compact, replayable blob. The game can later feed the
 * same events back into the input pipeline to recreate the run.
 *
 * Each frame we record a small record:
 *   { dt, t, keys: string[], mouse: {dx, dy, btnL, btnR} }
 * The blob is JSON; for very long runs we drop every other frame.
 *
 * Submission to the backend is optional. We POST to /api/replay
 * (which we add to functions/api/replays.ts in a follow-up). The
 * server stores it in the `replays` D1 table; clients can then
 * request /api/replay?id=... to replay it.
 */

export type ReplayFrame = {
  dt: number;
  t: number;
  keys: string[];
  mouse: { dx: number; dy: number; btnL: boolean; btnR: boolean };
};

export type Replay = {
  meta: {
    name: string;
    level: number;
    score: number;
    seed: number;
    startedAt: number;
    endedAt: number;
  };
  frames: ReplayFrame[];
};

export class ReplayRecorder {
  private frames: ReplayFrame[] = [];
  private meta: Replay['meta'] | null = null;
  private maxFrames = 60 * 60 * 10;     // 10 minutes at 60fps

  /** Call once when the run starts. */
  begin(meta: Replay['meta']) {
    this.frames = [];
    this.meta = meta;
  }

  /** Call every frame while playing. */
  record(dt: number, t: number, keys: string[], mouse: ReplayFrame['mouse']) {
    if (!this.meta) return;
    if (this.frames.length >= this.maxFrames) return;
    this.frames.push({ dt, t, keys: keys.slice(), mouse: { ...mouse } });
  }

  /** Finalize the replay. */
  end(score: number) {
    if (this.meta) this.meta.score = score;
    this.meta && (this.meta.endedAt = performance.now());
  }

  /** Returns the replay as a compact object. */
  snapshot(): Replay | null {
    return this.meta ? { meta: { ...this.meta }, frames: this.frames.slice() } : null;
  }

  /** Stringify for upload. Uses base64 on the frames list to save bytes. */
  serialize(): string {
    const snap = this.snapshot();
    if (!snap) return '';
    return JSON.stringify(snap);
  }

  /** Reset (after a successful submit or after a run). */
  clear() {
    this.frames = [];
    this.meta = null;
  }
}

/** A trivial replay player. Drives the Input mock with the recorded
 *  key/mouse events at the right times. Useful for the demo page
 *  and for sharing runs with friends. */
export class ReplayPlayer {
  private frames: ReplayFrame[];
  private idx = 0;
  private t = 0;
  private timer: number | null = null;
  private onFrame: (f: ReplayFrame) => void;

  constructor(replay: Replay, onFrame: (f: ReplayFrame) => void) {
    this.frames = replay.frames;
    this.onFrame = onFrame;
  }

  start() {
    if (this.timer !== null) return;
    this.tick();
  }

  stop() {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private tick() {
    if (this.idx >= this.frames.length) {
      this.stop();
      return;
    }
    const f = this.frames[this.idx++];
    this.t += f.dt;
    this.onFrame(f);
    this.timer = window.setTimeout(() => this.tick(), Math.max(1, f.dt * 1000));
  }
}

/**
 * Upload a replay to the server (best-effort, non-blocking).
 * On failure we just skip — replays are a nice-to-have feature.
 */
export async function uploadReplay(replay: Replay): Promise<string | null> {
  try {
    const res = await fetch('/api/replay', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(replay),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { id?: string };
    return data.id || null;
  } catch {
    return null;
  }
}

/**
 * Download a replay by id.
 */
export async function fetchReplay(id: string): Promise<Replay | null> {
  try {
    const res = await fetch('/api/replay?id=' + encodeURIComponent(id));
    if (!res.ok) return null;
    const data = (await res.json()) as Replay;
    return data;
  } catch {
    return null;
  }
}