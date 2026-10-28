# Shrink the worst code-quality hot spots (qf, 28 Oct 2026)

> **Verdict:** 8 behaviour-preserving PRs, one function each, chosen by complexity × how often the file changed in 30 days. Each adds
> characterization tests first (green on main and after), then splits the function into named pieces of at most 20 (cq's gate, aim 15).
> Owner (28 Oct 2026): "I just want that our code is very clean so that AI hallucinations are less prone to introduce bugs." The work is done
> by Codex (GPT-6.1 Sol) in visible panes; the qf session reviews, measures and ships.

Plan page: https://claude.ai/artifact/DokFrEXroRVA1ZsDFQnAAd · source report: cq's Clean Code Baseline (https://claude.ai/artifact/4VUBavWt8C3trSs7xSC1Aw).

| PR | Function | Before | PRs 30d |
|---|---|---|---|
| [qf] 1/8 | `desktop/lib/server.js` `start` | cognitive 286 | 88 |
| [qf] 2/8 | `extension/fill-flow.js` `consider` (flow core) | cognitive 247 | 112 |
| [qf] 3/8 | `extension/review.js` `render` | cognitive 176 | 135 |
| [qf] 4/8 | `src/desktop.py` `main` | McCabe 64 | 69 |
| [qf] 5/8 | `src/scout.py` `run` | McCabe 39 | 99 |
| [qf] 6/8 | `extension/page/fill.js` `fillPage` | cognitive 199 | 77 |
| [qf] 7/8 | `extension/flow.js` `fillTab` | cognitive 113 | 103 |
| [qf] 8/8 | `src/daily_search.py` `search` | McCabe 84 | 33 |

Measured at `02761d5` with eslint-plugin-sonarjs 4.2.2 (`cognitive-complexity`) and Ruff 0.17.3 (`C901`), outside the repo.
Churn: `git log --first-parent origin/main --since=30.days -- <file>`.

**Left for a second round:** `session-next-step.js` renderNextStep (354, 16 PRs), `jobs-render.js` renderJobs (252, 36),
`session-state.js` sessionState (137, 45), `worker/src/extension.js` handleExtension (104, 56), `activity-render.js` renderActivity (162, 24).

**Not a defect:** the four mirrored file pairs in cq's report (`tools/browser-form-fastpath.js`, `tools/browser-submit-guard.js`,
`desktop/renderer/tips-pool.js`, the snapshot scrubber) have one source each, copied by `extension/sync.sh` and guarded by
`worker/test/extension-files.test.js` and `worker/test/snapshot.test.js`.

## Progress
- [ ] 1/8 server.js start
- [ ] 2/8 fill-flow.js consider
- [ ] 3/8 review.js render
- [ ] 4/8 desktop.py main
- [ ] 5/8 scout.py run
- [ ] 6/8 page/fill.js fillPage
- [ ] 7/8 flow.js fillTab
- [ ] 8/8 daily_search.py search
