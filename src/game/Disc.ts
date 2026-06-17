/**
 * Disc.ts — disc-whip (boomerang) weapon.
 *
 * IMPORTANT: the disc is a free-flying projectile in WORLD space. It is
 * NOT a child of the hero (so it isn't affected by the hero's pitch/roll
 * on the terrain or its yaw rotation). It is parented directly to the
 * scene by Game.ts.
 *
 * Lifecycle:
 *   idle → fly (0.55s, linear interp from startPos to flyTarget)
 *        → return (0.4s, linear interp from peak to current hero pos)
 *        → idle
 *
 * Direction is captured at throw() time, based on the camera yaw of
 * that frame. Once thrown, the disc ignores camera changes — it
 * continues along the originally chosen vector.
 */
import * as THREE from 'three';
import { PALETTE } from './palette';

export type DiscState = 'idle' | 'fly' | 'return';

export class Disc {
  group = new THREE.Group();
  state: DiscState = 'idle';
  t = 0;
  startPos = new THREE.Vector3();
  flyTarget = new THREE.Vector3();     // peak position (startPos + dir * RANGE)
  // returns to this position (the hero's current world pos at the end of return)
  returnTarget = new THREE.Vector3();
  dir = new THREE.Vector3();             // unit vector in world space (set at throw)
  range = 14;                            // how far the disc travels before turning back
  flyDur = 0.55;
  returnDur = 0.4;
  mesh!: THREE.Mesh;
  trailLine!: THREE.Line;

  constructor() {
    // Disc: thin ring oriented horizontally (faces the camera by default)
    const ringGeo = new THREE.TorusGeometry(0.45, 0.06, 8, 24);
    const ringMat = new THREE.MeshBasicMaterial({ color: PALETTE.cyan });
    this.mesh = new THREE.Mesh(ringGeo, ringMat);
    // Rotate so the disc faces forward when flying (around its X axis)
    this.mesh.rotation.x = Math.PI / 2;
    this.group.add(this.mesh);
    // inner glow disk
    const innerGeo = new THREE.CircleGeometry(0.4, 24);
    const innerMat = new THREE.MeshBasicMaterial({
      color: PALETTE.cyan,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide,
    });
    const inner = new THREE.Mesh(innerGeo, innerMat);
    this.group.add(inner);
    // trail line
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(30 * 3), 3));
    this.trailLine = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ color: PALETTE.cyan, transparent: true, opacity: 0.6 }));
    this.group.add(this.trailLine);
    this.group.visible = false;
  }

  /**
   * Launch the disc in world space.
   * @param from world position of the hero's chest
   * @param fwd  world-space unit vector the disc should travel
   */
  throw(from: THREE.Vector3, fwd: THREE.Vector3) {
    this.state = 'fly';
    this.t = 0;
    this.startPos.copy(from);
    this.dir.copy(fwd).normalize();
    this.flyTarget.copy(from).addScaledVector(this.dir, this.range);
    this.returnTarget.copy(from); // updated each frame to follow the hero
    this.group.visible = true;
    this.group.position.copy(from);
  }

  isActive(): boolean { return this.state !== 'idle'; }

  /**
   * @param heroPos the hero's current world position (for the return arc)
   */
  update(dt: number, _t: number, heroPos?: THREE.Vector3) {
    if (this.state === 'idle') return;
    this.t += dt;
    if (this.state === 'fly') {
      const k = Math.min(1, this.t / this.flyDur);
      this.group.position.lerpVectors(this.startPos, this.flyTarget, k);
      if (k >= 1) {
        this.state = 'return';
        this.t = 0;
        this.startPos.copy(this.group.position);
        if (heroPos) this.returnTarget.copy(heroPos).add(new THREE.Vector3(0, 1.2, 0));
      }
    } else if (this.state === 'return') {
      // Track the hero each frame so it always returns to where they are now
      if (heroPos) this.returnTarget.copy(heroPos).add(new THREE.Vector3(0, 1.2, 0));
      const k = Math.min(1, this.t / this.returnDur);
      this.group.position.lerpVectors(this.startPos, this.returnTarget, k);
      if (k >= 1) { this.state = 'idle'; this.group.visible = false; }
    }
    // The disc spins around its own forward axis (perpendicular to dir)
    // for visual effect. This is independent of the camera.
    this.mesh.rotation.z += dt * 18;
  }

  /** Bounding sphere test against an enemy position. */
  hits(point: THREE.Vector3, radius = 1.0): boolean {
    if (this.state === 'idle') return false;
    const a = this.group.position; const b = point;
    const dx = a.x - b.x, dz = a.z - b.z;
    return Math.hypot(dx, dz) < radius + 1.1;
  }
}
