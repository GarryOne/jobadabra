// Refuse dev-start installs through shared node_modules without changing the link or its target.
import {lstatSync} from 'node:fs';

// Why (30 Oct 2026, owner): prestart bypasses the agent hook; check before invoking npm so every caller is protected.
try {
  if (lstatSync(new URL('../node_modules', import.meta.url)).isSymbolicLink()) {
    console.error('Install refused: desktop/node_modules is a link; run tools/worktree.sh own-modules desktop from the repo root, then retry.');
    process.exitCode = 1;
  }
} catch (error) {
  if (error.code !== 'ENOENT') {
    console.error(`Install refused: cannot check desktop/node_modules: ${error.message}`);
    process.exitCode = 1;
  }
}
