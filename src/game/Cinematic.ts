/**
 * Cinematic.ts — short scripted camera moves.
 * During a cinematic, the player's WASD input is ignored and the
 * camera follows a path. After the path ends, control is restored.
 */
import * as THREE from 'three';
import { CameraController } from './CameraController';

export type CinematicKeyframe = {
  // position the camera should orbit around (world space)
  focus: THREE.Vector3;
  // target orbit angles + distance
  yaw: number;
  pitch: number;
  distance: number;
  // time from start to reach this keyframe (seconds)
  t: number;
};

export class Cinematic {
  running = false;
  private keys: CinematicKeyframe[] = [];
  private startT = 0;
  private currentT = 0;
  private cam: CameraController;
  // when done, restore these:
  private savedYaw = 0;
  private savedPitch = 0;
  private savedDist = 0;
  // what to call when done
  private onDone: (() => void) | null = null;
  // total duration
  private duration = 0;

  constructor(cam: CameraController) { this.cam = cam; }

  play(keys: CinematicKeyframe[], onDone?: () => void) {
    this.keys = keys.slice().sort((a, b) => a.t - b.t);
    this.duration = this.keys[this.keys.length - 1].t;
    this.savedYaw = this.cam.yaw;
    this.savedPitch = this.cam.pitch;
    this.savedDist = this.cam.distance;
    this.startT = performance.now() / 1000;
    this.currentT = 0;
    this.running = true;
    this.onDone = onDone || null;
  }

  /** Returns true if the cinematic just ended this frame. */
  update(dt: number, now: number): boolean {
    if (!this.running) return false;
    this.currentT += dt;
    if (this.currentT >= this.duration) {
      this.running = false;
      // restore user cam state (so they don't get snapped back)
      this.cam.yaw = this.savedYaw;
      this.cam.pitch = this.savedPitch;
      this.cam.distance = this.savedDist;
      const cb = this.onDone; this.onDone = null;
      if (cb) cb();
      return true;
    }
    // interpolate between keyframes
    const k0 = this.keys[0];
    const k1 = this.keys[this.keys.length - 1];
    for (let i = 0; i < this.keys.length - 1; i++) {
      if (this.currentT >= this.keys[i].t && this.currentT <= this.keys[i + 1].t) {
        // smoothstep ease
        const a = this.keys[i], b = this.keys[i + 1];
        const k = (this.currentT - a.t) / (b.t - a.t);
        const e = k * k * (3 - 2 * k);
        this.cam.yaw = a.yaw + (b.yaw - a.yaw) * e;
        this.cam.pitch = a.pitch + (b.pitch - a.pitch) * e;
        this.cam.distance = a.distance + (b.distance - a.distance) * e;
        this.cam.target.lerpVectors(a.focus, b.focus, e);
        break;
      }
    }
    return false;
  }
}
