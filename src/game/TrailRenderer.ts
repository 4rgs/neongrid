/**
 * TrailRenderer.ts — renders the hero's trail as a glowing line strip.
 */
import * as THREE from 'three';
import { PALETTE } from './palette';
import { Hero } from './Hero';

export class TrailRenderer {
  scene: THREE.Scene;
  private line!: THREE.Line;
  private positions!: Float32Array;
  private max = 60;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.positions = new Float32Array(this.max * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    const mat = new THREE.LineBasicMaterial({ color: PALETTE.orange, transparent: true, opacity: 0.9 });
    this.line = new THREE.Line(geo, mat);
    this.scene.add(this.line);
  }

  update(hero: Hero) {
    const trail = hero.getTrail();
    const n = Math.min(trail.length, this.max);
    // Fill positions: newest last, so trail reads from front (hero) to back
    for (let i = 0; i < n; i++) {
      const t = trail[trail.length - 1 - i];
      this.positions[i * 3] = t.pos.x;
      this.positions[i * 3 + 1] = 0.15;
      this.positions[i * 3 + 2] = t.pos.z;
    }
    // Fill rest with last point to avoid stray lines
    const last = n > 0 ? trail[trail.length - 1] : null;
    for (let i = n; i < this.max; i++) {
      this.positions[i * 3] = last ? last.pos.x : hero.group.position.x;
      this.positions[i * 3 + 1] = 0.15;
      this.positions[i * 3 + 2] = last ? last.pos.z : hero.group.position.z;
    }
    (this.line.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.line.geometry as THREE.BufferGeometry).setDrawRange(0, n);
    // Fade by life (we approximate by overall opacity that pulses with last life)
    if (n > 0) {
      (this.line.material as THREE.LineBasicMaterial).opacity = Math.min(0.9, trail[trail.length - 1].life);
    }
  }
}
