import { chromium } from 'playwright';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { installExposureHarness, advanceExposure, summarizeExposure } from './lib/exposure-harness.mjs';

const phase = process.argv[2] ?? 'after';
if (!['before', 'after'].includes(phase)) throw new Error('Use before or after.');
const root = new URL('../', import.meta.url);
const output = new URL('docs/verification/iteration-02/', root);
await mkdir(output, { recursive: true });
const baselineRevision = '1b1db046e087dca823cc4ef020f7d75a0f1c9131';
let engineUrl = '/src/engine/StarTrailEngine.ts';
if (phase === 'before') {
  const directory = new URL('docs/verification/.capture/baseline-engine/', root);
  await mkdir(directory, { recursive: true });
  for (const file of ['StarTrailEngine.ts', 'StarParticle.ts']) {
    const source = execFileSync('git', ['show', `${baselineRevision}:src/engine/${file}`], { cwd: fileURLToPath(root), encoding: 'utf8' });
    await writeFile(new URL(file, directory), source);
  }
  engineUrl = '/docs/verification/.capture/baseline-engine/StarTrailEngine.ts';
}
const browser = await chromium.launch({ headless: true, channel: 'chromium' });
try {
  const page = await browser.newPage({ baseURL: 'http://127.0.0.1:5180', viewport: { width: 960, height: 600 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await installExposureHarness(page, engineUrl, { attribution: phase === 'before' });
  let trace;
  const checkpoints = [];
  for (const seconds of [8, 20, 46]) {
    trace = await advanceExposure(page, seconds);
    await page.screenshot({ path: fileURLToPath(new URL(`${phase}-hold-${seconds}s.png`, output)) });
    checkpoints.push({ seconds, ...await page.evaluate(() => window.exposureHarness.stats()) });
  }
  const baselineTimes = (phase === 'before' ? trace : JSON.parse(await readFile(new URL('before-trace.json', output), 'utf8'))).replacements.map(row => row.time);
  const result = {
    phase, baselineRevision, source: phase === 'before' ? baselineRevision : 'working tree',
    viewport: { width: 960, height: 600 }, dpr: 1, hz: 60,
    measurement: 'Controlled 60 Hz real Canvas rendering, 240x150 premultiplied-luma readback after each rendered frame. Readback is excluded from renderMs; this is not a wall-clock FPS benchmark.',
    summary: [[3, 8], [12, 20], [36, 46]].map(([from, to]) => summarizeExposure(trace.frames, from, to, baselineTimes)),
    checkpoints, errors, ...trace,
  };
  await writeFile(new URL(`${phase}-trace.json`, output), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ phase, summary: result.summary, checkpoints, replacements: trace.replacements.length, errors }, null, 2));
  await page.evaluate(() => window.exposureHarness.dispose());
} finally { await browser.close(); }
