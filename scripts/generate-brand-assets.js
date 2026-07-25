const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const SOURCE = path.join(ROOT, 'assets', 'brand', 'diem-profile.svg');
const OUTPUT = path.join(ROOT, 'assets', 'brand', 'diem-profile.png');

async function generateBrandAssets({
  sourcePath = SOURCE,
  outputPath = OUTPUT,
  chromiumImpl = chromium,
} = {}) {
  const svg = fs.readFileSync(sourcePath, 'utf8');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const browser = await chromiumImpl.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
    await page.setContent(`<!doctype html><style>*{box-sizing:border-box}html,body{margin:0;width:1024px;height:1024px;overflow:hidden}svg{display:block;width:1024px;height:1024px}</style>${svg}`);
    await page.screenshot({ path: outputPath, type: 'png' });
  } finally {
    await browser.close();
  }
  return outputPath;
}

if (require.main === module) {
  generateBrandAssets()
    .then(outputPath => console.log(`[DIEM Brand] Generated ${outputPath}`))
    .catch(error => {
      console.error(error);
      process.exitCode = 1;
    });
}

module.exports = {
  OUTPUT,
  SOURCE,
  generateBrandAssets,
};
