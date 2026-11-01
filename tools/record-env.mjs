// The settings of a recording run (npm run record-sites) are RECORD_*; the old SMOKE_* names (until 15 Oct 2026) are still read, with one warning line. Guard: e2e/test/record/record-sites-rename.test.mjs.
const warned = new Set();

// recordVar('PAIRED') -> env.RECORD_PAIRED, else env.SMOKE_PAIRED (a warning once per name), else undefined. `old` is the setting's older suffix when it differs (SHARE: PER_NIGHT).
export function recordVar(name, env = process.env, {old = name, warn = line => console.warn(line)} = {}) {
  if (env[`RECORD_${name}`] !== undefined) return env[`RECORD_${name}`];
  for (const suffix of new Set([name, old])) {
    if (env[`SMOKE_${suffix}`] === undefined) continue;
    if (!warned.has(suffix)) { warned.add(suffix); warn(`record-sites: SMOKE_${suffix} is the old name: use RECORD_${name}`); }
    return env[`SMOKE_${suffix}`];
  }
  return undefined;
}
