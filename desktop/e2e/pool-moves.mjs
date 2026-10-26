// node pool-moves.mjs <smoke reports folder>: after a CI pool run, the ladder moves each row's pages confirmed (lib/ladder-moves.mjs poolMoves, from the rows' saved app logs), printed as a
// table for the job log, then sent to the site's learning marked source 'ci' (sendMoves: CI only, the narrow REPLAYS_PUBLISH_KEY). Spec docs/superpowers/specs/2026-10-12-one-next-move.md,
// phase 1. Never fails the job: it prints lines.
import fs from 'node:fs';
import path from 'node:path';
import {poolMoves, sendMoves} from './lib/ladder-moves.mjs';

const [dir = ''] = process.argv.slice(2);
const days = (() => { try { return fs.readdirSync(dir).filter(name => /^\d{4}-\d\d-\d\d\.json$/.test(name)).sort(); } catch { return []; } })();
const report = days.length ? JSON.parse(fs.readFileSync(path.join(dir, days.at(-1)), 'utf8')) : {};
const found = poolMoves(report, name => { try { return fs.readFileSync(path.join(dir, name), 'utf8'); } catch { return ''; } });
for (const line of found.lines) console.log(line);
console.log(await sendMoves(found.moves, {source: 'ci', repairs: found.repairs}));
