# Applying with a silent Chrome: the demo escape (30 Oct 2026)

> **Verdict:** the demo's two symptoms had one cause, a test app left running on the owner's port 47111 for 27 h. The cards' fixes are already on main (#2499, #2508).
> These two PRs close the ways a test can still do that, and make the apply e2e play a silent Chrome so a regression shows on a PR, not in a demo.

**Owner (30 Oct 2026):** "today I wanted to demo, and I was not able to open the tab in Chrome on the applying. It was opening the extension settings in tab.
Othertimes the cards in applying are just stuck in "Checking" and so on" · "Can we, or should we have more e2e around the APplying ?"

<details><summary>Measured (owner's app.log, read-only)</summary>

| When (UTC) | What |
|---|---|
| 28 Oct 19:49:29 | last extension check-in the app heard |
| 28 Oct 21:04:45 | app restart; 47111 already held by a leaked e2e test app (no log line said so then) |
| 29 Oct 13:22–13:25, 18:00–18:12 | demo: "Chrome not reporting, Open Chrome pressed" ×6: the only button opened the extension's settings |
| 29 Oct 22:44 / 23:26 | #2499 (Open it again first) / #2508 (port guard, "can't hear Chrome" card) merged |
| 29 Oct 22:49–22:50 | the owner's Open it again opened 4 job tabs |
| 29 Oct 23:58:30 | first check-in in 27 h; healthy since |

Every other app start over 7 days heard Chrome in 0–26 s (the card checks for 45 s). Still running that night: a demo app (30 h), an offline app (3 days).
</details>

## PRs
1. **[ac] 1/2 Test and tool apps never take port 47111 or outlive their run**: a test process (e2e or `node --test`) never listens on 47111 however its port is given;
   the shot tools and the offline app end with their script (`lib/e2e-host.js` watchRunner); one class test over every way the app is started.
2. **[ac] 2/2 Apply e2e plays a silent Chrome**: S1 the app's port held by another program → "Jobadabra can't hear Chrome" at once, back when freed;
   S2 no reports → "Chrome isn't reporting" with Open it again first → the job's tab opens → the card leaves the state. In `apply` (a8, owner of e2e, 30 Oct 2026).

## Progress
- [ ] 1/2 port and leftover-app guards
- [ ] 2/2 silent-Chrome steps in apply
