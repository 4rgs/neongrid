# NEONGRID

> A 3D Tron-inspired low-poly web game built on a simulated PCB. You are a
> single program inside the Grid: collect code fragments, fight viruses,
> survive the procedural terrain, and bring down the Master Process.

![NeonGrid](https://img.shields.io/badge/Three.js-r180-000?logo=three.js)
![NeonGrid](https://img.shields.io/badge/Svelte-5-FF3E00?logo=svelte)
![NeonGrid](https://img.shields.io/badge/Cloudflare-Pages-F38020?logo=cloudflare)
![NeonGrid](https://img.shields.io/badge/license-MIT-green)
![NeonGrid](https://img.shields.io/badge/bundle-172KB-blue)

> Built by replicating the procedural Three.js + postprocessing stack
> used by [messenger.abeto.co](https://messenger.abeto.co/) (abeto studio).

---

## Quick start

```bash
npm install
npm run dev       # http://127.0.0.1:5173
```

```bash
npm run build     # production bundle in dist/
npm run preview   # serve the prod build at http://127.0.0.1:4173
```

```bash
npm run deploy    # Cloudflare Pages (see "Deployment" below)
```

## Controls

| Action | Input |
| --- | --- |
| Move | `WASD` (camera-relative, World-of-Warcraft style) |
| Dash (i-frames) | `Shift` |
| Jump | `Space` |
| Disc-whip attack | `J` or `LMB` |
| Orbit camera | drag with `RMB` |
| Zoom | mouse wheel |
| Pause | `Esc` or `P` |
| Settings | `M` |
| Close overlays | click anywhere |

## What is in here

- **3D Tron-style world** built on a procedural PCB-inspired terrain
  (heightmap noise, circuit traces, scattered components: chips, caps,
  resistors, diodes, big ICs, tall capacitor towers).
- **Hero combat**: cel-shaded low-poly character with disc-whip boomerang
  projectile in world space.
- **5 enemy types**: patrol, turret, hunter, charger, and the boss
  Master Process. Difficulty scales with fragment progress (two extra
  waves at 30% and 60%).
- **Cinematic camera** when the boss spawns, plus a victory screen with
  score, fragments, and time.
- **Audio**: synthesised drone + 4-chord pad music that intensifies during
  boss fights, with pickup / slash / hit / hurt / victory SFX.
- **Persistence**: fragments and best score survive a page reload.
- **HUD**: minimap, health bar, boss HP, lore popups, tutorial, settings.
- **Stack**: Vite + Svelte 5 + Three.js r180 + postprocessing (pmndrs).
  Zero runtime assets — everything is procedural.

## File layout

```
neongrid/
├── index.html              # Vite entry
├── package.json
├── vite.config.ts
├── wrangler.toml           # Cloudflare Pages config
├── deploy.sh               # build + wrangler pages deploy
├── public/
│   ├── _headers            # Cloudflare Pages caching + security
│   └── _redirects          # SPA fallback
└── src/
    ├── main.ts             # boot
    ├── game/
    │   ├── World.ts         # heightmap + grid shader + skybox + stars + traces
    │   ├── Hero.ts          # player + cel-shading + terrain physics
    │   ├── Disc.ts          # boomerang weapon (world-space)
    │   ├── Enemies.ts       # patrol/turret/hunter/charger
    │   ├── Boss.ts          # Master Process
    │   ├── Fragments.ts     # collectibles
    │   ├── Components.ts    # PCB obstacles (chips/caps/etc.)
    │   ├── Sectors.ts       # sector defs + gates
    │   ├── Particles.ts     # particle pool
    │   ├── TrailRenderer.ts
    │   ├── PostFX.ts        # bloom + chromatic + scanlines + ACES
    │   ├── Cinematic.ts     # scripted camera moves
    │   ├── CameraController.ts  # WoW-style orbit camera
    │   ├── Audio.ts         # Web Audio synth (music + SFX)
    │   ├── Input.ts         # keyboard + mouse
    │   ├── Game.ts          # orchestrator
    │   └── palette.ts
    └── ui/
        └── App.svelte       # HUD overlay (Svelte 5)
```

## How it works

`main.ts` mounts the Svelte 5 HUD into `#app` and waits for the component
to expose its API on `window.__hud` (see `waitForHud`). Once the API is
ready, a `Game` instance owns the WebGL canvas and the main loop.

The game loop:
1. Read input (camera-relative WASD + dash + jump + disc).
2. Update hero (gravity → terrain height, slope-aligned pitch/roll,
   AABB collision against PCB components).
3. Update disc (world-space projectile, returns to current hero position).
4. Update enemies (per-kind AI) and boss.
5. Particles, trail, post-FX.
6. Render via `EffectComposer` (pmndrs): bloom + chromatic aberration +
   scanlines + ACES tonemapping + vignette.

The terrain is a single `PlaneGeometry` (200×200, 220×220 segments) whose
vertices are baked with `terrainHeight(x, z)` (fBm noise + ridges +
hub sink). A custom shader draws the grid, with a per-vertex `aTrace`
attribute highlighting the orange circuit corridors.

## Tech notes

- **No game-engine framework**. Pure Three.js + a custom orchestrator.
- **No external assets**. Models, textures, sounds and music are all
  generated procedurally with `BufferGeometry`, `ShaderMaterial`, and
  the Web Audio API.
- **Code-split**. Vite splits `three` and `postprocessing` into their
  own chunks, so the game code ships as a small `index-*.js`.
- **Mobile-friendly**. Works on touch devices with virtual buttons (not
  shipped in this version but the input layer can be extended).

## Deployment

The repo is configured for Cloudflare Pages.

```bash
# one-off
npm i -g wrangler
npx wrangler login
npx wrangler pages project create neongrid

# every deploy
npm run deploy
```

The script:
1. `npm ci`
2. `npm run build` (produces `dist/`)
3. `wrangler pages deploy dist --project-name neongrid`

`public/_headers` sets 1-year cache on hashed assets and security
headers (X-Content-Type-Options, X-Frame-Options, Referrer-Policy,
Permissions-Policy).

## Bundle budget

| File | gzip |
| --- | --- |
| `index.html` | 0.69 KB |
| `index-*.css` | 1.68 KB |
| `app` (game + HUD) | 30.86 KB |
| `postprocessing` | 16.92 KB |
| `three` (lazy) | 122.21 KB |
| **First paint total** | **~50 KB** |
| **Cold load total** | **~172 KB** |

## License

MIT. See [LICENSE](./LICENSE).
