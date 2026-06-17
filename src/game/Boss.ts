/**
 * Boss.ts — the Master Process.
 *
 * Each level spawns a harder version of this boss. Level N has:
 *   - HP = 30 + 20 * (N - 1)         (so 30, 50, 70, 90, ...)
 *   - projectile speed *  (1 + 0.1 * (N - 1))
 *   - cooldown shorter at higher level
 *   - charge attack unlocked at level 2+
 *   - ring sweep unlocked at level 3+
 *   - enrage mode (faster, more damage) when HP < 30%
 *
 * Visual per level: different core shape (octa → icosa → dodeca → subdivided
 * icosa) and different color (orange → magenta → green → red → yellow).
 */
import * as THREE from 'three';
import { PALETTE } from './palette';
import { terrainHeight } from './World';

export class Boss {
  group = new THREE.Group();
  alive = true;
  hp = 30;
  maxHp = 30;
  level = 1;
  variant = 'octa';
  // private AI state
  private t = 0;
  private angle = 0;
  private shootCd = 1.5;
  private chargeCd = 5.0;
  private chargeT = 0;
  private chargeDir = new THREE.Vector3();
  private sweepT = 0;
  private hitFlashT = 0;   // brief invincibility after being hit
  private playerPos = new THREE.Vector3();
  // visuals
  private core!: THREE.Mesh;
  private coreOutline!: THREE.LineSegments;
  private ring!: THREE.Mesh;
  private spikes: THREE.Mesh[] = [];
  // projectiles
  projectiles: { mesh: THREE.Mesh; vel: THREE.Vector3; life: number; damage: number }[] = [];

  constructor(spawnAt: THREE.Vector3, level = 1, variant = 'octa') {
    this.level = level;
    this.variant = variant;
    this.hp = 30 + 20 * (level - 1);
    this.maxHp = this.hp;
    this.buildMesh();
    this.group.position.set(spawnAt.x, terrainHeight(spawnAt.x, spawnAt.z), spawnAt.z);
  }

  setPlayerPos(p: THREE.Vector3) { this.playerPos = p; }

  private buildMesh() {
    const body = new THREE.Group();
    body.position.y = 2.5;
    this.group.add(body);

    const coreSize = 1.6 + (this.level - 1) * 0.25;
    const coreGeo = this.makeCoreGeometry(coreSize);
    const coreColor = this.coreColor();
    const coreMat = new THREE.MeshBasicMaterial({ color: coreColor });
    this.core = new THREE.Mesh(coreGeo, coreMat);
    body.add(this.core);
    this.coreOutline = new THREE.LineSegments(
      new THREE.EdgesGeometry(coreGeo),
      new THREE.LineBasicMaterial({ color: PALETTE.cyan }),
    );
    this.core.add(this.coreOutline);

    const ringGeo = new THREE.TorusGeometry(3.2 + (this.level - 1) * 0.3, 0.18, 8, 48);
    const ringMat = new THREE.MeshBasicMaterial({
      color: this.ringColor(),
      transparent: true, opacity: 0.85,
    });
    this.ring = new THREE.Mesh(ringGeo, ringMat);
    this.ring.rotation.x = Math.PI / 2;
    body.add(this.ring);

    const spikeCount = 4 + Math.min(this.level - 1, 4);   // up to 8
    for (let i = 0; i < spikeCount; i++) {
      const spike = new THREE.Mesh(
        new THREE.ConeGeometry(0.3, 1.4, 6),
        new THREE.MeshBasicMaterial({ color: coreColor }),
      );
      const a = (i / spikeCount) * Math.PI * 2;
      spike.position.set(Math.cos(a) * 2.4, 0, Math.sin(a) * 2.4);
      body.add(spike);
      this.spikes.push(spike);
    }

    const baseR = 4 + (this.level - 1) * 0.5;
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(baseR, baseR + 1, 0.2, 12),
      new THREE.MeshBasicMaterial({ color: 0x331100 }),
    );
    base.position.y = 0.1;
    this.group.add(base);
    base.add(new THREE.LineSegments(
      new THREE.EdgesGeometry(base.geometry),
      new THREE.LineBasicMaterial({ color: PALETTE.cyan, transparent: true, opacity: 0.6 }),
    ));

    const baseRing = new THREE.Mesh(
      new THREE.TorusGeometry(baseR + 0.2, 0.1, 6, 36),
      new THREE.MeshBasicMaterial({ color: this.ringColor() }),
    );
    baseRing.rotation.x = Math.PI / 2;
    baseRing.position.y = 0.22;
    this.group.add(baseRing);
  }

  private makeCoreGeometry(size: number): THREE.BufferGeometry {
    if (this.level === 1) return new THREE.OctahedronGeometry(size, 0);
    if (this.level === 2) return new THREE.IcosahedronGeometry(size, 0);
    if (this.level === 3) return new THREE.DodecahedronGeometry(size, 0);
    return new THREE.IcosahedronGeometry(size, 1);
  }

  private coreColor(): number {
    return [PALETTE.orange, PALETTE.magenta, PALETTE.green, PALETTE.red, 0xffff00][(this.level - 1) % 5];
  }

  private ringColor(): number {
    return [PALETTE.magenta, PALETTE.cyan, PALETTE.orange, PALETTE.green, 0xff00ff][(this.level - 1) % 5];
  }

  private damage(): number { return 1 + Math.floor((this.level - 1) / 2); }
  private fireCooldown(): number { return Math.max(0.4, 1.5 - 0.1 * (this.level - 1)); }
  private projectileSpeed(): number { return 12 + 1.5 * (this.level - 1); }
  private enraged(): boolean { return this.hp < this.maxHp * 0.3; }

  hurt(dmg: number) {
    if (this.hitFlashT > 0) return;
    this.hp -= dmg;
    this.hitFlashT = 0.18;
    const mat = this.core.material as THREE.MeshBasicMaterial;
    mat.color.setHex(0xffffff);
    setTimeout(() => {
      if (this.core) (this.core.material as THREE.MeshBasicMaterial).color.setHex(this.coreColor());
    }, 100);
    if (this.hp <= 0) {
      this.alive = false;
      this.group.visible = false;
    }
  }

  takesHit(point: THREE.Vector3): boolean {
    if (!this.alive || this.hitFlashT > 0) return false;
    const a = this.group.position; const b = point;
    const dx = a.x - b.x, dz = a.z - b.z;
    return Math.hypot(dx, dz) < 2.5;
  }

  update(dt: number, t: number, playerPos: THREE.Vector3) {
    this.t = t;
    this.playerPos = playerPos;
    if (!this.alive) return;
    if (this.hitFlashT > 0) this.hitFlashT -= dt;
    if (this.shootCd > 0) this.shootCd -= dt;
    if (this.chargeCd > 0) this.chargeCd -= dt;
    if (this.chargeT > 0) this.chargeT -= dt;
    if (this.sweepT > 0) this.sweepT -= dt;

    const dx = playerPos.x - this.group.position.x;
    const dz = playerPos.z - this.group.position.z;
    const d = Math.hypot(dx, dz) || 1;

    // Drift slowly toward the player (gets closer on enrage).
    const driftSpeed = (this.enraged() ? 10 : 6) * dt;
    this.group.position.x += (dx / d) * driftSpeed;
    this.group.position.z += (dz / d) * driftSpeed;
    // Clamp distance so the boss doesn't run through the player
    const minDist = this.enraged() ? 4 : 6;
    if (d < minDist) {
      this.group.position.x = playerPos.x - (dx / d) * minDist;
      this.group.position.z = playerPos.z - (dz / d) * minDist;
    }
    this.group.position.y = terrainHeight(this.group.position.x, this.group.position.z);
    this.group.lookAt(playerPos.x, this.group.position.y, playerPos.z);

    // Spin visuals (faster on enrage)
    this.angle += dt * (this.enraged() ? 1.4 : 0.6);
    this.ring.rotation.z = t * (this.enraged() ? 2.5 : 0.6);
    this.core.rotation.x = t * 0.4;
    this.core.rotation.y = t * (this.enraged() ? 1.2 : 0.7);
    const spikeSpin = this.enraged() ? 2.5 : 1.4;
    for (let i = 0; i < this.spikes.length; i++) {
      const s = this.spikes[i];
      const a = -t * spikeSpin + (i * Math.PI * 2) / this.spikes.length;
      s.position.x = Math.cos(a) * 2.4;
      s.position.z = Math.sin(a) * 2.4;
      s.rotation.x = -a + Math.PI / 2;
    }

    // Charge attack (level 2+)
    if (this.level >= 2 && this.chargeT <= 0 && this.chargeCd <= 0 && d < 18) {
      this.chargeDir = new THREE.Vector3(dx / d, 0, dz / d);
      this.chargeT = 0.7;
      this.chargeCd = 4.0;
    }
    if (this.chargeT > 0) {
      this.chargeT -= dt;
      if (this.chargeT < 0.25) {
        const sp = 22;
        this.group.position.x += this.chargeDir.x * sp * dt;
        this.group.position.z += this.chargeDir.z * sp * dt;
        this.group.position.y = terrainHeight(this.group.position.x, this.group.position.z);
      }
    }

    // Shoot
    if (this.shootCd <= 0 && d < 26) {
      this.fire(t);
      this.shootCd = this.fireCooldown();
    }

    // Ring sweep (level 3+)
    if (this.level >= 3 && this.sweepT <= 0 && d < 24) {
      this.sweep();
      this.sweepT = 5.0;
    }

    // Update projectiles
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.mesh.position.add(p.vel.clone().multiplyScalar(dt));
      p.life -= dt;
      if (p.life <= 0) {
        p.mesh.parent?.remove(p.mesh);
        this.projectiles.splice(i, 1);
      }
    }
  }

  private fire(t: number) {
    const speed = this.projectileSpeed();
    const damage = this.damage();
    const toPlayer = new THREE.Vector3().subVectors(this.playerPos, this.group.position).setY(1.5).normalize();
    const start = this.group.position.clone().add(new THREE.Vector3(0, 2.5, 0));
    const fanCount = Math.min(1 + this.level, 5);
    const fanSpread = 0.45;
    for (let i = 0; i < fanCount; i++) {
      const offset = fanCount === 1 ? 0 : (i - (fanCount - 1) / 2) * fanSpread;
      const a = Math.atan2(toPlayer.x, toPlayer.z) + offset;
      const dir = new THREE.Vector3(Math.sin(a), 0, Math.cos(a)).normalize();
      this.spawnProjectile(start, dir, speed, damage);
    }
    if (this.enraged()) {
      const back = toPlayer.clone().multiplyScalar(-1);
      this.spawnProjectile(start, back, speed, damage);
    }
  }

  private sweep() {
    const speed = this.projectileSpeed() * 0.7;
    const damage = this.damage();
    const start = this.group.position.clone().add(new THREE.Vector3(0, 2.5, 0));
    const N = 12;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      this.spawnProjectile(start, dir, speed, damage);
    }
  }

  private spawnProjectile(start: THREE.Vector3, dir: THREE.Vector3, speed: number, damage: number) {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(0.35, 10, 8),
      new THREE.MeshBasicMaterial({
        color: this.enraged() ? 0xff2255 : (this.level >= 2 ? PALETTE.magenta : PALETTE.cyan),
      }),
    );
    m.position.copy(start);
    this.group.parent?.add(m);
    this.projectiles.push({ mesh: m, vel: dir.multiplyScalar(speed), life: 3.0, damage });
  }
}
