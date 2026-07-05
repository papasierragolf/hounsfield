// Regenerates all marketing screenshots (raw app shots + composed App
// Store-style tiles) as real PNG files under marketing/screenshots/.
//
// Requires the Vite dev server running first:
//   npm run dev
// Then, in another terminal:
//   node marketing/generate.mjs
//
// Uses Playwright driving the system's installed Google Chrome (no extra
// browser binary download). Demo content (two synthetic studies with
// procedurally-drawn placeholder images, not real scans) is seeded into
// IndexedDB, screenshotted, then cleared again so it never lingers in your
// dev database.

import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_URL = 'http://localhost:5173';
const APP_DIR = path.join(__dirname, 'screenshots', 'app');
const STORE_DIR = path.join(__dirname, 'screenshots', 'store');

async function ensureServerUp() {
  try {
    await fetch(APP_URL);
  } catch {
    console.error(`\nCould not reach ${APP_URL}. Start the dev server first:\n  npm run dev\n`);
    process.exit(1);
  }
}

// Same synthetic-image + sample-report seed used to preview these tiles
// interactively — kept here so screenshots can be regenerated any time.
async function seedDemoData(page) {
  await page.goto(APP_URL);
  await page.evaluate(async () => {
    function drawChestXray() {
      const c = document.createElement('canvas');
      c.width = 800; c.height = 960;
      const ctx = c.getContext('2d');
      const bg = ctx.createRadialGradient(400, 420, 80, 400, 420, 650);
      bg.addColorStop(0, '#141a22'); bg.addColorStop(1, '#04070b');
      ctx.fillStyle = bg; ctx.fillRect(0, 0, 800, 960);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const [cx, cy, rx, ry] of [[260, 420, 150, 260], [540, 420, 150, 260]]) {
        const g = ctx.createRadialGradient(cx, cy, 10, cx, cy, rx);
        g.addColorStop(0, 'rgba(120,150,180,0.35)'); g.addColorStop(1, 'rgba(120,150,180,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
      }
      ctx.strokeStyle = 'rgba(210,220,230,0.55)'; ctx.lineWidth = 6;
      for (let i = 0; i < 9; i++) {
        const y = 190 + i * 68;
        ctx.beginPath(); ctx.moveTo(160, y); ctx.quadraticCurveTo(400, y - 46 - i * 2, 640, y); ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(230,235,240,0.8)'; ctx.lineWidth = 34;
      ctx.beginPath(); ctx.moveTo(400, 150); ctx.lineTo(400, 760); ctx.stroke();
      ctx.lineWidth = 14; ctx.strokeStyle = 'rgba(220,228,235,0.7)';
      ctx.beginPath(); ctx.moveTo(260, 180); ctx.quadraticCurveTo(400, 130, 540, 180); ctx.stroke();
      const hg = ctx.createRadialGradient(430, 520, 20, 430, 520, 140);
      hg.addColorStop(0, 'rgba(200,150,120,0.3)'); hg.addColorStop(1, 'rgba(200,150,120,0)');
      ctx.fillStyle = hg; ctx.beginPath(); ctx.ellipse(430, 520, 110, 140, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      const vg = ctx.createRadialGradient(400, 480, 300, 400, 480, 650);
      vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.55)');
      ctx.fillStyle = vg; ctx.fillRect(0, 0, 800, 960);
      return c;
    }
    function drawCT() {
      const c = document.createElement('canvas');
      c.width = 800; c.height = 800;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 800, 800);
      const g = ctx.createRadialGradient(400, 400, 50, 400, 400, 340);
      g.addColorStop(0, '#3a3a3a'); g.addColorStop(0.7, '#232323'); g.addColorStop(1, '#0a0a0a');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.ellipse(400, 400, 330, 300, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalCompositeOperation = 'lighter';
      for (const [cx, cy, r, c1] of [
        [320, 340, 90, 'rgba(180,120,90,0.35)'],
        [480, 360, 70, 'rgba(150,150,170,0.3)'],
        [400, 480, 110, 'rgba(200,190,160,0.25)'],
      ]) {
        const gg = ctx.createRadialGradient(cx, cy, 4, cx, cy, r);
        gg.addColorStop(0, c1); gg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#e8e8e8';
      ctx.beginPath(); ctx.ellipse(400, 610, 38, 28, 0, 0, Math.PI * 2); ctx.fill();
      return c;
    }
    const xrayCanvas = drawChestXray();
    const ctCanvas = drawCT();
    const toBlob = (canvas, q) => new Promise((res) => canvas.toBlob(res, 'image/jpeg', q));
    function thumbOf(canvas, size) {
      const t = document.createElement('canvas');
      t.width = size; t.height = size * (canvas.height / canvas.width);
      t.getContext('2d').drawImage(canvas, 0, 0, t.width, t.height);
      return t;
    }
    const xrayBlob = await toBlob(xrayCanvas, 0.9);
    const ctBlob = await toBlob(ctCanvas, 0.9);
    const xrayThumbBlob = await toBlob(thumbOf(xrayCanvas, 320), 0.85);
    const ctThumbBlob = await toBlob(thumbOf(ctCanvas, 320), 0.85);

    const req = indexedDB.open('hounsfield');
    const db = await new Promise((res) => { req.onsuccess = () => res(req.result); });
    await new Promise((res) => {
      const tx = db.transaction(['studies', 'images', 'settings'], 'readwrite');
      tx.objectStore('studies').clear();
      tx.objectStore('images').clear();
      tx.objectStore('settings').put(false, 'vaultEnabled');
      tx.objectStore('settings').put(true, 'disclaimerAccepted');
      tx.objectStore('settings').put('light', 'theme');
      tx.oncomplete = res;
    });

    const now = Date.now();
    const study1 = {
      id: 'demo-study-1', createdAt: now - 3600_000,
      modality: 'xray', region: 'Chest',
      context: '58-year-old with three days of dry cough and low-grade fever.',
      question: 'Any focal consolidation?',
      imageIds: ['demo-img-1'],
      report:
        '## Technique\nSingle frontal projection radiograph of the chest, adequate inspiration and rotation.\n\n' +
        '## Findings\nLungs are clear bilaterally with no focal consolidation, effusion, or pneumothorax. ' +
        'Cardiac silhouette is normal in size and contour. Mediastinal and hilar contours are unremarkable. ' +
        'Osseous structures show no acute abnormality.\n\n' +
        '## Impression\n1. No acute cardiopulmonary process. (High confidence)\n' +
        '2. No radiographic evidence of pneumonia. (Moderate-high confidence)\n\n' +
        '## Recommendations\nClinical correlation recommended. If symptoms persist beyond 7–10 days, ' +
        'consider repeat imaging or CT for further characterization.\n\n---\n' +
        '*Generated on-device by MedGemma. Preliminary and educational only — not a medical diagnosis. ' +
        'Always have imaging reviewed by a qualified radiologist.*',
      model: 'mlx-community/medgemma-1.5-4b-it-4bit', elapsedMs: 8400, reportedAt: now - 3500_000,
    };
    const study2 = {
      id: 'demo-study-2', createdAt: now - 86_400_000,
      modality: 'ct', region: 'Abdomen',
      context: '46-year-old, post-operative follow-up.', question: '',
      imageIds: ['demo-img-2'],
      report:
        '## Technique\nSingle axial CT slice through the mid-abdomen, soft tissue window.\n\n' +
        '## Findings\nVisualized solid organs demonstrate homogeneous attenuation without focal lesion. ' +
        'No free fluid or free air. Bowel loops are non-dilated. No lymphadenopathy identified at this level.\n\n' +
        '## Impression\n1. No acute abnormality at the level imaged. (Moderate confidence — single slice limits full evaluation)\n\n' +
        '## Recommendations\nCorrelate with the complete study and clinical picture; full multi-slice review ' +
        'recommended before final interpretation.\n\n---\n' +
        '*Generated on-device by MedGemma. Preliminary and educational only — not a medical diagnosis. ' +
        'Always have imaging reviewed by a qualified radiologist.*',
      model: 'mlx-community/medgemma-1.5-4b-it-4bit', elapsedMs: 6100, reportedAt: now - 86_300_000,
    };
    const image1 = { id: 'demo-img-1', studyId: 'demo-study-1', blob: xrayBlob, thumb: xrayThumbBlob, width: 800, height: 960 };
    const image2 = { id: 'demo-img-2', studyId: 'demo-study-2', blob: ctBlob, thumb: ctThumbBlob, width: 800, height: 800 };

    await new Promise((res) => {
      const tx = db.transaction(['studies', 'images'], 'readwrite');
      tx.objectStore('studies').put(study1);
      tx.objectStore('studies').put(study2);
      tx.objectStore('images').put(image1);
      tx.objectStore('images').put(image2);
      tx.oncomplete = res;
    });
  });
}

async function clearDemoData(page) {
  await page.evaluate(async () => {
    const req = indexedDB.open('hounsfield');
    const db = await new Promise((res) => { req.onsuccess = () => res(req.result); });
    await new Promise((res) => {
      const tx = db.transaction(['studies', 'images'], 'readwrite');
      tx.objectStore('studies').clear();
      tx.objectStore('images').clear();
      tx.oncomplete = res;
    });
  });
}

function patchReadyChip(page) {
  return page.evaluate(() => {
    const chip = document.querySelector('.model-chip');
    if (chip) chip.innerHTML = '<span class="dot ready"></span>MedGemma · mlx';
  });
}

async function shootRawScreenshots(browser) {
  const page = await browser.newPage({ viewport: { width: 393, height: 852 } });
  await seedDemoData(page);
  await page.reload();
  await page.waitForSelector('.study-row');
  await patchReadyChip(page);
  await page.screenshot({ path: path.join(APP_DIR, 'studies-list-light.png') });

  await page.click('.study-row');
  await page.waitForSelector('.viewer');
  await patchReadyChip(page);
  await page.screenshot({ path: path.join(APP_DIR, 'report-light-top.png') });
  await page.evaluate(() => { document.querySelector('.app-main').scrollTop = 900; });
  await page.screenshot({ path: path.join(APP_DIR, 'report-light-scrolled.png') });

  await page.click('.back-link');
  await page.click('button:has-text("SETTINGS")');
  await page.evaluate(() => { document.querySelector('.app-main').scrollTop = 0; });
  await patchReadyChip(page);
  await page.screenshot({ path: path.join(APP_DIR, 'settings-security-light.png') });

  // Dark mode pass
  await page.click('.seg button:nth-child(2)'); // Dark
  await page.click('button:has-text("STUDIES")');
  await patchReadyChip(page);
  await page.screenshot({ path: path.join(APP_DIR, 'studies-list-dark.png') });
  await page.click('.study-row');
  await patchReadyChip(page);
  await page.screenshot({ path: path.join(APP_DIR, 'report-dark.png') });
  await page.click('.back-link');
  await page.click('button:has-text("SETTINGS")');
  await page.click('.seg button:nth-child(1)'); // back to Light

  // Capture flow
  await page.click('button:has-text("NEW STUDY")');
  await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 800; c.height = 960;
    const ctx = c.getContext('2d');
    const bg = ctx.createRadialGradient(400, 420, 80, 400, 420, 650);
    bg.addColorStop(0, '#141a22'); bg.addColorStop(1, '#04070b');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, 800, 960);
    ctx.strokeStyle = 'rgba(210,220,230,0.55)'; ctx.lineWidth = 6;
    for (let i = 0; i < 9; i++) {
      const y = 190 + i * 68;
      ctx.beginPath(); ctx.moveTo(160, y); ctx.quadraticCurveTo(400, y - 46 - i * 2, 640, y); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(230,235,240,0.8)'; ctx.lineWidth = 34;
    ctx.beginPath(); ctx.moveTo(400, 150); ctx.lineTo(400, 760); ctx.stroke();
    const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.9));
    const file = new File([blob], 'chest.jpg', { type: 'image/jpeg' });
    const dt = new DataTransfer(); dt.items.add(file);
    const input = document.querySelector('input[type=file]:not([capture])');
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 400));
    const contextField = document.querySelector('textarea');
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
      .call(contextField, '61-year-old with sudden onset shortness of breath.');
    contextField.dispatchEvent(new Event('input', { bubbles: true }));
    const qField = document.querySelector('input[type=text]');
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      .call(qField, 'Any evidence of pneumothorax?');
    qField.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.screenshot({ path: path.join(APP_DIR, 'capture-flow-light.png') });

  await clearDemoData(page);
  await page.close();
}

// Seven feature tiles matching Apple's recommended App Store showcase format:
// phone frame dominant (top 76%), short caption strip below.
// 'scroll' is a 0.0–1.0 fraction of .app-main scrollHeight applied after
// the screen loads, so we can land on the Impression section etc.
const TILES = [
  {
    file: 'tile-1-offline.png',
    params: {
      headline: '100% Offline AI — No cloud. No uploads.',
      sub: 'Your images stay on your device. Works in airplane mode after one-time setup.',
      bg: 'light', tab: 'studies', ready: '1',
    },
  },
  {
    file: 'tile-2-mlx.png',
    params: {
      headline: 'Runs MedGemma on iPhone — Apple MLX acceleration.',
      sub: "Google's medically-tuned vision model running natively on the device GPU.",
      bg: 'light', tab: 'study', ready: '1',
    },
  },
  {
    file: 'tile-3-confidence.png',
    params: {
      headline: 'Confidence Estimates — Every finding flagged.',
      sub: 'The model rates its own certainty on each reported finding — high, moderate, or low.',
      bg: 'light', tab: 'study', scroll: '0.58', ready: '1',
    },
  },
  {
    file: 'tile-4-control.png',
    params: {
      headline: 'Complete Control — Stop. Refine. Retry.',
      sub: 'Cancel inference mid-stream, edit patient context, and re-analyse with a single tap.',
      bg: 'light', tab: 'study', scroll: '0.1', ready: '1',
    },
  },
  {
    file: 'tile-5-memory.png',
    params: {
      headline: 'Memory Aware — Load and unload on demand.',
      sub: 'Free GPU memory instantly. Reload for a guaranteed clean context before the next study.',
      bg: 'light', tab: 'settings', scroll: '0.42', ready: '1',
    },
  },
  {
    file: 'tile-6-darkmode.png',
    params: {
      headline: 'Native iOS Experience — Light & Dark Mode.',
      sub: 'Designed for the reading room. The film viewer stays black in both themes.',
      bg: 'dark', tab: 'study', theme: 'dark', ready: '1',
    },
  },
  {
    file: 'tile-7-privacy.png',
    params: {
      headline: 'Privacy First — Face ID. Encrypted. No accounts.',
      sub: 'AES-GCM encryption at rest, biometric lock, zero mandatory network traffic.',
      bg: 'dark', tab: 'settings', theme: 'light', ready: '1',
    },
  },
];

// Apple-specified App Store screenshot dimensions (portrait, 1× pixel density).
// The template uses vw/vh layout so it adapts to any size here without
// stretching. Add further device classes by appending to this array.
const STORE_SIZES = [
  { name: 'social',          width: 1080, height: 1920 },  // LinkedIn / Substack
  { name: 'appstore-6.5in', width: 1242, height: 2688 },  // iPhone XS Max → 14 Plus
  { name: 'appstore-6.9in', width: 1320, height: 2868 },  // iPhone 15 Pro Max → 16 Pro Max
];

async function shootStoreTiles(browser) {
  for (const size of STORE_SIZES) {
    const outDir = path.join(STORE_DIR, size.name);
    await mkdir(outDir, { recursive: true });
    const page = await browser.newPage({ viewport: { width: size.width, height: size.height } });
    // Seed once per size so the tile screenshots (which reload the app
    // fresh inside the template's iframe) have data to show.
    await seedDemoData(page);
    for (const tile of TILES) {
      const qs = new URLSearchParams(tile.params).toString();
      await page.goto(`${APP_URL}/marketing/store-tile.html?${qs}`);
      await page.waitForFunction(() => document.title === 'tile-ready', { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(outDir, tile.file) });
    }
    await clearDemoData(page);
    await page.close();
  }
}

async function main() {
  await ensureServerUp();
  await mkdir(APP_DIR, { recursive: true });
  await mkdir(STORE_DIR, { recursive: true });

  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    await shootRawScreenshots(browser);
    await shootStoreTiles(browser);
  } finally {
    await browser.close();
  }
  console.log(`\nDone. Screenshots written to:\n  ${APP_DIR}\n  ${STORE_DIR} (per size subfolder)\n`);
}

main();
