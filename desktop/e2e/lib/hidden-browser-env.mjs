// Job: wait on state. The app's environment for its hidden browser under e2e: the fixture host map and the test certificate, nothing else (lib/background-browser.js e2eArguments).
// Why (2026-10-28, #2364): its own file with no app imports. context.mjs is loaded before desktop/shared/ is staged (lib/suite-main.mjs), so it must not import app code;
// background-proof.mjs does (form-judge.js), and importing it from context.mjs killed every apply suite on CI with ERR_MODULE_NOT_FOUND shared/alias-schema.js.
import {hostRules} from './forms.mjs';

/** -> the env entries that give the hidden browser the fixture host map for the forms server on `port`. */
export const hiddenBrowserEnv = port => ({JOB_PILOTTO_E2E_BACKGROUND_BROWSER_ARGS: JSON.stringify([`--host-resolver-rules=${hostRules(port)}`, '--ignore-certificate-errors', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])])});
