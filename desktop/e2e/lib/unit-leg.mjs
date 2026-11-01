// The desktop unit tests as one more leg of a release run's Test matrix (desktop.yml test-mac / test-windows), planned beside the E2E suites; never a suite itself.
// Why (1 Nov 2026, owner: "let's go this way"): the unit tests used to be a step of Build that ran before Compile, so every E2E started 4-6 min later than the build needed.
// A leg of its own starts with the suites when Build ends. Its `name` is the whole job name ("Unit tests · Mac"), which never starts with "E2E · ", so nothing that reads the E2E
// jobs by that prefix (the release gate, the canary, the reports) takes it for a suite; the gate looks it up by this name (tools/beta_rate_gate.py).
export const UNIT_SUITE = 'unit';
export const unitLeg = lane => ({suite: UNIT_SUITE, key: UNIT_SUITE, name: `Unit tests · ${lane}`, ...(lane === 'Mac' ? {os: 'macos-latest'} : {})});

/** Add the unit leg to a planned matrix ({include: [...]}) when the plan asks for it (GATE_UNIT=1, set by the release run only); the unit leg goes first. */
export const withUnitLeg = (matrix, lane, env) => env.GATE_UNIT === '1' ? {...matrix, include: [unitLeg(lane), ...matrix.include]} : matrix;
