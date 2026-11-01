# e2e → integration tests: three PRs, one per layer (1 Nov 2026)

> **Verdict:** the beta keeps only critical journeys; every other check becomes an integration test in `desktop/integration/<layer>/`, run on PRs, and leaves e2e in the same PR.

Owner, 1 Nov 2026: "I'd like the beta to have only the critical e2e/user journeys. ALl the others, to run separately less frequently." and "for each of these 3 points, start a new pane code sessions, that will convert these e2e suites to integrations tests. And will drop them from e2e completely." and "I'd rather have one big PR than 10 small PRs per session". Folder (owner's choice): `desktop/integration/` with `extension/`, `app/`, `store/`.

## Progress

- [ ] 1/3 extension layer: the extension on recorded pages (`desktop/integration/extension/`)
- [x] 2/3 app layer: the app's window on a seeded store, no real Chrome (`desktop/integration/app/`): focus, foryou, cardstates, activity, activityfailures wording, settings engine panel and ⌘K, store-backed screens (proof: desktop/integration/app/screen-focus.test.js)
- [x] gap: Calendar and the Interviews library screens (`desktop/integration/app/screen-calendar.test.js`, `screen-interviews.test.js`); the calendar suite left e2e, interviews keeps the steps that write through the real app (proof: desktop/integration/app/screen-calendar.test.js)
- [ ] 3/3 store layer: Node plus the real store (`desktop/integration/store/`)

Rules for every PR: write the integration test, make it pass, then delete the e2e step in the same PR; safety and data-integrity steps stay in e2e; no real network, AI or outside site; the PR body carries the step table and the e2e job count before → after.
