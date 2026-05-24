/**
 * timer.js — 5-minute countdown and phase tracking.
 */
Intro.timer = {
  TOTAL: 300, // seconds
  elapsed: 0,
  _startTime: null,
  running: false,

  start() {
    this._startTime = performance.now();
    this.running    = true;
  },

  update() {
    if (!this.running) return;
    this.elapsed = Math.min((performance.now() - this._startTime) / 1000, this.TOTAL);
    if (this.elapsed >= this.TOTAL) this.running = false;
  },

  getRemaining() {
    return Math.max(0, this.TOTAL - this.elapsed);
  },

  format(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  },

  // Returns { phase: 1-4, progress: 0-1 }
  getPhase() {
    const t = this.elapsed;
    if (t < 90)  return { phase: 1, progress: t / 90 };
    if (t < 210) return { phase: 2, progress: (t -  90) / 120 };
    if (t < 270) return { phase: 3, progress: (t - 210) /  60 };
                 return { phase: 4, progress: Math.min(1, (t - 270) / 30) };
  },
};
