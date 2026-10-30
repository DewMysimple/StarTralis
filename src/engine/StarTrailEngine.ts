import { randomGenerator, smoothstep, StarParticle, TAU } from './StarParticle';

export type SceneState = 'idle' | 'pressing' | 'releasing';
type StateListener = (state: SceneState) => void;
type DeviceHints = Navigator & { deviceMemory?: number };

const TRAIL_DECAY = .22;
const RELEASE_DECAY = 2.8;
const RELEASE_DURATION = 1.05;

/**
 * Two visible layers: immutable background and transparent animated presentation.
 * A persistent offscreen canvas accumulates real motion segments. Presentation
 * copies that history and adds crisp heads, so head glow never burns into tails.
 */
export class StarTrailEngine {
  private readonly background: CanvasRenderingContext2D;
  private readonly display: CanvasRenderingContext2D;
  private readonly historyCanvas = document.createElement('canvas');
  private readonly history: CanvasRenderingContext2D;
  private readonly glow = document.createElement('canvas');
  private particles: StarParticle[] = [];
  private state: SceneState = 'idle';
  private animationFrame = 0;
  private previousTime = 0;
  private pressStarted = 0;
  private releaseStarted = 0;
  private rebuildAt = 0;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private centerX = 0;
  private centerY = 0;
  private reducedMotion = false;
  private disposed = false;
  private slowFrames = 0;
  private drawBudget = 420;

  constructor(
    private readonly backgroundCanvas: HTMLCanvasElement,
    private readonly displayCanvas: HTMLCanvasElement,
    private readonly onStateChange: StateListener,
  ) {
    const background = backgroundCanvas.getContext('2d', { alpha: true });
    const display = displayCanvas.getContext('2d', { alpha: true });
    const history = this.historyCanvas.getContext('2d', { alpha: true });
    if (!background || !display || !history) throw new Error('Canvas 2D is unavailable.');
    this.background = background;
    this.display = display;
    this.history = history;
    this.createGlow();
  }

  setReducedMotion(value: boolean) {
    this.reducedMotion = value;
  }

  resize(width: number, height: number) {
    if (this.disposed || width < 1 || height < 1) return;
    const mobile = width <= 600;
    const hints = navigator as DeviceHints;
    const lowPower = (hints.hardwareConcurrency || 8) <= 4 || (hints.deviceMemory || 8) <= 4;
    const cap = lowPower ? 1.25 : mobile ? 1.75 : 2;
    const dpr = Math.min(window.devicePixelRatio || 1, cap, Math.max(1, Math.sqrt(6_000_000 / (width * height))));
    if (this.width === width && this.height === height && this.dpr === dpr) return;
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.centerX = width * .5;
    this.centerY = height * (mobile ? .65 : .67);
    for (const canvas of [this.backgroundCanvas, this.displayCanvas, this.historyCanvas]) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.getContext('2d')!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    const random = randomGenerator(0xa57a1);
    const count = this.reducedMotion ? 180 : mobile ? lowPower ? 240 : 280 : lowPower ? 360 : 480;
    this.particles = Array.from({ length: count }, () => new StarParticle(random, width, height, this.centerY));
    this.drawBudget = count;
    this.drawBackground();
    this.rebuildAt = 0;
    if (this.state === 'pressing') this.pressStarted = performance.now() / 1000;
    else if (this.state === 'releasing') this.finishRelease();
  }

  setPressed(pressed: boolean) {
    if (this.disposed || !this.width || document.hidden) return;
    if (pressed && this.state !== 'pressing') {
      const now = performance.now() / 1000;
      const resuming = this.state === 'releasing';
      if (resuming) {
        const elapsed = now - this.releaseStarted;
        const visibility = this.releaseVisibility(elapsed);
        this.erase(1 - visibility);
        const factor = Math.exp(-RELEASE_DECAY * elapsed) * visibility;
        for (const star of this.particles) star.attenuateHistory(factor);
      }
      for (const star of this.particles) {
        star.previousX = this.centerX + star.radius * Math.cos(star.angle);
        star.previousY = this.centerY + star.radius * Math.sin(star.angle);
        if (!resuming) star.resetHistory();
        if (star.active) star.record(now, 0, true);
      }
      this.pressStarted = now;
      this.rebuildAt = now + .45;
      this.setState('pressing');
      this.startLoop();
    } else if (!pressed && this.state === 'pressing') {
      this.releaseStarted = performance.now() / 1000;
      this.setState('releasing');
      this.startLoop();
    }
  }

  /** Hidden pages stop all work and return to a clean idle sky on resume. */
  suspend() {
    cancelAnimationFrame(this.animationFrame);
    this.animationFrame = 0;
    this.previousTime = 0;
    this.finishRelease();
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.animationFrame);
    this.animationFrame = 0;
    this.particles = [];
    this.historyCanvas.width = this.historyCanvas.height = 0;
    this.glow.width = this.glow.height = 0;
  }

  private setState(state: SceneState) {
    if (state === this.state) return;
    this.state = state;
    this.onStateChange(state);
  }

  private startLoop() {
    if (this.animationFrame || this.disposed) return;
    this.previousTime = performance.now() / 1000;
    this.animationFrame = requestAnimationFrame(this.tick);
  }

  private readonly tick = (timestamp: number) => {
    this.animationFrame = 0;
    if (this.disposed || document.hidden || this.state === 'idle') return;
    const now = timestamp / 1000;
    const dt = Math.min(.05, Math.max(0, now - this.previousTime));
    this.previousTime = now;
    const started = performance.now();
    if (this.state === 'pressing') {
      this.erase(1 - Math.exp(-TRAIL_DECAY * dt));
      this.advance(now, dt);
      // Rebase from bounded, real samples to eliminate 8-bit alpha rounding
      // residue. Without this, very long holds slowly turn into complete rings.
      if (now >= this.rebuildAt) {
        this.rebuildHistory(now);
        this.rebuildAt = now + .45;
      }
      this.present(1, 1);
    } else {
      const elapsed = now - this.releaseStarted;
      if (elapsed >= RELEASE_DURATION) {
        this.finishRelease();
        return;
      }
      this.erase(1 - Math.exp(-RELEASE_DECAY * dt));
      this.present(this.releaseVisibility(elapsed), Math.exp(-RELEASE_DECAY * elapsed));
    }
    // A sustained expensive render reduces future emission, while its existing
    // history is allowed to fade. The particle array stays bounded and stable.
    if (performance.now() - started > 13) this.slowFrames++;
    else this.slowFrames = Math.max(0, this.slowFrames - 1);
    if (this.slowFrames > 90 && this.drawBudget > 200) {
      this.drawBudget = Math.max(200, Math.floor(this.drawBudget * .88));
      this.slowFrames = 0;
    }
    this.animationFrame = requestAnimationFrame(this.tick);
  };

  private advance(now: number, dt: number) {
    const elapsed = now - this.pressStarted;
    const startup = smoothstep(elapsed / .34);
    const speed = startup * (this.reducedMotion ? .2 : 1);
    const ctx = this.history;
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineCap = 'round';
    for (let i = 0; i < this.particles.length; i++) {
      const star = this.particles[i];
      if (i >= this.drawBudget) { star.headAlpha *= Math.exp(-dt * 3); continue; }
      if (!star.active && elapsed < star.activationDelay) continue;
      if (!star.active) {
        star.active = true;
        star.activatedAt = now;
        star.record(now, 0, true);
      }
      const activation = smoothstep((now - star.activatedAt) / .2);
      if (activation <= 0) continue;
      const oldAngle = star.angle;
      star.angle += star.direction * star.angularVelocity * dt * speed;
      const shimmer = .93 + .07 * Math.sin(now * .65 + star.phase);
      star.headAlpha = Math.min(1, star.brightness * .9 + .48) * startup * shimmer * activation;
      const exposure = star.brightness * startup * shimmer * activation;
      ctx.lineWidth = star.size;
      ctx.strokeStyle = `rgba(${star.color},${exposure})`;
      ctx.beginPath();
      ctx.arc(this.centerX, this.centerY, star.radius, oldAngle, star.angle, true);
      ctx.stroke();
      star.previousX = this.centerX + star.radius * Math.cos(star.angle);
      star.previousY = this.centerY + star.radius * Math.sin(star.angle);
      star.record(now, exposure, now >= this.rebuildAt);
    }
  }

  private erase(alpha: number) {
    const ctx = this.history;
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = `rgba(0,0,0,${Math.min(1, Math.max(0, alpha))})`;
    ctx.fillRect(0, 0, this.historyCanvas.width / this.dpr, this.historyCanvas.height / this.dpr);
    ctx.globalCompositeOperation = 'source-over';
  }

  private rebuildHistory(now: number) {
    const ctx = this.history;
    this.clearCanvas(ctx);
    ctx.lineCap = 'round';
    // A conic opacity ramp follows actual angle/time samples. One continuous
    // stroke per star avoids visible joints between temporal opacity bands.
    // No generated arc exceeds its bounded, recorded motion history.
    for (const star of this.particles) {
      if (star.historyCount < 2) continue;
      let oldestOffset = 0;
      while (oldestOffset < star.historyCount - 1 && now - star.times[star.indexBehind(oldestOffset + 1)] <= star.lifetime) {
        oldestOffset++;
      }
      if (!oldestOffset) continue;
      const newest = star.historyCursor;
      const oldest = star.indexBehind(oldestOffset);
      const newestAngle = star.angles[newest];
      if (star.angles[oldest] - newestAngle < .000001) continue;
      const gradient = ctx.createConicGradient(newestAngle, this.centerX, this.centerY);
      // About one stop per 0.3 s. The glow sprite remains independently cached.
      ctx.lineWidth = star.size;
      let offset = 0;
      while (true) {
        const index = star.indexBehind(offset);
        const age = now - star.times[index];
        const edge = smoothstep((star.lifetime - age) / .8);
        const exposure = star.exposures[index] * Math.exp(-TRAIL_DECAY * age) * edge;
        const position = Math.min(1, Math.max(0, (star.angles[index] - newestAngle) / TAU));
        gradient.addColorStop(position, `rgba(${star.color},${exposure})`);
        if (offset === oldestOffset) break;
        offset = Math.min(oldestOffset, offset + 9);
      }
      ctx.strokeStyle = gradient;
      ctx.beginPath();
      ctx.arc(this.centerX, this.centerY, star.radius, star.angles[oldest], newestAngle, true);
      ctx.stroke();
    }
  }

  private releaseVisibility(elapsed: number) {
    return 1 - smoothstep(elapsed / RELEASE_DURATION);
  }

  private present(opacity: number, headFade: number) {
    const ctx = this.display;
    this.clearCanvas(ctx);
    ctx.globalAlpha = opacity;
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(this.historyCanvas, 0, 0, this.width, this.height);
    for (const star of this.particles) {
      if (!star.active || star.headAlpha < .005) continue;
      const x = star.previousX;
      const y = star.previousY;
      if (x < -12 || y < -12 || x > this.width + 12 || y > this.height + 12) continue;
      const alpha = star.headAlpha * headFade;
      if (star.glowFactor > 0) {
        const size = star.glowFactor > .5 ? 16 : 8;
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = opacity * alpha * star.glowFactor * .75;
        ctx.drawImage(this.glow, x - size / 2, y - size / 2, size, size);
        ctx.globalCompositeOperation = 'source-over';
      }
      ctx.globalAlpha = opacity * alpha;
      ctx.fillStyle = `rgb(${star.color})`;
      ctx.beginPath();
      ctx.arc(x, y, star.size * .86 + .12, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // Do not call setState, allocate particles, or trigger a React render here.
  }

  private finishRelease() {
    this.clearCanvas(this.history);
    this.clearCanvas(this.display);
    for (const star of this.particles) star.resetHistory();
    this.setState('idle');
    this.previousTime = 0;
  }

  private clearCanvas(ctx: CanvasRenderingContext2D) {
    // CSS width * fractional DPR can round up by half a device pixel. Clear in
    // backing-store coordinates so no antialiased fringe survives at an edge.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  private createGlow() {
    this.glow.width = this.glow.height = 48;
    const ctx = this.glow.getContext('2d')!;
    const gradient = ctx.createRadialGradient(24, 24, 0, 24, 24, 24);
    gradient.addColorStop(0, 'rgba(235,243,255,.8)');
    gradient.addColorStop(.12, 'rgba(220,233,255,.32)');
    gradient.addColorStop(.42, 'rgba(192,215,246,.055)');
    gradient.addColorStop(1, 'rgba(192,215,246,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 48, 48);
  }

  private drawBackground() {
    const ctx = this.background;
    this.clearCanvas(ctx);
    const random = randomGenerator(0x57a25);
    const count = this.width <= 600 ? 165 : 205;
    for (let i = 0; i < count; i++) {
      const x = random() * this.width;
      const y = random() * this.height;
      const bright = random() > .965;
      const size = bright ? .65 + random() * .35 : .25 + random() * .42;
      const alpha = bright ? .48 + random() * .2 : .08 + random() * .24;
      ctx.fillStyle = `rgba(199,211,230,${alpha})`;
      ctx.beginPath();
      ctx.arc(x, y, size, 0, TAU);
      ctx.fill();
    }
  }
}
