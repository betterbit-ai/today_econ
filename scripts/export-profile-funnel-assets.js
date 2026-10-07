#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(process.cwd(), 'content', 'profile-funnel');
const FILES = Object.freeze([
  '01-selection-criteria.svg',
  '02-basic-start.svg',
  '03-weekly-top3.svg',
]);

async function exportProfileFunnelAssets({ root = ROOT } = {}) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 });
    for (const fileName of FILES) {
      const svg = fs.readFileSync(path.join(root, fileName), 'utf8');
      await page.setContent(`<html><head><style>*{box-sizing:border-box}html,body{margin:0;width:1080px;height:1350px;overflow:hidden;background:#080c16}svg{display:block;width:1080px;height:1350px}</style></head><body>${svg}</body></html>`, { waitUntil: 'load' });
      await page.screenshot({
        path: path.join(root, fileName.replace(/\.svg$/u, '.png')),
        type: 'png',
        clip: { x: 0, y: 0, width: 1080, height: 1350 },
      });
    }
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  exportProfileFunnelAssets().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = { FILES, exportProfileFunnelAssets };
