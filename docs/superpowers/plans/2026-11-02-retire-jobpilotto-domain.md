# Retire jobpilotto.top and jobpilotto.workers.dev (owner, 2 Nov 2026)

Owner: "We need to decommission / rename to jobadabra" (the old domain and the workers.dev subdomain). Sketch: https://claude.ai/artifact/B8tp5PWTpUszUsosrVZd26

**Design:** the old names end in a fixed order, each step only when its replacement already answers. The installed desktop app still calls `www.jobpilotto.top` (free AI, telemetry, feedback, OAuth and its updater), so the old API ends only when the app traffic on it is small, not on a date.

Owner decisions (2 Nov 2026):
- The old host's API (then the zone, then the workers.dev name) ends **when app traffic on it is under 1% of today's** (80,331 `node` requests in 7 days to `www.jobpilotto.top`, read from Cloudflare GraphQL `httpRequestsAdaptiveGroups` on the zone `jobpilotto.top`, `requestSource: eyeball`).
- Pages on the old host redirect to `www.jobadabra.top` for **30 days** after that, then the zone is deleted.
- The workers.dev subdomain is renamed `jobpilotto` to `jobadabra` in the last step, after every caller (brokers, staging, central scout) uses the new names.
- The registration of `jobpilotto.top` is at an external registrar (Cloudflare's registrar list is empty): the owner cancels auto-renew.

## Progress
- [ ] 1/3 public: the app and every CI script call `www.jobadabra.top` (this PR); the next app release carries it
- [ ] 2/3 web: the sender and the test inboxes (`test-account-*@`) move to `jobadabra.top`; web's own callers, tests and docs
- [ ] dashboards (not a PR): Telegram webhook, Stripe webhook, LinkedIn redirect URL, then the test-mail catch-all and Email Sending on `jobadabra.top`
- [ ] weekly read of the old host's app traffic (same query); wait for under 1%
- [ ] 3/3 web: the Worker stops answering the old hosts (routes, `shared/hosts.js` alias code, tests); pages redirect for 30 days
- [ ] last: rename the workers.dev subdomain, move the broker URL and staging, delete the zone `jobpilotto.top`

## Before each PR
`git grep` the old names by every form (`jobpilotto.top`, the regex-escaped `jobpilotto\.top`, `@jobpilotto.top`, `jobpilotto.workers.dev`); the full list, never cut with `head`. zsh does not split an unquoted variable: pass files with `git grep -lz | xargs -0`.
