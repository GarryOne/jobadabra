// Why a PR's e2e run runs each step or whole suite: one log line each, with the changed file that reached it (owner on #2156, 27 Oct 2026: "This PR is running
// that many/less e2e suites. Is that correct?"; the e2e run showed 14 suite jobs and no reason, while the picker had chosen 39 steps). pr-suites.mjs prints the
// lines and passes them in pr_steps["(why)"]; plan-run.mjs prints them again in the e2e run's plan job. Tests: test/pick-why.test.mjs
export const WHY = '(why)', STORES = '(stores)';
const MAX_LINES = 150, MAX_LINE = 220;   // a dispatch's inputs are capped (65,535 characters in all): the reasons never crowd out the steps
const cut = text => (text.length > MAX_LINE ? `${text.slice(0, MAX_LINE - 1)}…` : text);

// suites: the plan's suites; steps: {suite: [names]} (a suite not in it runs whole); stores: {suite: store}; dropped: {suite: [{step, stores}]};
// picked: stepsCovering's {suite: {reach, reason, whole, setup}}; pointedBy: {suite: file} (stillWholeBy); hits: {suite: Set of removed strings};
// quoting: stepsQuoting's {suite: {steps, whole}}; own: {suite: [step names its own changed file touches]}. -> [line]
export function whyLines({suites = [], steps = {}, stores = {}, dropped = {}, picked = {}, pointedBy = {}, hits = {}, quoting = {}, own = {}}) {
  const lines = [];
  for (const suite of suites) {
    const where = stores[suite] ? ` [${stores[suite]}]` : '';
    if (steps[suite]) {
      for (const name of steps[suite]) {
        const from = picked[suite]?.reach?.[name] ? `runs ${picked[suite].reach[name]}`
          : quoting[suite]?.steps?.includes(name) ? `quotes text this PR removes (${[...(hits[suite] || [])].map(text => `"${text}"`).join(', ')})`
            : own[suite]?.includes(name) ? 'its own step changed in this PR'
              : picked[suite]?.reason || 'picked';
        lines.push(`${suite}${where} · "${name}" ← ${from}`);
      }
      for (const {step, stores: on} of dropped[suite] || []) lines.push(`${suite}${where} · not run: "${step}" (recorded only on ${on.join(', ')}: no such step on ${stores[suite]})`);
      continue;
    }
    const why = pointedBy[suite] ? `${pointedBy[suite]} (the suite watches or imports it, and its recorded run never loaded it)`
      : quoting[suite]?.whole ? `quotes text this PR removes outside a named step (${[...(hits[suite] || [])].map(text => `"${text}"`).join(', ')})`
        : picked[suite]?.reason || 'a file of the suite or its harness changed';
    lines.push(`${suite} · whole suite ← ${why}`);
  }
  return (lines.length > MAX_LINES ? [...lines.slice(0, MAX_LINES), `… ${lines.length - MAX_LINES} more in the PR's "E2E suites for a PR" log`] : lines).map(cut);
}
