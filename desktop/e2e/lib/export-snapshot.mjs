// Hashes the exact exported file bytes used as the restore contract in Settings round trips.
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {tar} from '../../lib/tar.js';

/** Read named file digests from an archive; files present before export must not disappear. */
export function exportedFileDigests(file, before) {
  const run = args => {
    const result = spawnSync(tar(), args, {maxBuffer: 64 * 1024 * 1024, timeout: 20000});
    if (result.error || result.status !== 0) throw new Error(`cannot read export archive (${result.error?.code || result.status})`);
    return result.stdout;
  };
  const members = run(['-tzf', file]).toString().split(/\r?\n/);
  return Object.fromEntries(Object.entries(before).map(([name, digest]) => {
    const member = members.find(entry => entry.replace(/^\.\//, '') === name);
    if (!member && digest !== null) throw new Error(`export archive omitted ${name}`);
    return [name, member ? crypto.createHash('sha256').update(run(['-xOzf', file, member])).digest('hex') : null];
  }));
}
