/**
 * Components.ts — PCB components scattered across the terrain.
 *
 * Scale: the hero is ~2m tall. Components are sized so they read at
 * the player's walking distance — chips are like tables, capacitors
 * are room-sized, towers block the view.
 */
import * as THREE from 'three';
import { PALETTE } from './palette';
import { terrainHeight } from './World';

export type ComponentKind = 'chip' | 'cap' | 'resistor' | 'diode' | 'mega' | 'tower';

export class Component {
  group = new THREE.Group();
  kind: ComponentKind;
  halfX = 0.5;
  halfZ = 0.5;
  height = 0.5;
  label = '';

  constructor(kind: ComponentKind, x: number, z: number) {
    this.kind = kind;
    this.group.position.set(x, terrainHeight(x, z), z);
    this.build();
  }

  private build() {
    switch (this.kind) {
      case 'chip':     this.buildChip();    break;
      case 'cap':      this.buildCap();     break;
      case 'resistor': this.buildResistor();break;
      case 'diode':    this.buildDiode();   break;
      case 'mega':     this.buildMega();    break;
      case 'tower':    this.buildTower();   break;
    }
  }

  private buildChip() {
    // "Table-sized" IC: 2.4–3.6m wide, 1.2–1.8m deep, 0.4m tall
    const w = 2.4 + Math.random() * 1.2;
    const d = 1.2 + Math.random() * 0.6;
    const h = 0.4;
    this.halfX = w * 0.5; this.halfZ = d * 0.5; this.height = h;
    this.label = 'U' + (Math.floor(Math.random() * 90) + 10);
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshBasicMaterial({ color: 0x081420 }),
    );
    body.position.y = h * 0.5;
    this.group.add(body);
    const notch = new THREE.Mesh(
      new THREE.CircleGeometry(h * 0.4, 16),
      new THREE.MeshBasicMaterial({ color: 0x000000 }),
    );
    notch.rotation.x = -Math.PI / 2;
    notch.position.set(-w * 0.4, h + 0.001, -d * 0.4);
    this.group.add(notch);
    // pins (large glowing pads)
    const pinMat = new THREE.MeshBasicMaterial({ color: PALETTE.cyan });
    const pinW = 0.25, pinH = 0.18, pinD = 0.18;
    const pinCount = 5;
    for (let i = 0; i < pinCount; i++) {
      const px = -w * 0.5 + (i + 0.5) * (w / pinCount);
      for (const side of [-1, 1]) {
        const pin = new THREE.Mesh(new THREE.BoxGeometry(pinW, pinH, pinD), pinMat);
        pin.position.set(px, h * 0.5, side * (d * 0.5 + pinD * 0.5));
        this.group.add(pin);
      }
    }
    for (let i = 0; i < pinCount; i++) {
      const pz = -d * 0.5 + (i + 0.5) * (d / pinCount);
      for (const side of [-1, 1]) {
        const pin = new THREE.Mesh(new THREE.BoxGeometry(pinD, pinH, pinW), pinMat);
        pin.position.set(side * (w * 0.5 + pinD * 0.5), h * 0.5, pz);
        this.group.add(pin);
      }
    }
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(body.geometry),
      new THREE.LineBasicMaterial({ color: PALETTE.cyan, transparent: true, opacity: 0.7 }),
    );
    edges.position.y = h * 0.5;
    this.group.add(edges);
  }

  private buildCap() {
    // "Barrel-sized" capacitor: 0.6–1m radius, 2–3.5m tall
    const r = 0.6 + Math.random() * 0.4;
    const h = 2.0 + Math.random() * 1.5;
    this.halfX = r; this.halfZ = r; this.height = h;
    this.label = 'C' + (Math.floor(Math.random() * 90) + 10);
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(r, r, h, 16),
      new THREE.MeshBasicMaterial({ color: 0x0a1828 }),
    );
    body.position.y = h * 0.5;
    this.group.add(body);
    const top = new THREE.Mesh(
      new THREE.CircleGeometry(r * 0.6, 16),
      new THREE.MeshBasicMaterial({ color: PALETTE.orange, transparent: true, opacity: 0.85 }),
    );
    top.rotation.x = -Math.PI / 2;
    top.position.y = h + 0.001;
    this.group.add(top);
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(body.geometry),
      new THREE.LineBasicMaterial({ color: PALETTE.cyan, transparent: true, opacity: 0.7 }),
    );
    edges.position.y = h * 0.5;
    this.group.add(edges);
  }

  private buildResistor() {
    // "Bench-sized" resistor: 1.5–2m long, 0.3m radius
    const len = 1.5 + Math.random() * 0.6;
    const r = 0.28;
    this.halfX = len * 0.5; this.halfZ = r; this.height = r * 2;
    this.label = 'R' + (Math.floor(Math.random() * 90) + 10);
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(r, r, len, 12),
      new THREE.MeshBasicMaterial({ color: 0x140808 }),
    );
    body.rotation.z = Math.PI / 2;
    body.position.y = r;
    this.group.add(body);
    const lead = new THREE.MeshBasicMaterial({ color: PALETTE.cyan });
    for (const side of [-1, 1]) {
      const l = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.5, 6), lead);
      l.rotation.z = Math.PI / 2;
      l.position.set(side * (len * 0.5 + 0.25), r, 0);
      this.group.add(l);
    }
    for (let i = 0; i < 3; i++) {
      const band = new THREE.Mesh(
        new THREE.CylinderGeometry(r * 1.05, r * 1.05, 0.12, 12),
        new THREE.MeshBasicMaterial({ color: i === 0 ? PALETTE.orange : PALETTE.magenta }),
      );
      band.rotation.z = Math.PI / 2;
      band.position.set(-len * 0.3 + i * len * 0.3, r, 0);
      this.group.add(band);
    }
  }

  private buildDiode() {
    // "Post-sized" diode: 0.25m radius, 1.2m tall
    const r = 0.25;
    const h = 1.2;
    this.halfX = r; this.halfZ = r; this.height = h;
    this.label = 'D' + (Math.floor(Math.random() * 90) + 10);
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(r, r, h, 12),
      new THREE.MeshBasicMaterial({ color: 0x0a0a18 }),
    );
    body.position.y = h * 0.5;
    this.group.add(body);
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(r * 1.1, r * 1.1, h * 0.3, 12),
      new THREE.MeshBasicMaterial({ color: PALETTE.cyan }),
    );
    band.position.y = h * 0.3;
    this.group.add(band);
    for (const side of [-1, 1]) {
      const l = new THREE.Mesh(
        new THREE.CylinderGeometry(0.07, 0.07, 0.5, 6),
        new THREE.MeshBasicMaterial({ color: PALETTE.cyan }),
      );
      l.position.set(0, -0.2 - side * 0.15, 0);
      this.group.add(l);
    }
  }

  private buildMega() {
    // "Building-sized" IC: 10–14m wide, 5–7m deep, 2.5m tall
    const w = 10 + Math.random() * 4;
    const d = 5 + Math.random() * 2;
    const h = 2.5;
    this.halfX = w * 0.5; this.halfZ = d * 0.5; this.height = h;
    this.label = 'IC-' + (Math.floor(Math.random() * 900) + 100);
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshBasicMaterial({ color: 0x040810 }),
    );
    body.position.y = h * 0.5;
    this.group.add(body);
    for (let i = 0; i < 5; i++) {
      const u = new THREE.Mesh(
        new THREE.BoxGeometry(0.2, 0.02, d * 0.7),
        new THREE.MeshBasicMaterial({ color: PALETTE.cyan, transparent: true, opacity: 0.6 }),
      );
      u.position.set(-w * 0.3 + i * w * 0.15, h + 0.005, 0);
      this.group.add(u);
    }
    const padMat = new THREE.MeshBasicMaterial({ color: PALETTE.cyan, transparent: true, opacity: 0.85 });
    for (let i = 0; i < 8; i++) {
      for (const side of [-1, 1]) {
        const p = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.12, 0.4), padMat);
        p.position.set(-w * 0.45 + i * (w * 0.9 / 7), 0.06, side * (d * 0.5 + 0.2));
        this.group.add(p);
      }
    }
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(body.geometry),
      new THREE.LineBasicMaterial({ color: PALETTE.cyan }),
    );
    edges.position.y = h * 0.5;
    this.group.add(edges);
  }

  private buildTower() {
    // "Tower-sized" electrolytic: 1.5–2.2m radius, 9–14m tall
    const r = 1.5 + Math.random() * 0.7;
    const h = 9 + Math.random() * 5;
    this.halfX = r; this.halfZ = r; this.height = h;
    this.label = 'C' + (Math.floor(Math.random() * 900) + 100);
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(r, r, h, 24),
      new THREE.MeshBasicMaterial({ color: 0x0a1020 }),
    );
    body.position.y = h * 0.5;
    this.group.add(body);
    const top = new THREE.Mesh(
      new THREE.SphereGeometry(r * 0.95, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x0a1020 }),
    );
    top.position.y = h;
    this.group.add(top);
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(r * 1.02, r * 1.02, 0.6, 24),
      new THREE.MeshBasicMaterial({ color: PALETTE.magenta, transparent: true, opacity: 0.9 }),
    );
    band.position.y = h * 0.4;
    this.group.add(band);
    const ser = new THREE.Mesh(
      new THREE.CylinderGeometry(r * 1.01, r * 1.01, h * 0.6, 24, 1, true),
      new THREE.MeshBasicMaterial({ color: PALETTE.cyan, transparent: true, opacity: 0.3, side: THREE.DoubleSide, wireframe: true }),
    );
    ser.position.y = h * 0.5;
    this.group.add(ser);
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(body.geometry),
      new THREE.LineBasicMaterial({ color: PALETTE.cyan, transparent: true, opacity: 0.7 }),
    );
    edges.position.y = h * 0.5;
    this.group.add(edges);
  }

  contains(x: number, z: number): boolean {
    const dx = Math.abs(x - this.group.position.x);
    const dz = Math.abs(z - this.group.position.z);
    return dx < this.halfX && dz < this.halfZ;
  }
}

export function generateComponents(): Component[] {
  const out: Component[] = [];
  const types: Array<[ComponentKind, number]> = [
    ['chip', 35],
    ['cap', 22],
    ['resistor', 18],
    ['diode', 14],
    ['mega', 8],
    ['tower', 5],
  ];
  const placed: THREE.Vector2[] = [];
  const minDist = (kind: ComponentKind) => {
    if (kind === 'mega' || kind === 'tower') return 9;
    if (kind === 'chip') return 4.5;
    if (kind === 'cap') return 3.5;
    if (kind === 'resistor') return 3.5;
    return 2.5;
  };
  const tooClose = (x: number, z: number, kind: ComponentKind): boolean => {
    const md = minDist(kind);
    for (const p of placed) {
      if (Math.hypot(p.x - x, p.y - z) < md) return true;
    }
    return false;
  };
  const onTrace = (x: number, z: number): boolean => {
    const w = 3.0;
    return (
      distToSegment2D(x, z, 0, 0, 30, 0) < w ||
      distToSegment2D(x, z, 0, 0, -30, 0) < w ||
      distToSegment2D(x, z, 0, 0, 0, -90) < w
    );
  };
  for (const [kind, count] of types) {
    let attempts = 0;
    let placed_count = 0;
    while (placed_count < count && attempts < count * 16) {
      attempts++;
      const x = (Math.random() - 0.5) * 160;
      const z = (Math.random() - 0.5) * 160;
      if (onTrace(x, z)) continue;
      if (tooClose(x, z, kind)) continue;
      placed.push(new THREE.Vector2(x, z));
      out.push(new Component(kind, x, z));
      placed_count++;
    }
  }
  return out;
}

function distToSegment2D(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const abx = bx - ax, abz = bz - az;
  const apx = px - ax, apz = pz - az;
  const denom = abx * abx + abz * abz;
  if (denom === 0) return Math.hypot(apx, apz);
  const t = Math.max(0, Math.min(1, (apx * abx + apz * abz) / denom));
  const cx = ax + abx * t, cz = az + abz * t;
  return Math.hypot(px - cx, pz - cz);
}
