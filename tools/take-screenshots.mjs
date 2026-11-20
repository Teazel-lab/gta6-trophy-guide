// Takes the contest screenshots: serves app/ on a free local port, drives headless
// Chrome over the DevTools protocol at 1280x800, opens each ?shot= scene, waits for
// document.title === 'shot-ready' and saves a JPEG (<= 250 KiB) into screenshots/.
// Usage: node tools/take-screenshots.mjs
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile, rm, mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP_DIR = path.join(ROOT, 'app');
const OUT_DIR = path.join(ROOT, 'screenshots');
const CHROME = '/usr/bin/google-chrome';
const VIEWPORT = { width: 1280, height: 800 };
const MAX_BYTES = 250 * 1024;

const SHOTS = [
  { file: '1-tracker-guide-sources.jpg', scene: 'tracker' },
  { file: '2-platinum-roadmap-missables.jpg', scene: 'roadmap' },
  { file: '3-spoiler-shield-story-filter.jpg', scene: 'spoilers' },
  { file: '4-import-export-collectibles.jpg', scene: 'import' },
];
const OLD_SHOTS = ['1-checklist.jpg', '2-silver.jpg', '3-bronze.jpg'];

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

await main();

async function main() {
  const server = await startStaticServer(APP_DIR);
  const base = `http://127.0.0.1:${server.address().port}/`;
  const chrome = await launchChrome();
  try {
    const page = await openPage(chrome.port);
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    await page.send('Emulation.setDeviceMetricsOverride', { ...VIEWPORT, deviceScaleFactor: 1, mobile: false });
    page.on('Runtime.consoleAPICalled', (p) => console.log('  [page]', p.args.map((a) => a.value ?? a.description).join(' ')));
    page.on('Runtime.exceptionThrown', (p) => console.log('  [page error]', p.exceptionDetails.exception?.description || p.exceptionDetails.text));
    await mkdir(OUT_DIR, { recursive: true });

    for (const shot of SHOTS) {
      await page.send('Storage.clearDataForOrigin', { origin: base.slice(0, -1), storageTypes: 'local_storage' });
      await page.send('Page.navigate', { url: `${base}index.html?shot=${shot.scene}` });
      await waitForTitle(page, 'shot-ready', 15000);
      const { bytes, quality } = await captureJpeg(page);
      await writeFile(path.join(OUT_DIR, shot.file), bytes);
      console.log(`${shot.file}: ${VIEWPORT.width}x${VIEWPORT.height}, q${quality}, ${(bytes.length / 1024).toFixed(1)} KiB`);
    }
    for (const old of OLD_SHOTS) await rm(path.join(OUT_DIR, old), { force: true });
    await writeShotsManifest();
    page.close();
  } finally {
    chrome.stop();
    server.close();
  }
}

/** Capture at falling JPEG quality until the file fits MAX_BYTES. */
async function captureJpeg(page) {
  for (let quality = 90; quality >= 50; quality -= 5) {
    const { data } = await page.send('Page.captureScreenshot', {
      format: 'jpeg', quality, clip: { x: 0, y: 0, ...VIEWPORT, scale: 1 },
    });
    const bytes = Buffer.from(data, 'base64');
    if (bytes.length <= MAX_BYTES) return { bytes, quality };
  }
  throw new Error('screenshot stays above 250 KiB even at quality 50');
}

async function writeShotsManifest() {
  const list = SHOTS.map((s) => ({ file: s.file, path: `/?shot=${s.scene}`, viewport: VIEWPORT }));
  const body = '[\n' + list.map((s) => '  ' + JSON.stringify(s)).join(',\n') + '\n]\n';
  await writeFile(path.join(ROOT, 'shots.json'), body);
}

// --- static server --------------------------------------------------------------

/** Tiny static file server for app/ with ETag revalidation, on a free port. */
function startStaticServer(dir) {
  const server = http.createServer(async (req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = path.join(dir, urlPath.endsWith('/') ? urlPath + 'index.html' : urlPath);
    if (!file.startsWith(dir + path.sep)) { res.writeHead(403).end(); return; }
    try {
      const body = await readFile(file);
      const etag = '"' + createHash('sha1').update(body).digest('hex').slice(0, 16) + '"';
      if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag }).end(); return; }
      res.writeHead(200, {
        'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-cache', ETag: etag,
      });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// --- Chrome + DevTools protocol ------------------------------------------------

async function launchChrome() {
  const profile = await mkdtemp(path.join(tmpdir(), 'platinum-run-chrome-'));
  const proc = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    `--window-size=${VIEWPORT.width},${VIEWPORT.height}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  const port = await new Promise((resolve, reject) => {
    let log = '';
    const timer = setTimeout(() => reject(new Error('Chrome did not start:\n' + log)), 15000);
    proc.stderr.on('data', (chunk) => {
      log += chunk;
      const m = /DevTools listening on ws:\/\/[^:]+:(\d+)\//.exec(log);
      if (m) { clearTimeout(timer); resolve(Number(m[1])); }
    });
  });
  return {
    port,
    stop() {
      proc.kill('SIGKILL');
      rm(profile, { recursive: true, force: true }).catch(() => {});
    },
  };
}

/** Connect to the first page target; returns {send(method, params), on(event, fn), close()}. */
async function openPage(port) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const target = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let nextId = 1;
  const pending = new Map();
  const listeners = new Map();
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
    } else if (msg.method) {
      for (const fn of listeners.get(msg.method) || []) fn(msg.params);
    }
  };
  return {
    send(method, params = {}) {
      const id = nextId++;
      ws.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    },
    on(method, fn) {
      listeners.set(method, [...(listeners.get(method) || []), fn]);
    },
    close: () => ws.close(),
  };
}

async function waitForTitle(page, title, timeout) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const { result } = await page.send('Runtime.evaluate', { expression: 'document.title' });
    if (result.value === title) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`timed out waiting for title "${title}"`);
}
