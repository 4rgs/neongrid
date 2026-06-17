/**
 * CameraController.ts — World of Warcraft-style third-person camera.
 *
 * Design rules (WoW-like):
 *  - Camera orbits the hero. The hero is always visible from behind.
 *  - The hero's facing direction (yaw) is driven by the camera yaw
 *    when the player moves; when idle, the hero keeps the last facing.
 *  - LMB-drag (or RMB-drag) rotates the orbit.
 *  - Mouse wheel zooms in/out (distance).
 *  - Smooth damping; no hard snaps.
 */
import * as THREE from 'three';

export class CameraController {
  // orbit
  yaw = 0;            // around Y, radians
  pitch = 0.55;       // 0 = top-down, ~PI/2 = horizon
  distance = 14;
  // damping
  private dYaw = 0;
  private dPitch = 0;
  private dDist = 0;
  // last applied
  private camYaw = 0;
  private camPitch = 0.55;
  private camDist = 14;

  target = new THREE.Vector3(0, 1.5, 0);

  private camera: THREE.PerspectiveCamera;
  // smooth target offset (lag behind hero)
  private smoothTarget = new THREE.Vector3();

  // sensitivity
  private readonly YAW_SPEED = 0.0055;
  private readonly PITCH_SPEED = 0.0040;
  private readonly MIN_PITCH = 0.10;
  private readonly MAX_PITCH = 1.30;
  private readonly MIN_DIST = 6;
  private readonly MAX_DIST = 30;

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
    this.smoothTarget.copy(this.target);
    this.dYaw = this.yaw;
    this.dPitch = this.pitch;
    this.dDist = this.distance;
  }

  /** Apply user mouse drag deltas (pixels). Yaw is inverted so dragging
   *  right rotates the world right (natural feel, like WoW). */
  applyOrbit(dx: number, dy: number) {
    this.yaw -= dx * this.YAW_SPEED;
    this.pitch = Math.max(this.MIN_PITCH, Math.min(this.MAX_PITCH, this.pitch + dy * this.PITCH_SPEED));
  }

  /** Mouse wheel: positive deltaY → zoom out (further). */
  applyZoom(deltaY: number) {
    // delta scaled; clamp
    const next = this.distance * (1 + deltaY * 0.0012);
    this.distance = Math.max(this.MIN_DIST, Math.min(this.MAX_DIST, next));
  }

  /** Hero driving camera target (position only). */
  setHeroPosition(pos: THREE.Vector3) {
    this.target.set(pos.x, pos.y + 1.2, pos.z);
  }

  /**
   * Set the hero's yaw to match the camera's yaw (so the hero's back
   * is to the camera) — call this on init and when the player starts moving
   * after an idle period. Returns the new yaw.
   */
  heroYawFromCamera(): number {
    // In our world, yaw=0 → fwd=(0,0,1)=north. We want the hero to face
    // away from the camera, so its forward = -cameraPosDirection
    // Camera is at: target + (sin yaw, 0, cos yaw) * dist * cos(pitch) + (0, sin pitch, 0) * dist
    // Hero should look opposite: forward = -(sin yaw, 0, cos yaw)
    // heroYaw (in our convention) is set such that fwd = (sin heroYaw, 0, cos heroYaw)
    // We want sin heroYaw = -sin yaw, cos heroYaw = -cos yaw → heroYaw = yaw + PI
    return this.yaw + Math.PI;
  }

  update(dt: number) {
    // Damp toward target angles
    const k = 1 - Math.pow(0.0001, dt);
    this.camYaw += (this.yaw - this.camYaw) * k * 0.7;
    this.camPitch += (this.pitch - this.camPitch) * k * 0.7;
    this.camDist += (this.distance - this.camDist) * k * 0.7;

    // Smooth the follow target so big teleports don't whip the camera
    this.smoothTarget.lerp(this.target, 1 - Math.pow(0.0005, dt));

    // Position
    const cosP = Math.cos(this.camPitch);
    const sinP = Math.sin(this.camPitch);
    const ox = Math.sin(this.camYaw) * cosP * this.camDist;
    const oz = Math.cos(this.camYaw) * cosP * this.camDist;
    const oy = sinP * this.camDist;
    this.camera.position.set(
      this.smoothTarget.x + ox,
      this.smoothTarget.y + oy,
      this.smoothTarget.z + oz,
    );
    this.camera.lookAt(this.smoothTarget);
  }
}
