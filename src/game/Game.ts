/**
 * Game.ts — main orchestrator. Owns scene, renderer, camera, postFX,
 * all systems, and the game loop.
 */
import * as THREE from 'three';
import { Input } from './Input';
import { World } from './World';
import { Hero } from './Hero';
import { Disc } from './Disc';
import { Fragment } from './Fragments';
import { Enemy } from './Enemies';
import { Boss } from './Boss';
import { Gate, SECTORS, makeFragmentsForSector } from './Sectors';
import { ParticleSystem } from './Particles';
import { TrailRenderer } from './TrailRenderer';
import { PostFX } from './PostFX';
import { Cinematic } from './Cinematic';
import { CameraController } from './CameraController';
import { AudioBus } from './Audio';
import { Component, generateComponents } from './Components';
import { PALETTE } from './palette';
import { Save, AchievementId, saveHighScores, saveRun, saveBestScore, saveFragments, loadSave, pushHighScore, ACHIEVEMENT_META, DEFAULT_UPGRADES } from './SaveSystem';
import { submitScore, fetchTop, fetchProfile, LeaderboardEntry, ProfileEntry, Period, Avatar, AVATARS } from './Leaderboard';
import { ReplayRecorder, uploadReplay, Replay } from './ReplayRecorder';

// Re-seed Math.random with a tiny mulberry32 PRNG so the procedural world
// generates a DIFFERENT layout per level. Called from startNextLevel().
function seedRandom(seed: number) {
  let s = seed | 0;
  (Math as any).random = function () {
    s = (s + 0x6D2B79F5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type HudHandle = {
  setScore: (n: number) => void;
  setBestScore: (n: number) => void;
  setFragments: (n: number, total: number) => void;
  setHp: (n: number, max: number) => void;
  setSector: (name: string) => void;
  setLore: (text: string | null) => void;
  setGameOver: (v: boolean) => void;
  setPaused: (v: boolean) => void;
  setBossHp: (n: number, max: number) => void;
  setTutorial: (v: boolean) => void;
  setVictory: (v: boolean, data?: { score: number; fragments: number; total: number; time: number; bestScore: number }) => void;
  setSettings: (v: boolean) => void;
  setVolume: (v: number) => void;
  getVolume: () => number;
  setLevel: (n: number) => void;
  setTransition: (v: boolean, label?: string) => void;
  setFlash: (color: 'white' | 'red', duration?: number) => void;
  setShop: (v: boolean) => void;
  setAchievements: (ids: AchievementId[]) => void;
  setGameOverScore: (score: number, level: number, bestScore: number) => void;
  setLeaderboard: (entries: any[], globalRank: number | null) => void;
  setTop3: (entries: any[]) => void;
  setLeaderboardPage: (v: boolean) => void;
  askForName: (defaultName: string) => void;
  submitWithName: (name: string) => void;
  skipName: () => void;
};

export class Game {
  private renderer!: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera!: THREE.PerspectiveCamera;
  private clock = new THREE.Clock();
  private postFX = new PostFX();
  input = new Input();

  // Replay capture (in-memory; uploaded on game-over)
  private replay = new ReplayRecorder();
  private replayStartedAt = 0;

  // Shop open state — when true, the world keeps running but the
  // hero is locked in place and cannot receive damage. Enemies
  // patrol and the player can orbit the camera with RMB/Q/E.
  private shopOpen = false;
  private shopDamagePaused = false;

  world!: World;
  hero!: Hero;
  private fragments: Fragment[] = [];
  private enemies: Enemy[] = [];
  private boss: Boss | null = null;
  private gates: Gate[] = [];
  private particles!: ParticleSystem;
  private trail!: TrailRenderer;
  private audio = new AudioBus();
  private camCtl!: CameraController;
  private cine!: Cinematic;
  private components: Component[] = [];

  private rootEl: HTMLElement;
  private hud: HudHandle;

  // game state
  private score = 0;
  private fragmentsCollected = 0;
  private fragmentsTotal = 0;
  private currentSectorId = 'hub';
  private gameOver = false;
  private victory = false;
  private paused = false;
  private t = 0;
  private startTime = 0;
  // camera shake
  private shakeT = 0;
  private shakeAmp = 0;
  // saved fragments (localStorage)
  private readonly STORAGE_KEY = 'neongrid:fragments';
  private readonly STORAGE_BEST = 'neongrid:best';
  private readonly STORAGE_VOL = 'neongrid:volume';
  private savedFragments: string[] = [];
  private bestScore = 0;
  // Save system
  private save: Save = loadSave();
  // achievements unlocked this run
  private achievements: AchievementId[] = [];
  // boss variant per level
  private bossVariant = 'octa';
  // respawn tracking
  private runStartTime = 0;
  private levelStartTime = 0;
  // damage tracking for flawless
  private damageThisLevel = 0;
  private enemiesKilledThisLevel = 0;
  // shop offers
  private shopOffer: 'hp' | 'dash' | 'attack' | 'speed' | null = null;
  // game-over showing high-score entry
  private gameOverScore = 0;
  // Global leaderboard (top-10, fetched lazily on game-over)
  private leaderboard: LeaderboardEntry[] = [];
  private globalRank: number | null = null;
  // Last fetched top-3 (refreshed every game-over)
  private top3Cache: LeaderboardEntry[] = [];

  // AABB for gate proximity
  private nearLore: string | null = null;
  private lastLoreUpdate = 0;

  // Boss spawn condition
  private bossSpawned = false;
  private bossDefeated = false;
  // Where the hero died — captured by startGameOver so the smash-zoom
  // cinematic can focus the body even if the hero gets reset later.
  private deathPos: THREE.Vector3 = new THREE.Vector3();
  // Body-contact damage from the boss is throttled by this cooldown so
  // touching it deals 1 hp per 0.7s instead of draining the hero every
  // frame (or instakilling, which punished the player too harshly).
  // The boss still pressures the player via projectiles and the enrage
  // phase (< 30% HP) ramping its fire-rate and drift speed.
  private bossContactCd = 0;
  // Difficulty progression
  private difficultyWave1 = 0;
  private difficultyWave2 = 0;
  private lastFragmentsCollected = 0;
  // Level loop
  private level = 1;

  constructor(root: HTMLElement, hud: any) {
    this.rootEl = root;
    this.hud = hud;
  }

  start() {
    this.setupRenderer();
    this.setupCamera();
    this.setupScene();
    this.setupPostFX();
    this.bindResize();
    this.loadSave();
    this.startTime = performance.now();
    this.replayStartedAt = this.startTime;
    this.replay.begin({
      name: this.save.run.heroName,
      level: 1,
      score: 0,
      seed: 9173,
      startedAt: this.startTime,
      endedAt: 0,
    });
    this.loop();
  }

  /** Called by the HUD to update the master volume in real time. */
  setVolume(v: number) {
    this.audio.setVolume(v);
    try { localStorage.setItem(this.STORAGE_VOL, v.toFixed(2)); } catch {}
  }

  /** Public: the AudioBus instance so the HUD can adjust volume. */
  getAudio() { return this.audio; }

  /** Multiplier applied to enemy hp / damage as level rises. */
  get difficultyMul(): number { return 1 + (this.level - 1) * 0.5; }

  /**
   * Wipe every dynamic entity from the world: enemies, the boss
   * (and its projectiles), fragments, gates, the particle pool,
   * and the per-level trackers (difficulty waves, kill/damage
   * counters, fragments collected). Called from every reset path
   * — death, level change, respawn, full restart — so the next
   * level starts with a clean slate instead of inheriting
   * half-dead enemies, lingering boss shots, and stale particles
   * from the previous encounter.
   *
   * NOTE: this does NOT touch components (chips / caps / megas) or
   * the hero. Those have their own reset paths because they need
   * to be regenerated from a new RNG seed rather than just hidden.
   */
  private clearField() {
    // ── Enemies (alive + dead) ──
    for (const e of this.enemies) {
      for (const p of e.projectiles) p.mesh.parent?.remove(p.mesh);
      e.projectiles.length = 0;
      this.scene.remove(e.group);
    }
    this.enemies.length = 0;
    // ── Boss ──
    if (this.boss) {
      for (const p of this.boss.projectiles) p.mesh.parent?.remove(p.mesh);
      this.boss.projectiles.length = 0;
      this.scene.remove(this.boss.group);
    }
    this.boss = null;
    this.bossSpawned = false;
    this.bossDefeated = false;
    // ── Fragments ──
    for (const f of this.fragments) this.scene.remove(f.group);
    this.fragments.length = 0;
    this.fragmentsCollected = 0;
    this.fragmentsTotal = 0;
    // ── Gates (sector markers) — they reset to default state too ──
    for (const g of this.gates) this.scene.remove(g.group);
    this.gates.length = 0;
    // ── Per-level trackers ──
    this.difficultyWave1 = 0;
    this.difficultyWave2 = 0;
    this.damageThisLevel = 0;
    this.enemiesKilledThisLevel = 0;
    // ── Boss contact cd (avoid leftover i-frames) ──
    this.bossContactCd = 0;
    // ── Particle pool ──
    this.particles.clear();
  }

  /**
   * Spawn the base level layout: 8 base enemies (patrol ×2, turret ×2,
   * hunter ×2, charger ×2) + 2 gates + 9 fragments spread across the
   * sectors. Called from the initial mount AND after every
   * clearField() so the new run/level/respawn always has the same
   * opening composition. The actual per-enemy HP is scaled by
   * this.difficultyMul inside makeEnemy, so each new level spawns
   * tougher opponents without changing the layout itself.
   */
  private spawnLevelEntities() {
    for (const s of SECTORS) {
      const frags = makeFragmentsForSector(s);
      for (const f of frags) {
        this.fragments.push(f);
        this.scene.add(f.group);
      }
    }
    this.fragmentsTotal = this.fragments.length;
    this.hud.setFragments(this.fragmentsCollected, this.fragmentsTotal);

    this.gates.push(this.makeGate(new THREE.Vector3(30, 0, 0), PALETTE.red,   'PURGED SECTOR // REQ 1 FRAG'));
    this.gates.push(this.makeGate(new THREE.Vector3(-30, 0, 0), PALETTE.green, 'GHOST CACHE // REQ 1 FRAG'));

    this.enemies.push(this.makeEnemy('patrol',  new THREE.Vector3( 45, 0,   8), new THREE.Vector3( 70, 0,  14)));
    this.enemies.push(this.makeEnemy('patrol',  new THREE.Vector3(-50, 0, -12), new THREE.Vector3(-75, 0,  12)));
    this.enemies.push(this.makeEnemy('turret',  new THREE.Vector3( 80, 0,  -6), new THREE.Vector3( 80, 0,  -6)));
    this.enemies.push(this.makeEnemy('turret',  new THREE.Vector3(-90, 0,   6), new THREE.Vector3(-90, 0,   6)));
    this.enemies.push(this.makeEnemy('hunter',  new THREE.Vector3( 20, 0,  25), new THREE.Vector3( 40, 0,  25)));
    this.enemies.push(this.makeEnemy('hunter',  new THREE.Vector3(-25, 0, -25), new THREE.Vector3(-45, 0, -25)));
    this.enemies.push(this.makeEnemy('charger', new THREE.Vector3( 50, 0, -30), new THREE.Vector3( 60, 0, -20)));
    this.enemies.push(this.makeEnemy('charger', new THREE.Vector3(-30, 0,  30), new THREE.Vector3(-45, 0,  40)));
  }

  /** Start a new level: clear field, bump level, regenerate
   *  components, more enemies, harder boss. After a cinematic reveal,
   *  opens the shop so the player can spend score on upgrades. */
  private startNextLevel() {
    this.level++;
    this.clearField();
    this.hud.setTransition(false);
    this.hud.setLevel(this.level);
    this.hud.setBossHp(0, 0);

    // Heal hero to full
    this.hero.hp = this.hero.maxHp;
    this.hud.setHp(this.hero.hp, this.hero.maxHp);

    // Respawn the level layout: 8 base enemies (scaled by
    // this.difficultyMul so each new level is tougher), 2 gates,
    // 9 fragments. Then spawn level-1 extra enemies (already
    // happens via the per-level progression) on top of that.
    this.spawnLevelEntities();

    // Re-generate components from a fresh per-level RNG seed so
    // the world layout changes between levels. clearField didn't
    // touch components (they were already replaced in the prior
    // level), so we wipe them explicitly here.
    for (const c of this.components) this.scene.remove(c.group);
    seedRandom(this.level * 9173 + 42);
    this.components = generateComponents();
    for (const c of this.components) this.scene.add(c.group);

    // Add MORE enemies per level on top of the base set
    this.spawnExtraEnemies();

    // Reset the hero to the hub
    this.hero.group.position.set(0, 0, 0);
    this.hero.hp = this.hero.maxHp;
    this.hero.hurt(0);

    // Pick a boss variant for this level (3 archetypes)
    const variants = ['octa', 'spinblade', 'voidtank'];
    this.bossVariant = variants[(this.level - 1) % variants.length];

    // Reset per-level trackers
    this.damageThisLevel = 0;
    this.enemiesKilledThisLevel = 0;
    this.levelStartTime = performance.now();

    // Music + UI
    this.hud.setLore(`// LEVEL ${this.level} // the grid has reconfigured. stay sharp.`);
    this.audio.ambientStart();

    // Cinematic reveal
    this.cine.play([
      { focus: new THREE.Vector3(0, 0, -45), yaw: Math.PI, pitch: 0.45, distance: 22, t: 0 },
      { focus: new THREE.Vector3(0, 0, 0), yaw: this.camCtl.yaw, pitch: 0.6, distance: 28, t: 1.4 },
    ]);

    // After the cinematic, open the shop so the player can spend score.
    // But only if the hero is still alive (the cinematic can overlap
    // with a game-over if the boss from the new level insta-killed).
    setTimeout(() => {
      if (!this.gameOver && this.hero.hp > 0) this.openShop();
    }, 1700);

    // Persist the level reached.
    this.save.run.currentLevel = this.level;
    saveRun(this.save.run);
  }

  /** Open the leaderboard page with the requested period, region and name. */
  async openLeaderboardPage(
    period: 'all' | 'daily' | 'weekly' = 'all',
    extra: { region?: string; name?: string } = {},
  ) {
    this.hud.setLeaderboardPage(true);
    const top = await fetchTop(20, period, { region: extra.region });
    if (extra.name) {
      // filter client-side by name when server didn't
      // (the server handles it via ?name= too, but we ensure UX consistency)
    }
    this.hud.setLeaderboard(top, null);
  }

  /** Fetch and return a player's profile. The HUD subscribes and renders. */
  async fetchProfile(name: string): Promise<ProfileEntry | null> {
    return await fetchProfile(name);
  }

  /** Public: change the player's avatar (persisted in the run save). */
  setAvatar(avatar: string) {
    if (AVATARS.indexOf(avatar as any) >= 0) {
      this.save.run.avatar = avatar as Avatar;
      saveRun(this.save.run);
    }
  }

  /** Open the shop overlay (called after the level cinematic). */
  openShop() {
    this.shopOpen = true;
    this.shopDamagePaused = true;
    this.input.frozen = true;
    this.hud.setShop(true);
  }

  /** Close the shop and resume the world. */
  closeShop() {
    this.shopOpen = false;
    this.shopDamagePaused = false;
    this.input.frozen = false;
    this.hud.setShop(false);
  }

  /** Buy an upgrade if affordable. Returns true on success. */
  buyUpgrade(kind: 'hp' | 'dash' | 'attack' | 'speed'): boolean {
    const cost = 1000 * (kind === 'hp' ? 2 : 1);
    if (this.score < cost) return false;
    this.score -= cost;
    this.hud.setScore(this.score);
    const u = this.save.run.upgrades;
    if (kind === 'hp' && u.maxHp < 10) {
      u.maxHp += 1;
      this.hero.maxHp = u.maxHp;
      this.hero.hp = this.hero.maxHp;
      this.hud.setHp(this.hero.hp, this.hero.maxHp);
    } else if (kind === 'dash' && u.dashCdMul > 0.4) {
      u.dashCdMul = Math.max(0.4, u.dashCdMul - 0.15);
      this.hero.dashCdMul = u.dashCdMul;
    } else if (kind === 'attack' && u.attackSpeedMul > 0.4) {
      u.attackSpeedMul = Math.max(0.4, u.attackSpeedMul - 0.15);
      this.hero.attackCdMul = u.attackSpeedMul;
    } else if (kind === 'speed' && u.speedMul < 1.4) {
      u.speedMul = Math.min(1.4, u.speedMul + 0.1);
      this.hero.speedMul = u.speedMul;
    } else {
      // Already at max — refund
      this.score += cost;
      this.hud.setScore(this.score);
      return false;
    }
    saveRun(this.save.run);
    this.audio.hit();
    return true;
  }

  /** Unlock an achievement (idempotent). */
  unlockAchievement(id: AchievementId) {
    if (this.achievements.includes(id)) return;
    this.achievements.push(id);
    // Persist to run save
    this.save.run.achievements = this.achievements;
    saveRun(this.save.run);
    this.hud.setAchievements(this.achievements);
    // Flash
    this.hud.setLore(`// ACHIEVEMENT UNLOCKED: ${ACHIEVEMENT_META[id].name}`);
    this.particles.burst(this.hero.group.position.clone().setY(1.5), PALETTE.cyan, 40, 6, 0.6);
  }

  /** Game over: pause and ask for the player's handle so the score
   *  can be attributed correctly in the leaderboard. The actual
   *  leaderboard submission happens in submitWithName(name). */
  private startGameOver() {
    if (this.gameOver) return;
    this.gameOver = true;
    // Clear the field on death so the world the player sees in the
    // smash-zoom freeze-frame is pristine — no lingering enemies
    // walking around the body, no leftover particles from the hit
    // that killed them. Hero + boss contact are wiped in clearField.
    this.clearField();
    this.hud.setShop(false);
    this.audio.ambientStop();
    this.audio.hurt();
    this.shake(0.5, 0.6);

    // Red flash overlay (signals "you're dead" before the name modal)
    this.hud.setFlash('red', 0.7);

    // Persist the level reached.
    this.save.run.currentLevel = this.level;
    saveRun(this.save.run);

    // Capture where the hero died so the smash-zoom can frame the body.
    // Clone because the hero may keep moving briefly before the world
    // freezes on the next tick (the cinematic lock takes effect at the
    // top of tick()).
    this.deathPos.copy(this.hero.group.position);

    // Smash-zoom cinematic: camera SLAMS into the dead body (~0.5s) with
    // a small orbit, then 700ms later the "identify yourself" modal
    // appears. The world is frozen during the cine so the body stays
    // framed; the red flash + shake from above paint over the 3D scene
    // as HUD overlays, which is exactly the "everything just stopped"
    // feel we want. After the cine ends the askForName modal takes over.
    {
      const dp = this.deathPos.clone();
      const startYaw = this.camCtl.yaw;
      this.cine.play([
        { focus: new THREE.Vector3(dp.x, dp.y + 0.5, dp.z), yaw: startYaw,       pitch: 0.45, distance: 18, t: 0.0  },
        { focus: new THREE.Vector3(dp.x, dp.y + 0.5, dp.z), yaw: startYaw + 0.6, pitch: 0.30, distance: 5,  t: 0.5  },
      ], () => {
        // 700ms after the smash lands, pop the name-entry modal.
        setTimeout(() => this.hud.askForName(this.save.run.heroName), 700);
      });
    }
  }

  /** Called by the HUD once the player has entered a name (or skipped).
   *  Validates the name, updates the saved run, and POSTs the score
   *  to the global leaderboard (with localStorage fallback). */
  submitWithName(name: string) {
    const clean = (name || '').trim().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 16);
    const finalName = clean || 'PROGRAMMER';
    this.save.run.heroName = finalName;
    saveRun(this.save.run);

    // Best score + local high-score table (offline fallback)
    const newBest = Math.max(this.bestScore, this.score);
    this.save.bestScore = newBest;
    saveBestScore(newBest);

    const totalTime = (performance.now() - this.runStartTime) / 1000;
    const entry: any = {
      name: finalName,
      score: this.score,
      level: this.level,
      time: totalTime,
      when: Date.now(),
      heroName: finalName,
      avatar: this.save.run.avatar || 'code',
      country: '??',   // server uses cf-ipcountry
    };
    this.save.highScores = pushHighScore(this.save.highScores, entry);
    saveHighScores(this.save.highScores);
    this.hud.setBestScore(newBest);
    this.hud.setGameOverScore(this.score, this.level, newBest);

    // Submit to global leaderboard (async, non-blocking). When it
    // resolves the HUD updates with the top-10 + global rank.
    submitScore(entry).then((top) => {
      this.leaderboard = top;
      const me = top.find((e) => e.name === finalName && e.score === this.score);
      this.globalRank = me ? me.rank : null;
      this.hud.setLeaderboard(top, this.globalRank);
      this.hud.setTop3(top);  // update top-3 widget too
    }).catch(() => { /* ignored */ });

    // Finalize + upload the replay (best-effort)
    this.replay.end(this.score);
    const snap = this.replay.snapshot();
    if (snap && snap.frames.length > 60) {
      uploadReplay(snap).then((replayId) => {
        if (replayId) {
          this.save.lastReplayId = replayId;
          saveRun(this.save.run);
        }
      });
    }
    this.replay.clear();

    // Auto-restart the run after the player confirms their name.
    // The user wanted the level to restart right after the "identify
    // yourself" screen with no extra waiting, so they don't have to
    // click PLAY AGAIN manually. We close the modal immediately and
    // run restartRun synchronously in the same microtask. The best
    // score persists in localStorage and is shown in the HUD on the
    // new run.
    this.restartRun();
  }

  /**
   * Reset the run to level 1 with default upgrades, full HP, and a
   * fresh score. Best score + achievements persist (they survive
   * across runs and are shown in the HUD / leaderboard).
   */
  restartRun() {
    // Hard reset for a brand-new run: wipe the field, the boss, all
    // enemies and projectiles, fragments, gates, and the particle
    // pool, then rebuild the world with the L1 layout and the
    // default upgrades. Best score + achievements survive in
    // localStorage (see save.run.upgrades reset below).
    this.clearField();
    // Clear the game-over UI
    this.gameOver = false;
    this.hud.setGameOver(false);
    this.hud.setShop(false);
    this.shopOpen = false;
    this.audio.ambientStart();

    // Reset run upgrades (the player keeps their best score & avatar)
    this.save.run.upgrades = { ...DEFAULT_UPGRADES };
    this.save.run.currentLevel = 1;
    this.save.run.achievements = [];
    saveRun(this.save.run);

    // Hero stats
    this.hero.maxHp = DEFAULT_UPGRADES.maxHp;
    this.hero.hp = this.hero.maxHp;
    this.hero.dashCdMul = DEFAULT_UPGRADES.dashCdMul;
    this.hero.attackCdMul = DEFAULT_UPGRADES.attackSpeedMul;
    this.hero.speedMul = DEFAULT_UPGRADES.speedMul;
    this.hero.group.position.set(0, 0, 0);

    // HUD
    this.hud.setHp(this.hero.hp, this.hero.maxHp);
    this.hud.setScore(0);
    this.hud.setBossHp(0, 0);
    this.hud.setFragments(0, this.fragmentsTotal);

    // Reset level + regenerate world
    this.level = 1;
    this.score = 0;
    this.damageThisLevel = 0;
    this.enemiesKilledThisLevel = 0;
    this.fragmentsCollected = 0;
    this.bossSpawned = false;
    this.bossDefeated = false;
    this.boss = null;
    // Spawn fresh level entities (8 base enemies scaled by
    // this.difficultyMul = 1 at L1, 2 gates, 9 fragments).
    this.spawnLevelEntities();
    for (const c of this.components) this.scene.remove(c.group);
    seedRandom(this.level * 9173 + 42);
    this.components = generateComponents();
    for (const c of this.components) this.scene.add(c.group);
    this.levelStartTime = performance.now();
    this.runStartTime = performance.now();

    // Cinematic reveal of the new level
    this.hud.setLore(`// LEVEL ${this.level} // the grid has reconfigured. stay sharp.`);
    this.cine.play([
      { focus: new THREE.Vector3(0, 0, -45), yaw: Math.PI, pitch: 0.45, distance: 22, t: 0 },
      { focus: new THREE.Vector3(0, 0, 0), yaw: this.camCtl.yaw, pitch: 0.55, distance: 14, t: 1.4 },
    ]);

    // Restart the replay recorder for the new run
    this.replay.clear();
    this.replayStartedAt = performance.now();
  }

  /** Respawn at the same level the player died on. */
  respawn() {
    // Wipe the field first so the dead enemies, the boss and its
    // projectiles, the fragments they were standing on, and the
    // particles from the killing blow don't carry over. The new
    // level layout is generated from the same RNG seed, so the
    // player gets back into a familiar (but clean) world.
    this.clearField();
    // Reset run timer / per-level trackers
    this.gameOver = false;
    this.hud.setGameOver(false);
    this.audio.ambientStart();
    // Restore HP from upgrades
    this.hero.maxHp = this.save.run.upgrades.maxHp;
    this.hero.hp = this.hero.maxHp;
    this.hero.dashCdMul = this.save.run.upgrades.dashCdMul;
    this.hero.attackCdMul = this.save.run.upgrades.attackSpeedMul;
    this.hero.speedMul = this.save.run.upgrades.speedMul;
    this.hud.setHp(this.hero.hp, this.hero.maxHp);
    // Reset world for the current level (re-generate entities,
    // components, boss)
    this.damageThisLevel = 0;
    this.enemiesKilledThisLevel = 0;
    this.levelStartTime = performance.now();
    this.fragmentsCollected = 0;
    // Spawn the level layout: 8 base enemies, 2 gates, 9 fragments.
    this.spawnLevelEntities();
    // Re-generate components from the same per-level RNG seed.
    for (const c of this.components) this.scene.remove(c.group);
    seedRandom(this.level * 9173 + 42);
    this.components = generateComponents();
    for (const c of this.components) this.scene.add(c.group);
    this.bossSpawned = false;
    this.bossDefeated = false;
    this.boss = null;
    this.hero.group.position.set(0, 0, 0);
    this.hud.setLore(`// RESPAWN // level ${this.level} // the grid is patient.`);
    this.cine.play([
      { focus: new THREE.Vector3(0, 0, -45), yaw: Math.PI, pitch: 0.45, distance: 22, t: 0 },
      { focus: new THREE.Vector3(0, 0, 0), yaw: this.camCtl.yaw, pitch: 0.55, distance: 14, t: 1.0 },
    ]);
  }

  /** Spawn extra enemies based on the current level. */
  private spawnExtraEnemies() {
    const extras = this.level - 1;
    if (extras < 1) return;
    const p = this.hero.group.position;
    for (let i = 0; i < extras; i++) {
      const a = (i / extras) * Math.PI * 2 + Math.random();
      const r = 25 + Math.random() * 10;
      const kinds: ('hunter' | 'charger' | 'drone')[] = ['hunter', 'charger', 'drone'];
      const k = kinds[Math.floor(Math.random() * kinds.length)];
      const x = p.x + Math.cos(a) * r;
      const z = p.z + Math.sin(a) * r;
      if (k === 'drone') {
        this.enemies.push(this.makeEnemy('drone', new THREE.Vector3(x, 0, z), new THREE.Vector3(x, 0, z)));
      } else {
        const b = new THREE.Vector3(x + (Math.random() - 0.5) * 8, 0, z + (Math.random() - 0.5) * 8);
        this.enemies.push(this.makeEnemy(k, new THREE.Vector3(x, 0, z), b));
      }
    }
  }

  private setupRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(PALETTE.bg, 1);
    this.rootEl.appendChild(this.renderer.domElement);
  }

  private setupCamera() {
    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2000);
    this.camera.position.set(0, 10, 16);
    this.camera.lookAt(0, 1, 0);
    this.camCtl = new CameraController(this.camera);
    this.cine = new Cinematic(this.camCtl);
  }

  private setupScene() {
    this.world = new World();
    this.scene.add(this.world.group);

    this.scene.add(new THREE.AmbientLight(0x202840, 0.6));
    const dir = new THREE.DirectionalLight(0xaaccff, 0.6);
    dir.position.set(50, 80, 30);
    this.scene.add(dir);

    this.hero = new Hero();
    this.scene.add(this.hero.group);
    // Disc is a free-flying world-space projectile: attach to the scene root.
    this.scene.add(this.hero.disc.group);

    this.particles = new ParticleSystem(this.scene);
    this.trail = new TrailRenderer(this.scene);

    // Spawn the base layout for the current level. Called both on
    // the initial mount and after every clearField() (level change,
    // respawn, restart) so the new run always has the same opening
    // composition. difficultyMul is applied per-enemy so each
    // new level spawns tougher opponents without us having to
    // change the layout here.
    this.spawnLevelEntities();

    // Difficulty wave 1 (4 more drones at 30%+ progress)
    this.difficultyWave1 = 0; // set when player reaches 30% fragments
    // Difficulty wave 2 (tougher chargers, more spawns)
    this.difficultyWave2 = 0;

    // PCB components scattered across the world
    this.components = generateComponents();
    for (const c of this.components) this.scene.add(c.group);

    this.hud.setFragments(0, this.fragmentsTotal);
    this.hud.setHp(this.hero.hp, this.hero.maxHp);
    this.hud.setScore(0);
    this.hud.setSector('GRID HUB');
    this.hud.setBossHp(0, 0);
    this.hud.setLevel(this.level);
    this.hud.setLore('WASD move · SHIFT dash · SPACE jump · J/LMB disc-whip · RMB drag to orbit · collect FRAGMENTS to unlock gates');
    this.hud.setTutorial(true);
  }

  private makeGate(pos: THREE.Vector3, color: number, label: string): Gate {
    const g = new Gate(pos, color, label, 0);
    this.scene.add(g.group);
    return g;
  }

  private makeEnemy(kind: 'patrol' | 'turret' | 'hunter' | 'charger' | 'drone', a: THREE.Vector3, b: THREE.Vector3): Enemy {
    // Spawn the enemy with this level's difficulty multiplier so the
    // HP scales per level (1.0 at L1, 1.5 at L2, 2.0 at L3, ...).
    const e = new Enemy(kind, a, b, this.difficultyMul);
    this.scene.add(e.group);
    return e;
  }

  private setupPostFX() {
    this.postFX.init(this.renderer, this.scene, this.camera);
  }

  private bindResize() {
    let resizeT: number | null = null;
    const onResize = () => {
      if (resizeT) cancelAnimationFrame(resizeT);
      resizeT = requestAnimationFrame(() => {
        const w = window.innerWidth, h = window.innerHeight;
        this.renderer.setSize(w, h);
        this.postFX.composer.setSize(w, h);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.hud.setFragments(this.fragmentsCollected, this.fragmentsTotal);
      });
    };
    window.addEventListener('resize', onResize);
    // Mouse wheel zoom
    window.addEventListener('wheel', (e) => {
      this.camCtl.applyZoom(-e.deltaY);
    }, { passive: true });
    // Start ambient on first user gesture
    const startAudio = () => {
      this.audio.ambientStart();
      window.removeEventListener('keydown', startAudio);
      window.removeEventListener('mousedown', startAudio);
    };
    window.addEventListener('keydown', startAudio, { once: true });
    window.addEventListener('mousedown', startAudio, { once: true });
  }

  private loop = () => {
    requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, this.clock.getDelta());
    this.t += dt;

    // Pause toggle (consume edge regardless so it doesn't pile up)
    if (this.input.consumePause() && !this.gameOver) {
      this.paused = !this.paused;
      this.hud.setPaused(this.paused);
      if (this.paused) this.audio.ambientStop();
      else this.audio.ambientStart();
    }

    if (!this.paused && !this.gameOver) this.tick(dt, this.t);
    // Cinematic must keep advancing even when gameOver is true so that
    // the death cinematic (smash-zoom) can finish and fire its onDone
    // callback — that's what pops the "identify yourself" modal. Without
    // this, gameOver freezes the tick and the smash-zoom hangs forever.
    if (this.gameOver && this.cine.running) {
      this.input.consumeOrbit();
      this.cine.update(dt, this.t);
    }
    // Music always advances (even on game over) for atmosphere
    this.audio.musicTick(dt);
    // Music intensity rises during boss fight
    if (this.boss && this.boss.alive) {
      this.audio.musicIntensity(2.0);
    } else {
      this.audio.musicIntensity(1.0);
    }
    this.postFX.setPulse(this.world.getPulse());
    this.postFX.composer.render(dt);
  };

  private tick(dt: number, t: number) {
    // Cinematic lock: when the scripted camera is running (e.g. boss
    // intro, level transition reveal), the entire world freezes. No
    // input, no movement, no enemy AI, no damage, no scoring — only
    // the camera plays its keyframes.
    if (this.cine.running) {
      // Drop any pending orbit input so it doesn't snap when the
      // cinematic ends.
      this.input.consumeOrbit();
      this.cine.update(dt, t);
      return;
    }

    // Shop lock: while the SHOP overlay is open (after a level clear,
    // before continuing), the hero is locked in place but the world
    // keeps running. Enemies patrol, fragments hover, projectiles
    // fly, the camera can orbit. The hero just doesn't take damage
    // and can't be moved by the player. The level has effectively
    // "started" already — the player can see it — but they get a
    // safe window to spend their score on upgrades first.
    this.shopDamagePaused = this.shopOpen;

    // Camera orbit input → controller
    const orbit = this.input.consumeOrbit();
    if (orbit.dx !== 0 || orbit.dy !== 0) this.camCtl.applyOrbit(orbit.dx, orbit.dy);

    // Record this frame into the replay (only the hero's input and
    // the mouse delta are useful for replay; we exclude the camera
    // shake because that's deterministic from the world's events).
    const mouse = { dx: orbit.dx, dy: orbit.dy, btnL: this.input.isLmbDown(), btnR: this.input.isRmbDown() };
    this.replay.record(dt, t, this.input.keysHeld(), mouse);

    // Keyboard camera orbit — Q/E (or U/O) orbit the camera. A/D
    // remain reserved for strafe (with W/S). Combine W+A for
    // "walk forward while looking around" feel: WASD strafe + Q/E orbit.
    const turnLeft  = this.input.held('KeyQ') || this.input.held('KeyU') || this.input.held('ArrowLeft');
    const turnRight = this.input.held('KeyE') || this.input.held('KeyO') || this.input.held('ArrowRight');
    const ORBIT_SPEED = 2.2; // rad/sec; ~126°/s
    if (turnLeft)  this.camCtl.applyOrbit(-ORBIT_SPEED * 60 * dt, 0);
    if (turnRight) this.camCtl.applyOrbit( ORBIT_SPEED * 60 * dt, 0);
    // Vertical camera tilt via R/F
    if (this.input.held('KeyR')) this.camCtl.applyOrbit(0,  1.0 * 60 * dt);
    if (this.input.held('KeyF')) this.camCtl.applyOrbit(0, -1.0 * 60 * dt);

    // Level-cleared transition: if the boss is dead and we haven't yet
    // triggered the next level, do it now.
    if (this.boss && !this.boss.alive && !this.victory) {
      this.victory = true;
      this.score += 2000;
      this.hud.setScore(this.score);
      this.particles.burst(this.boss.group.position.clone().setY(2), PALETTE.orange, 200, 12, 1.5);
      this.audio.boom();
      this.audio.victory();
      this.audio.ambientStop();
      this.saveBestScore(this.score);
      this.hud.setTransition(true, `LEVEL ${this.level} CLEARED`);
      // Outro cinematic: slow-zoom out from the dead boss. Starts at
      // ~the current camera distance and pulls back, pitching up a bit
      // to give a "you did it" wide reveal of the wreckage. The world
      // freezes during the cine (tick() short-circuits), so the boss
      // body stays in frame for the whole 3s.
      {
        const bossFocus = this.boss.group.position.clone().setY(1.5);
        this.cine.play([
          { focus: bossFocus, yaw: this.camCtl.yaw,           pitch: 0.45, distance: 14, t: 0.0 },
          { focus: bossFocus, yaw: this.camCtl.yaw + Math.PI / 6, pitch: 0.65, distance: 45, t: 3.0 },
        ]);
      }
      setTimeout(() => this.startNextLevel(), 2800);
      return;
    }

    const pulse = this.world.getPulse();
    this.world.update(dt, t);

    // Hero (camera-relative WASD) with PCB component collision
    this.hero.update(dt, this.input, t, pulse, this.camCtl.yaw, this.components);
    this.trail.update(this.hero);
    // Disc update in world space, with hero pos for return arc
    this.hero.disc.update(dt, t, this.hero.group.position);

    // Camera follow
    this.camCtl.setHeroPosition(this.hero.group.position);
    this.camCtl.update(dt);

    if (this.shakeT > 0) {
      this.shakeT -= dt;
      this.camera.position.x += (Math.random() - 0.5) * this.shakeAmp;
      this.camera.position.y += (Math.random() - 0.5) * this.shakeAmp;
      this.shakeAmp *= 0.9;
    }

    // Fragments
    for (const f of this.fragments) {
      if (f.collected) continue;
      f.update(t);
      const d = f.group.position.distanceTo(this.hero.group.position);
      if (d < 1.6) {
        f.collect();
        this.fragmentsCollected++;
        this.score += 100;
        this.hud.setScore(this.score);
        this.hud.setFragments(this.fragmentsCollected, this.fragmentsTotal);
        this.hud.setLore(f.lore);
        this.audio.pickup();
        this.particles.burst(f.group.position.clone().setY(1.2), f.color, 24, 5, 0.6);
        for (const g of this.gates) if (!g.unlocked) g.setUnlocked(true);
        this.saveProgress(f);
        setTimeout(() => { if (this.nearLore === f.lore) this.hud.setLore(null); }, 3500);
      }
    }

    // Boss spawn: when all fragments are collected and boss not yet spawned.
    // Sequence: flash + shake + lore + cinematic reveal.
    if (!this.bossSpawned && this.fragmentsCollected >= this.fragmentsTotal && this.fragmentsTotal > 0) {
      this.finalizeFragmentRun();
    }

    // Difficulty wave 1: at 30% progress, spawn 2 drones + 1 charger
    const progress = this.fragmentsTotal > 0 ? this.fragmentsCollected / this.fragmentsTotal : 0;
    if (this.difficultyWave1 === 0 && progress >= 0.3) {
      this.difficultyWave1 = 1;
      this.spawnWave(['drone', 'drone', 'charger']);
      this.hud.setLore('// wave 1 incoming. more processes detected.');
    }
    // Difficulty wave 2: at 60% progress, spawn 3 chargers + 1 drone
    if (this.difficultyWave2 === 0 && progress >= 0.6) {
      this.difficultyWave2 = 1;
      this.spawnWave(['charger', 'charger', 'charger', 'drone']);
      this.hud.setLore('// wave 2: the grid is retaliating.');
    }

    // Sector detection by nearest sector center
    let bestId = this.currentSectorId, bestD = Infinity;
    for (const s of SECTORS) {
      const d = s.center.distanceTo(this.hero.group.position);
      if (d < bestD) { bestD = d; bestId = s.id; }
    }
    if (bestId !== this.currentSectorId) {
      this.currentSectorId = bestId;
      const name = SECTORS.find((s) => s.id === bestId)?.name ?? 'UNKNOWN';
      this.hud.setSector(name);
    }

    // Lore proximity
    if (t - this.lastLoreUpdate > 0.1) {
      this.lastLoreUpdate = t;
      let closest: Fragment | null = null, cdist = Infinity;
      for (const f of this.fragments) {
        if (f.collected) continue;
        const d = f.group.position.distanceTo(this.hero.group.position);
        if (d < 4 && d < cdist) { cdist = d; closest = f; }
      }
      const lore = closest ? (closest as Fragment).lore : null;
      if (lore !== this.nearLore) {
        this.nearLore = lore;
        this.hud.setLore(lore);
      }
    }

    // Enemies
    for (const e of this.enemies) {
      e.update(dt, t, this.hero.group.position);
      if (!e.alive) continue;
      if (this.hero.disc.isActive() && this.hero.disc.hits(e.group.position, 0.8)) {
        const dead = e.hurt(1);
        if (dead) {
          this.enemiesKilledThisLevel++;
          // Track first blood achievement
          if (this.enemiesKilledThisLevel === 1) this.unlockAchievement('first_blood');
          this.score += 250;
          this.hud.setScore(this.score);
          this.particles.burst(e.group.position.clone().setY(0.8), PALETTE.magenta, 60, 7, 0.9);
          this.audio.boom();
        } else {
          this.particles.burst(e.group.position.clone().setY(0.8), 0xffffff, 12, 3, 0.3);
          this.audio.hit();
          this.shake(0.15, 0.1);
        }
      }
      if (e.alive && e.group.position.distanceTo(this.hero.group.position) < 1.4 && !this.shopDamagePaused) {
        this.damageThisLevel++;
        const dead = this.hero.hurt(1);
        this.hud.setHp(this.hero.hp, this.hero.maxHp);
        this.audio.hurt();
        this.shake(0.25, 0.3);
        if (dead) this.startGameOver();
      }
      // Projectiles from this enemy (turrets, hunters, drones).
      // Radius 2.0m is generous: the projectile is small (0.22m sphere)
      // moving at 14 m/s, so we give the player a fair hitbox.
      for (const p of e.projectiles) {
        if (p.mesh.position.distanceTo(this.hero.group.position) < 2.0) {
          if (this.shopDamagePaused) { p.life = 0; continue; }
          this.damageThisLevel++;
          p.life = 0;
          this.particles.burst(p.mesh.position.clone(), PALETTE.cyan, 18, 4, 0.5);
          const dead = this.hero.hurt(1);
          this.hud.setHp(this.hero.hp, this.hero.maxHp);
          this.audio.hurt();
          this.shake(0.25, 0.3);
          if (dead) this.startGameOver();
        }
      }
    }

    // Boss
    if (this.boss && this.boss.alive) {
      this.boss.update(dt, t, this.hero.group.position);
      if (this.hero.disc.isActive() && this.boss.takesHit(this.hero.disc.group.position)) {
        this.boss.hurt(1);
        this.hud.setBossHp(this.boss.hp, this.boss.maxHp);
        this.audio.hit();
        this.shake(0.3, 0.2);
        this.particles.burst(this.boss.group.position.clone().setY(2), 0xffffff, 30, 5, 0.4);
        // Level transition is detected at the top of tick() (next frame)
      }
      // Boss body contact — INSTAKILL. Touching the master process ends
      // the run immediately. Suppressed only while the shop is open so
      // the player can shop without being one-shot by a wandering boss.
      if (this.bossContactCd > 0) this.bossContactCd -= dt;
      if (this.boss.alive && this.boss.group.position.distanceTo(this.hero.group.position) < 4.5 && !this.shopDamagePaused) {
        this.damageThisLevel++;
        const dead = this.hero.hurt(999);   // instakill
        this.bossContactCd = 0.7;            // brief i-frames to avoid double-trigger next frame
        this.hud.setHp(this.hero.hp, this.hero.maxHp);
        this.audio.hurt();
        this.shake(0.6, 0.7);
        // Massive particles for the boss-touched-the-hero moment
        this.particles.burst(this.hero.group.position.clone().setY(1), PALETTE.red, 200, 12, 1.4);
        if (dead) this.startGameOver();
      }
      // Boss projectiles — the boss has its own projectile pool
      // (this.boss.projectiles) that is updated inside boss.update().
      // The enemies loop above only iterates enemy projectiles, so the
      // boss's shots used to fly straight through the hero with no
      // collision check. Mirror the enemies loop here.
      //
      // Hitbox is a CYLINDER around the hero (XZ-plane distance
      // only), not a sphere. Reason: the boss fires from height
      // 2.5m and the hero's pivot is at Y=0, so a 3D sphere check
      // would require the projectile to be at almost the same Y
      // as the hero to register a hit. The cylinder treats the
      // hero as a vertical column (Y=0..2) and checks the XZ
      // distance, which is what the player actually perceives as
      // "the shot went through me". Enemies use the same shape.
      for (const p of this.boss.projectiles) {
        const dx = p.mesh.position.x - this.hero.group.position.x;
        const dz = p.mesh.position.z - this.hero.group.position.z;
        const distXZ = Math.hypot(dx, dz);
        if (distXZ < 2.0) {
          if (this.shopDamagePaused) { p.life = 0; continue; }
          this.damageThisLevel++;
          p.life = 0;
          this.particles.burst(p.mesh.position.clone(), PALETTE.cyan, 18, 4, 0.5);
          const dead = this.hero.hurt(p.damage);
          this.hud.setHp(this.hero.hp, this.hero.maxHp);
          this.audio.hurt();
          this.shake(0.25, 0.3);
          if (dead) this.startGameOver();
        }
      }
    }

    this.particles.update(dt);
  }

  private shake(amp: number, t: number) {
    this.shakeAmp = Math.max(this.shakeAmp, amp);
    this.shakeT = Math.max(this.shakeT, t);
  }

  /** Triggered when the player collects the last fragment. Plays
   *  the "finalization" sequence: white flash, screen shake, lore
   *  banner, warning audio, particle burst, AND a short camera
   *  transition that pulls back and tilts the view toward the boss
   *  spawn position so the player feels the "something is coming"
   *  moment, not a static beat. After 1.6s the boss spawns and its
   *  spiral-reveal cinematic continues seamlessly from where this
   *  transition left off (its first keyframe matches the last
   *  keyframe of this transition). */
  private finalizeFragmentRun() {
    if (this.bossSpawned) return;
    this.bossSpawned = true;   // claim immediately so we don't double-spawn
    this.hud.setLore('// ALL FRAGMENTS COLLECTED // the master process awakens');
    this.hud.setFragments(this.fragmentsCollected, this.fragmentsTotal);
    this.shake(0.6, 1.0);
    // White-flash overlay (HUD side)
    this.hud.setFlash('white', 0.9);
    // Particle burst at hero position (cyan, large)
    this.particles.burst(this.hero.group.position.clone().setY(1.5), PALETTE.cyan, 120, 8, 1.2);
    // Audio: warning + chord
    this.audio.warning();

    // Camera transition: from the gameplay view (looking at the hero)
    // to a wide shot of the boss spawn position (0, 1.5, -90). The
    // camera dollies back, the yaw swings to face the boss spawn, and
    // the pitch drops slightly so the boss point reads as "ahead of
    // you, far away, dangerous". spawnBoss will then continue this
    // pull-in, so the two cinematics are one continuous move.
    {
      const bossFocus = new THREE.Vector3(0, 1.5, -90);
      this.cine.play([
        // Hold the gameplay view for a beat so the white flash reads
        { focus: this.hero.group.position.clone(), yaw: this.camCtl.yaw, pitch: 0.55, distance: 14, t: 0.0 },
        // Pull back, swing to the boss, drop the pitch
        { focus: bossFocus,                         yaw: Math.PI,        pitch: 0.35, distance: 28, t: 1.6 },
      ]);
    }

    // Spawn the boss when the transition ends so its spiral-reveal
    // starts from the wide-boss-shot the transition left us in.
    setTimeout(() => this.spawnBoss(), 1600);
  }

  private spawnBoss() {
    // Variant: octa (default), spinblade (faster ring), voidtank (slower tank)
    this.boss = new Boss(new THREE.Vector3(0, 0, -90), this.level, this.bossVariant);
    this.scene.add(this.boss.group);
    this.hud.setBossHp(this.boss.hp, this.boss.maxHp);
    this.audio.warning();
    // Cinematic reveal that continues from finalizeFragmentRun's
    // transition (which left the camera in a wide shot of the boss
    // spawn position). The first keyframe matches the end of that
    // transition — same focus, same distance, same pitch — so the
    // move is continuous: pull-in toward the boss, slight orbit to
    // register the threat, then settle back behind the hero for the
    // fight.
    const hp = this.hero.group.position.clone();
    const bossFocus = new THREE.Vector3(0, 1.5, -90);
    this.cine.play([
      // Match end-of-transition (wide boss shot) — no discontinuity
      { focus: bossFocus,                       yaw: Math.PI,        pitch: 0.35, distance: 28, t: 0.0 },
      // Pull in toward the boss
      { focus: bossFocus,                       yaw: Math.PI,        pitch: 0.40, distance: 22, t: 0.8 },
      // Slight orbit, pitch up — register the threat
      { focus: bossFocus,                       yaw: Math.PI + 0.4,  pitch: 0.45, distance: 18, t: 1.8 },
      // Begin the swing back toward the hero
      { focus: bossFocus.clone().lerp(hp, 0.5), yaw: Math.PI + 0.6,  pitch: 0.50, distance: 16, t: 2.8 },
      // Settle behind the hero for gameplay
      { focus: hp,                              yaw: this.camCtl.yaw, pitch: 0.55, distance: 14, t: 4.0 },
    ]);
  }

  /** Spawn a wave of enemies around the player at a comfortable distance. */
  private spawnWave(kinds: ('patrol' | 'turret' | 'hunter' | 'charger' | 'drone')[]) {
    const p = this.hero.group.position;
    for (const kind of kinds) {
      // place in a circle around the player, 22-28m out
      const a = Math.random() * Math.PI * 2;
      const r = 22 + Math.random() * 8;
      const x = p.x + Math.cos(a) * r;
      const z = p.z + Math.sin(a) * r;
      // patrol needs A and B
      if (kind === 'patrol' || kind === 'hunter' || kind === 'charger') {
        const b = new THREE.Vector3(x + (Math.random() - 0.5) * 8, 0, z + (Math.random() - 0.5) * 8);
        this.enemies.push(this.makeEnemy(kind, new THREE.Vector3(x, 0, z), b));
      } else {
        this.enemies.push(this.makeEnemy(kind, new THREE.Vector3(x, 0, z), new THREE.Vector3(x, 0, z)));
      }
    }
  }

  // --- localStorage persistence ---
  private fragmentId(f: Fragment): string {
    return `${f.group.position.x.toFixed(2)},${f.group.position.z.toFixed(2)}`;
  }

  private saveProgress(f: Fragment) {
    if (!this.savedFragments.includes(this.fragmentId(f))) {
      this.savedFragments.push(this.fragmentId(f));
      try { localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.savedFragments)); } catch {}
    }
  }

  private loadSave() {
    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      if (!raw) return;
      const ids: string[] = JSON.parse(raw);
      this.savedFragments = ids;
      for (const f of this.fragments) {
        if (ids.includes(this.fragmentId(f))) {
          f.collected = true;
          f.group.visible = false;
          this.fragmentsCollected++;
        }
      }
      this.hud.setFragments(this.fragmentsCollected, this.fragmentsTotal);
      for (const g of this.gates) g.setUnlocked(true);
    } catch {}
    try {
      const best = localStorage.getItem(this.STORAGE_BEST);
      if (best) this.bestScore = parseInt(best, 10) || 0;
      this.hud.setBestScore(this.bestScore);
    } catch {}
    try {
      const vol = localStorage.getItem(this.STORAGE_VOL);
      if (vol) this.audio.setVolume(parseFloat(vol));
    } catch {}
  }

  private saveBestScore(score: number) {
    if (score <= this.bestScore) return;
    this.bestScore = score;
    try { localStorage.setItem(this.STORAGE_BEST, score.toString()); } catch {}
    this.hud.setBestScore(score);
  }
}
