// The quality suite's rows ({id, props}, props named as the Job Matches columns lib/quality.mjs checks) on either store (P7 step 4, option d, mac-e4 9 Oct 2026).
// Notion (the stand-in, or the real test page): the Job Matches rows as they are, every column. This Mac's store: the store's match records (ctx.data matches.list),
// with what a record carries (src/stores/base.py MATCH_FIELDS: title, company, location, work mode, fit, reason, status, the fit parts and gaps). The enriched
// facts only Notion's columns hold today (ENRICHED) are checked where they exist; on this Mac's store a check of one says "not kept on this Mac's store" until the
// record carries it (mac-70 is adding them to the record), and then switches on by itself. Guarded by test/quality-rows.test.mjs.
import {databaseRows} from './notion.mjs';

export const MATCHES = 'Job Matches — AI Scored';
// Job Matches column -> the match record's field (snake_case, as the record will name it).
export const ENRICHED = {Tier: 'tier', Confidence: 'confidence', Code: 'code', Seniority: 'seniority', Languages: 'languages', Technologies: 'technologies',
  'Role family': 'role_family', Salary: 'salary', Recruiter: 'recruiter'};
const PARTS = {'Role fit': 'role_fit', 'Location fit': 'location', 'Compensation fit': 'compensation', Growth: 'growth', Risk: 'risk'};   // src/stores/notion_matches.py PARTS

// One store match record as a row of columns. Enriched columns the record lacks are left out (not "empty"): `missing` lists them.
export function rowOfRecord(record) {
  const detail = record.fit_detail || {}, parts = detail.parts || {};
  const props = {Job: record.title, 'Job URL': record.url, Company: record.company, Location: record.location, 'Work mode': record.work_mode, Score: record.fit,
    Reason: record.reason, Status: record.status, Gaps: Array.isArray(detail.gaps) ? detail.gaps.join('; ') : detail.gaps || ''};
  for (const [column, key] of Object.entries(PARTS)) props[column] = parts[key];
  const missing = [];
  for (const [column, field] of Object.entries(ENRICHED)) { if (field in record) props[column] = record[field]; else missing.push(column); }
  return {id: record.url, props, notKept: missing};
}

// -> [{id, props, notKept}] of the store the app uses.
export async function matchRowsOf(ctx) {
  if (ctx.store !== 'sqlite') return (await databaseRows(ctx.token, MATCHES)).map(row => ({...row, notKept: []}));
  return ((await ctx.data('matches', 'list', {})) || []).map(rowOfRecord);
}

// The columns of `rows` this store does not keep yet: one line for the step's output, '' when every column is kept.
export function notKeptNote(rows) {
  const columns = [...new Set(rows.flatMap(row => row.notKept || []))];
  return columns.length ? `not kept on this Mac's store (not checked): ${columns.join(', ')}` : '';
}
