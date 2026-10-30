import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const output = new URL('../docs/verification/iteration-02/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.addInitScript(() => {
    const nativeRaf = window.requestAnimationFrame.bind(window);
    const records = [];
    window.frameBenchmark = { active: false, startedAt: 0, previous: 0, trails: 0, records };
    const conic = CanvasRenderingContext2D.prototype.createConicGradient;
    CanvasRenderingContext2D.prototype.createConicGradient = function (...args) {
      window.frameBenchmark.trails++;
      return conic.apply(this, args);
    };
    window.requestAnimationFrame = callback => nativeRaf(timestamp => {
      window.frameBenchmark.trails = 0;
      const start = performance.now();
      callback(timestamp);
      const stats = window.frameBenchmark;
      if (!stats.active) return;
      records.push({ time: (timestamp - stats.startedAt) / 1000, timestamp, intervalMs: stats.previous ? timestamp - stats.previous : 0, renderMs: performance.now() - start, renderedTrails: stats.trails });
      stats.previous = timestamp;
    });
  });
  await page.goto('http://127.0.0.1:5180/');
  await page.locator('[data-ready="true"]').waitFor();
  await page.evaluate(() => {
    window.frameBenchmark.startedAt = performance.now();
    window.frameBenchmark.active = true;
  });
  await page.mouse.move(70, 70);
  await page.mouse.down();
  const started = Date.now();
  const checkpoints = [];
  for (const seconds of [8, 20, 46]) {
    await page.waitForTimeout(Math.max(0, started + seconds * 1000 - Date.now()));
    const stats = await page.evaluate(() => {
      return {
        elapsed: (performance.now() - window.frameBenchmark.startedAt) / 1000,
        renderedTrails: window.frameBenchmark.records.at(-1)?.renderedTrails,
        state: document.querySelector('.starfield-scene').dataset.state,
      };
    });
    await page.screenshot({ path: fileURLToPath(new URL(`live-hold-${seconds}s.png`, output)) });
    checkpoints.push({ seconds, ...stats });
  }
  const measured = await page.evaluate(() => {
    window.frameBenchmark.active = false;
    return { records: window.frameBenchmark.records, userAgent: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency, devicePixelRatio, canvasDpr: document.querySelector('.scene-trails').width / innerWidth };
  });
  await page.mouse.up();
  await page.waitForTimeout(1150);
  const released = await page.locator('.scene-trails').evaluate(canvas => {
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let alpha = 0;
    for (let i = 3; i < data.length; i += 4) alpha += data[i];
    return { state: document.querySelector('.starfield-scene').dataset.state, alpha };
  });
  const percentile = (values, fraction) => [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * fraction)];
  const windows = [[3, 8], [12, 20], [36, 46], [3, 46]].map(([from, to]) => {
    // Three screenshots are outside the steady-state performance windows.
    const frames = measured.records.filter(frame => frame.time >= from && frame.time <= to && !checkpoints.some(checkpoint => Math.abs(frame.time - checkpoint.elapsed) < .25));
    const intervals = frames.map(frame => frame.intervalMs).filter(value => value > 0);
    const costs = frames.map(frame => frame.renderMs);
    return { from, to, frames: frames.length, observedFps: 1000 / (intervals.reduce((a, b) => a + b, 0) / intervals.length), meanRenderMs: costs.reduce((a, b) => a + b, 0) / costs.length, p95RenderMs: percentile(costs, .95), p95FrameIntervalMs: percentile(intervals, .95), maxFrameIntervalMs: Math.max(...intervals) };
  });
  const result = { measurement: '46 second real wall-clock hold, native RAF, unmodified animation clock; no video encoding or per-frame pixel readback. Windows headless Chromium is not a physical 60 Hz display. Exclude +/-0.25 seconds around 3 screenshots from steady-state summaries; retain all raw frames.', viewport: { width: 1440, height: 900 }, ...measured, checkpoints, windows, released, errors };
  await writeFile(new URL('live-performance.json', output), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ windows, checkpoints, released, errors }, null, 2));
  if (errors.length || released.state !== 'idle' || released.alpha !== 0) throw new Error('Live benchmark failed to release cleanly.');
} finally { await browser.close(); }
