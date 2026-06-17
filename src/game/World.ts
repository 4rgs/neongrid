/**
 * World.ts — PCB-inspired procedural terrain.
 *   - Heightmap-driven grid: lines follow the topology, not a flat plane
 *   - Circuit traces: glowing paths connecting fragments, gates and the boss
 *   - Stars: same as before, in the background
 *   - Skybox: gradient + horizon glow
 */
import * as THREE from 'three';
import { PALETTE } from './palette';
import { SECTORS, Gate } from './Sectors';

const TERRAIN_SIZE = 200;          // world units
const TERRAIN_SEGMENTS = 220;      // mesh resolution

// ---------------------------------------------------------------- shaders

const GRID_VERT = /* glsl */`
  varying vec3 vWorldPos;
  varying vec3 vNormalW;
  varying float vHeight;
  attribute float aTrace;          // 0 or 1: marks circuit-trace cells
  varying float vTrace;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vHeight = position.y;
    vTrace = aTrace;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const GRID_FRAG = /* glsl */`
  precision highp float;
  uniform float uTime;
  uniform float uPulse;
  uniform vec3  uBase;
  uniform vec3  uHot;
  uniform vec3  uTraceHot;
  uniform vec3  uHorizon;
  uniform float uCell;
  uniform float uExtent;
  uniform vec3  uCamPos;
  varying vec3 vWorldPos;
  varying vec3 vNormalW;
  varying float vHeight;
  varying float vTrace;

  // anti-aliased grid line
  float gridLine(vec2 p, float cell) {
    vec2 g = abs(fract(p / cell - 0.5) - 0.5) / fwidth(p / cell);
    float l = min(g.x, g.y);
    return 1.0 - min(l, 1.0);
  }

  void main() {
    // Use world XZ for grid (so the grid stays axis-aligned regardless of terrain)
    vec2 p = vWorldPos.xz;
    float major = gridLine(p, uCell);
    float minor = gridLine(p, uCell * 0.2) * 0.30;
    float lines = max(major, minor);

    // Distance falloff (fade far)
    float d = length(p);
    float falloff = 1.0 - smoothstep(uExtent * 0.4, uExtent, d);

    // Slope-based brightness: faces that look up are bright, side-facing dim
    float slope = clamp(vNormalW.y, 0.0, 1.0);

    // Base color (dim cyan) → hot (bright cyan) modulated by pulse + slope
    vec3 col = mix(uBase, uHot, uPulse * (0.5 + 0.5 * slope));

    // Horizon blend
    col = mix(uHorizon, col, falloff);

    // Moving radial band
    float band = sin(d * 0.18 - uTime * 1.6) * 0.5 + 0.5;
    band = pow(band, 6.0);
    col += uHot * band * 0.4 * falloff * slope;

    // Trace highlight: bright orange/cyan along the PCB traces
    float traceGlow = vTrace * (0.7 + 0.3 * sin(uTime * 4.0 + p.x * 0.3 + p.y * 0.3));
    col = mix(col, uTraceHot, traceGlow * 0.85);

    // Height-based ambient: deeper = darker, higher = brighter
    col *= (0.5 + 0.7 * smoothstep(-2.0, 3.0, vHeight));

    float a = lines * (0.4 + 0.6 * uPulse) * falloff * (0.4 + 0.6 * slope);
    a = max(a, traceGlow * 0.9 * falloff);

    gl_FragColor = vec4(col, a);
  }
`;

// ---------------------------------------------------------------- heightmap

/** Simplex-like value noise for terrain heights. Not true simplex, but
 *  good enough for stylized low-poly PCB relief. */
function hash2(x: number, y: number): number {
  const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return h - Math.floor(h);
}
function smoothNoise(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  return a * (1 - ux) * (1 - uy) + b * ux * (1 - uy) + c * (1 - ux) * uy + d * ux * uy;
}
function fbm(x: number, y: number, oct = 4): number {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += amp * smoothNoise(x * freq, y * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

/** Computes the world height at (x, z). This is the single source of truth
 *  for terrain — used by the mesh, by the hero physics, and by enemies. */
export function terrainHeight(x: number, z: number): number {
  // Base large-scale rolling hills
  const h1 = fbm(x * 0.025, z * 0.025, 4) * 5.0 - 1.0;
  // Medium-scale dunes
  const h2 = fbm(x * 0.08, z * 0.08, 3) * 1.6;
  // A few sharper "PCB ridges" — long ridges aligned with axes
  const ridge1 = Math.exp(-Math.pow((x % 30) - 0, 2) / 50) * 0.5;
  const ridge2 = Math.exp(-Math.pow((z % 30) - 0, 2) / 50) * 0.5;
  // Sink around origin (hub) for arena feel
  const dx = x, dz = z;
  const hub = -Math.exp(-(dx * dx + dz * dz) / 800) * 1.2;
  return h1 + h2 + ridge1 + ridge2 + hub;
}

// ---------------------------------------------------------------- world

export class World {
  group = new THREE.Group();
  private floor!: THREE.Mesh;
  private floorMat!: THREE.ShaderMaterial;
  private floorGeo!: THREE.PlaneGeometry;
  private mountains!: THREE.LineSegments;
  private mountainMat!: THREE.LineBasicMaterial;
  private pulse = 0;
  // star field
  private stars!: THREE.Points;
  private starMat!: THREE.PointsMaterial;
  // circuit trace lines (one per "lane")
  private traceLines: THREE.LineSegments[] = [];

  constructor() {
    this.buildFloor();
    this.buildSkybox();
    this.buildMountains();
    this.buildStars();
    this.buildCircuitTraces();
  }

  private buildFloor() {
    const geo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, TERRAIN_SEGMENTS, TERRAIN_SEGMENTS);
    geo.rotateX(-Math.PI / 2);
    // Bake heightmap into the geometry Y
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const traceAttr = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const y = terrainHeight(x, z);
      pos.setY(i, y);
      // mark trace cells: every cell that lies near a gate-to-hub line gets 1
      traceAttr[i] = this.isOnCircuitTrace(x, z) ? 1.0 : 0.0;
    }
    geo.computeVertexNormals();
    geo.setAttribute('aTrace', new THREE.BufferAttribute(traceAttr, 1));

    this.floorMat = new THREE.ShaderMaterial({
      vertexShader: GRID_VERT,
      fragmentShader: GRID_FRAG,
      transparent: true,
      depthWrite: true,   // write depth so terrain sits behind components correctly
      uniforms: {
        uTime: { value: 0 },
        uPulse: { value: 0.5 },
        uBase: { value: new THREE.Color(PALETTE.cyan).multiplyScalar(0.18) },
        uHot: { value: new THREE.Color(PALETTE.cyan) },
        uTraceHot: { value: new THREE.Color(PALETTE.orange) },
        uHorizon: { value: new THREE.Color(0x002a3a) },
        uCell: { value: 3 },
        uExtent: { value: TERRAIN_SIZE * 0.5 },
        uCamPos: { value: new THREE.Vector3() },
      },
    });

    this.floor = new THREE.Mesh(geo, this.floorMat);
    this.floor.position.y = 0;
    this.floorGeo = geo;
    this.group.add(this.floor);
  }

  /** Returns true if (x, z) is near any of the circuit "trace" corridors. */
  private isOnCircuitTrace(x: number, z: number): boolean {
    // Traces run along cardinal axes from the hub to each gate, then to the boss.
    // We make them a few units wide.
    const hub = new THREE.Vector2(0, 0);
    const purged = new THREE.Vector2(30, 0);
    const ghost = new THREE.Vector2(-30, 0);
    const boss = new THREE.Vector2(0, -90);
    const w = 1.2;
    return (
      distToSegment(new THREE.Vector2(x, z), hub, purged) < w ||
      distToSegment(new THREE.Vector2(x, z), hub, ghost) < w ||
      distToSegment(new THREE.Vector2(x, z), hub, boss) < w
    );
  }

  private buildSkybox() {
    const skyGeo = new THREE.SphereGeometry(800, 32, 24);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uTop: { value: new THREE.Color(0x000814) },
        uMid: { value: new THREE.Color(0x001a2e) },
        uBot: { value: new THREE.Color(0x000000) },
        uAccent: { value: new THREE.Color(PALETTE.magenta) },
      },
      vertexShader: /* glsl */`
        varying vec3 vN;
        void main() {
          vN = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */`
        precision highp float;
        uniform vec3 uTop, uMid, uBot, uAccent;
        varying vec3 vN;
        void main() {
          float h = vN.y;
          vec3 col;
          if (h > 0.0) col = mix(uMid, uTop, smoothstep(0.0, 1.0, h));
          else         col = mix(uMid, uBot, smoothstep(0.0, 1.0, -h));
          float glow = pow(1.0 - abs(h), 6.0) * 0.35;
          col += uAccent * glow;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    const sky = new THREE.Mesh(skyGeo, skyMat);
    this.group.add(sky);
  }

  private buildMountains() {
    const peaks: number[] = [];
    const N = 28;
    const R = 240;
    for (let i = 0; i < N; i++) {
      const a0 = (i / N) * Math.PI * 2;
      const a1 = ((i + 1) / N) * Math.PI * 2;
      const h0 = 35 + Math.random() * 95;
      const h1 = 35 + Math.random() * 95;
      const x0 = Math.cos(a0) * R, z0 = Math.sin(a0) * R;
      const x1 = Math.cos(a1) * R, z1 = Math.sin(a1) * R;
      peaks.push(x0, 0, z0, x0, h0, z0);
      peaks.push(x0, h0, z0, x1, h1, z1);
      peaks.push(x1, h1, z1, x1, 0, z1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(peaks, 3));
    this.mountainMat = new THREE.LineBasicMaterial({
      color: PALETTE.cyan,
      transparent: true,
      opacity: 0.6,
    });
    this.mountains = new THREE.LineSegments(geo, this.mountainMat);
    this.group.add(this.mountains);
  }

  private buildStars() {
    const N = 1500;
    const positions = new Float32Array(N * 3);
    const colors = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = 200 + Math.random() * 60;
      positions[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.cos(phi) * 0.6 + 100;
      positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
      const c = 0.8 + Math.random() * 0.2;
      colors[i * 3]     = c * 0.6;
      colors[i * 3 + 1] = c;
      colors[i * 3 + 2] = c;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.starMat = new THREE.PointsMaterial({
      size: 0.8, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false,
    });
    this.stars = new THREE.Points(geo, this.starMat);
    this.group.add(this.stars);
  }

  /** Glowing lines along the PCB traces (above the grid, for emphasis). */
  private buildCircuitTraces() {
    const paths: Array<[THREE.Vector2, THREE.Vector2]> = [
      [new THREE.Vector2(0, 0), new THREE.Vector2(30, 0)],
      [new THREE.Vector2(0, 0), new THREE.Vector2(-30, 0)],
      [new THREE.Vector2(0, 0), new THREE.Vector2(0, -90)],
    ];
    for (const [a, b] of paths) {
      const pts: number[] = [];
      const STEPS = 30;
      for (let i = 0; i <= STEPS; i++) {
        const t = i / STEPS;
        const x = a.x + (b.x - a.x) * t;
        const z = a.y + (b.y - a.y) * t;
        const y = terrainHeight(x, z) + 0.05;
        pts.push(x, y, z);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      const mat = new THREE.LineBasicMaterial({
        color: PALETTE.orange,
        transparent: true,
        opacity: 0.6,
      });
      const line = new THREE.Line(geo, mat);
      this.group.add(line);
      this.traceLines.push(line as unknown as THREE.LineSegments);
    }
  }

  /** Pulse value 0..1 driven by the breathing rhythm. */
  update(dt: number, t: number) {
    this.pulse = 0.5 + 0.5 * Math.sin(t * Math.PI);
    this.floorMat.uniforms.uTime.value = t;
    this.floorMat.uniforms.uPulse.value = this.pulse;
    this.mountains.rotation.y = t * 0.02;

    if (this.stars) {
      const pos = (this.stars.geometry.getAttribute('position') as THREE.BufferAttribute);
      const arr = pos.array as Float32Array;
      const speed = 8;
      for (let i = 0; i < arr.length; i += 3) {
        arr[i + 1] -= speed * dt;
        if (arr[i + 1] < -50) arr[i + 1] = 250 + Math.random() * 50;
      }
      pos.needsUpdate = true;
      this.starMat.opacity = 0.7 + 0.3 * Math.sin(t * 0.8);
    }

    // Pulse the trace lines too
    for (const line of this.traceLines) {
      const m = line.material as THREE.LineBasicMaterial;
      m.opacity = 0.5 + 0.4 * Math.sin(t * 2 + line.id);
    }
  }

  getPulse(): number { return this.pulse; }
}

// ---------------------------------------------------------------- helpers

function distToSegment(p: THREE.Vector2, a: THREE.Vector2, b: THREE.Vector2): number {
  const ab = new THREE.Vector2().subVectors(b, a);
  const ap = new THREE.Vector2().subVectors(p, a);
  const t = Math.max(0, Math.min(1, ap.dot(ab) / ab.dot(ab)));
  const closest = a.clone().add(ab.multiplyScalar(t));
  return p.distanceTo(closest);
}
