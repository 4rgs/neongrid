<script lang="ts">
// HUD overlay. Svelte 5 runes.
let score = $state(0);
let bestScore = $state(0);
let fragments = $state(0);
let fragmentsTotal = $state(0);
let hp = $state(6);
let hpMax = $state(6);
let sector = $state('GRID HUB');
let lore = $state<string | null>('WASD move · SHIFT dash · SPACE jump · J/LMB disc-whip · RMB drag to orbit · collect FRAGMENTS to unlock gates');
let gameOver = $state(false);
let paused = $state(false);
let bossHp = $state(0);
let bossMax = $state(0);
let showTutorial = $state(true);
let victory = $state(false);
let victoryData = $state<{ score: number; fragments: number; total: number; time: number; bestScore: number } | null>(null);
let showSettings = $state(false);
let volume = $state(0.7);
// Minimap state
let minimapData = $state<{ x: number; y: number; yaw: number } | null>(null);
// Subscribe via raf polling
let minimapCanvas: HTMLCanvasElement;

  $effect(() => {
    const api = {
      setScore: (n: number) => { score = n; },
      setBestScore: (n: number) => { bestScore = n; },
      setFragments: (n: number, t: number) => { fragments = n; fragmentsTotal = t; },
      setHp: (n: number, m: number) => { hp = n; hpMax = m; },
      setSector: (n: string) => { sector = n; },
      setLore: (t: string | null) => { lore = t; },
      setGameOver: (v: boolean) => { gameOver = v; },
      setPaused: (v: boolean) => { paused = v; },
      setBossHp: (n: number, m: number) => { bossHp = n; bossMax = m; },
      setTutorial: (v: boolean) => { showTutorial = v; },
      setVictory: (v: boolean, data?: { score: number; fragments: number; total: number; time: number; bestScore: number }) => {
        victory = v;
        victoryData = data ?? null;
        if (data) bestScore = data.bestScore;
      },
      setSettings: (v: boolean) => { showSettings = v; },
      setVolume: (v: number) => { volume = v; },
      getVolume: () => volume,
    };
    (window as any).__hud = api;
    return () => { /* keep global on unmount */ };
  });

  // Toggle settings with M key
  function handleKeydown(e: KeyboardEvent) {
    if (e.code === 'KeyM' && !(window as any).__game?.gameOver) {
      showSettings = !showSettings;
    }
  }
  $effect(() => {
    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  });

  // Volume slider: change real-time
  function onVolumeChange(e: Event) {
    const v = parseFloat((e.target as HTMLInputElement).value);
    volume = v;
    const g = (window as any).__game;
    if (g) g.setVolume(v);
  }

  // Reset run
  function resetRun() {
    try { localStorage.removeItem('neongrid:fragments'); } catch {}
    location.reload();
  }

  function formatTime(s: number) {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  }

  const hpPct = $derived(hpMax > 0 ? (hp / hpMax) * 100 : 0);
  const hpColor = $derived(hpPct > 50 ? 'var(--cyan)' : hpPct > 20 ? 'var(--orange)' : 'var(--magenta)');
  const bossPct = $derived(bossMax > 0 ? (bossHp / bossMax) * 100 : 0);

  function restart() {
    try { localStorage.removeItem('neongrid:fragments'); } catch {}
    location.reload();
  }

  // Minimap render loop
  $effect(() => {
    const canvas = minimapCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const W = canvas.width, H = canvas.height;

    const draw = () => {
      // Read from window.__game and window.__hud
      const g: any = (window as any).__game;
      ctx.clearRect(0, 0, W, H);
      // border
      ctx.strokeStyle = 'rgba(0, 240, 255, 0.6)';
      ctx.lineWidth = 1;
      ctx.strokeRect(0, 0, W, H);
      if (!g) { requestAnimationFrame(draw); return; }

      // World coordinates to minimap (range -110..110 → 0..W)
      const SCALE = W / 220;
      const cx = W / 2, cy = H / 2;
      const wx = g.hero.group.position.x;
      const wz = g.hero.group.position.z;
      const yaw = g.hero.yaw;
      // sectors
      const sectors = (g as any).gates ? null : null; // reserved
      // draw sector center dots
      try {
        // draw player
        ctx.fillStyle = '#ff6a00';
        ctx.beginPath();
        ctx.arc(cx, cy, 3, 0, Math.PI * 2);
        ctx.fill();
        // facing line
        ctx.strokeStyle = '#ff6a00';
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.sin(yaw) * 10, cy + Math.cos(yaw) * 10);
        ctx.stroke();
        // enemies (color by kind)
        for (const e of g.enemies) {
          if (!e.alive) continue;
          if (e.kind === 'turret') ctx.fillStyle = '#ff2255';
          else if (e.kind === 'hunter') ctx.fillStyle = '#00ff88';
          else if (e.kind === 'charger') ctx.fillStyle = '#ff6a00';
          else ctx.fillStyle = '#ff00aa';
          const ex = cx + (e.group.position.x - wx) * SCALE;
          const ey = cy + (e.group.position.z - wz) * SCALE;
          ctx.beginPath();
          ctx.arc(ex, ey, 2, 0, Math.PI * 2);
          ctx.fill();
        }
        // fragments
        for (const f of g.fragments) {
          if (f.collected) continue;
          ctx.fillStyle = '#00f0ff';
          const ex = cx + (f.group.position.x - wx) * SCALE;
          const ey = cy + (f.group.position.z - wz) * SCALE;
          ctx.fillRect(ex - 1, ey - 1, 2, 2);
        }
        // boss
        if (g.boss && g.boss.alive) {
          ctx.fillStyle = '#ff6a00';
          const ex = cx + (g.boss.group.position.x - wx) * SCALE;
          const ey = cy + (g.boss.group.position.z - wz) * SCALE;
          ctx.beginPath();
          ctx.arc(ex, ey, 5, 0, Math.PI * 2);
          ctx.fill();
        }
        // gates
        for (const gate of g.gates) {
          ctx.strokeStyle = gate.unlocked ? '#00ff88' : '#444';
          const ex = cx + (gate.group.position.x - wx) * SCALE;
          const ey = cy + (gate.group.position.z - wz) * SCALE;
          ctx.beginPath();
          ctx.arc(ex, ey, 4, 0, Math.PI * 2);
          ctx.stroke();
        }
      } catch (e) {}

      requestAnimationFrame(draw);
    };
    draw();
  });
</script>

<div class="hud">
  <div class="hud-top-left">
    <div class="hud-label">SECTOR</div>
    <div class="hud-value">{sector}</div>
    {#if bestScore > 0}
      <div class="hud-best">BEST {bestScore.toString().padStart(6, '0')}</div>
    {/if}
  </div>

  <div class="hud-top-right">
    <div class="hud-label">SCORE</div>
    <div class="hud-value big">{score.toString().padStart(6, '0')}</div>
    <button class="hud-settings-btn" onclick={() => showSettings = !showSettings} title="Settings (M)">⚙</button>
  </div>

  <div class="hud-bottom-left">
    <div class="hud-label">HEALTH</div>
    <div class="hp-bar">
      <div class="hp-fill" style="width: {hpPct}%; background: {hpColor}"></div>
    </div>
    <div class="hud-value small">{hp}/{hpMax}</div>
  </div>

  <div class="hud-bottom-right">
    <div class="hud-label">FRAGMENTS</div>
    <div class="hud-value">{fragments}/{fragmentsTotal}</div>
  </div>

  <div class="hud-minimap">
    <div class="hud-label">MAP</div>
    <canvas bind:this={minimapCanvas} width="160" height="160"></canvas>
  </div>

  {#if bossMax > 0}
    <div class="hud-boss">
      <div class="hud-label">// MASTER PROCESS</div>
      <div class="hp-bar">
        <div class="hp-fill" style="width: {bossPct}%; background: var(--orange)"></div>
      </div>
      <div class="hud-value small">{bossHp}/{bossMax}</div>
    </div>
  {/if}

  {#if lore}
    <div class="hud-lore">{lore}</div>
  {/if}

  {#if showSettings}
    <div class="settings-overlay" onclick={() => showSettings = false} role="presentation">
      <div class="settings-card" onclick={(e) => e.stopPropagation()} role="presentation">
        <div class="settings-title">SETTINGS</div>
        <div class="settings-row">
          <span class="settings-key">VOLUME</span>
          <input
            type="range" min="0" max="1" step="0.05"
            value={volume}
            oninput={onVolumeChange}
            class="volume-slider"
          />
          <span class="settings-val">{Math.round(volume * 100)}%</span>
        </div>
        <div class="settings-row">
          <span class="settings-key">CONTROLS</span>
          <span class="settings-val">WASD · SHIFT · SPACE</span>
        </div>
        <div class="settings-row">
          <span class="settings-key">CAMERA</span>
          <span class="settings-val">RMB drag · Scroll</span>
        </div>
        <div class="settings-row">
          <span class="settings-key">PAUSE</span>
          <span class="settings-val">ESC / P</span>
        </div>
        <div class="settings-row">
          <span class="settings-key">SETTINGS</span>
          <span class="settings-val">M</span>
        </div>
        <div class="settings-row">
          <span class="settings-key">BEST SCORE</span>
          <span class="settings-val">{bestScore.toString().padStart(6, '0')}</span>
        </div>
        <div class="settings-actions">
          <button class="settings-btn" onclick={resetRun}>RESET RUN</button>
          <button class="settings-btn" onclick={() => showSettings = false}>CLOSE</button>
        </div>
        <div class="settings-hint">press M to toggle</div>
      </div>
    </div>
  {/if}

  {#if showTutorial}
    <div class="tutorial-overlay" onclick={() => showTutorial = false} role="presentation">
      <div class="tutorial-card">
        <div class="tutorial-title">NEONGRID</div>
        <div class="tutorial-sub">// survival protocol v0.1</div>
        <div class="tutorial-grid">
          <div class="tutorial-row"><span class="key">WASD</span> move (camera-relative)</div>
          <div class="tutorial-row"><span class="key">SHIFT</span> dash (with i-frames)</div>
          <div class="tutorial-row"><span class="key">SPACE</span> jump</div>
          <div class="tutorial-row"><span class="key">J / LMB</span> disc-whip attack</div>
          <div class="tutorial-row"><span class="key">RMB drag</span> orbit camera</div>
          <div class="tutorial-row"><span class="key">Scroll</span> zoom in/out</div>
          <div class="tutorial-row"><span class="key">ESC / P</span> pause</div>
        </div>
        <div class="tutorial-mission">// mission: collect 9 fragments to challenge the master process</div>
        <div class="tutorial-cta">click or press any key to begin</div>
      </div>
    </div>
  {/if}

  {#if paused}
    <div class="pause-overlay">
      <div class="pause-title">PAUSED</div>
      <div class="pause-sub">ESC / P to resume</div>
    </div>
  {/if}

  {#if victory && victoryData}
    <div class="victory-overlay">
      <div class="victory-card">
        <div class="victory-title">VICTORY</div>
        <div class="victory-sub">// master process terminated</div>
        <div class="victory-stats">
          <div class="victory-row">
            <span class="vkey">SCORE</span>
            <span class="vval">{victoryData.score.toString().padStart(6, '0')}</span>
          </div>
          <div class="victory-row">
            <span class="vkey">FRAGMENTS</span>
            <span class="vval">{victoryData.fragments} / {victoryData.total}</span>
          </div>
          <div class="victory-row">
            <span class="vkey">TIME</span>
            <span class="vval">{formatTime(victoryData.time)}</span>
          </div>
        </div>
        <button class="victory-btn" onclick={restart}>PLAY AGAIN</button>
      </div>
    </div>
  {/if}

  {#if gameOver}
    <div class="game-over">
      <div class="game-over-title">SYSTEM HALTED</div>
      <div class="game-over-sub">the grid consumes another program</div>
      <button class="game-over-btn" onclick={restart}>REBOOT</button>
    </div>
  {/if}
</div>

<style>
  .hud {
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 10;
    color: var(--cyan);
    text-shadow: 0 0 8px var(--cyan);
  }
  .hud-label {
    font-size: 10px;
    letter-spacing: 2px;
    opacity: 0.6;
    margin-bottom: 4px;
  }
  .hud-value {
    font-size: 18px;
    letter-spacing: 1.5px;
    font-weight: bold;
  }
  .hud-value.big {
    font-size: 28px;
  }
  .hud-best {
    font-size: 10px;
    color: var(--green);
    text-shadow: 0 0 6px var(--green);
    letter-spacing: 1.5px;
    margin-top: 4px;
  }
  .hud-settings-btn {
    background: transparent;
    border: 1px solid var(--cyan);
    color: var(--cyan);
    width: 28px;
    height: 28px;
    margin-top: 6px;
    cursor: pointer;
    font-size: 14px;
    text-shadow: 0 0 6px var(--cyan);
    transition: all 0.2s ease;
  }
  .hud-settings-btn:hover {
    background: var(--cyan);
    color: black;
    text-shadow: none;
  }
  .hud-value.small {
    font-size: 12px;
    opacity: 0.8;
  }
  .hud-top-left, .hud-top-right, .hud-bottom-left, .hud-bottom-right, .hud-minimap, .hud-boss {
    position: absolute;
    padding: 12px 16px;
    background: rgba(0, 20, 30, 0.4);
    border: 1px solid rgba(0, 240, 255, 0.4);
    backdrop-filter: blur(2px);
  }
  .hud-top-left { top: 0; left: 0; }
  .hud-top-right { top: 0; right: 0; text-align: right; }
  .hud-bottom-left { bottom: 0; left: 0; min-width: 180px; }
  .hud-bottom-right { bottom: 0; right: 0; text-align: right; }
  .hud-minimap {
    bottom: 0;
    left: 220px;
  }
  .hud-minimap canvas {
    display: block;
    image-rendering: pixelated;
    background: rgba(0, 0, 0, 0.4);
  }
  .hud-boss {
    top: 100px;
    left: 0;
    min-width: 240px;
    border-color: var(--orange);
    color: var(--orange);
    text-shadow: 0 0 8px var(--orange);
  }

  .hp-bar {
    width: 200px;
    height: 8px;
    background: rgba(0, 240, 255, 0.15);
    border: 1px solid currentColor;
    margin-bottom: 4px;
    position: relative;
  }
  .hp-fill {
    height: 100%;
    transition: width 0.2s ease, background 0.2s ease;
    box-shadow: 0 0 8px currentColor;
  }

  .hud-lore {
    position: absolute;
    bottom: 100px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(0, 20, 30, 0.7);
    border: 1px solid var(--cyan);
    padding: 10px 18px;
    font-size: 13px;
    letter-spacing: 1px;
    max-width: 60vw;
    text-align: center;
    animation: lore-fade 0.3s ease;
  }
  @keyframes lore-fade {
    from { opacity: 0; transform: translate(-50%, 6px); }
    to   { opacity: 1; transform: translate(-50%, 0); }
  }

  .pause-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.55);
    backdrop-filter: blur(2px);
  }
  .settings-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.55);
    backdrop-filter: blur(2px);
    pointer-events: auto;
    animation: fade-in 0.2s ease;
  }
  .settings-card {
    border: 1px solid var(--cyan);
    background: rgba(0, 20, 30, 0.92);
    padding: 28px 40px;
    box-shadow: 0 0 32px rgba(0, 240, 255, 0.4);
    min-width: 360px;
  }
  .settings-title {
    font-size: 28px;
    color: var(--cyan);
    text-shadow: 0 0 16px var(--cyan);
    letter-spacing: 8px;
    margin-bottom: 20px;
    text-align: center;
  }
  .settings-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 0;
    border-bottom: 1px solid rgba(0, 240, 255, 0.12);
    font-size: 13px;
  }
  .settings-key {
    color: var(--magenta);
    text-shadow: 0 0 6px var(--magenta);
    letter-spacing: 2px;
    min-width: 100px;
  }
  .settings-val {
    color: var(--cyan);
    letter-spacing: 1px;
  }
  .volume-slider {
    flex: 1;
    margin: 0 12px;
    accent-color: var(--cyan);
    height: 4px;
  }
  .settings-actions {
    display: flex;
    gap: 12px;
    margin-top: 20px;
    justify-content: center;
  }
  .settings-btn {
    background: transparent;
    border: 1px solid var(--cyan);
    color: var(--cyan);
    padding: 8px 16px;
    font-family: inherit;
    font-size: 12px;
    letter-spacing: 2px;
    cursor: pointer;
    text-shadow: 0 0 6px var(--cyan);
    transition: all 0.2s ease;
  }
  .settings-btn:hover {
    background: var(--cyan);
    color: black;
    text-shadow: none;
  }
  .settings-hint {
    text-align: center;
    font-size: 10px;
    color: var(--cyan);
    opacity: 0.5;
    margin-top: 10px;
    letter-spacing: 2px;
  }
  .victory-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.7);
    backdrop-filter: blur(4px);
    pointer-events: auto;
    animation: fade-in 0.5s ease;
  }
  .victory-card {
    border: 1px solid var(--green);
    background: rgba(0, 20, 10, 0.85);
    padding: 36px 56px;
    box-shadow: 0 0 48px rgba(0, 255, 136, 0.5);
    text-align: center;
    min-width: 380px;
  }
  .victory-title {
    font-size: 64px;
    color: var(--green);
    text-shadow: 0 0 32px var(--green);
    letter-spacing: 12px;
    margin-bottom: 6px;
    animation: victory-glow 1.5s ease-in-out infinite;
  }
  @keyframes victory-glow {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.85; transform: scale(1.02); }
  }
  .victory-sub {
    font-size: 12px;
    color: var(--cyan);
    opacity: 0.7;
    letter-spacing: 4px;
    margin-bottom: 28px;
  }
  .victory-stats {
    text-align: left;
    margin-bottom: 28px;
  }
  .victory-row {
    display: flex;
    justify-content: space-between;
    padding: 8px 0;
    border-bottom: 1px solid rgba(0, 255, 136, 0.2);
    font-size: 16px;
  }
  .vkey {
    color: var(--cyan);
    letter-spacing: 2px;
  }
  .vval {
    color: var(--green);
    font-weight: bold;
    letter-spacing: 2px;
  }
  .victory-btn {
    background: transparent;
    color: var(--green);
    border: 2px solid var(--green);
    padding: 12px 32px;
    font-family: inherit;
    font-size: 16px;
    letter-spacing: 4px;
    cursor: pointer;
    text-shadow: 0 0 8px var(--green);
    box-shadow: 0 0 16px rgba(0, 255, 136, 0.3);
    transition: all 0.2s ease;
  }
  .victory-btn:hover {
    background: var(--green);
    color: black;
    text-shadow: none;
  }
  .tutorial-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.7);
    backdrop-filter: blur(4px);
    pointer-events: auto;
    animation: fade-in 0.5s ease;
  }
  @keyframes fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  .tutorial-card {
    border: 1px solid var(--cyan);
    background: rgba(0, 20, 30, 0.85);
    padding: 32px 48px;
    box-shadow: 0 0 32px rgba(0, 240, 255, 0.4);
    text-align: center;
    max-width: 540px;
  }
  .tutorial-title {
    font-size: 56px;
    color: var(--orange);
    text-shadow: 0 0 24px var(--orange);
    letter-spacing: 12px;
    margin-bottom: 4px;
  }
  .tutorial-sub {
    font-size: 11px;
    color: var(--cyan);
    opacity: 0.6;
    letter-spacing: 4px;
    margin-bottom: 24px;
  }
  .tutorial-grid {
    text-align: left;
    margin-bottom: 20px;
  }
  .tutorial-row {
    padding: 6px 0;
    font-size: 14px;
    letter-spacing: 1px;
  }
  .tutorial-row .key {
    display: inline-block;
    min-width: 90px;
    color: var(--magenta);
    text-shadow: 0 0 8px var(--magenta);
    font-weight: bold;
  }
  .tutorial-mission {
    font-size: 12px;
    color: var(--green);
    text-shadow: 0 0 8px var(--green);
    letter-spacing: 1px;
    margin-bottom: 16px;
  }
  .tutorial-cta {
    font-size: 11px;
    color: var(--cyan);
    opacity: 0.6;
    letter-spacing: 3px;
    animation: tutorial-blink 1.5s ease-in-out infinite;
  }
  @keyframes tutorial-blink {
    0%, 100% { opacity: 0.4; }
    50% { opacity: 1; }
  }
  .pause-title {
    font-size: 48px;
    color: var(--cyan);
    text-shadow: 0 0 24px var(--cyan);
    letter-spacing: 12px;
  }
  .pause-sub {
    font-size: 12px;
    color: var(--cyan);
    opacity: 0.6;
    margin-top: 12px;
    letter-spacing: 3px;
  }

  .game-over {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.7);
    pointer-events: auto;
  }
  .game-over-title {
    font-size: 64px;
    color: var(--magenta);
    text-shadow: 0 0 24px var(--magenta);
    letter-spacing: 8px;
    margin-bottom: 12px;
    animation: game-over-pulse 1.2s ease-in-out infinite;
  }
  @keyframes game-over-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.6; }
  }
  .game-over-sub {
    font-size: 14px;
    color: var(--cyan);
    opacity: 0.7;
    margin-bottom: 32px;
    letter-spacing: 3px;
  }
  .game-over-btn {
    background: transparent;
    color: var(--orange);
    border: 2px solid var(--orange);
    padding: 12px 32px;
    font-family: inherit;
    font-size: 18px;
    letter-spacing: 4px;
    cursor: pointer;
    text-shadow: 0 0 8px var(--orange);
    box-shadow: 0 0 16px rgba(255, 106, 0, 0.3);
    transition: all 0.2s ease;
  }
  .game-over-btn:hover {
    background: var(--orange);
    color: black;
    text-shadow: none;
  }
</style>
