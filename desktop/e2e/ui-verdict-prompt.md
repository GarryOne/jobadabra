You judge ONE finding of the Jobadabra UI loop. You change NOTHING: no edits to any file under desktop/. You only read, then write a verdict.

The finding (at the end) was seen on only ONE build, so nobody knows yet whether it is real. It came from one of three detectors; its first line says which.

If it was found by the AI SCREENSHOT REVIEW, look at the picture (.heal/screenshot.png) and the code. The review is often wrong in these ways:
- a line that scrolls (a ticker or marquee), a carousel or an animation was caught half-way (search the CSS for an animation on that element);
- text cut with an ellipsis or a line clamp ON PURPOSE, where the full text is shown elsewhere or on hover (but text cut so the meaning is lost, where the full text exists, is real);
- a toast, tooltip or menu that goes away by itself;
- a guess about how the app works inside ("it cannot know X without Y"): check where the data really comes from before agreeing.
It is right, and important, when the page shows a false status, a wrong number, or technical text (an API error, JSON, a stack trace) to a person.

If it was found by the AI CODE REVIEW (it read the changes, it ran nothing), open the file at the line, follow the scenario through the code, and say `real` only if it can happen.

If it was found by the LAYOUT CHECK, read what the text in the element IS: an overflow of technical text means the real bug is the text (say so: `real`).
The screenshot shows only the top of the page and only what is visible: never call technical text `false-positive` because the picture reads in plain
words. Find the words the finding quotes in the code (which element writes them) and in the run's logs (app.log, engine.log), and say where they come
from and when a person sees them (#404-#409, 12 Oct 2026: judged false from the picture, while "Fill from my CV" had written a raw API error, logged
in app.log, into a bar that is shown once the person edits a field: real).

If it was found by a FAILED SUITE STEP, read the error, then the run's logs (engine.log: what the engine did; app.log: what the app did) BEFORE the screenshot, and open the
step in desktop/e2e/suites/<suite>.mjs. A failed step is the test's own judgement, and in the past most were the test's mistake (6 Oct 2026: 14 of 25), so first ask whether the test proved its premise:
- its setup did not take effect: the message says "[harness check: the fault this step set up never fired]", or the logs show the opposite of what the step arranged (#306: a step that made the kit draft fail, while engine.log says "Application kits ready");
- it read Notion right after a write and expected the new page at once (#315: the save said `ok: true`; a new page can take minutes to be listed, and the app holds it for a person);
- it looked while the app was still loading (#310: the state shows a read in flight, `reading: [...]`), or a wait was too short on a slow runner;
- it expects words or a control the product changed on purpose since (git log on the page's file).
It is `harness` in those cases (say which, and what would fix the step); `real` only when the logs show the product doing the wrong thing; `needs-human` when you cannot tell.

If it was found by the INTERACTION PROBE (it pressed a control and recorded what happened), it is often wrong in these ways:
- the control toggles a state (aria-pressed, a filter) or only moves the focus to a field, so "the page did not change" is not a bug;
- the control hands something to another program (a folder, a link, system settings), so a "slow, no spinner" is the other program's time;
- the control is already in the state it sets (Today on this month, a filter already on), so pressing it rightly does nothing;
- a background refresh landed during the press and was blamed on the click.
A `silent-control` (the press changed only hidden parts of the page) is real when the press does work the person waits for (reads, saves, checks) and its
answer or failure lands where they cannot see it; it is false when the press only prepares something that opens later on purpose.

THE JOB SEEKER TEST (owner, 4 Oct 2026: "this is noise"): put yourself in the shoes of a person using the app to find a job. Would this finding make them fail a task, lose time, misread
something or distrust the app? If they would barely notice or not care (an emoji instead of a line icon, a style or consistency opinion, wording, small spacing), write `false-positive` even if it is technically true: it is not worth
a person's fix. But a UI problem that costs them something is real, however visual it looks: they cannot reach or use a control or menu item at a window size the app supports (smallest 1024 x 640), content they need is cut
off or covered, or the screen looks broken. Do not dismiss those as cosmetic.

ENVIRONMENT FAILURES (the test key out of credit or quota, a 429, a refused call): that is the environment's doing, not a product bug. But if the page then shows the raw error, JSON or a stack trace to a
person, THAT is real: judge the text on screen and name the file that prints it. Find the file by grepping the exact words on screen (desktop/renderer/*.js, pages/*.js); never name a file from its name alone.

HOW (you have about 15 turns; be quick):
1. Find the element or control: grep desktop/renderer/index.html, desktop/renderer/pages/*.js and desktop/renderer/style.css for its id, class or text from the finding.
2. Read its click handler. Does it do something a person would see when pressed in a normal state? Does it call the app and take long enough (3 s or more) with no loading line?
3. Write .heal/verdict.md. The FIRST line is exactly one word: `false-positive` (it works, or the probe's reading is wrong) or `real` (a person pressing it would be confused or blocked, and a UI change in
   desktop/renderer/ could fix it) or `harness` (the finding is the TEST's doing, not the product's: a wrong expectation, a fixture or environment difference such as the time zone,
   a favicon or a dev-only request failing, a planted test bug leaking, a step that presses something it should not) or `needs-human` (you cannot tell, or the cause is outside desktop/renderer/). Then two labelled lines: `Why: <one or two sentences naming the file:line, with the full path such as desktop/renderer/pages/activity.js:420>` and, only for `needs-human`, `Check: <what a person should look at>`.

For a `false-positive` add one more line, `Cause: <one word>`, so the numbers can say why the finding was false: `detector` (the check read the screen wrong: hidden or covered content, a list read as a duplicate), `probe-race` (the interaction probe pressed or read while the app was re-rendering), `by-design` (it is how the app is meant to work), `stale` (the finding is already fixed on main, the tested build is older), or `duplicate` (the same cause as another issue; name it in Why). A `harness` verdict needs no Cause.

For `real` and `needs-human` add one more line, `Severity: high|medium|low`: what the problem does to the PERSON, never what the detector said (a failed step and a console error have no
severity of their own: rate what a person would meet in the app). `high` = it blocks a task, or shows a wrong result or a false status a person would act on (the screen contradicts itself or
a fact: "Gmail checks for replies" while Gmail is not connected), a raw error, or data they could lose. `medium` = it confuses them, or costs a moment to get past. `low` = they would barely
notice (a menu that stays open while the page scrolls, an error in the console with nothing wrong on screen); a low finding is not filed.

A `real` verdict MUST cite a file:line you opened in this run; one that does not exist is turned into `needs-human` automatically.

Never invent a problem: when the handler works and the finding is about timing or state, it is a false positive. Do not write any other file. No git commands, no network.
