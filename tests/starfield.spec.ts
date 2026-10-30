import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { writeFile } from 'node:fs/promises';

const evidenceDirectory = 'docs/verification';
const scene = (page: Page) => page.getByRole('button', { name: /^Astral Flow/ });

async function openScene(page: Page) {
  await page.goto('/');
  await expect(scene(page)).toHaveAttribute('data-ready', 'true');
}

async function canvasMetrics(page: Page, selector = '.scene-trails') {
  return page.locator(selector).evaluate((canvas: HTMLCanvasElement) => {
    const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let alpha = 0;
    let visible = 0;
    let checksum = 0;
    for (let offset = 0; offset < pixels.length; offset += 4) {
      alpha += pixels[offset + 3];
      if (pixels[offset + 3] > 12) visible++;
      checksum = (checksum + pixels[offset] * 3 + pixels[offset + 1] * 5 + pixels[offset + 2] * 7 + pixels[offset + 3]) >>> 0;
    }
    return { alpha, visible, checksum, width: canvas.width, height: canvas.height };
  });
}

test('exposure builds progressively, then fades without altering the sky or composition', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await mkdir(evidenceDirectory, { recursive: true });
  await page.clock.install();
  await openScene(page);
  await expect(scene(page)).toHaveAttribute('data-state', 'idle');
  const backgroundBefore = await canvasMetrics(page, '.scene-background');
  expect((await canvasMetrics(page)).alpha).toBe(0);
  await page.screenshot({ path: `${evidenceDirectory}/desktop-idle.png` });
  await page.mouse.move(100, 100);
  await page.mouse.down();
  await page.clock.runFor(500);
  const short = await canvasMetrics(page);
  expect(short.visible).toBeGreaterThan(60);
  await page.screenshot({ path: `${evidenceDirectory}/desktop-hold-0.5s.png` });
  await page.clock.runFor(1500);
  const twoSeconds = await canvasMetrics(page);
  expect(twoSeconds.alpha).toBeGreaterThan(short.alpha * 2);
  await page.screenshot({ path: `${evidenceDirectory}/desktop-hold-2s.png` });
  await page.clock.runFor(6000);
  const eightSeconds = await canvasMetrics(page);
  expect(eightSeconds.visible).toBeGreaterThan(twoSeconds.visible * 1.3);
  await page.screenshot({ path: `${evidenceDirectory}/desktop-hold-8s.png` });
  await page.mouse.up();
  await expect(scene(page)).toHaveAttribute('data-state', 'releasing');
  await page.clock.runFor(250);
  const fade250 = await canvasMetrics(page);
  expect(fade250.alpha).toBeGreaterThan(0);
  expect(fade250.alpha).toBeLessThan(eightSeconds.alpha);
  await page.screenshot({ path: `${evidenceDirectory}/desktop-release-0.25s.png` });
  await page.clock.runFor(350);
  const fade600 = await canvasMetrics(page);
  expect(fade600.alpha).toBeLessThan(fade250.alpha * .5);
  await page.screenshot({ path: `${evidenceDirectory}/desktop-release-0.6s.png` });
  await page.clock.runFor(500);
  await expect(scene(page)).toHaveAttribute('data-state', 'idle');
  expect((await canvasMetrics(page)).alpha).toBe(0);
  const backgroundAfter = await canvasMetrics(page, '.scene-background');
  expect(backgroundAfter.alpha).toBe(backgroundBefore.alpha);
  expect(backgroundAfter.visible).toBe(backgroundBefore.visible);
  // A GPU->CPU canvas readback may round unpremultiplied RGB by one level.
  expect(Math.abs(backgroundAfter.checksum - backgroundBefore.checksum)).toBeLessThan(backgroundBefore.checksum * .001);
  await expect(page.getByRole('heading', { name: 'Astral Flow' })).toBeVisible();
  await expect(page.locator('.celestial-center')).toBeVisible();
  await page.screenshot({ path: `${evidenceDirectory}/desktop-released.png` });
  expect(errors).toEqual([]);
  const evidence = JSON.stringify({ short, twoSeconds, eightSeconds, fade250, fade600, backgroundBefore, backgroundAfter, errors }, null, 2);
  await writeFile(`${evidenceDirectory}/exposure-measurements.json`, evidence);
  await testInfo.attach('measured-exposure', { body: evidence, contentType: 'application/json' });
});

test('long exposure remains varied at 46 seconds and can resume while fading', async ({ page }) => {
  test.setTimeout(90_000);
  await page.clock.install();
  await openScene(page);
  await page.keyboard.down('Space');
  await page.clock.runFor(46_000);
  await expect(scene(page)).toHaveAttribute('data-state', 'pressing');
  const before = await canvasMetrics(page);
  expect(before.visible).toBeGreaterThan(10_000);
  await page.screenshot({ path: `${evidenceDirectory}/desktop-hold-46s.png` });
  await page.keyboard.up('Space');
  await page.clock.runFor(320);
  await page.keyboard.down('Enter');
  await page.clock.runFor(500);
  await expect(scene(page)).toHaveAttribute('data-state', 'pressing');
  expect((await canvasMetrics(page)).alpha).toBeGreaterThan(0);
  await page.keyboard.up('Enter');
  await page.clock.runFor(1200);
  await expect(scene(page)).toHaveAttribute('data-state', 'idle');
});

test('pointer capture, cancellation, keyboard chords, blur and visibility release correctly', async ({ page }) => {
  await page.clock.install();
  await openScene(page);
  await page.mouse.click(100, 100, { button: 'right' });
  await expect(scene(page)).toHaveAttribute('data-state', 'idle');
  await page.mouse.move(80, 80);
  await page.mouse.down();
  await page.clock.runFor(600);
  await page.keyboard.down('Space');
  await page.keyboard.down('Space');
  await page.mouse.move(-50, -50);
  await page.mouse.up();
  await expect(scene(page)).toHaveAttribute('data-state', 'pressing');
  await page.keyboard.up('Space');
  await expect(scene(page)).toHaveAttribute('data-state', 'releasing');
  await page.clock.runFor(1200);
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.mouse.move(80 + attempt * 20, 80);
    await page.mouse.down();
    await page.clock.runFor(350);
    await page.mouse.move(1500, 1000);
    await page.mouse.up();
    await expect(scene(page)).toHaveAttribute('data-state', 'releasing');
    await page.clock.runFor(1200);
  }
  await page.mouse.move(100, 100);
  await page.mouse.down();
  await scene(page).dispatchEvent('pointercancel', { pointerId: 1 });
  await expect(scene(page)).toHaveAttribute('data-state', 'releasing');
  await page.mouse.up();
  await page.keyboard.down('Enter');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(scene(page)).toHaveAttribute('data-state', 'releasing');
  await page.keyboard.up('Enter');
  await page.keyboard.down('Space');
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(scene(page)).toHaveAttribute('data-state', 'idle');
  expect((await canvasMetrics(page)).alpha).toBe(0);
});

for (const dimensions of [
  { width: 1920, height: 1080 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
]) {
  test(`${dimensions.width} x ${dimensions.height}: composition, resize and exposure`, async ({ page }) => {
    await page.clock.install();
    await page.setViewportSize(dimensions);
    await openScene(page);
    await page.clock.runFor(100);
    const ring = await page.locator('.celestial-center').boundingBox();
    expect(ring).not.toBeNull();
    expect(ring!.x + ring!.width / 2).toBeCloseTo(dimensions.width / 2, 0);
    expect(ring!.y + ring!.height / 2).toBeCloseTo(dimensions.height * (dimensions.width <= 600 ? .65 : .67), 0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(dimensions.width);
    const heading = await page.getByRole('heading').boundingBox();
    expect(heading!.x).toBeGreaterThan(0);
    expect(heading!.x + heading!.width).toBeLessThan(dimensions.width);
    await page.screenshot({ path: `${evidenceDirectory}/${dimensions.width}x${dimensions.height}-idle.png` });
    await page.mouse.move(20, 20);
    await page.mouse.down();
    await page.clock.runFor(8000);
    expect((await canvasMetrics(page)).visible).toBeGreaterThan(1500);
    await page.screenshot({ path: `${evidenceDirectory}/${dimensions.width}x${dimensions.height}-hold-8s.png` });
    await page.setViewportSize({ width: dimensions.width - 10, height: dimensions.height - 10 });
    await page.clock.runFor(700);
    await page.mouse.up();
    await page.clock.runFor(1200);
    await expect(scene(page)).toHaveAttribute('data-state', 'idle');
    expect((await canvasMetrics(page)).alpha).toBe(0);
  });
}

test('real touch pointer events and high DPR stay sharp and release', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  const page = await context.newPage();
  await page.clock.install();
  await openScene(page);
  const client = await context.newCDPSession(page);
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 90, y: 200 }] });
  await page.clock.runFor(2000);
  await expect(scene(page)).toHaveAttribute('data-state', 'pressing');
  const metrics = await canvasMetrics(page);
  expect(metrics.visible).toBeGreaterThan(1000);
  expect(metrics.width).toBe(Math.round(390 * 1.75));
  await page.screenshot({ path: `${evidenceDirectory}/mobile-touch-dpr3.png` });
  await client.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await page.clock.runFor(1200);
  await expect(scene(page)).toHaveAttribute('data-state', 'idle');
  expect((await canvasMetrics(page)).alpha).toBe(0);
  await context.close();
});

test('reduced motion keeps explicit interaction and respects user preference', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.install();
  await openScene(page);
  await page.clock.runFor(1000);
  expect((await canvasMetrics(page)).alpha).toBe(0);
  await page.keyboard.down('Enter');
  await page.clock.runFor(1500);
  expect((await canvasMetrics(page)).visible).toBeGreaterThan(30);
  await page.keyboard.up('Enter');
  await page.clock.runFor(1200);
  await expect(scene(page)).toHaveAttribute('data-state', 'idle');
});

test('60, 120 and 144 Hz advance the same independent celestial orbits', async ({ page }) => {
  await openScene(page);
  const measurements = await page.evaluate(async () => {
    const { StarTrailEngine } = await import('/src/engine/StarTrailEngine.ts');
    const originalRaf = window.requestAnimationFrame;
    const originalCancel = window.cancelAnimationFrame;
    const originalNowDescriptor = Object.getOwnPropertyDescriptor(performance, 'now');
    let clock = 1000;
    let scheduled: FrameRequestCallback | null = null;
    window.requestAnimationFrame = callback => { scheduled = callback; return 1; };
    window.cancelAnimationFrame = () => { scheduled = null; };
    Object.defineProperty(performance, 'now', { configurable: true, value: () => clock });
    const results: { hz: number; displacements: number[] }[] = [];
    try {
      for (const hz of [60, 120, 144]) {
        clock = 1000;
        const engine = new StarTrailEngine(document.createElement('canvas'), document.createElement('canvas'), () => {});
        engine.resize(240, 200);
        const particles = (engine as unknown as { particles: { angle: number }[] }).particles;
        const initial = particles.map(star => star.angle);
        engine.setPressed(true);
        for (let frame = 1; frame <= hz * 8; frame++) {
          clock = 1000 + frame * 1000 / hz;
          const callback = scheduled as FrameRequestCallback | null;
          scheduled = null;
          if (!callback) throw new Error('The animation loop stopped before release.');
          callback(clock);
        }
        results.push({ hz, displacements: particles.map((star, i) => star.angle - initial[i]) });
        engine.dispose();
      }
    } finally {
      window.requestAnimationFrame = originalRaf;
      window.cancelAnimationFrame = originalCancel;
      if (originalNowDescriptor) Object.defineProperty(performance, 'now', originalNowDescriptor);
      else delete (performance as Partial<Performance>).now;
    }
    return results;
  });
  const reference = measurements[0].displacements;
  const differences = measurements.slice(1).map(result => ({
    hz: result.hz,
    maxAngularDifference: Math.max(...result.displacements.map((angle, i) => Math.abs(angle - reference[i]))),
  }));
  for (const result of differences) expect(result.maxAngularDifference).toBeLessThan(.012);
  await writeFile(`${evidenceDirectory}/refresh-rate-measurements.json`, JSON.stringify(differences, null, 2));
});

test('the reference report loads all frames, seeks the original video and steps once', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/docs/reference-analysis.html');
  await expect(page.locator('#frame-label')).toHaveText('F0000 · 0.000 s');
  await page.locator('#video').evaluate((video: HTMLVideoElement) => new Promise<void>((resolve, reject) => {
    if (video.readyState >= 1) resolve();
    else { video.addEventListener('loadedmetadata', () => resolve(), { once: true }); video.addEventListener('error', () => reject(new Error('Reference video failed to load')), { once: true }); }
  }));
  await page.locator('#frame-input').fill('240');
  await page.locator('#frame-input').press('Tab');
  await expect(page.locator('#frame-label')).toHaveText('F0240 · 8.000 s');
  await expect.poll(() => page.locator('#video').evaluate((video: HTMLVideoElement) => video.seeking)).toBe(false);
  expect(await page.locator('#video').evaluate((video: HTMLVideoElement) => video.currentTime)).toBeCloseTo(8 + .5 / 30, 3);
  await page.getByRole('button', { name: '后一帧 →' }).click();
  await expect(page.locator('#frame-label')).toHaveText('F0241 · 8.033 s');
  expect(await page.evaluate(() => (window as unknown as { ASTRAL_REFERENCE: { frames: unknown[] } }).ASTRAL_REFERENCE.frames.length)).toBe(1518);
  await page.screenshot({ path: `${evidenceDirectory}/reference-report.png`, fullPage: false });
  expect(errors).toEqual([]);
});
