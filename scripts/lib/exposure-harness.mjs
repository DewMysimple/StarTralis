/** Real Canvas pixels at a controlled 60 Hz. Readback happens outside render time.
 * No app code or test instrumentation is shipped in the production bundle.
 */
export async function installExposureHarness(page, engineUrl, { attribution = false, hz = 60 } = {}) {
  await page.goto('/');
  await page.locator('[data-ready="true"]').waitFor();
  await page.evaluate(async ({ engineUrl, attribution, hz }) => {
    const { StarTrailEngine } = await import(engineUrl);
    const originalRaf = window.requestAnimationFrame;
    const originalCancel = window.cancelAnimationFrame;
    const nowDescriptor = Object.getOwnPropertyDescriptor(performance, 'now');
    const realNow = performance.now.bind(performance);
    let time = 1000;
    let callback = null;
    let frame = 0;
    const frames = [];
    const replacements = [];
    const probe = document.createElement('canvas');
    probe.width = 240;
    probe.height = 150;
    const probeContext = probe.getContext('2d', { willReadFrequently: true });
    const sample = canvas => {
      probeContext.clearRect(0, 0, 240, 150);
      probeContext.drawImage(canvas, 0, 0, 240, 150);
      const pixels = probeContext.getImageData(0, 0, 240, 150).data;
      let alpha = 0;
      let luma = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        alpha += pixels[i + 3];
        luma += (.2126 * pixels[i] + .7152 * pixels[i + 1] + .0722 * pixels[i + 2]) * pixels[i + 3] / 255;
      }
      return { alpha, luma };
    };
    const background = document.querySelector('.scene-background').cloneNode();
    const display = document.querySelector('.scene-trails').cloneNode();
    document.querySelector('.scene-background').replaceWith(background);
    document.querySelector('.scene-trails').replaceWith(display);
    const scene = document.querySelector('.starfield-scene');
    const engine = new StarTrailEngine(background, display, state => { scene.dataset.state = state; });
    engine.resize(innerWidth, innerHeight);
    let attributionMs = 0;
    if (attribution && typeof engine.rebuildHistory === 'function') {
      const original = engine.rebuildHistory.bind(engine);
      engine.rebuildHistory = now => {
        let started = realNow();
        const before = sample(engine.historyCanvas);
        attributionMs += realNow() - started;
        original(now);
        started = realNow();
        const after = sample(engine.historyCanvas);
        attributionMs += realNow() - started;
        replacements.push({ time: now - 1, before: before.luma, after: after.luma, changePercent: (after.luma / before.luma - 1) * 100 });
      };
    }
    const patch = () => {
      window.requestAnimationFrame = next => { if (callback) throw new Error('More than one RAF was scheduled.'); callback = next; return 1; };
      window.cancelAnimationFrame = () => { callback = null; };
      Object.defineProperty(performance, 'now', { configurable: true, value: () => time });
    };
    const restore = () => {
      window.requestAnimationFrame = originalRaf;
      window.cancelAnimationFrame = originalCancel;
      if (nowDescriptor) Object.defineProperty(performance, 'now', nowDescriptor);
      else delete performance.now;
    };
    const withClock = action => { patch(); try { return action(); } finally { restore(); } };
    withClock(() => engine.setPressed(true));
    const step = () => {
      frame++;
      time = 1000 + frame * 1000 / hz;
      const next = callback;
      callback = null;
      if (!next) throw new Error('Animation ended during a hold.');
      const previousReadMs = attributionMs;
      const start = realNow();
      next(time);
      const renderMs = realNow() - start - (attributionMs - previousReadMs);
      const readStarted = realNow();
      const metrics = sample(display);
      const prior = frames.at(-1)?.luma ?? 0;
      frames.push({ frame, time: frame / hz, ...metrics, changePercent: prior > 0 ? (metrics.luma / prior - 1) * 100 : 0, renderMs, readbackMs: realNow() - readStarted });
    };
    window.exposureHarness = {
      advance(seconds) {
        withClock(() => { while (frame < Math.round(seconds * hz)) step(); });
        return { frames, replacements };
      },
      stats() {
        return {
          particleCount: engine.particles.length,
          maxHistoryCount: Math.max(...engine.particles.map(star => star.historyCount)),
          maxArcRadians: Math.max(...engine.particles.filter(star => star.historyCount > 1).map(star => {
            let offset = star.historyCount - 1;
            const now = engine.motionTime ?? time / 1000;
            while (offset > 0 && now - star.times[star.indexBehind(offset)] > star.lifetime) offset--;
            return star.angles[star.indexBehind(offset)] - star.angle;
          })),
          canvasWidth: display.width, canvasHeight: display.height,
          state: scene.dataset.state,
        };
      },
      dispose() { withClock(() => engine.dispose()); },
    };
  }, { engineUrl, attribution, hz });
}

export async function advanceExposure(page, seconds) {
  return page.evaluate(seconds => window.exposureHarness.advance(seconds), seconds);
}

export function summarizeExposure(frames, from = 3, to = 8, rebuildTimes = []) {
  const selected = frames.filter(frame => frame.time >= from && frame.time <= to);
  const changes = selected.map(frame => frame.changePercent).sort((a, b) => a - b);
  // RAF rounding drifts the old now+0.45 schedule away from zero-phase exact
  // multiples. Include the actual old rebuild frames, as well as nominal times.
  const periodWindows = selected.filter(frame => Math.abs(frame.time / .45 - Math.round(frame.time / .45)) < 2 / 60 / .45 || rebuildTimes.some(time => Math.abs(time - frame.time) <= 1 / 60 + 1e-6));
  return {
    from, to, frames: selected.length,
    worstDropPercent: changes[0],
    negativeJumpsOver5Percent: changes.filter(value => value < -5).length,
    worstNear450msPercent: Math.min(...periodWindows.map(frame => frame.changePercent)),
  };
}
