/**
 * Boss.ts — the Master Process.
 * A larger geometric construct: octahedron core + spinning ring +
 * 4 "spike" cylinders orbiting. Strafes around a center, faces the player,
 * shoots cyan projectiles every 1.5s.
 */
import * as THREE from 'three';
import { PALETTE } from './palette';
import { terrainHeight } from './World';

export class Boss {
  group = new THREE.Group();
  alive = true;
  hp = 10;
  maxHp = 10;
  // orbit center (slight drift)
  private center = new THREE.Vector3();
  private angle = 0;
  private radius = 8;
  private shootCd = 1.5;
  private t = 0;
  // visual
  private core!: THREE.Mesh;
  private ring!: THREE.Mesh;
  private spikes: THREE.Mesh[] = [];
  // projectiles
  projectiles: { mesh: THREE.Mesh; vel: THREE.Vector3; life: number }[] = [];

  constructor(spawnAt: THREE.Vector3) {
    this.center.copy(spawnAt);
    this.group.position.set(spawnAt.x, terrainHeight(spawnAt.x, spawnAt.z), spawnAt.z);

    // The boss's "body" is a Group at y=2.5 (the core height). Everything visual
    // (core, ring, spikes) is a child of this body so that lookAt() rotates
    // them all together as a single unit.
    const body = new THREE.Group();
    body.position.y = 2.5;
    this.group.add(body);

    const coreGeo = new THREE.OctahedronGeometry(1.6, 0);
    const coreMat = new THREE.MeshBasicMaterial({ color: PALETTE.orange });
    this.core = new THREE.Mesh(coreGeo, coreMat);
    body.add(this.core);
    // outline as child of core
    this.core.add(new THREE.LineSegments(
      new THREE.EdgesGeometry(coreGeo),
      new THREE.LineBasicMaterial({ color: PALETTE.cyan }),
    ));

    // big ring (rotates on its own axis; child of body)
    const ringGeo = new THREE.TorusGeometry(3.2, 0.18, 8, 48);
    const ringMat = new THREE.MeshBasicMaterial({ color: PALETTE.magenta });
    this.ring = new THREE.Mesh(ringGeo, ringMat);
    this.ring.rotation.x = Math.PI / 2;
    body.add(this.ring);

    // 4 spikes orbiting the body
    for (let i = 0; i < 4; i++) {
      const spike = new THREE.Mesh(
        new THREE.ConeGeometry(0.3, 1.4, 6),
        new THREE.MeshBasicMaterial({ color: PALETTE.cyan }),
      );
      // local position around the core
      spike.position.set(Math.cos(i * Math.PI / 2) * 2.4, 0, Math.sin(i * Math.PI / 2) * 2.4);
      body.add(spike);
      this.spikes.push(spike);
    }

    // base platform (not orbiting; on the ground)
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(4, 5, 0.2, 12),
      new THREE.MeshBasicMaterial({ color: 0x331100 }),
    );
    base.position.y = 0.1;
    this.group.add(base);
    // base outline
    base.add(new THREE.LineSegments(
      new THREE.EdgesGeometry(base.geometry),
      new THREE.LineBasicMaterial({ color: PALETTE.cyan, transparent: true, opacity: 0.6 }),
    ));

    // base ring
    const baseRing = new THREE.Mesh(
      new THREE.TorusGeometry(4.2, 0.1, 6, 36),
      new THREE.MeshBasicMaterial({ color: PALETTE.magenta }),
    );
    baseRing.rotation.x = Math.PI / 2;
    baseRing.position.y = 0.22;
    this.group.add(baseRing);
  }

  hurt(dmg: number) {
    this.hp -= dmg;
    this.core.material = new THREE.MeshBasicMaterial({ color: 0xffffff });
    setTimeout(() => {
      if (this.core) this.core.material = new THREE.MeshBasicMaterial({ color: PALETTE.orange });
    }, 100);
    if (this.hp <= 0) {
      this.alive = false;
      this.group.visible = false;
    }
  }

  takesHit(point: THREE.Vector3): boolean {
    if (!this.alive) return false;
    const a = this.group.position; const b = point;
    const dx = a.x - b.x, dz = a.z - b.z;
    return Math.hypot(dx, dz) < 2.5;
  }

  update(dt: number, t: number, playerPos: THREE.Vector3) {
    this.t += dt;
    if (!this.alive) return;
    if (this.shootCd > 0) this.shootCd -= dt;

    // Strafes in circle around its center, slowly drifts toward player
    this.angle += dt * 0.6;
    const orbitX = this.center.x + Math.cos(this.angle) * this.radius;
    const orbitZ = this.center.z + Math.sin(this.angle) * this.radius;
    this.group.position.x += (orbitX - this.group.position.x) * 3 * dt;
    this.group.position.z += (orbitZ - this.group.position.z) * 3 * dt;
    this.group.position.y = terrainHeight(this.group.position.x, this.group.position.z);
    this.group.lookAt(playerPos.x, this.group.position.y, playerPos.z);

    // Spin visuals
    this.ring.rotation.z = t * 0.6;
    this.core.rotation.x = t * 0.4;
    this.core.rotation.y = t * 0.7;
    for (let i = 0; i < this.spikes.length; i++) {
      const s = this.spikes[i];
      const a = -t * 1.4 + (i * Math.PI * 2) / this.spikes.length;
      s.position.x = Math.cos(a) * 2.4;
      s.position.z = Math.sin(a) * 2.4;
      s.rotation.x = -a + Math.PI / 2;
    }

    // Shoot
    if (this.shootCd <= 0) {
      this.shoot(playerPos);
      this.shootCd = 1.5;
    }

    // Update projectiles (they live in scene root)
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

  private shoot(playerPos: THREE.Vector3) {
    const dir = playerPos.clone().sub(this.group.position).setY(1.5).normalize();
    const start = this.group.position.clone().add(new THREE.Vector3(0, 2.5, 0));
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(0.35, 10, 8),
      new THREE.MeshBasicMaterial({ color: PALETTE.magenta }),
    );
    m.position.copy(start);
    this.group.parent?.add(m);
    this.projectiles.push({ mesh: m, vel: dir.multiplyScalar(12), life: 3 });
  }
}
