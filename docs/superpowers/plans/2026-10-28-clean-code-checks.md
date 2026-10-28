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
- [ ] 1/4 Gitar rule
- [ ] 2/4 sonarjs on new code
- [ ] 3/4 Ruff on new code
- [ ] 4/4 SonarQube Cloud

## Baseline: rerun on `bacbe2a`
Tools (installed outside the repo): jscpd, eslint 9.39.5 + eslint-plugin-sonarjs 4.2.2, Ruff 0.17.3. Run on a `git archive bacbe2a` copy.

| Number | Command | Result |
|---|---|---|
| Duplication | `jscpd --min-lines 5 --min-tokens 50 --format javascript,python --ignore "**/vendor/**,**/shared/**,**/.design-system/**,**/node_modules/**" .` | 363 clones, 3,405 of 327,226 lines (1.04%) |
| JS cognitive complexity | eslint `-c` a config enabling only `sonarjs/cognitive-complexity: ['warn', 15]` over `desktop extension worker tools`, ignoring vendor/shared/.design-system/dist/build; count non-test files (path has no `/test/`, `/e2e/`, `.test.`) | 288 |
| Python complexity | `ruff check --isolated --select C901 src tools tests worker` (default max 10) | 92 |
