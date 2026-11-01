// The pieces both strategy tests share (strategy-integration, strategy-notion-integration): the boards' new postings and one Jobs check, so they cannot drift apart.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {digestTitles} from '../../e2e/lib/digest.mjs';

export const ROLE = 'zebra wrangler', GIRAFFE = 'giraffe keeper', PLACE = 'lugano', SKIP = 'E2E Initech';
/** True when some entry of `list` (role keywords, places, companies) matches `word`, ignoring case; a missing list is empty. */
export const has = (list, word) => (list || []).some(entry => new RegExp(word, 'i').test(entry));
/** True when some digest title in `jobs` matches `word` (ignoring case) and, if `level` is given, starts with it ("Senior", "Staff"). */
export const listed = (jobs, word, level) => jobs.some(job => new RegExp(word, 'i').test(job) && (!level || job.startsWith(level)));

/** A new posting on one of the boards (the seen ones are not "new" again, so each check is judged on postings added just before it). */
export function addPosting(feeds, file, id, title, place = 'Lugano') {
  const feed = path.join(feeds, file), data = JSON.parse(fs.readFileSync(feed, 'utf8'));
  data.jobs.push({id, title, location: {name: place}, absolute_url: `https://boards.e2e.test/job/${id}`, updated_at: '2026-10-02T09:00:00Z',
    content: `<p>${title}: run production on Kubernetes and AWS with Terraform, SLOs and on-call. Senior level, English working language, ${place}.</p>`});
  fs.writeFileSync(feed, JSON.stringify(data));
}

/** One Jobs check on the feeds: the steps of a Find jobs press (`searchSteps`), to their end; -> the titles its digest listed. */
export const checker = (searchSteps, storage, exec) => async () => {
  const lines = [];
  const done = await searchSteps(storage, line => lines.push(String(line)), 'run', 'you', exec);
  assert.equal(done.code, 0, `the Jobs check failed: ${lines.slice(-8).join(' | ')}`);
  return digestTitles(lines.join('\n'));
};
