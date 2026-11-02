// "Help the pool grow" (private spec jobadabra-lab:docs/specs/2026-09-30-pool-contributions.md): opt-out, on by default for every install
// (migrate.openPoolShare, 7 Oct 2026), and one switch in Settings for everyone. On, the runs (this Mac
// and the user's GitHub repo) tell the central pool which employer career pages they use, with coarse role / region tags
// (src/contribute.py). The app keeps only this switch and the random install id.
import crypto from 'node:crypto';

export const on = storage => storage.settings().shareEmployers !== false;

// The random id technical reports already use (no name, e-mail or account); made here if reports never needed one.
export function installId(storage) {
  let id = storage.settings().telemetryId;
  if (!id) { id = crypto.randomUUID(); storage.saveSettings({telemetryId: id}); }
  return id;
}

export function set(storage, value) {
  storage.saveSettings({shareEmployers: !!value, shareEmployersChosen: true});
  if (value) installId(storage);
  return {on: !!value};
}

// What the Python side reads (pipeline environment, and repository variables for Always on).
export function variables(storage) {
  return on(storage) ? {JOBADABRA_SHARE_EMPLOYERS: '1', JOBADABRA_INSTALL_ID: installId(storage)} : null;
}
export const NAMES = ['JOBADABRA_SHARE_EMPLOYERS', 'JOBADABRA_INSTALL_ID'];
