// What the repo holds to test with, counted by structure (a folder with its case.json), never from a hand list: the saved form pages (desktop/e2e/recorded) and the control-test pages
// (desktop/e2e/widget-zoo). CI on main sends these with the replay upload it already does (replays-report.mjs) so /admin/form-filling/lab's "What we test on" can show them: the site cannot read the repo. Guard: test/repo-counts.test.mjs.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const E2E = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');   // not lib/app.mjs: the report job installs no browser packages

const casesIn = dir => (fs.existsSync(dir) ? fs.readdirSync(dir).filter(name => fs.existsSync(path.join(dir, name, 'case.json'))).length : 0);

// -> {recorded, zoo}
export const repoCounts = (root = E2E) => ({recorded: casesIn(path.join(root, 'recorded')), zoo: casesIn(path.join(root, 'widget-zoo'))});
