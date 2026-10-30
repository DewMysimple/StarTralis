import { expect, test, type Page } from '@playwright/test';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { installExposureHarness, advanceExposure, summarizeExposure } from '../scripts/lib/exposure-harness.mjs';

const output = 'docs/verification/iteration-02';

async function openPausedScene(page: Page) {
  await page.clock.install({ time: '2026-10-30T00:00:00Z' });
  await page.goto('/');
  await expect(page.locator('[data-ready="true"]')).toBeVisible();
  // install() alone keeps time running during pixel readback and input IPC.
  // Pause after mount so each comparison advances by exactly runFor().
  await page.clock.pauseAt('2026-10-30T00:01:00Z');
}

test('every rendered frame remains stable through 8, 20 and 46 second holds', async ({ page }) => {
  test.setTimeout(120_000);
  await mkdir(output, { recursive: true });
  await page.setViewportSize({ width: 960, height: 600 });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await installExposureHarness(page, '/src/engine/StarTrailEngine.ts');
  const checkpoints = [];
  let trace;
  for (const seconds of [8, 20, 46]) {
    trace = await advanceExposure(page, seconds);
    const stats = await page.evaluate(() => (window as any).exposureHarness.stats());
    checkpoints.push({ seconds, ...stats });
    expect(stats.maxHistoryCount).toBeLessThanOrEqual(384);
    expect(stats.maxArcRadians).toBeLessThan(Math.PI * 2);
    expect(stats.state).toBe('pressing');
    await page.screenshot({ path: `${output}/after-hold-${seconds}s.png` });
  }
  const baseline = JSON.parse(await readFile(`${output}/before-trace.json`, 'utf8'));
  const summary = [[3, 8], [12, 20], [36, 46]].map(([from, to]) => summarizeExposure(trace.frames, from, to, baseline.replacements.map((row: { time: number }) => row.time)));
  for (const interval of summary) {
    expect(interval.worstDropPercent).toBeGreaterThan(-5);
    expect(interval.negativeJumpsOver5Percent).toBe(0);
    expect(interval.worstNear450msPercent).toBeGreaterThan(-5);
  }
  // A fixed, pre-fix recording makes the regression gate demonstrably useful.
  expect(baseline.summary[0].worstDropPercent).toBeLessThan(-10);
  expect(errors).toEqual([]);
  await writeFile(`${output}/after-trace.json`, JSON.stringify({
    phase: 'after', source: 'working tree', baselineRevision: baseline.baselineRevision,
    viewport: { width: 960, height: 600 }, dpr: 1, hz: 60,
    measurement: baseline.measurement, summary, checkpoints, errors, ...trace,
  }, null, 2));
  await page.evaluate(() => (window as any).exposureHarness.dispose());
});

test('release freezes the complete picture and follows one 1.05 second fade curve', async ({ page }) => {
  await openPausedScene(page);
  const scene = page.locator('[data-ready="true"]');
  await expect(scene).toBeVisible();
  await page.keyboard.down('Space');
  await page.clock.runFor(8000);
  await page.keyboard.up('Space');
  await page.evaluate(() => {
    const canvas = document.querySelector('.scene-trails') as HTMLCanvasElement;
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    (window as any).fadeReference = { data, releasedAt: performance.now() };
  });
  const measurements = [];
  for (const milliseconds of [250, 350]) {
    await page.clock.runFor(milliseconds);
    const measure = await page.evaluate(() => {
      const canvas = document.querySelector('.scene-trails') as HTMLCanvasElement;
      const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
      const reference = (window as any).fadeReference;
      let originalSquared = 0;
      let product = 0;
      let sumOriginal = 0;
      for (let i = 3; i < pixels.length; i += 4) {
        originalSquared += reference.data[i] ** 2;
        product += reference.data[i] * pixels[i];
        sumOriginal += reference.data[i];
      }
      const fittedScale = product / originalSquared;
      let error = 0;
      for (let i = 3; i < pixels.length; i += 4) error += Math.abs(pixels[i] - reference.data[i] * fittedScale);
      const elapsed = (performance.now() - reference.releasedAt) / 1000;
      const t = Math.min(1, elapsed / 1.05);
      return { elapsed, fittedScale, expectedScale: 1 - t * t * (3 - 2 * t), normalizedShapeError: error / sumOriginal };
    });
    measurements.push(measure);
    expect(Math.abs(measure.fittedScale - measure.expectedScale)).toBeLessThan(.035);
    expect(measure.normalizedShapeError).toBeLessThan(.015);
  }
  await page.clock.runFor(500);
  await expect(scene).toHaveAttribute('data-state', 'idle');
  await writeFile(`${output}/release-curve.json`, JSON.stringify(measurements, null, 2));
});

test('resuming a fading exposure does not flash, restart or detach its old trails', async ({ page }) => {
  await openPausedScene(page);
  const alpha = () => page.locator('.scene-trails').evaluate((canvas: HTMLCanvasElement) => {
    const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let total = 0;
    for (let i = 3; i < pixels.length; i += 4) total += pixels[i];
    return total;
  });
  await page.keyboard.down('Space');
  await page.clock.runFor(8000);
  const changes = [];
  for (let repetition = 0; repetition < 6; repetition++) {
    await page.keyboard.up('Space');
    await page.clock.runFor(repetition === 0 ? 600 : 110);
    const before = await alpha();
    await page.keyboard.down('Space');
    await page.clock.runFor(16);
    const after = await alpha();
    const changePercent = (after / before - 1) * 100;
    changes.push({ repetition, before, after, changePercent });
    await page.clock.runFor(160);
  }
  await page.keyboard.up('Space');
  await page.clock.runFor(1200);
  expect(await alpha()).toBe(0);
  await writeFile(`${output}/resume-continuity.json`, JSON.stringify(changes, null, 2));
  for (const change of changes) expect(Math.abs(change.changePercent)).toBeLessThan(5);
});

test('high DPR touch viewport remains continuous at 144 Hz', async ({ browser }) => {
  test.setTimeout(60_000);
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:5180', viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  try {
    const page = await context.newPage();
    await installExposureHarness(page, '/src/engine/StarTrailEngine.ts', { hz: 144 });
    const trace = await advanceExposure(page, 8);
    const stats = await page.evaluate(() => (window as any).exposureHarness.stats());
    const summary = summarizeExposure(trace.frames, 3, 8);
    expect(stats.canvasWidth).toBe(Math.round(390 * 1.75));
    expect(summary.worstDropPercent).toBeGreaterThan(-5);
    expect(summary.negativeJumpsOver5Percent).toBe(0);
    expect(stats.maxHistoryCount).toBeLessThanOrEqual(384);
    await writeFile(`${output}/high-dpr-stability.json`, JSON.stringify({ deviceDpr: 3, drawingDpr: 1.75, hz: 144, summary, stats, ...trace }, null, 2));
    await page.evaluate(() => (window as any).exposureHarness.dispose());
  } finally { await context.close(); }
});

test('the flicker report loads all 256 frames and steps across the measured dip', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/docs/flicker-analysis.html');
  await expect(page.locator('#headline')).toContainText('新版三个长按窗口超过 5% 的骤降均为 0 次');
  await page.locator('#video').evaluate((video: HTMLVideoElement) => new Promise<void>((resolve, reject) => {
    if (video.readyState >= 1) resolve();
    else {
      video.addEventListener('loadedmetadata', () => resolve(), { once: true });
      video.addEventListener('error', () => reject(new Error('Flicker recording failed to load')), { once: true });
    }
  }));
  await page.locator('#frame-input').fill('169');
  await page.locator('#frame-input').press('Tab');
  await expect(page.locator('#frame-label')).toHaveText('F169 · 7.042 s');
  await page.locator('#next').click();
  await expect(page.locator('#frame-label')).toHaveText('F170 · 7.083 s');
  await expect.poll(() => page.locator('#video').evaluate((video: HTMLVideoElement) => video.seeking)).toBe(false);
  expect(await page.locator('#video').evaluate((video: HTMLVideoElement) => video.currentTime)).toBeCloseTo(170.5 / 24, 3);
  await expect(page.locator('#frame-table tr.selected')).toContainText('-13.35%');
  expect(await page.evaluate(() => (window as any).STABILITY_REPORT.input.frames.length)).toBe(256);
  await page.screenshot({ path: `${output}/flicker-report.png` });
  expect(errors).toEqual([]);
});

test('fractional drawing DPR preserves the frozen picture without resampling', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:5180', viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
  try {
    const page = await context.newPage();
    await openPausedScene(page);
    await page.keyboard.down('Space');
    await page.clock.runFor(8000);
    await page.locator('.scene-trails').evaluate((canvas: HTMLCanvasElement) => {
      (window as any).frozenDprReference = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    });
    await page.keyboard.up('Space');
    await page.clock.runFor(16);
    const measured = await page.locator('.scene-trails').evaluate((canvas: HTMLCanvasElement) => {
      const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
      const original = (window as any).frozenDprReference;
      let sum = 0;
      let difference = 0;
      for (let i = 3; i < pixels.length; i += 4) {
        sum += original[i];
        difference += Math.abs(pixels[i] - original[i]);
      }
      return { width: canvas.width, height: canvas.height, relativeDifference: difference / sum };
    });
    await writeFile(`${output}/fractional-dpr-freeze.json`, JSON.stringify(measured, null, 2));
    expect(measured.relativeDifference).toBeLessThan(.015);
  } finally { await context.close(); }
});
