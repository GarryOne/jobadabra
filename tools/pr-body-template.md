🟢 <one line: what changed for the user or for us, in plain words>

**Why:** <the incident, measurement or owner request behind it>
**Unblocks:** <exactly what this solves or lets happen next: a PR, a session, a number, a person's step>
**Root cause:** <a fix only, else delete this line: the cause in one sentence (file:line, log line or measurement); why this is not a symptom patch; what let it through (the rule, test or check that missed it)>
**Design:** <a fix whose AREA-CIRCLES line (pr-body.sh adds it) shows 7d=2 or more, else delete: the states, their one owner, the verdicts that change them>

| Area | Impact | How |
|---|---|---|
| 👤 Real users | 🟢 High / 🟡 Medium / ⚪ Low / — None | <what a real user gets> |
| 📝 Form filling | 🟢 High / 🟡 Medium / ⚪ Low / — None | <fields, forms, wrong answers> |
| 📊 Admin data accuracy | 🟢 High / 🟡 Medium / ⚪ Low / — None | <which page or number is truer> |
| 🔁 Offline replays | 🟢 High / 🟡 Medium / ⚪ Low / — None | <recordings, refills, verdicts> |
| 🧪 Tests & harness | 🟢 High / 🟡 Medium / ⚪ Low / — None | <what the tests now catch> |
| ⚡ Development speed | 🟢 High / 🟡 Medium / ⚪ Low / — None | <time or runner slots saved> |
| 💰 Cost | 🟢 High / 🟡 Medium / ⚪ Low / — None | <AI or CI money, + or -> |

- ✅ <2-4 short bullets: what changed, a few words each>

| | Before | After |
|---|---|---|
| <the measured or seen difference> | <before> | <after> |

**Design checks**
<desktop window changes: tick each on the after-shot (docs/rules/desktop-ui.md); a failing one is fixed, never left unticked>
- [ ] Each value uses its kind's control (Value → control)
- [ ] No saved value is cut by its box; long text grows
- [ ] Chips show values only (no quotes, codes, regex); a note for the AI is a muted line under its value
- [ ] One primary button per card; every button solid (no text-only ghost/link), one row; no card inside a card
- [ ] Spacing from the scale (label → field 4, field → field 12, card padding 16)
- [ ] Looked at in light and dark

<When a screen changed: every image in this table, one row per change; or: No screenshots: <why> (never for a site page: a change to web/public or admin html/css/js needs images, live page vs your branch, 1440px and 390px). A PR in the private site repo (jobadabra-web) hosts its images there: `node tools/pr-assets.mjs pr-assets-<branch> <png>... --repo=GarryOne/jobadabra-web`. Shoot a site page with `tools/site-run.sh node tools/page-shot.mjs --path /admin/<page> --width 1440,390 --seed <name> --out <dir>` there (real Worker, demo data, refuses an unstyled page); the printed `github.com/<repo>/raw/<tag>/<file>` URLs render in a private repo, raw.githubusercontent.com ones do not.
Caption = what changed and where to look (a few words); crop to the changed card and frame the change: `npm run shot -- <page> --select '<card>' --mark '<changed control>'` (same options for before and after). A new screen: "—" before, the reason in the caption.>

| What changed | Before | After |
|---|---|---|
| <e.g. Availability card: "Start date" now sits under the dropdown> | ![before](<url>) | ![after](<url>) |
