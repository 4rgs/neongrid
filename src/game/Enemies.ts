/**
 * Enemies.ts — PatrolBot and Turret virus enemies.
 * PatrolBot: walks on a back-and-forth line, chases player if close.
 * Turret: static, fires a slow cyan projectile every 2s.
 */
import * as THREE from 'three';
import { PALETTE } from './palette';
import { terrainHeight } from './World';

export type EnemyKind = 'patrol' | 'turret' | 'hunter' | 'charger' | 'drone';

export class Enemy {
  group = new THREE.Group();
  alive = true;
  hp = 2;
  maxHp = 2;
  kind: EnemyKind;
  private t = 0;
  private patrolA: THREE.Vector3;
  private patrolB: THREE.Vector3;
  private patrolDir = 1;
  private shootCd = 1.5;
  // private state for chase
  private alertT = 0;
  // charger charge
  private chargeT = 0;
  private chargeDir = new THREE.Vector3();
  private chargeCd = 0;
  // hunter strafe
  private strafeAngle = 0;
  // projectile list (for turret/hunter)
  projectiles: { mesh: THREE.Mesh; vel: THREE.Vector3; life: number }[] = [];

  constructor(kind: EnemyKind, a: THREE.Vector3, b: THREE.Vector3, levelMul = 1) {
    this.kind = kind;
    this.patrolA = a.clone();
    this.patrolB = b.clone();
    this.group.position.set(a.x, terrainHeight(a.x, a.z), a.z);
    this.buildMesh();
    // Base HP per kind, scaled by the level difficulty multiplier so
    // each new level spawns tougher enemies. Ceil so a 1.0 mul still
    // gives the base HP and 1.5x on 2hp gives 3hp (not 3.something).
    const base = (kind === 'hunter' || kind === 'charger') ? 4
               : kind === 'drone' ? 2
               : 2;  // patrol / turret
    this.hp = this.maxHp = Math.max(1, Math.ceil(base * levelMul));
  }

  private buildMesh() {
    if (this.kind === 'patrol') {
      const bodyMat = new THREE.MeshBasicMaterial({ color: PALETTE.magenta });
      // Spider-like box body + 4 legs (lines)
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(0.7, 0.4, 0.9),
        bodyMat,
      );
      body.position.y = 0.55;
      this.group.add(body);
      // outline as child of body so it follows the body's position+rotation
      const outline = new THREE.LineSegments(
        new THREE.EdgesGeometry(body.geometry),
        new THREE.LineBasicMaterial({ color: PALETTE.cyan }),
      );
      body.add(outline);
      // eyes (emissive cyan)
      const eyeMat = new THREE.MeshBasicMaterial({ color: PALETTE.cyan });
      const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), eyeMat);
      eyeL.position.set(-0.18, 0.1, 0.46);  // local to body
      body.add(eyeL);
      const eyeR = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), eyeMat);
      eyeR.position.set(0.18, 0.1, 0.46);
      body.add(eyeR);
      // legs as lines (local to body)
      const legPts: number[] = [];
      for (const dx of [-0.3, 0.3]) for (const dz of [-0.35, 0.35]) {
        legPts.push(dx, 0, dz, dx * 1.6, -0.5, dz * 1.6);
      }
      const legGeo = new THREE.BufferGeometry();
      legGeo.setAttribute('position', new THREE.Float32BufferAttribute(legPts, 3));
      body.add(new THREE.LineSegments(legGeo, new THREE.LineBasicMaterial({ color: PALETTE.magenta })));
    } else if (this.kind === 'turret') {
      // Turret: short cylinder + horizontal arm
      const base = new THREE.Mesh(
        new THREE.CylinderGeometry(0.55, 0.7, 0.4, 12),
        new THREE.MeshBasicMaterial({ color: PALETTE.red }),
      );
      base.position.y = 0.2;
      this.group.add(base);
      // outline (local to base)
      base.add(new THREE.LineSegments(
        new THREE.EdgesGeometry(base.geometry),
        new THREE.LineBasicMaterial({ color: PALETTE.cyan }),
      ));
      const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.35, 12, 8),
        new THREE.MeshBasicMaterial({ color: PALETTE.red }),
      );
      head.position.y = 0.7;
      this.group.add(head);
      head.add(new THREE.LineSegments(
        new THREE.EdgesGeometry(head.geometry),
        new THREE.LineBasicMaterial({ color: PALETTE.cyan }),
      ));
      const barrel = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.08, 0.9, 8),
        new THREE.MeshBasicMaterial({ color: PALETTE.cyan }),
      );
      barrel.rotation.z = Math.PI / 2;
      barrel.position.set(0.55, 0.7, 0);
      this.group.add(barrel);
      const eye = new THREE.Mesh(
        new THREE.SphereGeometry(0.18, 10, 8),
        new THREE.MeshBasicMaterial({ color: PALETTE.cyan }),
      );
      eye.position.set(0, 0.7, 0.35);
      this.group.add(eye);
    } else if (this.kind === 'hunter') {
      const body = new THREE.Mesh(
        new THREE.TetrahedronGeometry(0.55, 0),
        new THREE.MeshBasicMaterial({ color: PALETTE.green }),
      );
      body.position.y = 0.7;
      this.group.add(body);
      // outline as child of body
      body.add(new THREE.LineSegments(
        new THREE.EdgesGeometry(body.geometry),
        new THREE.LineBasicMaterial({ color: PALETTE.cyan }),
      ));
      const eye = new THREE.Mesh(
        new THREE.SphereGeometry(0.12, 8, 6),
        new THREE.MeshBasicMaterial({ color: PALETTE.cyan }),
      );
      eye.position.set(0, 0.05, 0.3);  // local to body
      body.add(eye);
    } else {
      // Charger: a thick biped that runs at the player
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(0.9, 0.7, 0.5),
        new THREE.MeshBasicMaterial({ color: PALETTE.red }),
      );
      body.position.y = 0.7;
      this.group.add(body);
      // outline as child of body
      body.add(new THREE.LineSegments(
        new THREE.EdgesGeometry(body.geometry),
        new THREE.LineBasicMaterial({ color: PALETTE.cyan }),
      ));
      // spikes on back (local to body)
      for (let i = 0; i < 3; i++) {
        const spike = new THREE.Mesh(
          new THREE.ConeGeometry(0.1, 0.4, 4),
          new THREE.MeshBasicMaterial({ color: PALETTE.cyan }),
        );
        spike.position.set((i - 1) * 0.3, 0.5, 0);
        body.add(spike);
      }
      // eyes (local to body)
      const eyeMat = new THREE.MeshBasicMaterial({ color: PALETTE.cyan });
      const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), eyeMat);
      eyeL.position.set(-0.22, 0.15, 0.26);
      body.add(eyeL);
      const eyeR = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), eyeMat);
      eyeR.position.set(0.22, 0.15, 0.26);
      body.add(eyeR);
    }
  }

  hurt(dmg: number): boolean {
    this.hp -= dmg;
    // flash
    this.group.children.forEach((c) => {
      if ((c as THREE.Mesh).material instanceof THREE.MeshBasicMaterial) {
        const m = (c as THREE.Mesh).material as THREE.MeshBasicMaterial;
        const orig = m.color.getHex();
        m.color.setHex(0xffffff);
        setTimeout(() => m.color.setHex(orig), 80);
      }
    });
    if (this.hp <= 0) {
      this.alive = false;
      this.group.visible = false;
    }
    return !this.alive;
  }

  update(dt: number, t: number, playerPos: THREE.Vector3) {
    this.t += dt;
    if (this.shootCd > 0) this.shootCd -= dt;
    if (this.chargeCd > 0) this.chargeCd -= dt;
    if (!this.alive) return;

    const toPlayer = playerPos.clone().sub(this.group.position);
    const dist = toPlayer.length();
    const inRange = dist < 18;
    if (inRange) this.alertT = 1.5; else this.alertT = Math.max(0, this.alertT - dt);

    if (this.kind === 'patrol') {
      if (this.alertT > 0) {
        const dir = toPlayer.clone().setY(0).normalize();
        const speed = 4.5;
        this.group.position.x += dir.x * speed * dt;
        this.group.position.z += dir.z * speed * dt;
        this.group.position.y = terrainHeight(this.group.position.x, this.group.position.z);
        this.group.lookAt(playerPos.x, this.group.position.y, playerPos.z);
      } else {
        const seg = this.patrolB.clone().sub(this.patrolA);
        const len = seg.length();
        const dir = seg.clone().normalize();
        const speed = 2.2;
        this.group.position.x += dir.x * this.patrolDir * speed * dt;
        this.group.position.z += dir.z * this.patrolDir * speed * dt;
        this.group.position.y = terrainHeight(this.group.position.x, this.group.position.z);
        const d = this.group.position.clone().sub(this.patrolA).dot(dir);
        if (d > len) { this.patrolDir = -1; this.group.position.copy(this.patrolA).add(dir.clone().multiplyScalar(len)); }
        else if (d < 0) { this.patrolDir = 1; this.group.position.copy(this.patrolA); }
        this.group.lookAt(this.group.position.x + dir.x * this.patrolDir, this.group.position.y, this.group.position.z + dir.z * this.patrolDir);
      }
    } else if (this.kind === 'turret') {
      this.group.position.y = terrainHeight(this.group.position.x, this.group.position.z);
      this.group.lookAt(playerPos.x, this.group.position.y, playerPos.z);
      if (this.shootCd <= 0 && dist < 22) {
        this.shoot(playerPos);
        this.shootCd = 2.0;
      }
    } else if (this.kind === 'hunter') {
      if (this.alertT > 0) {
        this.strafeAngle += dt * 1.5;
        const r = 8;
        const desired = playerPos.clone().add(new THREE.Vector3(Math.cos(this.strafeAngle) * r, 0, Math.sin(this.strafeAngle) * r));
        this.group.position.lerp(desired, 4 * dt);
        this.group.position.y = terrainHeight(this.group.position.x, this.group.position.z);
        this.group.lookAt(playerPos.x, this.group.position.y, playerPos.z);
        if (this.shootCd <= 0 && dist < 20) {
          this.shoot(playerPos, 0.55);
          this.shootCd = 0.85;
        }
      } else {
        const seg = this.patrolB.clone().sub(this.patrolA);
        const dir = seg.clone().normalize();
        this.group.position.x += dir.x * this.patrolDir * 1.8 * dt;
        this.group.position.z += dir.z * this.patrolDir * 1.8 * dt;
        this.group.position.y = terrainHeight(this.group.position.x, this.group.position.z);
        const d = this.group.position.clone().sub(this.patrolA).dot(dir);
        const len = seg.length();
        if (d > len) this.patrolDir = -1;
        if (d < 0) this.patrolDir = 1;
      }
    } else if (this.kind === 'charger') {
      if (this.chargeT > 0) {
        this.chargeT -= dt;
        const speed = 16;
        this.group.position.x += this.chargeDir.x * speed * dt;
        this.group.position.z += this.chargeDir.z * speed * dt;
        this.group.position.y = terrainHeight(this.group.position.x, this.group.position.z);
        this.group.lookAt(this.group.position.x + this.chargeDir.x, this.group.position.y, this.group.position.z + this.chargeDir.z);
      } else if (this.chargeCd <= 0 && dist < 14) {
        this.chargeDir = toPlayer.clone().setY(0).normalize();
        this.chargeT = 0.6;
        this.chargeCd = 2.5;
        this.group.lookAt(playerPos.x, this.group.position.y, playerPos.z);
      } else if (this.chargeCd > 0) {
        this.group.position.y = terrainHeight(this.group.position.x, this.group.position.z);
        this.group.lookAt(playerPos.x, this.group.position.y, playerPos.z);
      } else {
        const seg = this.patrolB.clone().sub(this.patrolA);
        const dir = seg.clone().normalize();
        this.group.position.x += dir.x * this.patrolDir * 2 * dt;
        this.group.position.z += dir.z * this.patrolDir * 2 * dt;
        this.group.position.y = terrainHeight(this.group.position.x, this.group.position.z);
        const d = this.group.position.clone().sub(this.patrolA).dot(dir);
        const len = seg.length();
        if (d > len) this.patrolDir = -1;
        if (d < 0) this.patrolDir = 1;
      }
    } else if (this.kind === 'drone') {
      // Drone: floats 4m above the player and shoots 360°
      const target = new THREE.Vector3(playerPos.x, playerPos.y + 4, playerPos.z);
      this.group.position.lerp(target, 3 * dt);
      // hover bob
      this.group.position.y += Math.sin(t * 4) * 0.05;
      this.group.lookAt(playerPos.x, this.group.position.y, playerPos.z);
      // spin
      this.group.rotation.y += dt * 2;
      if (this.shootCd <= 0 && dist < 22) {
        // 3 bullets in a 30° fan — also flatten to hero Y so they connect.
        const baseDir = new THREE.Vector3(
          playerPos.x - this.group.position.x,
          0,                                 // aim horizontally
          playerPos.z - this.group.position.z,
        );
        if (baseDir.lengthSq() < 0.01) baseDir.set(0, 0, 1);
        baseDir.normalize();
        const angle = Math.atan2(baseDir.x, baseDir.z);
        for (let i = -1; i <= 1; i++) {
          const a = angle + i * 0.35;
          const dir = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
          const start = this.group.position.clone();
          start.y = playerPos.y + 0.3;
          const m = new THREE.Mesh(
            new THREE.SphereGeometry(0.18, 8, 6),
            new THREE.MeshBasicMaterial({ color: PALETTE.magenta }),
          );
          m.position.copy(start);
          this.group.parent?.add(m);
          this.projectiles.push({ mesh: m, vel: dir.multiplyScalar(12), life: 2.5 });
        }
        this.shootCd = 2.0;
      }
    }
    // Update projectiles
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.mesh.position.add(p.vel.clone().multiplyScalar(dt));
      p.life -= dt;
      if (p.life <= 0) {
        this.group.parent?.remove(p.mesh);
        this.projectiles.splice(i, 1);
      }
    }
  }

  private shoot(playerPos: THREE.Vector3, speedMul = 1) {
    // Aim at the hero's body, not 0.7m above. We subtract the turret's
    // own Y so the projectile travels on a flat horizontal line that
    // will actually intersect the hero at his current height.
    const heroY = playerPos.y;       // hero is on the terrain (~0)
    const dir = new THREE.Vector3(
      playerPos.x - this.group.position.x,
      heroY - this.group.position.y,
      playerPos.z - this.group.position.z,
    );
    // If the hero is roughly at the same height, flatten the dir to XZ so
    // the projectile travels straight at him rather than arcing.
    if (Math.abs(dir.y) < 0.5) dir.y = 0;
    dir.normalize();
    const start = this.group.position.clone();
    // Raise the start a bit so the projectile spawns at the hero's chest
    start.y = heroY + 0.3;
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 8, 6),
      new THREE.MeshBasicMaterial({ color: PALETTE.cyan }),
    );
    m.position.copy(start);
    this.group.parent?.add(m);
    this.projectiles.push({ mesh: m, vel: dir.multiplyScalar(14 * speedMul), life: 2.5 });
  }
}
