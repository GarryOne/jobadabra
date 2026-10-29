# Plan: Clean-code checks (cq)

Owner request (28 Oct 2026): "I just want that our code is very clean so that AI hallucinations are less prone to introduce bugs"
(don't repeat yourself, modular, reusable, existing patterns). Chosen: all 3 layers. Baseline (read-only, `bacbe2a`, sketch
https://claude.ai/artifact/4VUBavWt8C3trSs7xSC1Aw): 1.0% duplicated lines, 288 JS functions over cognitive complexity 15, 92 Python
functions over McCabe 10. Rule: new code only, old code is never blocked. A rule stays only if a 20-finding sample is mostly real.

## PRs

| PR | What | Test / proof |
|---|---|---|
| 1/4 | Gitar rule `.gitar/review/clean-code.md` | rule file only; Gitar reviews this PR with it |
| 2/4 | eslint-plugin-sonarjs on changed code: `tools/pre-push-check.sh` (changed files, under 60 s, agreed with fl) and the PR job; old code via a baseline | sampled precision per rule in the PR; a new over-limit function fails, an old one does not |
| 3/4 | Ruff small rule set on changed Python lines, same two places | sampled precision per rule; same pass/fail pair |
| 4/4 | ~~SonarQube Cloud~~ skipped (owner, 28 Oct 2026): this closes the plan | see "4/4: SonarQube Cloud, skipped" below |

## Progress
- [x] Baseline numbers and sketch (proof: docs/superpowers/plans/2026-10-28-clean-code-checks.md)
- [x] 1/4 Gitar rule (proof: .gitar/review/clean-code.md)
- [x] 2/4 sonarjs on new code (proof: tools/clean-code-js.mjs)
- [x] 3/4 Ruff on new code (proof: tools/clean-code-py.py)
- [x] 4/4 SonarQube Cloud skipped by the owner, plan closed (proof: docs/superpowers/plans/2026-10-28-clean-code-checks.md)

## Baseline: rerun on `bacbe2a`
Tools (installed outside the repo): jscpd, eslint 9.39.5 + eslint-plugin-sonarjs 4.2.2, Ruff 0.17.3. Run on a `git archive bacbe2a` copy.

| Number | Command | Result |
|---|---|---|
| Duplication | `jscpd --min-lines 5 --min-tokens 50 --format javascript,python --ignore "**/vendor/**,**/shared/**,**/.design-system/**,**/node_modules/**" .` | 363 clones, 3,405 of 327,226 lines (1.04%) |
| JS cognitive complexity | eslint `-c` a config enabling only `sonarjs/cognitive-complexity: ['warn', 15]` over `desktop extension worker tools`, ignoring vendor/shared/.design-system/dist/build; count non-test files (path has no `/test/`, `/e2e/`, `.test.`) | 288 |
| Python complexity | `ruff check --isolated --select C901 src tools tests worker` (default max 10) | 92 |

## JS rules: sampled precision (2/4)
Findings in production code of the baseline tree; a sample of up to 20 per rule was read (file:line and code line). Run: eslint with only the rule on, as above.

| Rule | Findings | Verdict from the sample |
|---|---|---|
| `sonarjs/cognitive-complexity` | 288 at 15, 185 at 20 | real; the 16-20 band is marginal (e.g. `needRow`, `startRecording`), so the limit is 20 |
| `sonarjs/no-identical-functions` | 1 | real (`extension/visit-page.js:92`) |
| `sonarjs/no-duplicated-branches` | 2 | real, trivial (`extension/ladder/dead-end.js:24`) |
| `sonarjs/no-collapsible-if` | 1 | real (`desktop/main.js:262`) |
| `sonarjs/no-duplicate-string` | 101 | dropped: DOM ids and CSS class strings; a constant would be worse |
| `sonarjs/no-nested-conditional`, `expression-complexity` | 894, 421 | dropped: readable ternary chains and plain guards |
| `sonarjs/no-gratuitous-expressions` | 5 | dropped: all 5 are one `DEMO` constant |
| `sonarjs/no-inverted-boolean-check` | 22 | dropped: `!(x > 0)` differs from `x <= 0` when x is NaN |
| `no-empty-collection`, `no-unused-collection`, `no-dead-store` | 4, 3, 1 | dropped: misfires on test resets and destructuring |

Mode: `tools/clean-code-js.mjs` runs inside `npm run lint` (push gate and the desktop CI job) and reports a finding only on a line the change adds (diff against the merge base with `origin/main`), in `desktop/` and `extension/`. A function's finding sits on its head line, so a new or rewritten head is refused; since 29 Oct 2026 (owner: "PR CI guardrails to not get back again") an old function over the limit whose body the change makes more complex is refused too, by its score before and after.

## Python rules: sampled precision (3/4)
Ruff 0.17.3, `--isolated`, over `src tools tests worker` of the baseline tree; production = not under `tests/`. Samples of up to 20 per rule read as for the JS rules.

| Rule | Findings (prod) | Verdict from the sample |
|---|---|---|
| `C901` McCabe | 87 at 10, 33 at 15 | real; the limit is 15 (JS 20 is cognitive, which counts nesting) |
| `F401` unused import | 137 | 14 of 20 truly unused, 3 re-exports that tests patch (`# noqa: F401 (<why>)` keeps them), 3 duplicate imports: kept, ~85% real |
| `F841` unused local | 3 | all real |
| `B023` lambda over a loop variable | 2 | real bug shape |
| `B904` raise in except without `from` | 6 | real: the cause chain is lost |
| `F405` star import | 366 | dropped: one pattern, a rewrite not a fix |
| `PLR0913` / `PLR0912` / `PLR0915` / `PLR0911` | 136 / 44 / 41 / 25 | dropped: counts overlap `C901` |
| `F811` redefinition | 38 | dropped: re-export blocks in `src/scout.py` |
| `SIM115`, `RET503`, `PERF401`, `SIM105`, `RUF005`, `B905` | 17, 7, 31, 24, 43, 29 | dropped: style, scripts |

Mode: `tools/clean-code-py.py` runs in `tools/pre-push-check.sh` (the push gate; CI's pr-gate job runs the same script) on changed `src/` and `tools/` files and keeps findings on added lines, and C901 on an old function the change makes more complex (29 Oct 2026). Ruff is pinned and installed on first use into `~/.cache/jobadabra` (about 10 s once; 0.6 s after).

## 4/4: SonarQube Cloud, skipped
Owner, 28 Oct 2026: "Skip SonarQube for now". Why: its free tier is for public repos with an OSI-approved licence; this repo is FSL-1.1-ALv2 (source-available, not OSI), and the free tier for other projects is private-only up to 50k lines (the repo is about 327k). A paid plan needs the owner's yes and a looked-up price first. Nothing was signed up for or bought.
What stays unmeasured by a tool: duplication across files (baseline 1.0% by jscpd; rerun the command in the baseline section to see the drift).
Revisit when: the licence changes to an OSI one, or the owner wants the dashboard and a paid plan.
