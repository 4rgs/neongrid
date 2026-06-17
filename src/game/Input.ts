/**
 * Input.ts — keyboard + mouse state holder, polled each frame.
 * Mouse:
 *  - left click / KeyJ → attack (disc-whip)
 *  - right click + drag → orbit camera around hero (yaw)
 */
export class Input {
  keys = new Set<string>();
  // edge-triggered actions
  private _jumpEdge = false;
  private _dashEdge = false;
  private _attackEdge = false;
  // mouse for camera orbit
  private _rmbDown = false;
  private _lmbDown = false;
  private _lastMx = 0;
  private _lastMy = 0;
  // accumulated orbit deltas, consumed per frame
  private _orbitDx = 0;
  private _orbitDy = 0;
  // pause edge
  private _pauseEdge = false;

  constructor(target: HTMLElement = window) {
    target.addEventListener('keydown', (e) => {
      const k = e.code;
      if (this.keys.has(k)) return;
      this.keys.add(k);
      if (k === 'Space') this._jumpEdge = true;
      if (k === 'ShiftLeft' || k === 'ShiftRight') this._dashEdge = true;
      if (k === 'KeyJ') this._attackEdge = true;
      if (k === 'Escape' || k === 'KeyP') this._pauseEdge = true;
    });
    target.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });
    window.addEventListener('blur', () => this.keys.clear());
    // Mouse left click → attack
    window.addEventListener('mousedown', (e) => {
      if (e.button === 0) this._attackEdge = true;
      if (e.button === 2) {
        this._rmbDown = true;
        this._lastMx = e.clientX;
        this._lastMy = e.clientY;
        e.preventDefault();
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 2) this._rmbDown = false;
    });
    window.addEventListener('mousemove', (e) => {
      if (!this._rmbDown) return;
      const dx = e.clientX - this._lastMx;
      const dy = e.clientY - this._lastMy;
      this._lastMx = e.clientX;
      this._lastMy = e.clientY;
      this._orbitDx += dx;
      this._orbitDy += dy;
    });
    // Prevent right-click context menu on the canvas
    window.addEventListener('contextmenu', (e) => {
      if (e.target instanceof HTMLElement && e.target.tagName === 'CANVAS') e.preventDefault();
    });
  }

  // Set by the game when an overlay (e.g. SHOP) is open. While true,
  // the input axis returns (0,0) so the hero can't be moved by the
  // player. Camera orbit is handled separately and still works.
  frozen = false;

  axis(): { x: number; z: number } {
    // Movement: W/S always. A/D strafe (left/right), working together
    // with W or S. Q/E are reserved for camera orbit (see Game.ts).
    if (this.frozen) return { x: 0, z: 0 };
    let x = 0, z = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) z -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) z += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
    const len = Math.hypot(x, z);
    if (len > 0) { x /= len; z /= len; }
    return { x, z };
  }

  consumeJump(): boolean { const v = this._jumpEdge; this._jumpEdge = false; return v; }
  consumeDash(): boolean { const v = this._dashEdge; this._dashEdge = false; return v; }
  consumeAttack(): boolean { const v = this._attackEdge; this._attackEdge = false; return v; }
  consumePause(): boolean { const v = this._pauseEdge; this._pauseEdge = false; return v; }

  /** Mouse drag deltas (px) since last consume. */
  consumeOrbit(): { dx: number; dy: number } {
    const v = { dx: this._orbitDx, dy: this._orbitDy };
    this._orbitDx = 0;
    this._orbitDy = 0;
    return v;
  }
  isRmbDown(): boolean { return this._rmbDown; }
  isLmbDown(): boolean { return this._lmbDown; }
  keysHeld(): string[] { return Array.from(this.keys); }

  held(code: string): boolean { return this.keys.has(code); }

  // --- Mobile / programmatic injection ---
  press(code: string) { this.keys.add(code); this.markEdges(code); }
  release(code: string) { this.keys.delete(code); }
  private markEdges(code: string) {
    if (code === 'Space') this._jumpEdge = true;
    if (code === 'ShiftLeft' || code === 'ShiftRight') this._dashEdge = true;
    if (code === 'KeyJ' || code === 'Mouse0') this._attackEdge = true;
  }
  attackEdge() { this._attackEdge = true; }
  dashEdge() { this._dashEdge = true; }
  jumpEdge() { this._jumpEdge = true; }
}
