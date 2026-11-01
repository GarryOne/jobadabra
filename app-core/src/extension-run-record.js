// What a form fill's run record is made of (moved out of extension.js, 11 Oct 2026, a pure move): who paid for the answer (billedTo), the lessons from a fill's field log,
// the run's Notion page body (runBlocks) and the store-neutral run record and its data (runRecord, runData). No Notion calls and no AI: logRun in extension.js writes them.
// Guarded by app-core/test/extension.test.js and desktop/test/local-server.test.js.

// "Billed to" in 🎏 Agent Runs, from the answer's own usage (the desktop app's client may be any engine; the Worker's own is Anthropic's).
export const BILLED = ['Anthropic API credits', 'OpenAI API credits', 'Claude subscription', 'ChatGPT plan'];
export function billedTo(usage = {}) {
  const openai = usage.provider === 'openai';
  if (usage.billing === 'subscription') return openai ? 'ChatGPT plan' : 'Claude subscription';
  return openai ? 'OpenAI API credits' : 'Anthropic API credits';
}

const ATS = [['greenhouse', 'Greenhouse'], ['ashbyhq', 'Ashby'], ['lever.co', 'Lever'], ['workable', 'Workable']];

// Lessons from a fill, from its field log (no AI): what kept fields from being filled, grouped.
export function learnings(run) {
  const left = (run.trace || []).filter((f) => f.outcome !== 'filled');
  const groups = {};
  for (const f of left) (groups[f.reason || 'unknown'] ||= []).push(f.label);
  return Object.entries(groups).map(([reason, labels]) => `${labels.length} left: ${reason} (${labels.slice(0, 4).join(', ')}${labels.length > 4 ? ', …' : ''})`);
}

// Which documents went in, by slot and which document ("Cover letter: this job's letter"; a file the page held already: its slot only). Both stores show it.
export const attachedOf = (run) => (run.trace || []).filter((f) => f.type === 'file' && f.outcome === 'filled').slice(0, 10)
  .map((f) => [f.label, f.source].filter(Boolean).join(': ').slice(0, 120));

// The run's page: summary, the field-by-field log as a table, and what's left for the user.
export function runBlocks(run, minutes) {
  const t = (s) => [{ type: 'text', text: { content: String(s ?? '').slice(0, 1900) } }];
  const p = (s) => ({ object: 'block', type: 'paragraph', paragraph: { rich_text: t(s) } });
  const h = (s) => ({ object: 'block', type: 'heading_3', heading_3: { rich_text: t(s) } });
  const li = (s) => ({ object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: t(s) } });
  const trace = (run.trace || []).slice(0, 90);
  const blocks = [p(`${run.kit ? 'Filled from the kit' : 'Claude answered the form on the page'} in ${minutes} min; ` +
    `${trace.filter((f) => f.outcome === 'filled').length} of ${trace.length} fields filled; AI cost $${Number(run.usd || 0).toFixed(3)}.`)];
  if (trace.length) {
    blocks.push(h('Field by field'));
    const cells = (...values) => ({ type: 'table_row', table_row: { cells: values.map(t) } });
    blocks.push({ object: 'block', type: 'table', table: { table_width: 5, has_column_header: true, children: [
      cells('Field', 'Required', 'Answer from', 'Result', 'Why / note'),
      ...trace.map((f) => cells(f.label, f.required ? 'yes' : '', f.source || '—', f.outcome === 'filled' ? '✅ filled' : '⬜ left',
        [f.reason, f.low && `check: ${f.low}`].filter(Boolean).join(' · '))),
    ] } });
  }
  const lessons = learnings(run);
  if (lessons.length) { blocks.push(h('Learnings')); blocks.push(...lessons.map(li)); }
  if ((run.todo || []).length) { blocks.push(h('Left for you')); blocks.push(...run.todo.map(li)); }
  if (attachedOf(run).length) { blocks.push(h('Attached')); blocks.push(...attachedOf(run).map(li)); }
  if (run.debug) {
    // The full record (step timings, the form as read, every answer and its source, dropdown clicks, errors).
    const json = JSON.stringify(run.debug, null, 1).slice(0, 190000);
    const chunks = [];
    for (let i = 0; i < json.length; i += 1900) chunks.push({ type: 'text', text: { content: json.slice(i, i + 1900) } });
    blocks.push(h('Debug data'));
    for (let i = 0; i < chunks.length; i += 100) {
      blocks.push({ object: 'block', type: 'code', code: { language: 'json', rich_text: chunks.slice(i, i + 100) } });
    }
  }
  return blocks;
}

// A form fill by the extension, as a row in 🎏 Job Apply — Agent Runs (same columns as the agent runs).
// One fill run's values, whichever store keeps them (src/stores AGENT_RUN_FIELDS + AGENT_RUN_EXTRAS): logRun() writes them as Notion's
// 🤖 Agent Runs columns, the desktop's store on this Mac as an agent_runs record. `job`: the tracked job's summary, if any.
export function runRecord(run, job = {}) {
  const host = (() => { try { return new URL(run.url).hostname; } catch { return ''; } })();
  const minutes = Math.round((Date.parse(run.ended) - Date.parse(run.started)) / 600) / 100;
  const status = run.unfilled ? 'Needs input' : 'Ready';
  return {url: run.url, ats: (ATS.find(([key]) => host.includes(key)) || [null, 'Other'])[1], outcome: status,
    learnings: learnings(run).join(' · ') || (run.todo || []).join(' · '),
    fields: {job: job.title || '', company: job.company || '', agent: 'Extension', status, started: run.started, ended: run.ended, minutes,
      field_count: Number(run.fields) || 0, unfilled_required: Number(run.unfilled) || 0, tokens_total: 0,
      billed_to: BILLED.includes(run.billed_to) ? run.billed_to : run.usd ? 'Anthropic API credits' : 'Unknown',   // an older extension sends no billed_to
      reason: `${run.kit ? 'Filled from the kit' : 'The AI answered the form'}; AI cost $${Number(run.usd || 0).toFixed(3)}`,
      data: runData(run)}};
}

// The page body's table, "Left for you" and step timings as the record's `fields.data` (spec "Agent run shapes"), so the store on this Mac
// keeps what Notion's page shows (desktop renderer/pages/form-fills.js). Labels, sources and our own reasons only: never an answer value.
const cut = (value, n = 200) => String(value ?? '').slice(0, n);
export function runData(run) {
  return {
    fields: (run.trace || []).slice(0, 90).map((f) => ({label: cut(f.label), required: !!f.required, source: cut(f.source, 60),
      outcome: f.outcome === 'filled' ? 'filled' : 'left', confidence: f.low ? 'low' : '', reason: cut([f.reason, f.low && `check: ${f.low}`].filter(Boolean).join(' · '))})),
    left_for_you: (run.todo || []).slice(0, 30).map((item) => cut(item)),
    attachments: attachedOf(run),
    steps: (run.debug?.steps || []).slice(0, 60).map(({step, ms}) => ({step: cut(step, 60), ms: Math.max(0, Math.round(Number(ms) || 0))})),
  };
}
