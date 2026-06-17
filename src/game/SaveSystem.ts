/**
 * SaveSystem.ts — localStorage persistence.
 *
 *  - highScores:  top-5 {name, score, level, time}
 *  - runState:    {currentLevel, upgrades, achievements, heroName}
 *  - settings:    {volume}
 *
 * All operations are wrapped in try/catch (Safari private mode breaks
 * localStorage, and we don't want to crash the game).
 */

export type HighScore = {
  name: string;
  score: number;
  level: number;
  time: number;  // seconds
  when: number;  // epoch ms
};

export type Upgrades = {
  maxHp: number;          // 6, 7, 8, 9, 10  (5 levels, +1 each)
  dashCdMul: number;      // 1.0, 0.85, 0.7, 0.55, 0.4
  attackSpeedMul: number; // 1.0, 0.85, 0.7, 0.55, 0.4
  speedMul: number;       // 1.0, 1.1, 1.2, 1.3, 1.4
};

export type Avatar = 'code' | 'glitch' | 'shard' | 'circuit' | 'kernel';
export const DEFAULT_AVATAR: Avatar = 'code';

export type AchievementId =
  | 'first_blood'      // kill first enemy
  | 'frag_collector'   // collect first fragment
  | 'boss_slayer_l1'   // kill first boss
  | 'boss_slayer_l3'   // reach level 3 boss
  | 'boss_slayer_l5'   // reach level 5 boss
  | 'survivor'         // finish a level with full HP
  | 'pacifist'         // finish a level without dying
  | 'flawless'         // kill a boss without taking damage in that level
  | 'speedrunner'      // finish level 1 in under 60 seconds
  | 'component_smash'  // damage 20 enemies with a single disc throw
  | 'completionist';   // reach level 10

export type Save = {
  highScores: HighScore[];
  run: {
    currentLevel: number;
    upgrades: Upgrades;
    achievements: AchievementId[];
    heroName: string;
    avatar: Avatar;
  };
  settings: {
    volume: number;
  };
  fragments: string[];  // existing per-fragment persistence
  bestScore: number;
};

const K_HIGH = 'neongrid:high';
const K_RUN = 'neongrid:run';
const K_SETTINGS = 'neongrid:settings';
const K_FRAG = 'neongrid:fragments';
const K_BEST = 'neongrid:best';

function safe<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch { return fallback; }
}

export const DEFAULT_UPGRADES: Upgrades = {
  maxHp: 6,
  dashCdMul: 1.0,
  attackSpeedMul: 1.0,
  speedMul: 1.0,
};

export const DEFAULT_SAVE: Save = {
  highScores: [],
  run: {
    currentLevel: 1,
    upgrades: { ...DEFAULT_UPGRADES },
    achievements: [],
    heroName: 'PROGRAMMER',
    avatar: DEFAULT_AVATAR,
  },
  settings: { volume: 0.7 },
  fragments: [],
  bestScore: 0,
};

export function loadSave(): Save {
  return safe(() => {
    const high = JSON.parse(localStorage.getItem(K_HIGH) || '[]') as HighScore[];
    const run = JSON.parse(localStorage.getItem(K_RUN) || 'null') as Save['run'] | null;
    const settings = JSON.parse(localStorage.getItem(K_SETTINGS) || 'null') as Save['settings'] | null;
    const fragments = JSON.parse(localStorage.getItem(K_FRAG) || '[]') as string[];
    const best = parseInt(localStorage.getItem(K_BEST) || '0', 10);
    return {
      highScores: high,
      run: run || { ...DEFAULT_SAVE.run },
      settings: settings || { ...DEFAULT_SAVE.settings },
      fragments,
      bestScore: best || 0,
    };
  }, { ...DEFAULT_SAVE });
}

export function saveHighScores(scores: HighScore[]) {
  safe(() => localStorage.setItem(K_HIGH, JSON.stringify(scores)), undefined);
}

export function saveRun(run: Save['run']) {
  safe(() => localStorage.setItem(K_RUN, JSON.stringify(run)), undefined);
}

export function saveSettings(s: Save['settings']) {
  safe(() => localStorage.setItem(K_SETTINGS, JSON.stringify(s)), undefined);
}

export function saveFragments(ids: string[]) {
  safe(() => localStorage.setItem(K_FRAG, JSON.stringify(ids)), undefined);
}

export function saveBestScore(s: number) {
  safe(() => localStorage.setItem(K_BEST, s.toString()), undefined);
}

/** Insert a new high score, sort, and trim to top 5. */
export function pushHighScore(scores: HighScore[], entry: HighScore): HighScore[] {
  const next = [...scores, entry].sort((a, b) => b.score - a.score).slice(0, 5);
  return next;
}

/** Achievement metadata for the HUD display. */
export const ACHIEVEMENT_META: Record<AchievementId, { name: string; desc: string; icon: string }> = {
  first_blood:     { name: 'FIRST BLOOD',     desc: 'Defeat your first enemy',                 icon: '⚔' },
  frag_collector:  { name: 'COLLECTOR',       desc: 'Pick up a code fragment',                 icon: '◇' },
  boss_slayer_l1:  { name: 'BREAKTHROUGH',    desc: 'Defeat the Master Process',               icon: '✦' },
  boss_slayer_l3:  { name: 'VETERAN',         desc: 'Reach level 3',                           icon: '✦✦' },
  boss_slayer_l5:  { name: 'EXTERMINATOR',    desc: 'Reach level 5',                           icon: '✦✦✦' },
  survivor:        { name: 'SURVIVOR',        desc: 'Finish a level at full HP',               icon: '♥' },
  pacifist:        { name: 'PACIFIST',        desc: 'Finish a level without dying',            icon: '☮' },
  flawless:        { name: 'FLAWLESS',        desc: 'Defeat a boss without taking damage',     icon: '★' },
  speedrunner:     { name: 'SPEEDRUNNER',     desc: 'Finish level 1 in under 60s',             icon: '⏱' },
  component_smash: { name: 'BIG BOOM',        desc: 'Hit 20 enemies with one disc',            icon: '◎' },
  completionist:   { name: 'COMPLETIONIST',   desc: 'Reach level 10',                          icon: '♛' },
};
