// Which application stages may start an application: the one rule the Apply picker (lib/apply.js) and Background automation (lib/background-apply-store.js) share.
// Why (2026-10-28, owner screenshot): the picker went by job status alone and took a job already in process; Background refused it with "not eligible to start another application".

/** The stages a job may be in when an application starts: not yet applied (Saved, Kit ready) or already being applied (Applying: its session is reused). */
export const STARTABLE_STAGES = ['Saved', 'Kit ready', 'Applying'];

/** True when a job at `stage` may start an application; a job with no stage yet (nothing recorded) may. */
export function canStart(stage) { return !stage || STARTABLE_STAGES.includes(stage); }
