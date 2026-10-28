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
| 4/4 | SonarQube Cloud on the public repo, quality gate on new code (duplication, complexity, reliability) | owner signs in once; gate shows on a PR; private repo stays out until the owner says paying is fine |

## Progress
- [x] Baseline numbers and sketch (proof: docs/superpowers/plans/2026-10-28-clean-code-checks.md)
- [x] 1/4 Gitar rule (proof: .gitar/review/clean-code.md)
- [x] 2/4 sonarjs on new code (proof: tools/clean-code-js.mjs)
- [ ] 3/4 Ruff on new code
- [ ] 4/4 SonarQube Cloud

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

Mode: `tools/clean-code-js.mjs` runs inside `npm run lint` (push gate and the desktop CI job) and reports a finding only on a line the change adds (diff against the merge base with `origin/main`), in `desktop/` and `extension/`. A function's finding sits on its head line, so editing the body of an old tangled function is not blocked; a new or rewritten head is.
