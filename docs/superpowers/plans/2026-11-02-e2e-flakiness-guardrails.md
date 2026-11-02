# E2E flakiness guardrails: one per class (a8, 2 Nov 2026)

Owner, 2 Nov 2026: "I want us to put now guardrails for multiple flakiness reasons (while writing new e2e or fixing existing ones)"; plan chosen "All 4, in this order". Sketch: https://claude.ai/artifact/DvC31vYm2muvVXJKdywfDu
Escapes behind it: betas 16 and 17 (wizard red twice on the same AI ask key after #2926 edited a doc the ask carries), #2954 (steps that never ran reached main).
Each PR refuses or fixes only what is new; old lines are fixed when they go red. Never stacked.

## Progress
- [x] 1/4 Data files the app reads at run time count as a test's inputs: the after-merge picker runs the steps that ran the reading line, the flaky verdict counts them, and the integration and unit picker (tools/affected-tests.py) runs their readers' tests; owner chose "e2e + integration" (proof: desktop/e2e/test/replay/data-reads.test.mjs)
- [ ] 2/4 Stand-in AI answers by operation and answer shape only; the exact-request match is deleted and an unlabelled ask fails loudly naming its step (owner, 2 Nov 2026: "A: remove exact matching"; replaces "AI asks with a name")
  - [x] 2/4a Wizard answers its AI asks by name (backbone): beta 18's organize ask, whose heading ids moved after #2963, gets its stored answer; wizard red 3 betas in a row, owner chose "Start 2/4 on wizard" (proof: desktop/e2e/test/ai/wizard-named-answers.test.mjs)
  - [ ] 2/4b The other gate suites still on the exact-text cache answer by name too (apply, settings, strategy, updates, notion-real, personas, pool, explore; qualityai stays live)
  - [ ] 2/4c The exact-request match is deleted; an ask with no name fails loudly, naming its step
- [ ] 3/4 The reliability check refuses new CSS/nth locators, `.catch(() => {})`, `pages()[n]` and `networkidle` in desktop/e2e and desktop/integration (counts its escapes first: "gate only if it pays")
- [ ] 4/4 A PR runs the e2e steps it adds or changes, on Linux, as the one e2e on a PR (owner, 2 Nov 2026)

Outside the numbering, from beta 18 (run 41383379256, red at the Free AI relay after jobadabra-web #318 moved its handler): a blocked artifact upload says why in its own annotation and still blocks (owner: "Keep failing, say why"; #2973), and the relay's annotation carries the error itself (after rn's public relay PR #2972).
