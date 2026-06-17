/**
 * Fragments.ts — collectible code fragments scattered around each sector.
 * Floating, rotating, with bob.
 */
import * as THREE from 'three';
import { PALETTE } from './palette';
import { terrainHeight } from './World';

export class Fragment {
  group = new THREE.Group();
  collected = false;
  baseY = 0;
  tOffset = 0;
  mesh!: THREE.Mesh;

  constructor(x: number, z: number, color: number, loreText: string) {
    this.group.position.set(x, terrainHeight(x, z), z);
    this.lore = loreText;
    this.color = color;
    this.tOffset = Math.random() * Math.PI * 2;
    // Octahedron
    const geo = new THREE.OctahedronGeometry(0.35, 0);
    const mat = new THREE.MeshBasicMaterial({ color });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.y = 1.2;
    this.group.add(this.mesh);
    // Halo
    const halo = new THREE.Mesh(
      new THREE.RingGeometry(0.5, 0.7, 24),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.4, side: THREE.DoubleSide }),
    );
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = 0.05;
    this.group.add(halo);
    // edge wireframe
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 }),
    );
    this.mesh.add(edges);
  }

  color: number;
  lore: string;
  collectedFlag = false;

  update(t: number) {
    this.mesh.rotation.x = t * 1.2 + this.tOffset;
    this.mesh.rotation.y = t * 1.6;
    this.mesh.position.y = 1.2 + Math.sin(t * 2.5 + this.tOffset) * 0.18;
  }

  collect() { this.collected = true; this.group.visible = false; }
}
