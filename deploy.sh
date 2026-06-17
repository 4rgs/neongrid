#!/usr/bin/env bash
# Deploy NEONGRID to Cloudflare Pages.
# Prereq: `npm i -g wrangler` and `wrangler login` once.
set -euo pipefail
cd "$(dirname "$0")"

echo "==> Installing deps"
npm ci --silent

echo "==> Building"
npm run build

echo "==> Deploying to Cloudflare Pages (project: neongrid)"
npx wrangler pages deploy dist --project-name neongrid --commit-dirty=true

echo
echo "==> Done. Check https://neongrid.pages.dev"
