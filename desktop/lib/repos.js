// The GitHub owner and repository names the app reads, in one place: a move of the repos to an organization changes OWNER here and nowhere else.
// Why (1 Nov 2026, owner: "start a session now that will move the github repos to a github organization"): the owner was a literal in the updater,
// the engine name and the starter, and GitHub redirects a GET after a transfer but not a POST or a workflow `uses:`.
// Spec: docs/superpowers/specs/2026-11-01-github-org-move-design.md. Guarded by desktop/test/repos.test.js.

// The owner of the public engine and the starter template. Still the personal account until the repos are transferred.
export const OWNER = 'GarryOne';
// Owners this project had before: a workflow file an older app wrote names one of them, and engine-repo.js rewrites it to the current name.
export const PREVIOUS_OWNERS = ['GarryOne'];
export const ENGINE_NAME = 'jobadabra';
// The starter template users create their private Always-on repo from. Why (1 Nov 2026, owner: "for us it should be joabdabra-....-template ... in the
// middle can be user, or byok, both"): it is renamed jobadabra-user-template and created under the org. The app asks the API which candidate exists
// (github.js resolveStarter), newest name first, so it works before and after the rename; the old name is dropped from here once the move is done.
export const STARTER_ORG = 'jobadabra';
export const STARTER_NAME = 'jobadabra-user-template';
export const OLD_STARTER = `${OWNER}/job-pilotto-starter`;

export const ENGINE = `${OWNER}/${ENGINE_NAME}`;
export const STARTER = `${STARTER_ORG}/${STARTER_NAME}`;
export const STARTER_CANDIDATES = [STARTER, OLD_STARTER];
// A regex source matching any owner the project has had (and the current one), for rewriting a file an older app wrote.
export const OWNER_PATTERN = [...new Set([OWNER, ...PREVIOUS_OWNERS])].map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
