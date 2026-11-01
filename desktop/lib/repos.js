// The GitHub owner and repository names the app reads, in one place: a move of the repos to an organization changes OWNER here and nowhere else.
// Why (1 Nov 2026, owner: "start a session now that will move the github repos to a github organization"): the owner was a literal in the updater,
// the engine name and the starter, and GitHub redirects a GET after a transfer but not a POST or a workflow `uses:`.
// Spec: docs/superpowers/specs/2026-11-01-github-org-move-design.md. Guarded by desktop/test/repos.test.js.

// The owner of the public engine and the starter template. Still the personal account until the repos are transferred.
export const OWNER = 'GarryOne';
// Owners this project had before: a workflow file an older app wrote names one of them, and engine-repo.js rewrites it to the current name.
export const PREVIOUS_OWNERS = ['GarryOne'];
export const ENGINE_NAME = 'jobadabra';
export const STARTER_NAME = 'job-pilotto-starter';   // TODO(AI): becomes jobadabra-starter in the queued JOB_PILOTTO rename (1 Nov 2026)

export const ENGINE = `${OWNER}/${ENGINE_NAME}`;
export const STARTER = `${OWNER}/${STARTER_NAME}`;
// A regex source matching any owner the project has had (and the current one), for rewriting a file an older app wrote.
export const OWNER_PATTERN = [...new Set([OWNER, ...PREVIOUS_OWNERS])].map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
