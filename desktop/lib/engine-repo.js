// Which engine repository and release the user's Always-on workflows call, by the name GitHub uses for it now.
// Moved out of lib/github.js (24 Oct 2026, repo rename). Guarded by desktop/test/engine-repo.test.js and cloud-sync.test.js.

const API = 'https://api.github.com';

// Which Jobadabra code the user's repo runs: an installed app sets its own release tag (desktop-v<version>), so
// the GitHub runs match the app and its Notion schema, and move on together when the app updates (the files are
// rewritten at each start). A source checkout (the owner's) keeps "main".
let engineRef = 'main';
export const setEngineRef = ref => { engineRef = ref || 'main'; };

// The engine's repository, by the name the user's workflows call it. GitHub doesn't redirect a workflow's `uses:` after a repo
// rename (proved on throwaway repos, 24 Oct 2026: "workflow was not found"), but its API does. So the app asks the API for the
// engine's current name and writes that: a rename reaches every user's repo at the app's next check.
export const ENGINE_REPO = 'GarryOne/jobadabra';
let engineRepo = ENGINE_REPO;
export const currentEngineRepo = () => engineRepo;

// -> true when the name changed since the last look. Offline or a refusal keeps the last name.
export async function resolveEngineRepo(fetcher = globalThis.fetch) {
  try {
    const response = await fetcher(`${API}/repos/${ENGINE_REPO}`, {headers: {Accept: 'application/vnd.github+json'}});
    const name = response.ok ? (await response.json())?.full_name : '';
    if (/^[\w.-]+\/[\w.-]+$/.test(name || '') && name !== engineRepo) { engineRepo = name; return true; }
  } catch { /* keep the last name */ }
  return false;
}

// A template as the user's repo gets it: the engine named as GitHub names it now, pinned to this app's release.
const named = yaml => yaml.replace(/GarryOne\/(?:job-pilotto|jobadabra)(?=\/\.github\/workflows\/)/g, engineRepo)
  .replace(/^(\s*code_repository:\s*)GarryOne\/(?:job-pilotto|jobadabra)(?![\w.-])/gm, `$1${engineRepo}`);
export const pinned = yaml => (engineRef === 'main' ? named(yaml)
  : named(yaml).replace(/([\w.-]+\/[\w.-]+\/\.github\/workflows\/[\w.-]+\.yml)@main/g, `$1@${engineRef}`).replace(/code_ref: main\b/g, `code_ref: ${engineRef}`));
