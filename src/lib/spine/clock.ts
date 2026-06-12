// The world clock. One time-of-day signal for the whole site: the sky reads
// it for the sun, fish read it for the hatch, the score reads it for mood.
// Demos that don't care about time of day can ignore it entirely.

export class WorldClock {
  // Seconds of simulated time since midnight, day 0.
  private t: number;
  // Real seconds for one 24-hour day. 600 = a full day in ten minutes.
  dayLength = 600;
  speed = 1;
  paused = false;

  constructor(startHour = 6.5) {
    this.t = (startHour / 24) * this.dayLength;
  }

  advance(dtSeconds: number): void {
    if (!this.paused) this.t += dtSeconds * this.speed;
  }

  // 0..1 through the current day; 0 is midnight, 0.5 is noon.
  get day01(): number {
    const d = this.t / this.dayLength;
    return d - Math.floor(d);
  }

  // 0..24 clock hours.
  get hour(): number {
    return this.day01 * 24;
  }

  get dayCount(): number {
    return Math.floor(this.t / this.dayLength);
  }

  setHour(h: number): void {
    this.t = this.dayCount * this.dayLength + ((h / 24) % 1) * this.dayLength;
  }
}

// Page-wide default. Demos may construct their own clock when they need
// independent time (e.g. a scrubber), but live scenes share this one.
export const clock = new WorldClock();
