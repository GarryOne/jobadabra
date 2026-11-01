// The night's AI answers (private spec jobadabra-lab:docs/specs/2026-10-17-ready-to-send.md; owner, 17 Oct 2026: "Yes, add AI in phase 1"): the stand-in's /extension/answer runs the same engine as the normal Apply (app-core/src/extension.js answerForm:
// same prompt, same floors) on the owner's facts from the batch. The container holds no key: each model call goes to the site (/api/ready/ai) with the night token, which counts its cost toward the $1 cap. A written answer stays a draft,
// as in the app. Any failure answers nothing (the questions stay open for the morning); it never stops the fill. Guard: desktop/test/ready-fill.test.js.
const key = address => String(address || '').split('#')[0];

// The model client answerForm expects ({messages: {create}}): a call goes through the site. A capped night throws the contract's AiLimit.
export function siteClient({site, token, fetchImpl = fetch}) {
  return {engine: 'night', messages: {create: async params => {
    const reply = await fetchImpl(`${site}/api/ready/ai`, {method: 'POST', headers: {authorization: `Bearer ${token}`, 'content-type': 'application/json'}, body: JSON.stringify(params)});
    if (!reply.ok) throw Object.assign(new Error(`the night's AI answered ${reply.status}`), {aiLimit: reply.status === 402});
    return reply.json();
  }}};
}

// What answerForm reads as its env: the owner's facts from the batch, and the jobs as the store would give them.
export function answerEnv(batch, fetchFn = fetch) {
  const jobs = new Map(batch.jobs.map(job => [key(job.url), job]));
  const facts = batch.facts || {};
  return {PROFILE_TEXT: facts.profile || '', ANSWERS_TEXT: facts.standard || '', SEARCH_TEXT: facts.search || '', CV_FACTS_TEXT: facts.cvFacts || '', KNOWLEDGE_TEXT: facts.knowledge || '', fetchFn,
    store: {findJob: async url => { const job = jobs.get(key(url)); return job ? {id: job.id, title: job.title, company: job.company, url: job.url} : null; },
      kit: async id => { const job = batch.jobs.find(each => each.id === id); return job ? {answers: job.kit?.answers || [], cover_letter: job.letter || ''} : null; }}};
}

// The fields as the app's route cleans them before the AI sees them.
const cleanFields = list => list.slice(0, 80).map(f => ({field: String(f.field || '').slice(0, 200), label: String(f.label || '').slice(0, 300), type: String(f.type || '').slice(0, 30), required: !!f.required,
  ...(f.multiple ? {multiple: true} : {}), ...(Array.isArray(f.options) && f.options.length ? {options: f.options.slice(0, 60).map(o => String(o).slice(0, 150))} : {})}));

// answerForm: the engine (passed in so a test can fake it). -> the handler of /extension/answer: (body) => {answers, ...}. The cost is counted by the site per call, so the usd here is 0.
export function createAnswerer({batch, site, token, answerForm, fetchImpl = fetch, log = console}) {
  if (!batch.facts || !Object.values(batch.facts).some(Boolean)) return async () => ({answers: [], usd: 0});   // no facts, nothing to answer from
  const env = answerEnv(batch, fetchImpl), client = siteClient({site, token, fetchImpl});
  return async body => {
    if (!body?.url || !Array.isArray(body.fields) || !body.fields.length) return {answers: [], usd: 0};
    try {
      const done = await answerForm(env, {url: body.url, fields: cleanFields(body.fields), page_text: body.page_text}, client);
      return {...done, usd: 0};
    } catch (error) {
      log.error(`night AI: ${String(error.message).slice(0, 120)}`);
      return {answers: [], usd: 0};
    }
  };
}

// The engine is the Worker's own module (copied into the image next to these files, or two folders up in the repo); loaded only when the batch has facts, so a night without them needs neither it nor its SDK.
async function engine() {
  for (const where of ['./app-core/src/extension.js', '../../app-core/src/extension.js']) {
    try { return (await import(where)).answerForm; } catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND' || !String(error.message).includes('/extension.js')) throw error; }
  }
  throw new Error('the answer engine is not in the image');
}

// -> the /extension/answer handler for this batch (no facts: one that answers nothing).
export async function answererFor({batch, site, token, fetchImpl = fetch, log = console}) {
  const has = batch.facts && Object.values(batch.facts).some(Boolean);
  try { return createAnswerer({batch, site, token, answerForm: has ? await engine() : null, fetchImpl, log}); }
  catch (error) { log.error(`night AI off: ${String(error.message).slice(0, 120)}`); return createAnswerer({batch: {...batch, facts: {}}, site, token, answerForm: null, fetchImpl, log}); }
}
