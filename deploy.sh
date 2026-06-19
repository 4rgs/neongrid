#!/usr/bin/env bash
# Deploy NEONGRID to Cloudflare Pages.
# Prereq: `npm i -g wrangler` and `wrangler login` once.
set -euo pipefail
cd "$(dirname "$0")"

echo "==> Installing deps"
npm ci --silent

echo "==> Building"
npm run build

echo "==> Copying Pages Functions into dist/"
# Cloudflare Pages looks for `functions/` INSIDE the deploy
# directory. Vite doesn't know about Pages Functions, so we
# copy them in after the build. We only ship the compiled
# JS middleware here — the legacy `functions/api/scores.ts`
# and `functions/api/replay.ts` files are TypeScript sources
# that never made it through a Pages build pipeline and would
# fail to load if Pages tried to run them as Workers. They
# live in the repo for source control but are excluded from
# the deploy.
rm -rf dist/functions
mkdir -p dist/functions
cp functions/_middleware.js dist/functions/_middleware.js

echo "==> Deploying to Cloudflare Pages (project: neongrid)"
npx wrangler pages deploy dist --project-name neongrid --commit-dirty=true

echo
echo "==> Done. Check https://neongrid.pages.dev"
