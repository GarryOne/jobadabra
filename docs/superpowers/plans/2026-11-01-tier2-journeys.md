# Tier 2 journeys: 9 → 29, proved by integration tests (tj, 1 Nov 2026)

Owner, 1 Nov 2026: "We can build 10-20 more journeys. for the integrations". Tier 1 stays e2e and blocks the beta; Tier 2 is integration only.

## Progress
- [ ] 1/2 Register 16 journeys (J20-J35) from integration files that already prove a board journey, plus 3 additions to J11, J15, J19: Tier 2 9 → 25, files mapped 18 → 59 of 65. Registry rows only.
- [ ] 2/2 Four new integration tests, one journey each (J36 extension pairing, J37 AI credit wording, J38 add a job by hand, J39 Telegram digest): Tier 2 25 → 29.

Left unregistered on purpose: engine-kit, net-record-lost-body, replay-watch-window, applying-report (tooling) and cv-check, applied-by-hand, the strategy-integration setup tests (PR-time counterparts of Tier 1 J14, J5, J13; a Tier 1 journey holds e2e steps only).
The GTM readiness page (jobadabra-web `jobs/gtm-readiness.mjs`) reads the registry through `loadJourneys()` and matches each `{integration, test}` to CI result names, so new rows need no web change.
