/**
 * Sectors.ts — 3 named sectors connected by light-gates.
 * Each sector has a base color, a list of fragments, and enemies.
 */
import * as THREE from 'three';
import { PALETTE } from './palette';
import { Fragment } from './Fragments';
import { terrainHeight } from './World';

export type SectorDef = {
  id: string;
  name: string;
  center: THREE.Vector3;
  gateColor: number;
  fragmentCount: number;
};

export const SECTORS: SectorDef[] = [
  { id: 'hub', name: 'GRID HUB', center: new THREE.Vector3(0, 0, 0), gateColor: PALETTE.cyan, fragmentCount: 2 },
  { id: 'purged', name: 'PURGED SECTOR', center: new THREE.Vector3(60, 0, 0), gateColor: PALETTE.red, fragmentCount: 4 },
  { id: 'ghost', name: 'GHOST CACHE', center: new THREE.Vector3(-60, 0, 0), gateColor: PALETTE.green, fragmentCount: 3 },
];

export function makeFragmentsForSector(s: SectorDef): Fragment[] {
  const out: Fragment[] = [];
  const loreBySector: Record<string, string[]> = {
    hub: [
      '// the grid remembers every program that ever ran',
      '// signal lost. cross the gate to find traces of them',
    ],
    purged: [
      '// the purged sector deletes what it cannot control',
      '// three cycles ago, the firewall fell. survivors scattered',
      '// red light is faster than thought',
      '// a daemon still patrols the mainline',
    ],
    ghost: [
      '// ghost cache: the part of the grid that dreams',
      '// green sectors run on a clock two ticks slow',
      '// some fragments chose to be forgotten',
    ],
  };
  const list = loreBySector[s.id] ?? ['// unknown sector'];
  for (let i = 0; i < s.fragmentCount; i++) {
    const angle = (i / s.fragmentCount) * Math.PI * 2 + Math.random() * 0.5;
    const r = 8 + Math.random() * 10;
    const x = s.center.x + Math.cos(angle) * r;
    const z = s.center.z + Math.sin(angle) * r;
    const c = i % 2 === 0 ? s.gateColor : (s.id === 'ghost' ? PALETTE.magenta : PALETTE.cyan);
    out.push(new Fragment(x, z, c, list[i % list.length]));
  }
  return out;
}

/** A gate is a glowing torus between two sectors. */
export class Gate {
  group = new THREE.Group();
  color: number;
  unlocked = false;
  requiredFragments: number;
  mesh!: THREE.Mesh;
  label: string;

  constructor(pos: THREE.Vector3, color: number, label: string, required: number) {
    this.color = color;
    this.label = label;
    this.requiredFragments = required;
    this.group.position.set(pos.x, terrainHeight(pos.x, pos.z), pos.z);
    const torus = new THREE.Mesh(
      new THREE.TorusGeometry(2.2, 0.12, 8, 32),
      new THREE.MeshBasicMaterial({ color }),
    );
    torus.rotation.x = Math.PI / 2;
    this.mesh = torus;
    this.group.add(torus);
    // pillar posts
    const postGeo = new THREE.CylinderGeometry(0.2, 0.2, 5, 6);
    const postMat = new THREE.MeshBasicMaterial({ color: PALETTE.cyan, transparent: true, opacity: 0.6 });
    for (const x of [-2.0, 2.0]) {
      const p = new THREE.Mesh(postGeo, postMat);
      p.position.set(x, 2.5, 0);
      this.group.add(p);
    }
  }

  setUnlocked(u: boolean) {
    this.unlocked = u;
    this.mesh.material = new THREE.MeshBasicMaterial({
      color: u ? this.color : 0x222222,
    });
  }
}
