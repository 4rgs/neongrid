/**
 * Hero.ts — the player.
 * Low-poly humanoid: capsule body + box head + box arms + cel-shaded
 * material with 3-band lighting + emissive seam lines.
 * Movement: WASD walk, Shift dash (1.2s cooldown), Space jump.
 * Combat: J or LMB throws a disc-whip that returns (boomerang).
 */
import * as THREE from 'three';
import { PALETTE } from './palette';
import { Input } from './Input';
import { Disc } from './Disc';
import { terrainHeight } from './World';
import type { Component } from './Components';

const CEL_VERT = /* glsl */`
  varying vec3 vNormalW;
  varying vec3 vViewDirW;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vViewDirW = normalize(cameraPosition - wp.xyz);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const CEL_FRAG = /* glsl */`
  precision highp float;
  uniform vec3 uColor;
  uniform vec3 uSeam;
  uniform vec3 uLightDir;
  uniform float uPulse;
  varying vec3 vNormalW;
  varying vec3 vViewDirW;

  void main() {
    vec3 N = normalize(vNormalW);
    vec3 L = normalize(uLightDir);
    float ndl = dot(N, L);
    float band;
    if (ndl > 0.5)       band = 1.0;
    else if (ndl > 0.0)  band = 0.6;
    else                 band = 0.3;
    vec3 col = uColor * band;
    float rim = 1.0 - max(dot(N, normalize(vViewDirW)), 0.0);
    rim = pow(rim, 2.5);
    col += uSeam * rim * (0.7 + 0.3 * uPulse);
    gl_FragColor = vec4(col, 1.0);
  }
`;

export class Hero {
  group = new THREE.Group();
  bodyMat!: THREE.ShaderMaterial;
  seamMat!: THREE.MeshBasicMaterial;
  outlineMat!: THREE.MeshBasicMaterial;
  velocity = new THREE.Vector3();
  yaw = 0;
  hp = 6;
  maxHp = 6;
  hpChanged = false;
  onGround = true;
  vy = 0;
  dashT = 0;
  dashDir = new THREE.Vector3();
  dashCd = 0;
  attackCd = 0;
  trail: { pos: THREE.Vector3; life: number }[] = [];
  torso!: THREE.Mesh;
  head!: THREE.Mesh;
  armL!: THREE.Mesh;
  armR!: THREE.Mesh;
  disc!: Disc;
  private bodyGeoms: THREE.BufferGeometry[] = [];

  constructor() {
    this.buildBody();
    this.disc = new Disc();
    // The disc is NOT added to the hero group: it is a free-flying world-space
    // projectile (see Disc.ts). Game.ts attaches it to the scene directly.
  }

  private addGeo(g: THREE.BufferGeometry) { this.bodyGeoms.push(g); }

  private buildBody() {
    this.bodyMat = new THREE.ShaderMaterial({
      vertexShader: CEL_VERT,
      fragmentShader: CEL_FRAG,
      uniforms: {
        uColor: { value: new THREE.Color(PALETTE.orange) },
        uSeam: { value: new THREE.Color(PALETTE.cyan) },
        uLightDir: { value: new THREE.Vector3(0.5, 1.0, 0.3).normalize() },
        uPulse: { value: 0.5 },
      },
    });
    this.seamMat = new THREE.MeshBasicMaterial({ color: PALETTE.cyan });
    this.outlineMat = new THREE.MeshBasicMaterial({
      color: PALETTE.cyan,
      side: THREE.BackSide,
    });

    // Helper: add a body part with its own BackSide outline.
    // The outline is a sibling mesh at the same position+scale 1.06; it
    // follows the part's transforms because it's in the same group, so
    // pitch/roll on the hero no longer misalign the silhouette.
    const addPart = (geo: THREE.BufferGeometry, x: number, y: number, z: number, outlineScale = 1.06) => {
      const mesh = new THREE.Mesh(geo, this.bodyMat);
      mesh.position.set(x, y, z);
      this.group.add(mesh);
      const outline = new THREE.Mesh(geo, this.outlineMat);
      outline.position.set(x, y, z);
      outline.scale.setScalar(outlineScale);
      this.group.add(outline);
      return mesh;
    };

    // Torso
    const torsoGeo = new THREE.BoxGeometry(0.7, 0.9, 0.4);
    this.torso = addPart(torsoGeo, 0, 1.0, 0);

    // Head
    const headGeo = new THREE.BoxGeometry(0.55, 0.5, 0.5);
    this.head = addPart(headGeo, 0, 1.75, 0);

    // Visor (emissive seam on the face)
    const visorGeo = new THREE.BoxGeometry(0.56, 0.15, 0.1);
    const visor = new THREE.Mesh(visorGeo, this.seamMat);
    visor.position.set(0, 1.75, 0.21);
    this.group.add(visor);
    // Helmet top seam (thin line)
    const helmetSeam = new THREE.LineSegments(
      new THREE.EdgesGeometry(headGeo),
      new THREE.LineBasicMaterial({ color: PALETTE.cyan }),
    );
    helmetSeam.position.set(0, 1.75, 0);
    this.group.add(helmetSeam);

    // Arms
    const armGeo = new THREE.BoxGeometry(0.22, 0.8, 0.22);
    this.armL = addPart(armGeo, -0.46, 1.0, 0, 1.08);
    this.armR = addPart(armGeo, 0.46, 1.0, 0, 1.08);

    // Legs
    const legGeo = new THREE.BoxGeometry(0.26, 0.7, 0.26);
    addPart(legGeo, -0.18, 0.35, 0, 1.08);
    addPart(legGeo, 0.18, 0.35, 0, 1.08);

    // Belt seam (emissive)
    const beltGeo = new THREE.BoxGeometry(0.72, 0.06, 0.42);
    const belt = new THREE.Mesh(beltGeo, this.seamMat);
    belt.position.set(0, 0.7, 0);
    this.group.add(belt);

    this.group.position.set(0, 0, 0);
  }

  /** Damage the player. Returns true if it killed. */
  hurt(dmg = 1): boolean {
    if (this.dashT > 0) return false; // i-frames during dash
    this.hp = Math.max(0, this.hp - dmg);
    this.hpChanged = true;
    this.bodyMat.uniforms.uColor.value = new THREE.Color(0xffffff);
    setTimeout(() => {
      this.bodyMat.uniforms.uColor.value = new THREE.Color(PALETTE.orange);
    }, 100);
    return this.hp === 0;
  }

  /** Try to start an attack. Throws disc in the direction the camera faces. */
  tryAttack(cameraYaw: number): boolean {
    if (this.attackCd > 0 || this.disc.state !== 'idle') return false;
    this.attackCd = 0.5;
    // Launch from WORLD position (not local) so the disc starts in front of
    // the hero regardless of pitch/roll on the terrain.
    const fwd = new THREE.Vector3(Math.sin(cameraYaw + Math.PI), 0, Math.cos(cameraYaw + Math.PI));
    const startPos = new THREE.Vector3(
      this.group.position.x + fwd.x * 0.4,
      this.group.position.y + 1.2,
      this.group.position.z + fwd.z * 0.4,
    );
    this.disc.throw(startPos, fwd);
    this.yaw = cameraYaw + Math.PI;
    this.group.rotation.y = this.yaw;
    return true;
  }

  private firstCollider(components: Component[], x: number, z: number, r: number): Component | null {
    for (const c of components) {
      const dx = Math.abs(x - c.group.position.x);
      const dz = Math.abs(z - c.group.position.z);
      if (dx < c.halfX + r && dz < c.halfZ + r) {
        return c;
      }
    }
    return null;
  }

  update(dt: number, input: Input, t: number, pulse: number, cameraYaw: number, components: Component[] = []) {
    if (this.attackCd > 0) this.attackCd = Math.max(0, this.attackCd - dt);
    if (this.dashT > 0) this.dashT = Math.max(0, this.dashT - dt);
    if (this.dashCd > 0) this.dashCd = Math.max(0, this.dashCd - dt);

    const { x, z } = input.axis();
    const wantDash = input.consumeDash();
    const wantJump = input.consumeJump();
    const wantAttack = input.consumeAttack();

    // Camera-relative movement
    const fwd = new THREE.Vector3(-Math.sin(cameraYaw), 0, -Math.cos(cameraYaw));
    const right = new THREE.Vector3(Math.cos(cameraYaw), 0, -Math.sin(cameraYaw));
    const moveDir = new THREE.Vector3()
      .addScaledVector(fwd, -z)
      .addScaledVector(right, x);
    const len = moveDir.length();
    if (len > 0.01) moveDir.multiplyScalar(1 / len);

    const baseSpeed = 7;
    const dashSpeed = 22;
    let speed = baseSpeed;

    if (this.dashT > 0) {
      speed = dashSpeed;
    } else if (wantDash && this.dashCd <= 0 && len > 0.01) {
      this.dashT = 0.22;
      this.dashCd = 0.9;
      this.dashDir.copy(moveDir);
    }

    if (len > 0.01) {
      this.yaw = Math.atan2(moveDir.x, moveDir.z);
    }
    this.group.rotation.y = this.yaw;

    const vel = (this.dashT > 0) ? this.dashDir.clone() : moveDir;
    this.velocity.x = vel.x * speed;
    this.velocity.z = vel.z * speed;

    // Jump physics (relative to terrain)
    if (wantJump && this.onGround) {
      this.vy = 9.5;
      this.onGround = false;
    }
    this.vy -= 26 * dt;
    // AABB sliding collision
    const heroRadius = 0.45;
    const newX = this.group.position.x + this.velocity.x * dt;
    const newZ = this.group.position.z + this.velocity.z * dt;
    let finalX = newX;
    let finalZ = newZ;
    {
      const c = this.firstCollider(components, finalX, this.group.position.z, heroRadius);
      if (c) {
        const sign = Math.sign(this.velocity.x) || 1;
        finalX = c.group.position.x - sign * (c.halfX + heroRadius + 0.001);
        this.velocity.x = 0;
      }
    }
    {
      const c = this.firstCollider(components, finalX, finalZ, heroRadius);
      if (c) {
        const sign = Math.sign(this.velocity.z) || 1;
        finalZ = c.group.position.z - sign * (c.halfZ + heroRadius + 0.001);
        this.velocity.z = 0;
      }
    }
    this.group.position.x = finalX;
    this.group.position.z = finalZ;
    this.group.position.y += this.vy * dt;
    const groundY = terrainHeight(this.group.position.x, this.group.position.z) + 0.02;
    if (this.group.position.y <= groundY) {
      this.group.position.y = groundY;
      this.vy = 0;
      this.onGround = true;
    }

    // Pitch & roll the hero to follow the slope.
    // Use a smaller sample distance (0.35) to avoid heavy angles on
    // bumpy terrain that would misalign the disc and cause motion sickness.
    const dx = 0.35;
    const hFront = terrainHeight(this.group.position.x + Math.sin(this.yaw) * dx, this.group.position.z + Math.cos(this.yaw) * dx);
    const hRight = terrainHeight(this.group.position.x + Math.cos(this.yaw) * dx, this.group.position.z - Math.sin(this.yaw) * dx);
    const pitch = Math.atan2(hFront - groundY, dx) * 0.7;  // dampen to 70%
    const roll = -Math.atan2(hRight - groundY, dx) * 0.7;
    this.group.rotation.x = pitch;
    this.group.rotation.z = roll;

    // Walk anim: sway arms
    const walkPhase = len > 0.01 ? t * 10 : 0;
    this.armL.rotation.x = Math.sin(walkPhase) * 0.6;
    this.armR.rotation.x = -Math.sin(walkPhase) * 0.6;

    this.bodyMat.uniforms.uPulse.value = pulse;

    if (wantAttack) this.tryAttack(cameraYaw);

    // Note: this.disc.update is called from Game.ts so it can pass the
    // hero's current world position for the return arc.
    this.updateTrail(dt);
  }

  private updateTrail(dt: number) {
    const speed = this.velocity.length();
    if (speed > 12 || this.dashT > 0) {
      this.trail.push({ pos: this.group.position.clone().setY(0.1), life: 1 });
    }
    for (let i = this.trail.length - 1; i >= 0; i--) {
      this.trail[i].life -= dt * 1.3;
      if (this.trail[i].life <= 0) this.trail.splice(i, 1);
    }
    if (this.trail.length > 60) this.trail.splice(0, this.trail.length - 60);
  }

  getTrail(): { pos: THREE.Vector3; life: number }[] { return this.trail; }
}
