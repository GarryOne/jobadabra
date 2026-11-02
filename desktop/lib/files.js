// Large files that used to live only on this Mac, kept in Notion too (the source of truth): the CV (every version,
// on the Profile page under "📎 CV") and each tailored CV (on the job's Applications row, column "Tailored CV").
// Notion's file uploads: create an upload, send the bytes, then attach it. The free plan takes files up to 5 MB;
// anything bigger (call recordings) stays on the Mac and in the automatic backup (lib/backup.js).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as notion from './notion.js';   // Notion-only: the CV and cover letter uploaded to the Notion Profile, only when Notion is the store (notionInUse)
import {notionInUse} from './notion-gate.js';

export const MAX_BYTES = 5 * 1024 * 1024;
export const CV_HEADING = '📎 CV';
export const LETTER_HEADING = '✉️ Cover letter';  // the approved general cover letter PDFs, newest first
// The end-to-end tests put a Notion stand-in in between that can fail on purpose (desktop/e2e/lib/notion-proxy.mjs); honoured only in a test run.
const API = process.env.JOBADABRA_E2E && process.env.JOBADABRA_E2E_NOTION_BASE_URL ? `${process.env.JOBADABRA_E2E_NOTION_BASE_URL.replace(/\/$/, '')}/v1/` : 'https://api.notion.com/v1/';
export const fingerprint = file => crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex').slice(0, 16);

// -> the file upload's id, ready to attach. Throws when Notion refuses or the file is too big.
export async function upload(token, file, name = path.basename(file), fetcher = globalThis.fetch) {
  const data = fs.readFileSync(file);
  if (data.length > MAX_BYTES) throw new Error(`${name} is ${(data.length / 1e6).toFixed(1)} MB; Notion's free plan takes files up to 5 MB`);   // about Notion
  const created = await notion.call(token, 'POST', 'file_uploads', {filename: name, content_type: 'application/pdf'}, fetcher);
  const form = new FormData();
  form.append('file', new Blob([data], {type: 'application/pdf'}), name);
  const response = await fetcher(`${API}file_uploads/${created.id}/send`, {method: 'POST', body: form,
    headers: {Authorization: `Bearer ${token}`, 'Notion-Version': '2022-06-28'}});   // about Notion
  const sent = await response.json().catch(() => ({}));
  if (!response.ok || sent.status !== 'uploaded') throw new Error(sent.message || `Notion upload ${response.status}`);   // about Notion
  return created.id;
}

// A PDF on the Profile page under its heading ("📎 CV", "✉️ Cover letter"), newest version first (older ones stay below).
export async function cvToProfile(token, profileId, file, name, when = new Date(), fetcher, headingText = CV_HEADING) {
  const id = await upload(token, file, name, fetcher);
  const blocks = await notion.textBlocks(token, profileId, fetcher);
  let heading = blocks.find(block => block.type.startsWith('heading') && block.text.trim() === headingText)?.id;
  if (!heading) heading = await notion.appendHeading(token, profileId, headingText, fetcher);
  const caption = `${name} · ${when.toISOString().slice(0, 10)}`;
  await notion.call(token, 'PATCH', `blocks/${profileId}/children`, {after: heading, children: [{object: 'block', type: 'file',
    file: {type: 'file_upload', file_upload: {id}, caption: [{type: 'text', text: {content: caption}}]}}]}, fetcher);
  return caption;
}

// A tailored CV on the job's Applications row (-> false when the job has no row yet: it's still on this Mac).
export async function tailoredToApplication(token, applicationsDb, jobUrl, file, name, fetcher) {
  const found = await notion.call(token, 'POST', `databases/${applicationsDb}/query`,
    {filter: {property: 'Job URL', url: {equals: jobUrl}}, page_size: 1}, fetcher);
  const row = found.results?.[0];
  if (!row) return false;
  const id = await upload(token, file, name, fetcher);
  await notion.call(token, 'PATCH', `pages/${row.id}`, {properties: {'Tailored CV': {files: [{type: 'file_upload', file_upload: {id}, name}]}}}, fetcher);
  return true;
}

// The CV in Notion once per version: settings.cvInNotion remembers which one is there. -> what happened.
export async function syncCv(storage, fetcher) {
  const token = storage.secret('NOTION_TOKEN'), profile = storage.settings().notionIds?.NOTION_PROFILE_PAGE_ID;
  const file = storage.path('cv.pdf');
  if (!notionInUse(storage)) return {skipped: 'the data is on this Mac'};   // one copy: never into a Notion that is not the store
  if (!token || !profile || !fs.existsSync(file)) return {skipped: 'nothing to upload'};
  const print = fingerprint(file);
  if (storage.settings().cvInNotion === print) return {skipped: 'already in Notion'};   // about Notion
  const caption = await cvToProfile(token, profile, file, storage.settings().cvName || 'CV.pdf', new Date(), fetcher);
  storage.saveSettings({cvInNotion: print});
  return {uploaded: caption};
}

// The approved cover letter on the Profile page, once per version (the user's text is in the PDF; Notion keeps every version):
// settings.letterInNotion remembers which one is there, so a letter approved while the data was on this Mac reaches Notion after a
// move to it (syncCv runs at every start, as it does for the CV).
export async function coverLetterToProfile(storage, file, fetcher) {
  const token = storage.secret('NOTION_TOKEN'), profile = storage.settings().notionIds?.NOTION_PROFILE_PAGE_ID;
  if (!notionInUse(storage) || !token || !profile || !fs.existsSync(file)) return null;
  const print = fingerprint(file);
  if (storage.settings().letterInNotion === print) return null;
  const caption = await cvToProfile(token, profile, file, 'Cover letter.pdf', new Date(), fetcher, LETTER_HEADING);
  storage.saveSettings({letterInNotion: print});
  return caption;
}
