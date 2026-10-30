import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { startPngRecording } from './lib/png-recorder.mjs';

const output = new URL('../docs/verification/', import.meta.url);
const collectCanvas = process.argv.includes('--measure-canvas');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chromium' });
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('http://127.0.0.1:5180/');
  await page.locator('[data-ready="true"]').waitFor();
  await page.waitForTimeout(300);
  const recorder = await startPngRecording(context, page, new URL('interaction.webm', output));
  await page.evaluate(collectCanvas => {
    window.astralVerification = { intervals: [], canvasFrames: [], previous: 0, lastRead: 0, done: false };
    const start = performance.now();
    const source = document.querySelector('.scene-trails');
    const probe = document.createElement('canvas');
    probe.width = 240;
    probe.height = 150;
    const ctx = probe.getContext('2d', { willReadFrequently: true });
    const sample = timestamp => {
      const stats = window.astralVerification;
      if (stats.previous) stats.intervals.push(timestamp - stats.previous);
      stats.previous = timestamp;
      if (collectCanvas && timestamp - stats.lastRead >= 40) {
        stats.lastRead = timestamp;
        ctx.clearRect(0, 0, 240, 150);
        ctx.drawImage(source, 0, 0, 240, 150);
        const pixels = ctx.getImageData(0, 0, 240, 150).data;
        let luma = 0;
        for (let i = 0; i < pixels.length; i += 4) luma += (.2126 * pixels[i] + .7152 * pixels[i + 1] + .0722 * pixels[i + 2]) * pixels[i + 3] / 255;
        const previous = stats.canvasFrames.at(-1)?.luma ?? 0;
        stats.canvasFrames.push({ time: (timestamp - start) / 1000, luma, changePercent: previous > 0 ? (luma / previous - 1) * 100 : 0 });
      }
      if (timestamp - start < 8000) requestAnimationFrame(sample);
      else stats.done = true;
    };
    requestAnimationFrame(sample);
  }, collectCanvas);
  await page.mouse.move(70, 70);
  await page.mouse.down();
  await page.waitForTimeout(8000);
  await page.screenshot({ path: fileURLToPath(new URL('desktop-live-hold-8s.png', output)) });
  const performanceResult = await page.evaluate(() => {
    const intervals = window.astralVerification.intervals.slice(20).sort((a, b) => a - b);
    const canvasFrames = window.astralVerification.canvasFrames;
    const steady = canvasFrames.filter(frame => frame.time >= 3 && frame.time <= 7.8);
    return {
      measurement: canvasFrames.length
        ? 'Actual wall-clock hold with PNG compositor capture and sparse raw-Canvas probes at about 25 Hz; includes diagnostic overhead. Use iteration-02/live-performance.json for the independent benchmark.'
        : 'Actual wall-clock hold with PNG compositor capture; raw-Canvas probing disabled. Encoding runs afterward. Use iteration-02/live-performance.json for the independent benchmark.',
      rawCanvasWorstDropPercent: steady.length ? Math.min(...steady.map(frame => frame.changePercent)) : null,
      rawCanvasJumpsOver5Percent: steady.length ? steady.filter(frame => frame.changePercent < -5).length : null,
      canvasFrames,
      framesObserved: intervals.length,
      meanIntervalMs: intervals.reduce((sum, value) => sum + value, 0) / intervals.length,
      p95IntervalMs: intervals[Math.floor(intervals.length * .95)],
      maxIntervalMs: intervals.at(-1),
      userAgent: navigator.userAgent,
    };
  });
  await page.mouse.up();
  await page.waitForTimeout(1150);
  const released = await page.evaluate(() => {
    const canvas = document.querySelector('.scene-trails');
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let alpha = 0;
    for (let i = 3; i < pixels.length; i += 4) alpha += pixels[i];
    return { state: document.querySelector('.starfield-scene').dataset.state, remainingAlpha: alpha };
  });
  if (errors.length || released.state !== 'idle' || released.remainingAlpha !== 0) {
    throw new Error(JSON.stringify({ errors, released }));
  }
  const recording = await recorder.stop();
  await context.close();
  const result = { ...performanceResult, released, recording, errors };
  await writeFile(new URL('live-performance.json', output), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, canvasFrames: result.canvasFrames.length }, null, 2));
} finally {
  await browser.close();
}
