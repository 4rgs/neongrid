/**
 * main.ts — entry point.
 * Boots the Svelte HUD, mounts the canvas, then starts the game loop.
 */
import { mount } from 'svelte';
import App from './ui/App.svelte';
import { Game } from './game/Game';

const appEl = document.getElementById('app')!;

// Surface any error to the page itself for debugging
window.addEventListener('error', (e) => {
  console.error('[window.error]', e.message, e.error);
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#400;color:#fff;padding:10px;z-index:9999;font:10px monospace;white-space:pre-wrap;max-height:60vh;overflow:auto;';
  d.textContent = 'ERR: ' + (e.error?.stack || e.message);
  document.body.appendChild(d);
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('[unhandledrejection]', e.reason);
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:#404;color:#fff;padding:10px;z-index:9999;font:10px monospace;white-space:pre-wrap;max-height:40vh;overflow:auto;';
  d.textContent = 'REJECT: ' + (e.reason?.stack || String(e.reason));
  document.body.appendChild(d);
});

/**
 * Wait for the HUD api to be available AND stable. Svelte 5 sets
 * `window.__hud` inside an `$effect`, which runs after the first render.
 * We also wait one extra microtask to make sure the effect has flushed.
 */
async function waitForHud(): Promise<any> {
  const deadline = performance.now() + 5000;
  while (performance.now() < deadline) {
    const api = (window as any).__hud;
    if (api && typeof api.setTutorial === 'function' && typeof api.setBossHp === 'function') {
      return api;
    }
    await new Promise((r) => setTimeout(r, 16));
  }
  return (window as any).__hud ?? null;
}

(async () => {
  try {
    // HUD overlay (Svelte 5) — its $effect will populate window.__hud
    let hud: any = null;
    try {
      hud = mount(App, { target: appEl });
      console.log('[boot] HUD mounted, waiting for api…');
    } catch (svelteErr) {
      console.error('[boot] Svelte mount failed:', svelteErr);
      const d = document.createElement('div');
      d.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#f00;color:#fff;padding:20px;z-index:99999;font:11px monospace;white-space:pre-wrap;';
      d.textContent = 'SVELTE MOUNT FAILED: ' + (svelteErr instanceof Error ? svelteErr.stack : String(svelteErr));
      document.body.appendChild(d);
      return;
    }

    const api = await waitForHud();
    if (!api) {
      throw new Error('Svelte HUD did not expose its API on window.__hud');
    }
    console.log('[boot] HUD api ready');

    const game = new Game(appEl, api);
    console.log('[boot] Game constructed');
    game.start();
    console.log('[boot] Game started');

    (globalThis as any).__game = game;
  } catch (err) {
    console.error('[boot] FATAL', err);
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#600;color:#fff;padding:10px;z-index:9999;font:11px monospace;white-space:pre-wrap;';
    d.textContent = 'FATAL: ' + (err instanceof Error ? err.stack : String(err));
    document.body.appendChild(d);
  }
})();
