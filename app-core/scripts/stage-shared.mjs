// The worker's tests import desktop/lib/question-labels.js, which reads the label cleaner from desktop/shared/ (git-ignored, written by
// desktop/scripts/stage.mjs). CI runs the worker on its own, where nothing staged it (5 Oct 2026: fa1f838 red): copy the one file it needs.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
fs.mkdirSync(path.join(repo, 'desktop', 'shared'), {recursive: true});
fs.copyFileSync(path.join(repo, 'extension', 'alias-schema.js'), path.join(repo, 'desktop', 'shared', 'alias-schema.js'));
