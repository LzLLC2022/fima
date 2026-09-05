#!/bin/bash
set -e

CRON_DIR="/home/lz/fima-cron"

if [ ! -d "$CRON_DIR" ]; then
  git clone git@github.com:LzLLC2022/fima.git "$CRON_DIR"
fi

cd "$CRON_DIR"
git checkout main
git pull origin main

npm install puppeteer node-fetch
npx puppeteer browsers install chrome

node scripts/scrape_tax_base.js

git add public/data/tax_base.json public/data/tax_base.log
if git diff --staged --quiet; then
  echo "No changes to commit."
else
  git commit -m "Auto-update tax_base data and log via cron on dev server"
  git push origin main
fi
