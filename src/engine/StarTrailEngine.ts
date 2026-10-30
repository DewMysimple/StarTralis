import { randomGenerator, smoothstep, StarParticle, TAU } from './StarParticle';

export type SceneState = 'idle' | 'pressing' | 'releasing';
type StateListener = (state: SceneState) => void;
type DeviceHints = Navigator & { deviceMemory?: number };

const TRAIL_DECAY = .22;
const RELEASE_DURATION = 1.05;

/**
 * Two visible layers: immutable background and transparent animated presentation.
 * Every pressing frame uses the same finite, recorded motion history and opacity
 * function. Release freezes the entire presentation and fades that one image.
 */
export class StarTrailEngine {
  private readonly background: CanvasRenderingContext2D;
  private readonly display: CanvasRenderingContext2D;
  private readonly frozenCanvas = document.createElement('canvas');
  private readonly frozen: CanvasRenderingContext2D;
  private readonly glow = document.createElement('canvas');
  private particles: StarParticle[] = [];
  private state: SceneState = 'idle';
  private animationFrame = 0;
  private previousTime = 0;
  private pressStarted = 0;
  private releaseStarted = 0;
  private motionTime = 0;
  private releaseOpacity = 1;
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
    const frozen = this.frozenCanvas.getContext('2d', { alpha: true });
    if (!background || !display || !frozen) throw new Error('Canvas 2D is unavailable.');
    this.background = background;
    this.display = display;
    this.frozen = frozen;
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
    for (const canvas of [this.backgroundCanvas, this.displayCanvas, this.frozenCanvas]) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.getContext('2d')!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    const random = randomGenerator(0xa57a1);
    const count = this.reducedMotion ? 160 : mobile ? lowPower ? 200 : 240 : lowPower ? 280 : 360;
    this.particles = Array.from({ length: count }, () => new StarParticle(random, width, height, this.centerY));
    this.drawBudget = count;
    this.drawBackground();
    this.motionTime = 0;
    if (this.state === 'pressing') this.pressStarted = 0;
    else if (this.state === 'releasing') this.finishRelease();
  }

  setPressed(pressed: boolean) {
    if (this.disposed || !this.width || document.hidden) return;
    if (pressed && this.state !== 'pressing') {
      const now = performance.now() / 1000;
      const resuming = this.state === 'releasing';
      for (const star of this.particles) {
        if (!resuming) star.resetHistory();
        else {
          // Simulation time was paused during release. The same recorded shape
          // resumes at its last displayed opacity, without aging or reviving it.
          star.attenuateHistory(this.releaseOpacity);
          star.exposure *= this.releaseOpacity;
          star.headAlpha *= this.releaseOpacity;
          if (star.active) star.record(this.motionTime, star.exposure, true);
        }
        star.resumeExposure = star.exposure;
        star.resumeHeadAlpha = star.headAlpha;
        star.previousX = this.centerX + star.radius * Math.cos(star.angle);
        star.previousY = this.centerY + star.radius * Math.sin(star.angle);
      }
      this.pressStarted = this.motionTime;
      this.previousTime = now;
      this.setState('pressing');
      this.startLoop();
    } else if (!pressed && this.state === 'pressing') {
      this.releaseStarted = performance.now() / 1000;
      this.releaseOpacity = 1;
      this.clearCanvas(this.frozen);
      this.copyBitmap(this.frozen, this.displayCanvas);
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
    this.frozenCanvas.width = this.frozenCanvas.height = 0;
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
      this.motionTime += dt;
      this.advance(dt);
      this.renderHistory();
    } else {
      const elapsed = now - this.releaseStarted;
      if (elapsed >= RELEASE_DURATION) {
        this.finishRelease();
        return;
      }
      this.renderRelease(elapsed);
    }
    // Reduce quality gradually, never remove a group of visible trails at once.
    if (performance.now() - started > 13) this.slowFrames++;
    else this.slowFrames = Math.max(0, this.slowFrames - 1);
    if (this.slowFrames > 90 && this.drawBudget > 200) {
      this.drawBudget = Math.max(200, Math.floor(this.drawBudget * .88));
      this.slowFrames = 0;
    }
    this.animationFrame = requestAnimationFrame(this.tick);
  };

  private advance(dt: number) {
    const now = this.motionTime;
    const elapsed = now - this.pressStarted;
    const startup = smoothstep(elapsed / .34);
    const speed = startup * (this.reducedMotion ? .2 : 1);
    for (let i = 0; i < this.particles.length; i++) {
      const star = this.particles[i];
      if (i >= this.drawBudget) star.quality = Math.max(0, star.quality - dt / 2);
      if (!star.quality) continue;
      if (!star.active && elapsed < star.activationDelay) continue;
      if (!star.active) {
        star.active = true;
        star.activatedAt = now;
        star.record(now, 0, true);
      }
      const activation = smoothstep((now - star.activatedAt) / .2);
      if (activation <= 0) continue;
      star.angle += star.direction * star.angularVelocity * dt * speed;
      const shimmer = .93 + .07 * Math.sin(now * .65 + star.phase);
      const targetHead = Math.min(1, star.brightness * 1.12 + (star.glowFactor ? .24 : .1)) * shimmer * activation;
      const targetExposure = star.brightness * shimmer * activation;
      // On a resumed hold, blend from the attenuated live endpoint instead of
      // resetting it to zero or instantly restoring its original brightness.
      star.headAlpha = star.resumeHeadAlpha + (targetHead - star.resumeHeadAlpha) * startup;
      star.exposure = star.resumeExposure + (targetExposure - star.resumeExposure) * startup;
      star.previousX = this.centerX + star.radius * Math.cos(star.angle);
      star.previousY = this.centerY + star.radius * Math.sin(star.angle);
      star.record(now, star.exposure);
      star.prune(now);
    }
  }

  private renderHistory() {
    const ctx = this.display;
    this.clearCanvas(ctx);
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineCap = 'round';
    for (const star of this.particles) {
      if (!star.active || !star.quality) continue;
      const oldestOffset = star.historyCount - 1;
      const oldest = star.indexBehind(oldestOffset);
      if (oldestOffset >= 0 && star.angles[oldest] - star.angle > .000001) {
        const gradient = ctx.createConicGradient(star.angle, this.centerX, this.centerY);
        gradient.addColorStop(0, star.alphaColors[Math.round(star.exposure * 1024)]);
        let offset = 0;
        while (true) {
          const index = star.indexBehind(offset);
          const age = this.motionTime - star.times[index];
          const edge = smoothstep((star.lifetime - age) / .8);
          const exposure = star.exposures[index] * Math.exp(-TRAIL_DECAY * age) * edge;
          const position = Math.min(1, Math.max(0, (star.angles[index] - star.angle) / TAU));
          gradient.addColorStop(position, star.alphaColors[Math.round(exposure * 1024)]);
          if (offset === oldestOffset) break;
          offset = Math.min(oldestOffset, offset + 6);
        }
        ctx.globalAlpha = star.quality;
        ctx.lineWidth = star.size;
        ctx.strokeStyle = gradient;
        ctx.beginPath();
        // End at the live angle, not the last 30 Hz sample: no detached heads.
        ctx.arc(this.centerX, this.centerY, star.radius, star.angles[oldest], star.angle, true);
        ctx.stroke();
      }
      if (star.headAlpha < .005) continue;
      const x = star.previousX;
      const y = star.previousY;
      if (x < -12 || y < -12 || x > this.width + 12 || y > this.height + 12) continue;
      const alpha = star.headAlpha * star.quality;
      if (star.glowFactor > 0) {
        const size = star.glowFactor > .5 ? 16 : 8;
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = alpha * star.glowFactor * .75;
        ctx.drawImage(this.glow, x - size / 2, y - size / 2, size, size);
        ctx.globalCompositeOperation = 'source-over';
      }
      ctx.globalAlpha = alpha;
      ctx.fillStyle = star.headColor;
      ctx.beginPath();
      ctx.arc(x, y, star.size * .86 + .12, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  private renderRelease(elapsed: number) {
    this.clearCanvas(this.display);
    this.releaseOpacity = 1 - smoothstep(elapsed / RELEASE_DURATION);
    this.copyBitmap(this.display, this.frozenCanvas, this.releaseOpacity);
  }

  private finishRelease() {
    this.clearCanvas(this.frozen);
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

  private copyBitmap(ctx: CanvasRenderingContext2D, source: HTMLCanvasElement, opacity = 1) {
    // Fractional DPR rounds backing sizes. Copy device pixels 1:1, rather than
    // resampling through a CSS-sized rectangle and subtly moving thin trails.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = opacity;
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(source, 0, 0);
    ctx.globalAlpha = 1;
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
