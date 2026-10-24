// Export job list (Pro): the jobs a person chose, as the columns they see (CSV or JSON) and the one gate. Pure: the handler reads the jobs through the
// store and writes the file. A CSV cell that starts with = + - @ (or a tab/return) gets a leading quote so a spreadsheet never runs a job title as a formula.
// No scoring words, no AI text: details live in Reports. Guard: test/jobs-export.test.js.
import path from 'node:path';

export const COLUMNS = [
  ['Role', job => job.title], ['Company', job => job.company], ['Location', job => job.location], ['Work mode', job => job.work_mode],
  ['Status', job => job.stage || job.status], ['Match', job => (job.fit == null || job.fit === '' ? '' : Number(job.fit))], ['Link', job => job.url],
  ['Posted', job => day(job.posted_at)], ['Found', job => day(job.first_seen_at)], ['Interview', job => job.next_interview], ['Notes', job => job.notes],
];
export const FORMATS = {csv: 'CSV (spreadsheet)', json: 'JSON'};
const day = value => String(value || '').slice(0, 10);

// Pro for this feature = the app is licensed: a paid Pro account (the site says so) or a valid owner-signed key (founder, friend, pass). One definition (licenseState in app-allowance.js).
export const canExport = state => !!state?.licensed;

export function rowsOf(jobs) {
  return jobs.map(job => Object.fromEntries(COLUMNS.map(([name, get]) => [name, get(job) ?? ''])));
}

// A formula-looking cell is made plain text with a leading quote (OWASP CSV injection); then RFC 4180 quoting.
export function safeCell(value) {
  let text = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
export function toCsv(jobs) {
  const rows = rowsOf(jobs), names = COLUMNS.map(([name]) => name);
  return `﻿${[names, ...rows.map(row => names.map(name => row[name]))].map(line => line.map(safeCell).join(',')).join('\r\n')}\r\n`;   // BOM: Excel reads the accents
}
export const toJson = jobs => `${JSON.stringify(rowsOf(jobs), null, 2)}\n`;
export const render = (jobs, format) => (format === 'json' ? toJson(jobs) : toCsv(jobs));

export const fileName = (date = new Date()) => `jobadabra-jobs-${date.toISOString().slice(0, 10)}`;
// The format follows the extension the person picked in the save dialog (csv by default).
export const formatOf = file => (path.extname(String(file)).toLowerCase() === '.json' ? 'json' : 'csv');

// The jobs to write: every one, or those whose link is in `urls` (what the Jobs list showed, sent by the window).
export function chosen(jobs, {all = false, urls = []} = {}) {
  if (all) return jobs;
  const wanted = new Set(urls.map(String));
  return jobs.filter(job => wanted.has(String(job.url)));
}
