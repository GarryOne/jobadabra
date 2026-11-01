// The app the night's extension talks to (private spec jobadabra-lab:docs/specs/2026-10-17-ready-to-send.md): a small local server that answers like the Mac's, from the batch only. /extension/me and /extension/kit are keyed by the job's address (its form and the pages below it count as the job);
// every other call answers {} (no AI judging, no Notion, no Keychain, no site password: phase 1 has no accounts). It keeps what the fill reported: the run record's counts and the page's role (an account or sign-in page is a wall).
// It holds no secret and no network access beyond 127.0.0.1. Guard: desktop/test/ready-fill.test.js.
import http from 'node:http';
// The app's own rule for a job's form address (desktop/lib/form-address.js); in the image it sits at /desktop/lib, which this same path reaches from /night.
import {isFormOf} from '../../desktop/lib/form-address.js';

const HEADERS = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Content-Type': 'application/json'};
const file = (name, base64) => (base64 ? {data: base64, name, type: 'application/pdf'} : null);

// batch: {contact, jobs: [{id, url, title, company, kit, cv, letterPdf}]}. -> {port, close, outcome(url), asked}
export async function createStandIn(batch, {answer = null} = {}) {
  // A page the extension reports belongs to the job whose form it is (the posting, its form address, or a page below it, the way the app matches):
  // every lookup and every count is kept under that job's address, so a press on Apply or a next step stays on the same job.
  const key = address => { const page = String(address || '').split('#')[0]; return batch.jobs.find(job => isFormOf(page, job.url))?.url.split('#')[0] ?? page; };
  const jobs = new Map(batch.jobs.map(job => [key(job.url), job]));
  const passes = new Map(), roles = new Map(), stuck = new Map(), started = new Map(), said = new Map(), asked = [];   // said: per job, the AI's answers with the question each was for (the morning's Open in Chrome replays them)
  let answered = 0;   // the AI answers asked since the form now filling started (forms fill one at a time: the live line's count)   // passes: per job, the counts of each fill pass (a second pass fills only what the first left)
  const answers = {
    '/extension/pair': port => ({url: `http://127.0.0.1:${port}`, token: 'night'}),
    '/extension/run': () => ({ok: true, id: 'night-run'}),
    '/extension/answer': async (port, url, body) => {
      answered++;
      const done = answer ? await answer(body) : {answers: [], usd: 0};
      if (body?.url && Array.isArray(done?.answers)) keepSaid(body, done.answers);
      return done;
    },   // the night's AI (night-ai.mjs) when the batch has facts; otherwise the questions the kit and the rules do not cover stay open
    '/extension/me': (port, url) => {
      const job = jobs.get(key(url));
      return {contact: batch.contact || {}, contactSource: 'night', ...(file('CV.pdf', job?.cv) ? {resume: file('CV.pdf', job.cv)} : {}), ...(file('Cover letter.pdf', job?.letterPdf) ? {coverLetterFile: file('Cover letter.pdf', job.letterPdf)} : {})};
    },
    '/extension/kit': (port, url) => { const job = jobs.get(key(url)); return job ? {job: {title: job.title, company: job.company, url: job.url}, kit: job.kit || null} : {error: 'not tracked'}; },
  };
  // The night's answers for a job, each with its question's id and label (the morning matches a field by them): only answers it typed or proposed, never an empty one.
  function keepSaid(body, answers) {
    const label = Object.fromEntries((body.fields || []).map(f => [String(f.field || ''), String(f.label || '')]));
    const list = said.get(key(body.url)) || [];
    for (const each of answers) if (each?.field && each.value !== '' && each.value != null && label[each.field] !== undefined) list.push({field: String(each.field), label: label[each.field], answer: each});
    said.set(key(body.url), list.slice(-200));
  }
  const server = http.createServer((request, response) => {
    if (request.method === 'OPTIONS') { response.writeHead(204, HEADERS); response.end(); return; }
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', async () => {
      const [route, query = ''] = request.url.split('?');
      const url = new URLSearchParams(query).get('url') || '';
      asked.push(route); if (process.env.JP_NIGHT_DEBUG && route === '/extension/event') console.log('event', body.slice(0, 300));
      let parsed = null;
      try { parsed = body ? JSON.parse(body) : null; } catch { /* not JSON */ }
      if (route === '/extension/run' && parsed?.url) {   // the fill's own record: counts only. An update (`update` set) restates the last pass; a new record is a new pass.
        const list = passes.get(key(parsed.url)) || [], pass = {fields: Number(parsed.fields) || 0, unfilled: Number(parsed.unfilled) || 0, usd: Number(parsed.usd) || 0};
        if (parsed.update && list.length) list[list.length - 1] = {...pass, usd: list[list.length - 1].usd}; else list.push(pass);
        passes.set(key(parsed.url), list);
      }
      if (route === '/extension/event' && parsed?.type === 'fill-started' && parsed.url) started.set(key(parsed.url), (started.get(key(parsed.url)) || 0) + 1);
      if (route === '/extension/event' && parsed?.type === 'stuck' && parsed.url) stuck.set(key(parsed.url), {why: String(parsed.why || ''), needs: String(parsed.needs || '')});   // the fill's own dead end: its reason and the fixed sentence, no page text
      if (route === '/extension/review' && parsed?.url) roles.set(key(parsed.url), String(parsed.role || ''));
      const found = answers[route] ? await answers[route](server.address().port, url, parsed) : {};
      response.writeHead(200, HEADERS); response.end(JSON.stringify(found));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    port: server.address().port, asked,
    // What the fill reported for a job: filled count, required left, the page's role. null until the extension posted its record.
    outcome: url => { const list = passes.get(key(url)); return list?.length ? {filled: list.reduce((sum, pass) => sum + pass.fields, 0), left: list.at(-1).unfilled, role: roles.get(key(url)) || '', usd: list.reduce((sum, pass) => sum + pass.usd, 0)} : null; },
    started: url => started.get(key(url)) || 0,
    role: url => roles.get(key(url)) || '',
    stuck: url => stuck.get(key(url)) || null,
    answered: () => answered,
    said: url => said.get(key(url)) || [],
    // A form added to the night while it runs (a 2nd Fill again joins the line): its kit and files are served like the others.
    add: job => { if (!batch.jobs.some(each => each.id === job.id)) batch.jobs.push(job); jobs.set(key(job.url), job); },
    // Before a form fills (again): what an earlier pass of it reported is forgotten, so its outcome is this fill's.
    reset: url => { for (const map of [passes, roles, stuck, started, said]) map.delete(key(url)); answered = 0; },
    close: () => new Promise(resolve => server.close(resolve)),
  };
}
