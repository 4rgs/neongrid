/**
 * ParticlePool.ts — fixed pool of N particles reused across bursts.
 * Avoids per-hit allocations.
 */
import * as THREE from 'three';

const POOL_SIZE = 600;

export class ParticleSystem {
  scene: THREE.Scene;
  // One big BufferGeometry holding all particles
  geo!: THREE.BufferGeometry;
  points!: THREE.Points;
  mat!: THREE.PointsMaterial;
  // per-particle: position, velocity, life, maxLife, color
  pos!: Float32Array;
  vel!: Float32Array;
  life!: Float32Array;
  maxLife!: Float32Array;
  colors!: Float32Array;
  // cursor for next free slot
  cursor = 0;
  // active count
  count = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.pos = new Float32Array(POOL_SIZE * 3);
    this.vel = new Float32Array(POOL_SIZE * 3);
    this.life = new Float32Array(POOL_SIZE);
    this.maxLife = new Float32Array(POOL_SIZE);
    this.colors = new Float32Array(POOL_SIZE * 3);

    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.geo.setDrawRange(0, 0);
    this.mat = new THREE.PointsMaterial({
      size: 0.22, vertexColors: true, transparent: true, opacity: 1.0, depthWrite: false,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    // initialize life to 0
    for (let i = 0; i < POOL_SIZE; i++) this.life[i] = 0;
    this.scene.add(this.points);
  }

  burst(pos: THREE.Vector3, color: number, count = 30, speed = 6, life = 0.7) {
    const c = new THREE.Color(color);
    for (let n = 0; n < count; n++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % POOL_SIZE;
      this.pos[i * 3]     = pos.x;
      this.pos[i * 3 + 1] = pos.y;
      this.pos[i * 3 + 2] = pos.z;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const s = speed * (0.5 + Math.random() * 0.5);
      this.vel[i * 3]     = s * Math.sin(phi) * Math.cos(theta);
      this.vel[i * 3 + 1] = s * Math.cos(phi) * 0.6 + 2;
      this.vel[i * 3 + 2] = s * Math.sin(phi) * Math.sin(theta);
      this.maxLife[i] = life * (0.6 + Math.random() * 0.6);
      this.life[i] = this.maxLife[i];
      this.colors[i * 3]     = c.r;
      this.colors[i * 3 + 1] = c.g;
      this.colors[i * 3 + 2] = c.b;
    }
    if (this.count < POOL_SIZE) this.count = Math.min(POOL_SIZE, this.count + count);
    this.geo.setDrawRange(0, this.count);
  }

  update(dt: number) {
    let alive = 0;
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      this.pos[i * 3]     += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.vel[i * 3 + 1] -= 9 * dt;
      alive++;
    }
    // Faint fade by lowering overall opacity based on fraction of pool in use
    (this.mat as THREE.PointsMaterial).opacity = 1.0;
    (this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }
}
