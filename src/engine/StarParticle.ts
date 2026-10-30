export const TAU = Math.PI * 2;
const HISTORY_CAPACITY = 384;

export function randomGenerator(seed: number) {
  return () => {
    seed |= 0;
    seed = seed + 0x6d2b79f5 | 0;
    let value = Math.imul(seed ^ seed >>> 15, 1 | seed);
    value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value;
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

export function smoothstep(value: number) {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
}

/** One independently moving star, with a bounded, sampled motion history. */
export class StarParticle {
  radius: number;
  angle: number;
  readonly angularVelocity: number;
  readonly direction = -1;
  readonly brightness: number;
  readonly size: number;
  readonly color: string;
  readonly activationDelay: number;
  readonly phase: number;
  readonly glowFactor: number;
  readonly lifetime: number;
  previousX = 0;
  previousY = 0;
  active = false;
  activatedAt = 0;
  headAlpha = 0;
  historyCount = 0;
  historyCursor = -1;
  readonly times = new Float64Array(HISTORY_CAPACITY);
  readonly angles = new Float64Array(HISTORY_CAPACITY);
  readonly exposures = new Float32Array(HISTORY_CAPACITY);

  constructor(random: () => number, width: number, height: number, centerY: number) {
    // Sampling screen positions gives irregular, area-weighted radii, including
    // enough outer stars to reach the corners. Avoid a congested central disk.
    let x = 0;
    let y = 0;
    for (let attempt = 0; attempt < 12; attempt++) {
      x = (random() - .5) * width * 1.08;
      y = random() * height * 1.08 - centerY;
      if (Math.hypot(x, y) > 44) break;
    }
    this.radius = Math.max(44, Math.hypot(x, y));
    this.angle = Math.atan2(y, x);
    const category = random();
    const special = category > .965;
    const bright = category > .81;
    this.angularVelocity = .12 + random() ** 1.4 * .25;
    this.brightness = special ? .9 : bright ? .6 + random() * .2 : .18 + random() ** .9 * .45;
    this.size = special ? 1.1 + random() * .1 : bright ? .88 + random() * .27 : .65 + random() * .32;
    this.color = random() > .91 ? '180,205,241' : random() > .8 ? '207,217,232' : '225,230,236';
    this.activationDelay = random() ** 1.6 * 2.7;
    this.phase = random() * TAU;
    this.glowFactor = special ? .8 : bright ? .2 : 0;
    this.lifetime = special ? 10.2 : 3.2 + random() ** .7 * 6.8;
  }

  record(time: number, exposure: number, force = false) {
    if (!force && this.historyCount && time - this.times[this.historyCursor] < 1 / 30) return;
    this.historyCursor = (this.historyCursor + 1) % HISTORY_CAPACITY;
    this.times[this.historyCursor] = time;
    this.angles[this.historyCursor] = this.angle;
    this.exposures[this.historyCursor] = exposure;
    this.historyCount = Math.min(HISTORY_CAPACITY, this.historyCount + 1);
  }

  indexBehind(offset: number) {
    return (this.historyCursor - offset + HISTORY_CAPACITY) % HISTORY_CAPACITY;
  }

  attenuateHistory(factor: number) {
    for (let offset = 0; offset < this.historyCount; offset++) {
      this.exposures[this.indexBehind(offset)] *= factor;
    }
  }

  resetHistory() {
    this.historyCount = 0;
    this.historyCursor = -1;
    this.active = false;
    this.activatedAt = 0;
    this.headAlpha = 0;
  }
}
