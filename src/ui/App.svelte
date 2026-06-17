<script lang="ts">
// HUD overlay. Svelte 5 runes.
let score = $state(0);
let bestScore = $state(0);
let fragments = $state(0);
let fragmentsTotal = $state(0);
let hp = $state(6);
let hpMax = $state(6);
let sector = $state('GRID HUB');
let lore = $state<string | null>('W/S move · A/D orbit camera · SHIFT dash · SPACE jump · J/LMB disc-whip · RMB drag to orbit · collect FRAGMENTS to unlock gates');
let gameOver = $state(false);
let paused = $state(false);
let bossHp = $state(0);
let bossMax = $state(0);
let showTutorial = $state(true);
let victory = $state(false);
let victoryData = $state<{ score: number; fragments: number; total: number; time: number; bestScore: number } | null>(null);
let showSettings = $state(false);
let volume = $state(0.7);
let level = $state(1);
let showTransition = $state(false);
let transitionLabel = $state('');
// Shop
let showShop = $state(false);
let shopScore = $state(0);
// Achievements
let achievements = $state<string[]>([]);
let justUnlocked = $state<string | null>(null);
let justUnlockedName = $state('');
// Game over data
let gameOverScore = $state(0);
let gameOverLevel = $state(1);
let gameOverBest = $state(0);
// Name-entry modal
let askForName = $state(false);
let pendingName = $state('PROGRAMMER');
// Global leaderboard
let leaderboard = $state<{ rank: number; name: string; score: number; level: number; time: number; avatar?: string; country?: string }[]>([]);
let globalRank = $state<number | null>(null);
let leaderboardLabel = $state<string>('');   // 'GLOBAL' or 'LOCAL' depending on online/offline
let highScores = $state<{ name: string; score: number; level: number; time: number }[]>([]);
// Top-3 widget
let top3 = $state<{ rank: number; name: string; score: number; avatar?: string; country?: string }[]>([]);
// Leaderboard page (full overlay)
  let showLeaderboardPage = $state(false);
  let lbPeriod = $state<'all' | 'daily' | 'weekly'>('all');
  let lbRegion = $state<string>('');   // '' = all, otherwise NA/SA/EU/AS/OC/AF/AN
  let lbLoading = $state(false);
  let selectedAvatar = $state<string>('code');
  // Profile page (per-player)
  let showProfilePage = $state(false);
  let profileName = $state<string>('');
  let profile = $state<any>(null);
  let profileLoading = $state(false);
  // Flash overlay (white or red), used by setFlash
  let flashColor = $state<string | null>(null);
  let flashDuration = $state(0);
// Mobile
let isMobile = $state(false);
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
      setLevel: (n: number) => { level = n; },
      setTransition: (v: boolean, label?: string) => {
        showTransition = v;
        transitionLabel = label ?? '';
      },
      setFlash: (color: 'white' | 'red', duration = 0.9) => {
        flashColor = color;
        flashDuration = duration;
        setTimeout(() => {
          if (flashColor === color) { flashColor = null; }
        }, duration * 1000);
      },
      setShop: (v: boolean) => { showShop = v; shopScore = (window as any).__game?.score ?? 0; },
      setAchievements: (ids: string[]) => {
        // Show the latest newly unlocked
        const fresh = ids.filter(id => !achievements.includes(id));
        if (fresh.length > 0) {
          justUnlocked = fresh[fresh.length - 1];
        }
        achievements = ids;
      },
      setGameOverScore: (s: number, lv: number, best: number) => {
        gameOverScore = s;
        gameOverLevel = lv;
        gameOverBest = best;
      },
      setLeaderboard: (entries: any[], rank: number | null) => {
        leaderboard = entries || [];
        globalRank = rank;
        leaderboardLabel = rank ? 'GLOBAL' : 'LOCAL';
      },
      setTop3: (entries: any[]) => {
        top3 = (entries || []).slice(0, 3);
      },
      setLeaderboardPage: (v: boolean) => {
        showLeaderboardPage = v;
      },
      askForName: (defaultName: string) => {
        pendingName = defaultName || 'PROGRAMMER';
        askForName = true;
      },
      openProfile: (name: string) => {
        profileName = name;
        showProfilePage = true;
        showLeaderboardPage = false;
        profileLoading = true;
        (window as any).__game?.fetchProfile?.(name).then((p: any) => {
          profile = p;
          profileLoading = false;
        });
      },
      submitWithName: (name: string) => {
        (window as any).__game?.submitWithName(name);
        askForName = false;
      },
      skipName: () => {
        (window as any).__game?.submitWithName(pendingName);
        askForName = false;
      },
    };
    (window as any).__hud = api;
    return () => { /* keep global on unmount */ };
  });

  // Toggle settings with M key, leaderboard with L key
  function handleKeydown(e: KeyboardEvent) {
    if (e.code === 'KeyM' && !(window as any).__game?.gameOver) {
      showSettings = !showSettings;
    }
    if (e.code === 'KeyL' && !(window as any).__game?.gameOver) {
      showLeaderboardPage = !showLeaderboardPage;
      if (showLeaderboardPage) (window as any).__game?.openLeaderboardPage?.(lbPeriod);
    }
  }
  $effect(() => {
    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  });

  // Volume slider: change real-time
  $effect(() => {
    // Detect mobile
    isMobile = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    return () => {};
  });

  function onVolumeChange(e: Event) {
    const v = parseFloat((e.target as HTMLInputElement).value);
    volume = v;
    const g = (window as any).__game;
    if (g) g.setVolume(v);
  }

  // Reset run
  function resetRun() {
    try { localStorage.removeItem('neongrid:fragments'); } catch {}
    try { localStorage.removeItem('neongrid:run'); } catch {}
    try { localStorage.removeItem('neongrid:high'); } catch {}
    location.reload();
  }

  // Shop actions
  function buyHp()    { (window as any).__game?.buyUpgrade('hp');    shopScore = (window as any).__game?.score ?? 0; }
  function buyDash()  { (window as any).__game?.buyUpgrade('dash');  shopScore = (window as any).__game?.score ?? 0; }
  function buyAtk()   { (window as any).__game?.buyUpgrade('attack'); shopScore = (window as any).__game?.score ?? 0; }
  function buySpeed() { (window as any).__game?.buyUpgrade('speed'); shopScore = (window as any).__game?.score ?? 0; }
  function closeShopNow() {
    showShop = false;
    (window as any).__game?.closeShop?.();
  }

  // Achievements list: load from localStorage on mount
  function loadHighScores() {
    try {
      const raw = localStorage.getItem('neongrid:high');
      if (raw) highScores = JSON.parse(raw);
    } catch {}
  }
  $effect(() => { loadHighScores(); });

  function respawn() {
    (window as any).__game?.respawn?.();
  }
  function formatTimeShort(s: number) {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  }

  // Mobile input injection
  function mobiPress(code: string) {
    (window as any).__game?.input?.press?.(code);
  }
  function mobiRelease(code: string) {
    (window as any).__game?.input?.release?.(code);
  }
  function mobiClick() { (window as any).__game?.input?.attackEdge?.(); }
  function mobiDash()  { (window as any).__game?.input?.dashEdge?.(); }
  function mobiJump()  { (window as any).__game?.input?.jumpEdge?.(); }

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
    <div class="hud-level">LEVEL {level.toString().padStart(2, '0')}</div>
  </div>

  <div class="hud-top-right">
    <div class="hud-minimap-vert">
      <div class="hud-label">MAP</div>
      <canvas bind:this={minimapCanvas} width="160" height="160"></canvas>
    </div>
    <div class="hud-top-right-stack">
      <div class="hud-label">SCORE</div>
      <div class="hud-value big">{score.toString().padStart(6, '0')}</div>
      {#if bestScore > 0}
        <div class="hud-best">BEST {bestScore.toString().padStart(6, '0')}</div>
      {/if}
      <button class="hud-settings-btn" onclick={() => showSettings = !showSettings} title="Settings (M)">⚙</button>
      <button class="hud-lb-btn" onclick={() => (window as any).__hud?.setLeaderboardPage(true)} title="Leaderboard (L)">★</button>
    </div>
  </div>

  {#if top3.length > 0 && !gameOver && !showShop && !showTransition}
    <div class="top3-widget">
      <div class="top3-title">// TOP 3 //</div>
      {#each top3 as entry}
        <div class="top3-row">
          <span class="top3-rank">#{entry.rank}</span>
          <span class="top3-avatar avatar-{entry.avatar || 'code'}"></span>
          <span class="top3-name">{entry.name}</span>
          <span class="top3-score">{entry.score.toString().padStart(6, '0')}</span>
        </div>
      {/each}
    </div>
  {/if}

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

  {#if showLeaderboardPage}
    <div class="lb-overlay" onclick={() => showLeaderboardPage = false} role="presentation">
      <div class="lb-card" onclick={(e) => e.stopPropagation()} role="presentation">
        <div class="lb-title">// GLOBAL LEADERBOARD //</div>
        <div class="lb-period">
          <button class="lb-period-btn" class:active={lbPeriod === 'all'}    onclick={() => { lbPeriod = 'all';    (window as any).__game?.openLeaderboardPage('all', { region: lbRegion }); }}>ALL TIME</button>
          <button class="lb-period-btn" class:active={lbPeriod === 'daily'}  onclick={() => { lbPeriod = 'daily';  (window as any).__game?.openLeaderboardPage('daily', { region: lbRegion }); }}>TODAY</button>
          <button class="lb-period-btn" class:active={lbPeriod === 'weekly'} onclick={() => { lbPeriod = 'weekly'; (window as any).__game?.openLeaderboardPage('weekly', { region: lbRegion }); }}>THIS WEEK</button>
        </div>
        <div class="lb-region">
          <span class="lb-region-label">REGION</span>
          {#each ['', 'NA', 'SA', 'EU', 'AS', 'OC', 'AF'] as r}
            <button class="lb-region-btn" class:active={lbRegion === r} onclick={() => { lbRegion = r; (window as any).__game?.openLeaderboardPage(lbPeriod, { region: r }); }}>{r || 'ALL'}</button>
          {/each}
        </div>
        <div class="lb-avatar-pick">
          <span class="lb-avatar-label">YOUR AVATAR</span>
          {#each ['code', 'glitch', 'shard', 'circuit', 'kernel'] as a}
            <button class="lb-avatar-btn avatar-{a}" class:active={selectedAvatar === a}
              onclick={() => { selectedAvatar = a; (window as any).__game?.setAvatar(a); }}
              title={a}></button>
          {/each}
        </div>
        {#if leaderboard.length > 0}
          <div class="lb-list">
            {#each leaderboard.slice(0, 20) as entry}
              <div class="lb-row" class:lb-row-you={globalRank !== null && entry.rank === globalRank}>
                <span class="lb-rank">#{entry.rank}</span>
                <span class="lb-avatar-mini avatar-{entry.avatar || 'code'}"></span>
                <button class="lb-name lb-name-btn" onclick={() => (window as any).__hud?.openProfile(entry.name)}>{entry.name}</button>
                <span class="lb-score">{entry.score.toString().padStart(7, '0')}</span>
                <span class="lb-lv">L{entry.level.toString().padStart(2, '0')}</span>
                <span class="lb-time">{formatTimeShort(entry.time)}</span>
                <span class="lb-country">{entry.country || '??'}</span>
              </div>
            {/each}
          </div>
        {:else}
          <div class="lb-empty">// no scores in this period //</div>
        {/if}
        <div class="lb-actions">
          <button class="lb-btn" onclick={() => showLeaderboardPage = false}>CLOSE</button>
        </div>
        <div class="lb-hint">press L to toggle · click a name to view profile</div>
      </div>
    </div>
  {/if}

  {#if showProfilePage}
    <div class="profile-overlay" onclick={() => showProfilePage = false} role="presentation">
      <div class="profile-card" onclick={(e) => e.stopPropagation()} role="presentation">
        <div class="profile-title">// PLAYER PROFILE //</div>
        <div class="profile-name">{profileName}</div>
        {#if profileLoading}
          <div class="profile-loading">// loading... //</div>
        {:else if profile}
          <div class="profile-stats">
            <div class="profile-stat">
              <span class="profile-stat-label">BEST</span>
              <span class="profile-stat-value">{profile.best?.toString().padStart(7, '0') ?? '0'}</span>
            </div>
            <div class="profile-stat">
              <span class="profile-stat-label">RUNS</span>
              <span class="profile-stat-value">{profile.runs ?? 0}</span>
            </div>
            <div class="profile-stat">
              <span class="profile-stat-label">TIME</span>
              <span class="profile-stat-value">{formatTimeShort(profile.totalTime ?? 0)}</span>
            </div>
            <div class="profile-stat">
              <span class="profile-stat-label">COUNTRY</span>
              <span class="profile-stat-value">{profile.country || '??'}</span>
            </div>
          </div>
          <div class="profile-history-label">// LAST {profile.history?.length ?? 0} RUNS //</div>
          {#if profile.history && profile.history.length > 0}
            <div class="profile-history">
              {#each profile.history.slice(0, 20) as h}
                <div class="profile-history-row">
                  <span class="ph-score">{h.score?.toString().padStart(7, '0') ?? '0'}</span>
                  <span class="ph-lv">L{h.level?.toString().padStart(2, '0') ?? '00'}</span>
                  <span class="ph-time">{formatTimeShort(h.time ?? 0)}</span>
                  <span class="ph-when">{new Date(h.when ?? 0).toLocaleDateString()}</span>
                  <span class="ph-avatar avatar-{h.avatar || 'code'}"></span>
                </div>
              {/each}
            </div>
          {:else}
            <div class="profile-empty">// no runs found //</div>
          {/if}
          <div class="profile-actions">
            <button class="profile-btn" onclick={() => { lbPeriod = 'all'; (window as any).__game?.openLeaderboardPage('all', { name: profileName }); showProfilePage = false; showLeaderboardPage = true; }}>VIEW RANKS</button>
            <button class="profile-btn" onclick={() => showProfilePage = false}>CLOSE</button>
          </div>
        {:else}
          <div class="profile-empty">// player not found //</div>
          <div class="profile-actions">
            <button class="profile-btn" onclick={() => showProfilePage = false}>CLOSE</button>
          </div>
        {/if}
      </div>
    </div>
  {/if}

  {#if askForName}
    <div class="name-overlay">
      <div class="name-card">
        <div class="name-title">// IDENTIFY YOURSELF //</div>
        <div class="name-sub">enter your handle for the leaderboard</div>
        <input
          class="name-input"
          type="text"
          maxlength="16"
          value={pendingName}
          oninput={(e) => pendingName = (e.target as HTMLInputElement).value}
          onkeydown={(e) => { if (e.key === 'Enter') { (window as any).__hud?.submitWithName(pendingName); askForName = false; } }}
          placeholder="PROGRAMMER"
        />
        <div class="name-hint">A-Z 0-9 _ - · 1-16 chars</div>
        <div class="name-actions">
          <button class="name-btn primary" onclick={() => { (window as any).__hud?.submitWithName(pendingName); askForName = false; }}>CONFIRM</button>
          <button class="name-btn" onclick={() => { (window as any).__hud?.skipName(); }}>SKIP</button>
        </div>
      </div>
    </div>
  {/if}

  {#if showTransition}
    <div class="transition-overlay">
      <div class="transition-label">{transitionLabel}</div>
      <div class="transition-sub">// reinitializing grid //</div>
    </div>
  {/if}

  {#if flashColor}
    <div class="flash-overlay flash-{flashColor}"></div>
  {/if}

  {#if showShop}
    <div class="shop-overlay">
      <div class="shop-title">SHOP</div>
      <div class="shop-score">SCORE: {shopScore}</div>
      <div class="shop-grid">
        <button class="shop-item" onclick={buyHp}>
          <div class="shop-icon">♥</div>
          <div class="shop-name">+1 HP</div>
          <div class="shop-cost">2000</div>
        </button>
        <button class="shop-item" onclick={buyDash}>
          <div class="shop-icon">≫</div>
          <div class="shop-name">DASH CD</div>
          <div class="shop-cost">1000</div>
        </button>
        <button class="shop-item" onclick={buyAtk}>
          <div class="shop-icon">✦</div>
          <div class="shop-name">ATTACK</div>
          <div class="shop-cost">1000</div>
        </button>
        <button class="shop-item" onclick={buySpeed}>
          <div class="shop-icon">»</div>
          <div class="shop-name">SPEED</div>
          <div class="shop-cost">1000</div>
        </button>
      </div>
      <button class="shop-close" onclick={closeShopNow}>CONTINUE</button>
    </div>
  {/if}

  {#if justUnlocked}
    <div class="ach-popup" role="alert">
      <div class="ach-icon">★</div>
      <div class="ach-name">{justUnlocked.replace(/_/g, ' ').toUpperCase()}</div>
      <div class="ach-sub">ACHIEVEMENT UNLOCKED</div>
    </div>
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
          <span class="settings-val">A/D · Q/E · R/F · RMB · Scroll</span>
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
          <div class="tutorial-row"><span class="key">W / S</span> move forward / back (cam-relative)</div>
          <div class="tutorial-row"><span class="key">A / D</span> orbit camera (LEFT / RIGHT) — hero never moves</div>
          <div class="tutorial-row"><span class="key">W + A</span> walk forward while looking left (combined)</div>
          <div class="tutorial-row"><span class="key">Q / E</span> orbit camera (alias)</div>
          <div class="tutorial-row"><span class="key">R / F</span> tilt camera up/down</div>
          <div class="tutorial-row"><span class="key">SHIFT</span> dash (with i-frames)</div>
          <div class="tutorial-row"><span class="key">SPACE</span> jump</div>
          <div class="tutorial-row"><span class="key">J / LMB</span> disc-whip attack</div>
          <div class="tutorial-row"><span class="key">RMB drag</span> orbit camera (mouse)</div>
          <div class="tutorial-row"><span class="key">Scroll</span> zoom in/out</div>
          <div class="tutorial-row"><span class="key">ESC / P</span> pause · M settings</div>
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

  {#if isMobile && !showTutorial && !showSettings && !showShop && !showTransition && !gameOver && !victory}
    <div class="mobile-controls">
      <div class="dpad">
        <button class="dpad-btn"
          onpointerdown={() => mobiPress('KeyW')} onpointerup={() => mobiRelease('KeyW')}
          onpointerleave={() => mobiRelease('KeyW')}>↑</button>
        <button class="dpad-btn"
          onpointerdown={() => mobiPress('KeyA')} onpointerup={() => mobiRelease('KeyA')}
          onpointerleave={() => mobiRelease('KeyA')}>←</button>
        <button class="dpad-btn"
          onpointerdown={() => mobiPress('KeyS')} onpointerup={() => mobiRelease('KeyS')}
          onpointerleave={() => mobiRelease('KeyS')}>↓</button>
        <button class="dpad-btn"
          onpointerdown={() => mobiPress('KeyD')} onpointerup={() => mobiRelease('KeyD')}
          onpointerleave={() => mobiRelease('KeyD')}>→</button>
      </div>
      <div class="action-buttons">
        <button class="action-btn" onpointerdown={() => mobiJump()}>⤴</button>
        <button class="action-btn" onpointerdown={() => mobiDash()}>≫</button>
        <button class="action-btn attack" onpointerdown={() => mobiClick()}>✦</button>
      </div>
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
    <div class="gameover-overlay">
      <div class="gameover-title">SYSTEM HALTED</div>
      <div class="gameover-sub">// the grid consumes another program //</div>
      <div class="gameover-stats">
        <div class="gameover-stat"><span>SCORE</span><strong>{gameOverScore.toString().padStart(6, '0')}</strong></div>
        <div class="gameover-stat"><span>LEVEL</span><strong>{gameOverLevel.toString().padStart(2, '0')}</strong></div>
        <div class="gameover-stat"><span>BEST</span><strong>{gameOverBest.toString().padStart(6, '0')}</strong></div>
      </div>
      {#if leaderboard.length > 0}
        <div class="high-scores">
          <div class="hs-title">
            // {leaderboardLabel} TOP {Math.min(leaderboard.length, 10)} //
            {#if globalRank !== null}
              <span class="hs-your-rank">YOUR RANK: #{globalRank}</span>
            {/if}
          </div>
          {#each leaderboard.slice(0, 10) as entry}
            <div class="hs-row" class:hs-row-you={globalRank !== null && entry.rank === globalRank}>
              <span class="hs-rank">#{entry.rank}</span>
              <span class="hs-name">{entry.name}</span>
              <span class="hs-score">{entry.score.toString().padStart(6, '0')}</span>
              <span class="hs-lv">L{entry.level.toString().padStart(2, '0')}</span>
              <span class="hs-time">{formatTimeShort(entry.time)}</span>
            </div>
          {/each}
        </div>
      {/if}
      <div class="gameover-actions">
        <button class="gameover-btn" onclick={respawn}>RESPAWN</button>
        <button class="gameover-btn" onclick={resetRun}>REBOOT</button>
      </div>
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
  .hud-level {
    font-size: 10px;
    color: var(--orange);
    text-shadow: 0 0 6px var(--orange);
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
  .hud-lb-btn {
    background: rgba(255, 106, 0, 0.12);
    border: 1px solid var(--orange);
    color: var(--orange);
    width: 28px;
    height: 28px;
    margin-top: 4px;
    cursor: pointer;
    font-size: 14px;
    text-shadow: 0 0 6px var(--orange);
    transition: all 0.2s ease;
  }
  .hud-lb-btn:hover { background: var(--orange); color: black; text-shadow: none; }

  /* ─── Top-3 widget ─────────────────────────────────────────────────── */
  .top3-widget {
    position: absolute;
    left: 220px;
    top: 192px;
    min-width: 220px;
    padding: 8px 12px;
    background: rgba(0, 20, 30, 0.4);
    border: 1px solid rgba(0, 240, 255, 0.3);
    backdrop-filter: blur(2px);
    font-size: 10px;
    letter-spacing: 1px;
  }
  .top3-title {
    color: var(--cyan);
    text-shadow: 0 0 6px var(--cyan);
    margin-bottom: 6px;
  }
  .top3-row {
    display: grid;
    grid-template-columns: 24px 18px 1fr 60px;
    align-items: center;
    gap: 6px;
    padding: 2px 0;
  }
  .top3-rank { color: var(--magenta); }
  .top3-name { color: var(--cyan); overflow: hidden; text-overflow: ellipsis; }
  .top3-score { color: var(--orange); text-align: right; text-shadow: 0 0 6px var(--orange); }
  /* Avatars (small) — CSS-only mini-icons */
  .top3-avatar, .lb-avatar-mini, .lb-avatar-btn {
    display: inline-block;
    width: 16px;
    height: 16px;
    border: 1px solid currentColor;
    background-size: cover;
    image-rendering: pixelated;
  }
  .lb-avatar-btn {
    width: 28px;
    height: 28px;
    cursor: pointer;
    background: transparent;
    transition: all 0.2s ease;
  }
  .lb-avatar-btn.active { border-width: 2px; box-shadow: 0 0 12px currentColor; transform: scale(1.1); }
  /* Avatar variants: pure CSS sprites */
  .avatar-code {
    background: linear-gradient(135deg, #00f0ff 0%, #00f0ff 50%, #000 50%, #000 100%);
  }
  .avatar-glitch {
    background:
      linear-gradient(0deg, transparent 48%, #ff00aa 48%, #ff00aa 52%, transparent 52%),
      linear-gradient(90deg, transparent 48%, #ff6a00 48%, #ff6a00 52%, transparent 52%),
      #000;
  }
  .avatar-shard {
    background: conic-gradient(from 45deg, #00f0ff, #ff00aa, #ff6a00, #00ff88, #00f0ff);
  }
  .avatar-circuit {
    background:
      linear-gradient(0deg, transparent 40%, #00f0ff 40%, #00f0ff 60%, transparent 60%),
      linear-gradient(90deg, transparent 40%, #00f0ff 40%, #00f0ff 60%, transparent 60%),
      #000;
    border: 1px solid #00f0ff;
  }
  .avatar-kernel {
    background: radial-gradient(circle, #ff00aa 30%, transparent 30%),
                radial-gradient(circle, #00f0ff 60%, transparent 60%),
                #000;
  }

  /* ─── Leaderboard page overlay ─────────────────────────────────────── */
  .lb-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.78);
    backdrop-filter: blur(4px);
    pointer-events: auto;
    z-index: 30;
    animation: fade-in 0.3s ease;
  }
  .lb-card {
    border: 1px solid var(--cyan);
    background: rgba(0, 20, 30, 0.95);
    padding: 22px 28px;
    box-shadow: 0 0 32px var(--cyan);
    min-width: 580px;
    max-width: 720px;
    max-height: 84vh;
    overflow-y: auto;
  }
  .lb-title {
    font-size: 22px;
    color: var(--cyan);
    text-shadow: 0 0 12px var(--cyan);
    letter-spacing: 6px;
    margin-bottom: 12px;
    text-align: center;
  }
  .lb-period { display: flex; gap: 8px; justify-content: center; margin-bottom: 16px; }
  .lb-period-btn {
    background: transparent;
    border: 1px solid var(--cyan);
    color: var(--cyan);
    padding: 6px 14px;
    font-family: inherit;
    font-size: 11px;
    letter-spacing: 3px;
    cursor: pointer;
  }
  .lb-period-btn:hover { background: rgba(0, 240, 255, 0.18); }
  .lb-period-btn.active {
    background: var(--cyan);
    color: black;
    text-shadow: none;
  }
  .lb-avatar-pick {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px;
    border: 1px solid rgba(255, 106, 0, 0.3);
    margin-bottom: 12px;
    justify-content: center;
  }
  .lb-avatar-label {
    color: var(--orange);
    font-size: 10px;
    letter-spacing: 2px;
    text-shadow: 0 0 6px var(--orange);
  }
  .lb-list { margin-bottom: 12px; }
  .lb-row {
    display: grid;
    grid-template-columns: 32px 18px 1fr 80px 36px 56px 32px;
    align-items: center;
    gap: 6px;
    padding: 3px 0;
    font-size: 11px;
    letter-spacing: 1px;
  }
  .lb-row-you {
    background: rgba(255, 106, 0, 0.18);
    border: 1px solid var(--orange);
    padding: 3px 6px;
  }
  .lb-rank { color: var(--magenta); }
  .lb-name { color: var(--cyan); overflow: hidden; text-overflow: ellipsis; }
  .lb-score { color: var(--orange); text-align: right; text-shadow: 0 0 6px var(--orange); }
  .lb-lv, .lb-time { color: rgba(0, 240, 255, 0.7); text-align: center; }
  .lb-country { color: var(--green); text-align: center; opacity: 0.7; }
  .lb-empty { text-align: center; color: rgba(0, 240, 255, 0.5); padding: 40px 0; }
  .lb-actions { text-align: center; margin-top: 12px; }
  .lb-btn {
    background: transparent;
    border: 1px solid var(--cyan);
    color: var(--cyan);
    padding: 8px 30px;
    font-family: inherit;
    font-size: 12px;
    letter-spacing: 4px;
    cursor: pointer;
  }
  .lb-btn:hover { background: var(--cyan); color: black; }
  .lb-hint { text-align: center; font-size: 9px; color: rgba(0, 240, 255, 0.5); margin-top: 8px; }
  .lb-region { display: flex; gap: 4px; align-items: center; justify-content: center; margin-bottom: 12px; flex-wrap: wrap; }
  .lb-region-label {
    color: var(--green);
    font-size: 9px;
    letter-spacing: 2px;
    text-shadow: 0 0 6px var(--green);
    margin-right: 6px;
  }
  .lb-region-btn {
    background: transparent;
    border: 1px solid var(--green);
    color: var(--green);
    padding: 4px 10px;
    font-family: inherit;
    font-size: 10px;
    letter-spacing: 2px;
    cursor: pointer;
  }
  .lb-region-btn:hover { background: rgba(0, 255, 136, 0.18); }
  .lb-region-btn.active { background: var(--green); color: black; text-shadow: none; }
  .lb-name-btn {
    background: transparent;
    border: none;
    color: var(--cyan);
    text-align: left;
    cursor: pointer;
    text-decoration: none;
    font-family: inherit;
    padding: 0;
  }
  .lb-name-btn:hover { color: var(--orange); text-decoration: underline; }

  /* ─── Profile page overlay ───────────────────────────────────────────── */
  .profile-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.78);
    backdrop-filter: blur(4px);
    pointer-events: auto;
    z-index: 31;
    animation: fade-in 0.3s ease;
  }
  .profile-card {
    border: 1px solid var(--green);
    background: rgba(0, 20, 30, 0.95);
    padding: 22px 28px;
    box-shadow: 0 0 32px var(--green);
    min-width: 540px;
    max-width: 680px;
    max-height: 84vh;
    overflow-y: auto;
  }
  .profile-title {
    font-size: 20px;
    color: var(--green);
    text-shadow: 0 0 12px var(--green);
    letter-spacing: 6px;
    margin-bottom: 6px;
    text-align: center;
  }
  .profile-name {
    font-size: 28px;
    color: var(--orange);
    text-shadow: 0 0 16px var(--orange);
    letter-spacing: 8px;
    text-align: center;
    margin-bottom: 18px;
  }
  .profile-stats {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
    margin-bottom: 16px;
  }
  .profile-stat {
    border: 1px solid var(--green);
    padding: 8px;
    text-align: center;
    background: rgba(0, 255, 136, 0.06);
  }
  .profile-stat-label {
    display: block;
    font-size: 9px;
    color: var(--green);
    letter-spacing: 2px;
    text-shadow: 0 0 4px var(--green);
  }
  .profile-stat-value {
    display: block;
    font-size: 16px;
    color: var(--cyan);
    text-shadow: 0 0 6px var(--cyan);
    margin-top: 2px;
  }
  .profile-history-label {
    font-size: 10px;
    color: var(--cyan);
    letter-spacing: 2px;
    text-shadow: 0 0 6px var(--cyan);
    margin-bottom: 8px;
    text-align: center;
  }
  .profile-history { margin-bottom: 14px; }
  .profile-history-row {
    display: grid;
    grid-template-columns: 80px 32px 60px 100px 18px;
    gap: 6px;
    padding: 3px 0;
    font-size: 11px;
    letter-spacing: 1px;
  }
  .ph-score { color: var(--orange); text-align: right; text-shadow: 0 0 6px var(--orange); }
  .ph-lv { color: var(--cyan); text-align: center; }
  .ph-time { color: var(--cyan); opacity: 0.7; text-align: center; }
  .ph-when { color: rgba(0, 240, 255, 0.6); text-align: center; }
  .profile-actions { text-align: center; margin-top: 14px; display: flex; gap: 10px; justify-content: center; }
  .profile-btn {
    background: transparent;
    border: 1px solid var(--green);
    color: var(--green);
    padding: 8px 22px;
    font-family: inherit;
    font-size: 12px;
    letter-spacing: 4px;
    cursor: pointer;
  }
  .profile-btn:hover { background: var(--green); color: black; }
  .profile-loading, .profile-empty {
    text-align: center;
    color: rgba(0, 240, 255, 0.6);
    padding: 24px 0;
  }
  .hud-value.small {
    font-size: 12px;
    opacity: 0.8;
  }
  .hud-top-left, .hud-top-right, .hud-bottom-left, .hud-bottom-right, .hud-boss {
    position: absolute;
    padding: 12px 16px;
    background: rgba(0, 20, 30, 0.4);
    border: 1px solid rgba(0, 240, 255, 0.4);
    backdrop-filter: blur(2px);
  }
  .hud-top-left { top: 0; left: 0; }
  .hud-top-right {
    top: 0;
    right: 0;
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 0;
    background: transparent;
    border: none;
    backdrop-filter: none;
  }
  .hud-top-right .hud-minimap-vert {
    padding: 12px 16px;
    background: rgba(0, 20, 30, 0.4);
    border: 1px solid rgba(0, 240, 255, 0.4);
    backdrop-filter: blur(2px);
  }
  .hud-top-right .hud-minimap-vert canvas {
    display: block;
    image-rendering: pixelated;
    background: rgba(0, 0, 0, 0.4);
  }
  .hud-top-right .hud-top-right-stack {
    padding: 12px 16px;
    background: rgba(0, 20, 30, 0.4);
    border: 1px solid rgba(0, 240, 255, 0.4);
    backdrop-filter: blur(2px);
    text-align: right;
    min-width: 160px;
  }
  .hud-bottom-left { bottom: 0; left: 0; min-width: 220px; }
  .hud-bottom-right { bottom: 0; right: 0; text-align: right; }
  .hud-boss {
    top: 220px;
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
  .name-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.7);
    backdrop-filter: blur(3px);
    pointer-events: auto;
    z-index: 30;
    animation: fade-in 0.3s ease;
  }
  .name-card {
    border: 1px solid var(--orange);
    background: rgba(0, 20, 30, 0.95);
    padding: 28px 36px;
    box-shadow: 0 0 32px var(--orange);
    min-width: 360px;
    text-align: center;
  }
  .name-title {
    font-size: 22px;
    color: var(--orange);
    text-shadow: 0 0 12px var(--orange);
    letter-spacing: 6px;
    margin-bottom: 6px;
  }
  .name-sub {
    font-size: 11px;
    color: var(--cyan);
    opacity: 0.7;
    letter-spacing: 2px;
    margin-bottom: 16px;
  }
  .name-input {
    width: 100%;
    background: rgba(0, 240, 255, 0.08);
    border: 1px solid var(--cyan);
    color: var(--cyan);
    font: 20px 'Share Tech Mono', monospace;
    padding: 10px 14px;
    text-align: center;
    letter-spacing: 4px;
    text-shadow: 0 0 8px var(--cyan);
    outline: none;
  }
  .name-input:focus {
    background: rgba(0, 240, 255, 0.18);
    box-shadow: 0 0 16px var(--cyan);
  }
  .name-input::placeholder { color: rgba(0, 240, 255, 0.4); }
  .name-hint {
    font-size: 9px;
    color: var(--cyan);
    opacity: 0.5;
    letter-spacing: 2px;
    margin: 6px 0 16px;
  }
  .name-actions { display: flex; gap: 12px; justify-content: center; }
  .name-btn {
    background: transparent;
    border: 1px solid var(--cyan);
    color: var(--cyan);
    padding: 8px 24px;
    font-family: inherit;
    font-size: 12px;
    letter-spacing: 4px;
    cursor: pointer;
    text-shadow: 0 0 6px var(--cyan);
  }
  .name-btn:hover { background: var(--cyan); color: black; text-shadow: none; }
  .name-btn.primary {
    border-color: var(--orange);
    color: var(--orange);
    text-shadow: 0 0 6px var(--orange);
  }
  .name-btn.primary:hover { background: var(--orange); color: black; }
  .transition-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.85);
    backdrop-filter: blur(4px);
    pointer-events: auto;
    z-index: 20;
    animation: fade-in 0.3s ease;
  }
  .transition-label {
    font-size: 64px;
    color: var(--orange);
    text-shadow: 0 0 32px var(--orange);
    letter-spacing: 12px;
    margin-bottom: 8px;
    animation: transition-pulse 0.9s ease-in-out infinite;
  }
  @keyframes transition-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }
  .transition-sub {
    font-size: 12px;
    color: var(--cyan);
    opacity: 0.7;
    letter-spacing: 4px;
  }
  .flash-overlay {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 60;
    animation: flash-fade ease-out forwards;
    animation-duration: inherit;
  }
  .flash-white {
    background: rgba(255, 255, 255, 0.85);
    box-shadow: inset 0 0 120px rgba(255, 255, 255, 0.9);
    animation-name: flash-fade-white;
  }
  .flash-red {
    background: rgba(255, 34, 85, 0.7);
    box-shadow: inset 0 0 80px rgba(255, 34, 85, 0.8);
    animation-name: flash-fade-red;
  }
  @keyframes flash-fade-white {
    0%   { opacity: 0.95; }
    20%  { opacity: 0.85; }
    100% { opacity: 0; }
  }
  @keyframes flash-fade-red {
    0%   { opacity: 0.9; }
    30%  { opacity: 0.6; }
    100% { opacity: 0; }
  }
  .shop-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.85);
    backdrop-filter: blur(4px);
    pointer-events: auto;
    z-index: 20;
    animation: fade-in 0.3s ease;
  }
  .shop-title {
    font-size: 56px;
    color: var(--orange);
    text-shadow: 0 0 24px var(--orange);
    letter-spacing: 12px;
    margin-bottom: 8px;
  }
  .shop-score {
    font-size: 16px;
    color: var(--green);
    text-shadow: 0 0 8px var(--green);
    margin-bottom: 24px;
  }
  .shop-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 12px;
    margin-bottom: 24px;
  }
  .shop-item {
    background: rgba(0, 240, 255, 0.08);
    border: 1px solid var(--cyan);
    color: var(--cyan);
    padding: 18px 24px;
    min-width: 140px;
    cursor: pointer;
    font-family: inherit;
    transition: all 0.2s ease;
  }
  .shop-item:hover { background: var(--cyan); color: black; }
  .shop-icon { font-size: 32px; margin-bottom: 6px; }
  .shop-name { font-size: 14px; letter-spacing: 2px; }
  .shop-cost { font-size: 11px; opacity: 0.8; margin-top: 4px; }
  .shop-close {
    background: transparent;
    border: 1px solid var(--green);
    color: var(--green);
    padding: 10px 30px;
    font-family: inherit;
    font-size: 13px;
    letter-spacing: 4px;
    cursor: pointer;
    text-shadow: 0 0 6px var(--green);
  }
  .shop-close:hover { background: var(--green); color: black; text-shadow: none; }
  .ach-popup {
    position: absolute;
    top: 80px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(0, 0, 0, 0.9);
    border: 1px solid var(--orange);
    padding: 12px 24px;
    text-align: center;
    z-index: 30;
    box-shadow: 0 0 24px var(--orange);
    animation: ach-slide 3s ease forwards;
  }
  @keyframes ach-slide {
    0%   { opacity: 0; transform: translateX(-50%) translateY(-20px); }
    10%  { opacity: 1; transform: translateX(-50%) translateY(0); }
    90%  { opacity: 1; }
    100% { opacity: 0; transform: translateX(-50%) translateY(-20px); }
  }
  .ach-icon { font-size: 28px; color: var(--orange); }
  .ach-name { font-size: 18px; color: var(--orange); text-shadow: 0 0 12px var(--orange); letter-spacing: 4px; }
  .ach-sub { font-size: 10px; color: var(--cyan); letter-spacing: 3px; }
  .gameover-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.85);
    backdrop-filter: blur(4px);
    pointer-events: auto;
    z-index: 25;
    padding: 20px;
  }
  .gameover-title {
    font-size: 56px;
    color: var(--red);
    text-shadow: 0 0 32px var(--red);
    letter-spacing: 12px;
    margin-bottom: 8px;
  }
  .gameover-sub {
    font-size: 12px;
    color: var(--cyan);
    opacity: 0.7;
    letter-spacing: 3px;
    margin-bottom: 20px;
  }
  .gameover-stats {
    display: flex;
    gap: 24px;
    margin-bottom: 24px;
  }
  .gameover-stat {
    text-align: center;
    border: 1px solid var(--cyan);
    padding: 12px 20px;
    background: rgba(0, 20, 30, 0.5);
    min-width: 120px;
  }
  .gameover-stat span {
    display: block;
    font-size: 10px;
    color: var(--cyan);
    letter-spacing: 2px;
    margin-bottom: 4px;
  }
  .gameover-stat strong {
    display: block;
    font-size: 22px;
    color: var(--orange);
    text-shadow: 0 0 8px var(--orange);
  }
  .high-scores {
    border: 1px solid var(--green);
    padding: 12px 16px;
    background: rgba(0, 30, 20, 0.5);
    margin-bottom: 20px;
    max-width: 480px;
    width: 100%;
  }
  .hs-title {
    font-size: 11px;
    color: var(--green);
    text-shadow: 0 0 6px var(--green);
    letter-spacing: 3px;
    margin-bottom: 8px;
    text-align: center;
  }
  .hs-row {
    display: grid;
    grid-template-columns: 30px 1fr 90px 50px 60px;
    gap: 8px;
    padding: 4px 0;
    font-size: 12px;
    color: var(--cyan);
    align-items: center;
  }
  .hs-rank { color: var(--magenta); }
  .hs-score { text-align: right; color: var(--orange); }
  .hs-lv, .hs-time { text-align: center; opacity: 0.8; }
  .hs-row-you {
    background: rgba(255, 106, 0, 0.18);
    border: 1px solid var(--orange);
    padding: 4px 6px;
  }
  .hs-your-rank {
    color: var(--orange);
    text-shadow: 0 0 6px var(--orange);
    margin-left: 16px;
    letter-spacing: 2px;
  }
  .gameover-actions { display: flex; gap: 16px; }
  .gameover-btn {
    background: transparent;
    border: 1px solid var(--cyan);
    color: var(--cyan);
    padding: 10px 30px;
    font-family: inherit;
    font-size: 13px;
    letter-spacing: 4px;
    cursor: pointer;
    text-shadow: 0 0 6px var(--cyan);
  }
  .gameover-btn:hover { background: var(--cyan); color: black; text-shadow: none; }
  .mobile-controls {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 8;
  }
  .dpad {
    position: absolute;
    bottom: 40px;
    left: 40px;
    width: 180px;
    height: 180px;
    pointer-events: auto;
    display: grid;
    grid-template-columns: 60px 60px 60px;
    grid-template-rows: 60px 60px 60px;
  }
  .dpad-btn {
    background: rgba(0, 240, 255, 0.18);
    border: 1px solid var(--cyan);
    color: var(--cyan);
    font-size: 24px;
    cursor: pointer;
    touch-action: none;
  }
  .action-buttons {
    position: absolute;
    bottom: 60px;
    right: 40px;
    display: flex;
    gap: 12px;
    pointer-events: auto;
  }
  .action-btn {
    background: rgba(0, 240, 255, 0.18);
    border: 1px solid var(--cyan);
    color: var(--cyan);
    width: 64px;
    height: 64px;
    border-radius: 50%;
    font-size: 22px;
    cursor: pointer;
    touch-action: none;
  }
  .action-btn.attack {
    background: rgba(255, 106, 0, 0.18);
    border-color: var(--orange);
    color: var(--orange);
    width: 80px;
    height: 80px;
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
