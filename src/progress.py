"""Live progress for a long step: "⏳ Reading new jobs with AI: 12 of 26", printed at the start, then at most every few seconds and at the end.
The app shows the latest ⏳ line as the run's current step (desktop/lib/pipeline.js) and the Search runs row as its Summary
(src/notion/cron_runs.py). 7 Oct 2026: a search read 26 jobs with AI for minutes while the app said "Closed 0 job(s) not seen for 7 days".
Each line after the first also says about how long is left, from the pace so far (owner, 7 Oct 2026: "I want to have a clue when it's going
to finish. In 30 s or in 10 minutes")."""
import time


class Ticker:
    def __init__(self, label, total, every=8.0, clock=time.monotonic, out=None):
        self.label, self.total, self.every, self.clock = label, total, every, clock
        self.out = out or (lambda text: print(text, flush=True))
        self.last, self.started = None, clock()
        self.eta = Eta(self.started)
        if total:
            self._say(0, '')

    def tick(self, done, extra=''):
        if not self.total:
            return
        if done >= self.total or self.clock() - self.last >= self.every:
            self._say(done, extra)

    def _say(self, done, extra):
        self.last = self.clock()
        self.out(f'⏳ {self.label}: {min(done, self.total)} of {self.total}{extra}{self.eta.text(self.last, done, self.total)}')


SLOW = ' · taking longer than expected'


class Eta:
    """The time left, said so a person can trust it (owner, 25 Oct 2026: "it was saying before 1 min left, now it says 2 min left").
    The pace is smoothed over recent items (not the whole run), and a number never goes up: it is the smaller of the new estimate and the last
    one shown minus the time passed, so rounding cannot flip it either. When the run is slower than that countdown (or nothing finished for
    a long while) it says SLOW instead of a bigger number. The same rule, in the same words, is desktop/renderer/eta.js (the LibreOffice
    download); tests/fixtures/eta-sequence.json is run by both (tests/test_progress.py, desktop/test/eta.test.js)."""
    SMOOTH, STALL_MIN, STALL_PACES = 0.3, 60, 5

    def __init__(self, started):
        self.started, self.at, self.done, self.pace, self.cap, self.cap_at = started, started, 0, None, None, None

    def text(self, now, done, total):
        """' · about 4 min left', ' · under a minute left', SLOW, or '' (nothing done yet, the end, a few seconds left)."""
        if done <= 0 or done >= total:
            return ''
        if done > self.done:
            each = (now - self.at) / (done - self.done)
            self.pace = each if self.pace is None else self.SMOOTH * each + (1 - self.SMOOTH) * self.pace
            self.done, self.at = done, now
        fresh = self.pace * (total - done)
        if self.cap is None:
            seconds = fresh
        else:
            allowed = max(0, self.cap - (now - self.cap_at))
            if now - self.at > max(self.STALL_MIN, self.STALL_PACES * self.pace) or fresh > 2 * allowed + 30:
                return SLOW
            seconds = min(fresh, allowed)
        self.cap, self.cap_at = seconds, now
        if seconds < 60:
            return ' · under a minute left' if seconds >= 10 else ''
        return f' · about {round(seconds / 60)} min left'
