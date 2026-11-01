// The owner's own values (the tripwire's list) handed to every app the harness starts, so the app never types them (worker/src/owner-guard.js; the app side is
// desktop/lib/owner-guard-env.js, which honours it only under JOB_PILOTTO_E2E and removes it from its environment). The values travel in memory only (an environment
// variable of the child), never to a file or a log. Guard: e2e/test/harness/owner-guard-env.test.mjs.
import {ownerValues} from './privacy-tripwire.mjs';

let memo = null;
// -> {JOB_PILOTTO_E2E_OWNER_VALUES} or {} when this computer holds nothing of an owner (a CI runner). values: a test's own list.
export function ownerGuardEnv(values = (memo ||= ownerValues())) {
  return values.size ? {JOB_PILOTTO_E2E_OWNER_VALUES: JSON.stringify([...values])} : {};
}
