// The one writer of a grey job's trend record: grey.json {suite, reason}, uploaded by the retry step as artifact "grey-<suite>" and read by the private site's hourly collector.
// Invariants: reason is one of REASONS (flakyProof's own kind, or picker), suite a plain suite key; the record holds nothing else, so it carries no log text and needs no secret scan;
// the run id, day and kind are added by the reader from the run it reads, never stored here. A caller that cannot write must not change the job's verdict (flaky-proof.mjs).
// Why (gt, 31 Oct 2026, owner: "which suite went grey most this week, and why"): since #2665 a grey job ends green, so nothing counted greys over time.
// Tests: test/grey-record.test.mjs
// Job: report health
import fs from 'node:fs';
import path from 'node:path';

export const REASONS = ['timing', 'environment', 'picker'];
const SUITE = /^[\w.+-]{1,80}$/;

/** The record for one grey job, or a thrown Error when the suite key or the reason is not one the site accepts (both ends validate). */
export function greyRecord(suite, reason) {
  if (typeof suite !== 'string' || !SUITE.test(suite)) throw new Error(`grey record: suite "${String(suite).slice(0, 40)}" is not a plain suite key`);
  if (!REASONS.includes(reason)) throw new Error(`grey record: reason "${String(reason).slice(0, 40)}" is not one of ${REASONS.join(', ')}`);
  return {suite, reason};
}

/** Write the record to `file` (its folder is created). */
export function writeGreyRecord(file, suite, reason) {
  const record = greyRecord(suite, reason);
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, JSON.stringify(record));
  return record;
}
