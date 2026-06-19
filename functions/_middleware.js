// Cloudflare Pages Function — middleware for all routes.
//
// Blocks requests whose User-Agent matches a known scanner/audit
// signature, or is missing entirely. The TLM-Audit-Scanner hit
// NEONGRID in March 2026 scanning for vulnerabilities; we want
// to drop the request before it reaches any asset (static or
// function) so the attacker can't fingerprint the stack, gauge
// response timing, or enumerate endpoints.
//
// The block is intentionally conservative on the *matcher*
// (we don't try to fingerprint the real browser, we just reject
// a curated list of known-bad UAs and empty UAs) so the false-
// positive rate stays near zero for legitimate users — even
// `curl` without `-A` still gets a User-Agent, and any real
// browser always sends one.
//
// Pages Functions in the runtime provide a single export:
//   onRequest { context } → Response | undefined
// Return a Response to short-circuit; return undefined (or call
// context.next() and don't await) to fall through to the static
// asset handler.

const BAD_UA_PATTERNS = [
  // The specific scanner that hit us in March 2026.
  /TLM-Audit-Scanner/i,

  // Common security/vuln scanning tools. Matched as a substring
  // of the UA so version bumps still match.
  /\bsqlmap\b/i,
  /\bnikto\b/i,
  /\bnmap\b/i,
  /\bmasscan\b/i,
  /\bacunetix\b/i,
  /\bnessus\b/i,
  /\bqualys\b/i,
  /\bwpscan\b/i,
  /\bdirbuster\b/i,
  /\bgobuster\b/i,
  /\bwfuzz\b/i,
  /\bdirb\b/i,
  /\bnuclei\b/i,
  /\bsubfinder\b/i,
  /\bamass\b/i,
  /\bmetasploit\b/i,
  /\bzgrab\b/i,
  /\bcensys\b/i,
  /\bshodan\b/i,
  /\bburpcollaborator\b/i,
  /\bhttpx\b/i,
  /\bnuclei\b/i,
];

export async function onRequest(context) {
  const rawUa = context.request.headers.get('User-Agent') || '';
  // Block empty UAs outright — most well-behaved HTTP clients
  // (browsers, fetch, curl, axios, etc.) always send a UA. Empty
  // UAs (or UAs that are just punctuation like '""' from
  // misbehaving clients) are a strong signal of scripted probing.
  // We strip whitespace AND surrounding quotes before checking
  // length, so `User-Agent: ""` (which curl sends with the
  // literal quotes intact) gets caught here too.
  const stripped = rawUa.replace(/^[\s"'`]+|[\s"'`]+$/g, '');
  if (stripped.length < 4) {
    return new Response('forbidden', {
      status: 403,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
  // Block known-bad UAs.
  for (const pattern of BAD_UA_PATTERNS) {
    if (pattern.test(rawUa)) {
      // Visible in the Cloudflare logs (Workers / Pages functions
      // log stdout to the page's log stream) so we can see who's
      // hitting us and tune the list over time.
      console.warn(
        `[block] UA matched ${pattern} for ${context.request.method} ${context.request.url}`,
      );
      return new Response('forbidden', {
        status: 403,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }
  }
  // Fall through to the next handler (static asset or another
  // function). Pages Functions receive undefined as the
  // "continue" signal.
  return context.next();
}
