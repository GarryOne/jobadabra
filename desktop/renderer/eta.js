// The time left, said so a person can trust it (owner, 25 Oct 2026: "it was saying before 1 min left, now it says 2 min left"): the same rule as
// Eta in src/progress.py (smoothed recent pace, never goes up, SLOW instead of a bigger number). tests/fixtures/eta-sequence.json is run by both
// (tests/test_progress.py, desktop/test/eta.test.js). Used by pages/office-progress.js (the LibreOffice download).
export const SLOW = ' · taking longer than expected';
const SMOOTH = 0.3, STALL_MIN = 60, STALL_PACES = 5;

export class Eta {
  constructor(started) { Object.assign(this, {started, at: started, done: 0, pace: null, cap: null, capAt: null}); }

  // Seconds in, ' · about 4 min left' / ' · under a minute left' / SLOW / '' out.
  text(now, done, total) {
    if (done <= 0 || done >= total) return '';
    if (done > this.done) {
      const each = (now - this.at) / (done - this.done);
      this.pace = this.pace === null ? each : SMOOTH * each + (1 - SMOOTH) * this.pace;
      this.done = done; this.at = now;
    }
    const fresh = this.pace * (total - done);
    let seconds = fresh;
    if (this.cap !== null) {
      const allowed = Math.max(0, this.cap - (now - this.capAt));
      if (now - this.at > Math.max(STALL_MIN, STALL_PACES * this.pace) || fresh > 2 * allowed + 30) return SLOW;
      seconds = Math.min(fresh, allowed);
    }
    this.cap = seconds; this.capAt = now;
    if (seconds < 60) return seconds >= 10 ? ' · under a minute left' : '';
    return ` · about ${pyRound(seconds / 60)} min left`;
  }
}

// Python's round() goes to the even neighbour on .5; the fixture pins both languages to one answer.
const pyRound = x => { const r = Math.round(x); return Math.abs(x % 1) === 0.5 && r % 2 ? r - 1 : r; };
