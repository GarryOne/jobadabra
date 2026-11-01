// A suite's own data, written through the store the app uses (ctx.data, lib/store-call.mjs), so one seed works on this Mac's store and on Notion (P7 step 4).
// Each helper writes what the app itself would: the same entities, fields and sections. Guarded by test/seed-data.test.mjs.
import {tailoredFiles as notionTailoredFiles} from './notion.mjs';

export const KIT_SECTION = '📝 Application kit';         // src/stores/base.py KIT_SECTION
export const DESCRIPTION_SECTION = '🧾 Job description';  // src/ai/prep.py DESCRIPTION_HEADING

// The kit section as the engine keeps it on every store (src/ai/kit.py kit_markdown, base.kit_from): readable text, then the kit as the section's last ```json fence.
export const kitMarkdown = kit => `Drafted for the end-to-end test.\n\n### Machine-readable kit\n\n\`\`\`json\n${JSON.stringify(kit)}\n\`\`\`\n`;

// A tracked job with a drafted kit (kit: null = a saved job the person has not prepared yet) and, if given, the posting's text. -> the store's record ({id, url, ...}).
export async function addKitJob(ctx, {title, company, url, kit, fit = 80, description = '', stage = 'Kit ready', nextStep = '📝 Kit ready: review it, then apply', location = 'Zurich, Switzerland'}) {
  const made = await ctx.data('applications', 'create', {job: {url, title, company, location}, stage});
  if (!made?.id) throw new Error(`the store did not create the job ${url}: ${JSON.stringify(made)}`);
  await ctx.data('applications', 'update', {app_id: made.id, fields: {fit, next_step: nextStep}});
  if (kit) await ctx.data('applications', 'set_section', {app_id: made.id, name: KIT_SECTION, markdown: kitMarkdown(kit)});
  if (description) await ctx.data('applications', 'set_section', {app_id: made.id, name: DESCRIPTION_SECTION, markdown: description});
  return made;
}

// The posting of a live row, as a real user's job is when they press Apply on a fresh posting from their list: tracked (title, company), Saved, NO drafted kit,
// nothing invented (no fixture description or location). Both live paths seed it (suites/apply.mjs for lib/apply-live.mjs; lib/live-row.mjs): a drafted kit makes
// the extension skip its eligibility stop (extension/tab-pages.js kitStance), so a kit on the Electron path only split the paths (Teamtailor, 11 Oct 2026).
export const seedLivePosting = (ctx, {url, title, company}) => addKitJob(ctx, {title: title || 'Live posting', company: company || '', url, kit: null, stage: 'Saved', nextStep: '', location: ''});

// Every tracked job at one of `urls` removed with its sections and files (a suite resets only the jobs it wrote). -> how many.
export async function removeJobsByUrl(ctx, urls) {
  let count = 0;
  for (const url of urls) {
    const found = await ctx.data('applications', 'get', {url});
    if (found?.id) { await ctx.data('applications', 'delete', {app_id: found.id}); count++; }
  }
  return count;
}

// The job's stage in the store ('' when it is not tracked).
export const stageOf = async (ctx, url) => (await ctx.data('applications', 'get', {url}))?.stage || '';

// How many tailored CVs the job carries in the store: on Notion its "Tailored CV" column (desktop/lib/files.js); on this Mac's store the job's files
// (applications.attach, so a later move to Notion carries them; owner, 9 Oct 2026: a tailored CV goes through the store on every store).
export async function tailoredFiles(ctx, url) {
  if (ctx.store !== 'sqlite') return notionTailoredFiles(ctx.token, url);
  const job = await ctx.data('applications', 'get', {url});
  if (!job?.id) return 0;
  return ((await ctx.data('applications', 'files', {app_id: job.id})) || []).filter(file => /\.pdf$/i.test(file.name || '')).length;
}

// A tracked job as the Calendar and Interviews suites need it: its stage and, if given, its next interview (an ISO date or date-time). -> the store's record.
export async function addTrackedJob(ctx, {role, company, url, stage = 'Interviewing', nextInterview = '', location = 'Zurich, Switzerland'}) {
  const made = await ctx.data('applications', 'create', {job: {url, title: role, company, location}, stage});
  if (!made?.id) throw new Error(`the store did not create the job ${url}: ${JSON.stringify(made)}`);
  if (nextInterview) await ctx.data('applications', 'update', {app_id: made.id, fields: {next_interview: nextInterview}});
  return made;
}

// A 🎤 interview (`overall` unset: not reviewed yet), linked to a job by its record id; its transcript and review are whole Markdown (spec §4). -> the store's record.
export async function addInterview(ctx, {name, day, round = '', overall = '', nextStep = '', input = 'Transcript', applicationId = '', transcript = '', review = ''}) {
  const fields = {title: name, at: day, round, input, ...(overall ? {overall} : {}), ...(nextStep ? {next_step: nextStep} : {}), ...(applicationId ? {app_id: applicationId} : {}),
    ...(transcript ? {transcript} : {}), ...(review ? {review} : {})};
  const made = await ctx.data('interviews', 'save', {interview_id: null, fields});
  if (!made?.id) throw new Error(`the store did not save the interview "${name}": ${JSON.stringify(made)}`);
  return made;
}
