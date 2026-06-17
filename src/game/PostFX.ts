/**
 * PostFX.ts — fullscreen post-processing chain (pmndrs/postprocessing).
 * Scanlines + chromatic aberration + bloom + ACES tone mapping.
 * Plus a custom pulse uniform driving global emissive intensity.
 */
import * as THREE from 'three';
import {
  EffectComposer, EffectPass, RenderPass,
  BloomEffect, ChromaticAberrationEffect, ScanlineEffect, ToneMappingEffect, ToneMappingMode, VignetteEffect,
} from 'postprocessing';
import { PALETTE } from './palette';

export class PostFX {
  composer!: EffectComposer;
  bloom!: BloomEffect;
  chroma!: ChromaticAberrationEffect;
  scan!: ScanlineEffect;
  tone!: ToneMappingEffect;
  vignette!: VignetteEffect;

  init(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    this.bloom = new BloomEffect({
      intensity: 1.4,
      luminanceThreshold: 0.18,
      luminanceSmoothing: 0.5,
      mipmapBlur: true,
    });
    // ChromaticAberrationEffect v6.36 — radialModulation & modulationOffset are required
    this.chroma = new ChromaticAberrationEffect({
      offset: new THREE.Vector2(0.0014, 0.0014),
      radialModulation: false,
      modulationOffset: 0.0,
    });
    // ScanlineEffect v6.36 — no opacity option; density only
    this.scan = new ScanlineEffect({ density: 1.4 });
    this.tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
    this.vignette = new VignetteEffect({ darkness: 0.55, offset: 0.2 });
    composer.addPass(new EffectPass(camera, this.bloom, this.chroma, this.scan, this.tone, this.vignette));
    this.composer = composer;
  }

  setPulse(p: number) {
    // Pulse drives bloom intensity; chromatic stays low for legibility
    this.chroma.offset.set(0.0004 + p * 0.0004, 0.0004 + p * 0.0004);
    this.bloom.intensity = 1.0 + p * 0.4;
  }
}
