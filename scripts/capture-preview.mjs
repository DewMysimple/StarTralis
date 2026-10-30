import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const output = new URL('../docs/verification/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chromium' });
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    recordVideo: { dir: fileURLToPath(new URL('.capture/', output)), size: { width: 1440, height: 900 } },
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('http://127.0.0.1:5180/');
  await page.locator('[data-ready="true"]').waitFor();
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    window.astralVerification = { intervals: [], previous: 0, done: false };
    const start = performance.now();
    const sample = timestamp => {
      const stats = window.astralVerification;
      if (stats.previous) stats.intervals.push(timestamp - stats.previous);
      stats.previous = timestamp;
      if (timestamp - start < 8000) requestAnimationFrame(sample);
      else stats.done = true;
    };
    requestAnimationFrame(sample);
  });
  await page.mouse.move(70, 70);
  await page.mouse.down();
  await page.waitForTimeout(8000);
  await page.screenshot({ path: fileURLToPath(new URL('desktop-live-hold-8s.png', output)) });
  const performanceResult = await page.evaluate(() => {
    const intervals = window.astralVerification.intervals.slice(20).sort((a, b) => a - b);
    return {
      measurement: 'Real wall-clock hold on local headless Chromium; monitor RAF intervals, not simulated test time.',
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
  const video = page.video();
  await context.close();
  await video.saveAs(fileURLToPath(new URL('interaction.webm', output)));
  await video.delete();
  const result = { ...performanceResult, released, errors };
  await writeFile(new URL('live-performance.json', output), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
