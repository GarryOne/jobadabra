// Telegram webhook for @sre_job_pilotto_bot.
//
// Quick commands (/help, /status, /applied) are answered here. Commands that
// need the job database (/run, /today, /apply_<code>) start the GitHub
// workflow, which replies in Telegram when it finishes.

import { handleReport } from './report.js';
import { handleExtension } from './extension.js';
import { runScheduled } from './scheduler.js';
import { STAGE_EMOJI, escapeHtml, formatRuns, formatNotionRuns, formatApplied, formatSaved, formatAppliedItems, formatSavedItems, formatRunItems } from './format.js';
export { escapeHtml, formatRuns, formatNotionRuns, formatApplied, formatSaved };
import { LABEL as WATCHDOG_LABEL, TITLE as WATCHDOG_TITLE } from './watchdog.js';

const HELP = [
  '✈️ <b>Jobadabra</b>\nCommands',
  '<b>Jobs</b>\n/check — find and score new jobs, then send the digest (~3 min; /run works too)\n/today — the current ranked list (~1 min)\n/saved — jobs you saved with ⭐\n/employers — find new employers with a public job feed (~1 min; /scout works too)',
  '<b>Applications</b>\n/applied — your applications with their stage; tap a number to record a reply\n/add &lt;job URL&gt; [date] — track an application made elsewhere, e.g. /add https://… two days ago\n/mail — check Gmail and Calendar now (also runs 3 times a day)',
  '<b>Reports</b>\n/insight — one insight about your search (~1 min)\n/weekly — the weekly report (~1 min); it also arrives every Monday\n/status — latest runs',
  '<b>Send me</b>\nA screenshot, a forwarded message or /add with its text: I find the job it is about and update it.\nAfter an interview: the recording (only if everyone agreed) or a transcript (.txt, .md, .srt, .vtt) with a caption like "Grafana, round 1", or /interview Grafana round 1 and your notes.',
  '<b>Under a digest</b>\nTap a job number → ✅ Applied · ⭐ Save · ❌ Dismiss · 📝 Prepare (saves a cover letter and form answers in Notion)',
].join('\n\n');

// "/apply_ab12cd34@sre_job_pilotto_bot" -> { name: "apply", arg: "ab12cd34" }
export function parseCommand(text) {
  const match = /^\/([a-z]+)(?:_([0-9a-z]+))?(?:@\w+)?(?:\s|$)/i.exec((text || '').trim());
  return match ? { name: match[1].toLowerCase(), arg: (match[2] || '').toLowerCase() } : null;
}

// Telegram's Bot API; in the desktop app's end-to-end tests, their fake (desktop/e2e/lib/telegram-fake.mjs). A Cloudflare worker has no `process`: always the real API.
function telegramBase() {
  const env = globalThis.process?.env || {};
  return env.JOB_PILOTTO_E2E && env.JOB_PILOTTO_E2E_TELEGRAM_BASE_URL ? env.JOB_PILOTTO_E2E_TELEGRAM_BASE_URL.replace(/\/$/, '') : 'https://api.telegram.org';
}

async function telegram(env, method, body) {
  const response = await fetch(`${telegramBase()}/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Telegram ${method} failed: ${response.status}`);
  return response.json();
}

// A command answers with text, or with {text, keyboard} when it carries buttons.
function reply(env, answer) {
  const { text, keyboard } = typeof answer === 'string' ? { text: answer } : answer;
  return telegram(env, 'sendMessage', {
    chat_id: env.OWNER_CHAT_ID, text, parse_mode: 'HTML', disable_web_page_preview: true,
    ...(keyboard ? { reply_markup: keyboard } : {}),
  });
}

function github(env, path, init = {}) {
  return fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'sre-job-pilotto-bot',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
}

async function dispatch(env, inputs, workflow = env.WORKFLOW_FILE) {
  // The desktop app runs the same pipeline locally instead of starting a GitHub workflow.
  if (env.dispatch) return env.dispatch(inputs, workflow);
  // A dispatch from Telegram (an audio file, /interview, a button) starts a run the Mac never sees: log it here, or
  // "who started this run?" has no answer on either side (1 Oct 2026: two runs 38 s apart for one interview).
  // Fields and mode only — never the user's words in `note`.
  console.log(`dispatch ${workflow} mode=${inputs?.mode || '-'} keys=${Object.keys(inputs || {}).sort().join(',')}`);
  const response = await github(env, `actions/workflows/${workflow}/dispatches`, {
    method: 'POST', body: JSON.stringify({ ref: 'main', inputs }),
  });
  if (response.status !== 204) {
    console.log(`dispatch failed ${workflow} status=${response.status}`);
    throw new Error(`GitHub dispatch failed: ${response.status} ${await response.text()}`);
  }
}

function notion(env, path, method = 'GET', body) {
  return fetch(`https://api.notion.com/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.NOTION_TOKEN}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

// Outcome buttons under /applied (callback_data, page id without dashes):
//   opick:<n>:<page>       number n tapped -> outcome rows for that application
//   out:<k>:<page>:<n>     outcome k -> Stage on the Applications row + a 📈 Application Events row
//   oclose                 hide the outcome rows
export const OUTCOMES = {
  c: 'Confirmation received', s: 'Screening', i: 'Interview scheduled', v: 'Interviewing',
  o: 'Offer', r: 'Rejected', n: 'No response', w: 'Withdrawn',
};
const OUTCOME_LABELS = {
  c: '📬 Confirmed', s: '📞 Screening', i: '🗓 Interview booked', v: '🎤 Interviewing',
  o: '🎉 Offer', r: '❌ Rejected', n: '💤 No reply', w: '↩️ Withdrawn',
};
// Insight feedback buttons: ins:<u|n|a>:<page> -> Feedback on the 💡 Insights row.
const INSIGHT_FEEDBACK = { u: ['Useful', '👍 Marked useful'], n: ['Not useful', '👎 Marked not useful'],
                           a: ['Acting on it', "✅ You're acting on it"] };
const isOutcomeRow = (row) => row.some((b) => /^(out:|oclose)/.test(b.callback_data || ''));

export function appliedKeyboard(pages) {
  const buttons = pages.map((page, i) => ({ text: String(i + 1), callback_data: `opick:${i + 1}:${page.id.replace(/-/g, '')}` }));
  const rows = [];
  for (let i = 0; i < buttons.length; i += 6) rows.push(buttons.slice(i, i + 6));
  return rows.length ? { inline_keyboard: rows } : null;
}

export function withOutcomeRows(markup, n, page) {
  const rows = (markup?.inline_keyboard || []).filter((row) => !isOutcomeRow(row));
  const button = (k) => ({ text: OUTCOME_LABELS[k], callback_data: `out:${k}:${page}:${n}` });
  return { inline_keyboard: [
    [{ text: `${n}:`, callback_data: 'oclose' }, button('c'), button('s'), button('i')],
    [button('v'), button('o'), button('r'), button('n')],
    [button('w'), { text: '✖', callback_data: 'oclose' }],
    ...rows,
  ] };
}

export function afterOutcome(markup, n, emoji) {
  const rows = (markup?.inline_keyboard || []).filter((row) => !isOutcomeRow(row));
  return { inline_keyboard: rows.map((row) => row.map((b) => (
    new RegExp(`^opick:${n}:`).test(b.callback_data || '') ? { ...b, text: `${emoji} ${n}` } : b))) };
}

// Stage on the Applications row plus one event row: the history the learning reports read.
export async function recordOutcome(env, page, stage) {
  const got = await notion(env, `pages/${page}`);
  if (!got.ok) throw new Error(`Notion page read failed: ${got.status}`);
  const props = (await got.json()).properties || {};
  const text = (prop) => (prop?.rich_text || prop?.title || []).map((t) => t.plain_text).join('');
  const patched = await notion(env, `pages/${page}`, 'PATCH', { properties: { Stage: { select: { name: stage } } } });
  if (!patched.ok) throw new Error(`Notion stage update failed: ${patched.status}`);
  const created = await notion(env, 'pages', 'POST', {
    parent: { database_id: env.NOTION_EVENTS_DB },
    properties: {
      Event: { title: [{ text: { content: `${stage} · ${text(props.Company) || text(props.Job) || 'application'}`.slice(0, 200) } }] },
      Application: { relation: [{ id: page }] },
      Kind: { select: { name: stage } },
      At: { date: { start: new Date().toISOString() } },
      Source: { select: { name: 'Telegram' } },
      ...(props['Job URL']?.url ? { 'Job URL': { url: props['Job URL'].url } } : {}),
    },
  });
  if (!created.ok) throw new Error(`Notion event not saved: ${created.status}`);
  return text(props.Job) || 'Application';
}

async function queryApplications(env, filter, sorts) {
  const response = await fetch(`https://api.notion.com/v1/databases/${env.NOTION_APPLICATIONS_DB}/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.NOTION_TOKEN}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json',
    },
    body: JSON.stringify({ page_size: 30, filter, sorts }),
  });
  if (!response.ok) throw new Error(`Notion query failed: ${response.status}`);
  return (await response.json()).results;
}

// With the data on the desktop's Mac (desktop/lib/store/telegram-store.js) env.store answers instead of Notion: saved(), applied(),
// runs(), recordOutcome(id, stage), insightFeedback(id, feedback). The Cloudflare worker is Notion only (spec D5).
async function saved(env) {
  if (env.store) return formatSavedItems(await env.store.saved(), '');
  const results = await queryApplications(env, { property: 'Stage', select: { equals: 'Saved' } },
    [{ timestamp: 'created_time', direction: 'descending' }]);
  return formatSaved(results, `https://www.notion.so/${env.NOTION_APPLICATIONS_DB}`);
}

async function applied(env) {
  if (env.store) {
    const items = await env.store.applied(), keyboard = appliedKeyboard(items);
    const text = formatAppliedItems(items, '');
    return keyboard ? { text: `${text}\n\n<b>Next step</b>\nTap a number when you hear back.`, keyboard } : text;
  }
  const response = await fetch(`https://api.notion.com/v1/databases/${env.NOTION_APPLICATIONS_DB}/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.NOTION_TOKEN}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      page_size: 30,
      // Real applications only: not starred, auto-kitted, dismissed or closed-posting rows.
      filter: { and: ['Saved', 'Kit ready', 'Dismissed', 'Closed'].map(stage => (
        { property: 'Stage', select: { does_not_equal: stage } })) },
      sorts: [{ property: 'Applied on', direction: 'descending' }],
    }),
  });
  if (!response.ok) throw new Error(`Notion query failed: ${response.status}`);
  const { results } = await response.json();
  const text = formatApplied(results, `https://www.notion.so/${env.NOTION_APPLICATIONS_DB}`);
  const keyboard = appliedKeyboard(results);
  return keyboard ? { text: `${text}\n\n<b>Next step</b>\nTap a number when you hear back.`, keyboard } : text;
}

export async function handleCommand(env, command) {
  switch (command?.name) {
    case 'start':
    case 'help':
      return HELP;
    case 'check':
    case 'run':
      await dispatch(env, { mode: 'run' });
      return '🔄 Crawling now. The digest arrives in about 3 minutes.';
    case 'today':
      await dispatch(env, { mode: 'today' });
      return '📋 Sending the current list in about a minute.';
    case 'applied':
      return applied(env);
    case 'saved':
      return saved(env);
    case 'apply':
      if (!/^[0-9a-f]{8}$/.test(command.arg)) return 'Tap the /apply_… code shown under a job in the digest.';
      await dispatch(env, { mode: 'apply', job: command.arg });
      return '⏳ Marking it applied in Notion…';
    case 'insight':
      await dispatch(env, { mode: 'insight' });
      return '💡 Looking at the market and your applications; the insight arrives in about a minute.';
    case 'weekly':
      await dispatch(env, { mode: 'weekly' });
      return '📊 Writing the weekly report; it arrives in about a minute.';
    case 'mail':
      await dispatch(env, { delay: '0' }, 'mail.yml');
      return '📧 Checking Gmail and Calendar; news arrives in about a minute (nothing if there is none).';
    case 'employers':
    case 'scout':
      await dispatch(env, { batch: '15' }, 'scout.yml');
      return '🔎 Scouting 15 companies for new job feeds; the summary arrives in about a minute.';
    case 'status': {
      // Notion ⏱️ Search runs is the one history, the same from the app, this bot and Notion.
      if (env.store) return formatRunItems(await env.store.runs(6));
      if (env.NOTION_TOKEN && env.NOTION_CRON_RUNS_DB) {
        const response = await notion(env, `databases/${env.NOTION_CRON_RUNS_DB}/query`, 'POST',
          { sorts: [{ property: 'Started', direction: 'descending' }], page_size: 6 });
        if (response.ok) return formatNotionRuns((await response.json()).results || []);
      }
      if (env.status) return env.status(); // desktop app without Notion runs: its own recent searches
      const response = await github(env, `actions/workflows/${env.WORKFLOW_FILE}/runs?per_page=5`);
      if (!response.ok) throw new Error(`GitHub runs failed: ${response.status}`);
      return formatRuns((await response.json()).workflow_runs);
    }
    default:
      return `I don't know that command.\n\n${HELP}`;
  }
}

// Digest buttons arrive as callback_query: "apply:<code>" (✅ n) or "more:<seed>:<page>" (➕ Next).
// Digest buttons (callback_query data):
//   pick:<code>:<n>        number n tapped -> show an action row for that job on the same message
//   act:<a|s|d>:<code>:<n> Applied / Save / Dismiss -> dispatch an apply run, mark the number button
//   act:p:<code>:<n>       Prepare -> dispatch a prepare run (application kit), mark the number button
//   close                  hide the action row
//   more:<seed>:<page>     next page;  apply:<code>  legacy ✅ button from older digests
const ACTIONS = { a: ['applied', '✅', 'Marking it applied{where}…'],   // {where}: " in Notion" only when Notion holds the data (env.store unset)
                  s: ['saved', '⭐', 'Saved — it stays in digests with a star.'],
                  d: ['dismissed', '❌', "Dismissed — it won't show again."],
                  p: [null, '📝', 'Drafting the application kit; it arrives in about a minute.'] };

const isActionRow = (row) => row.some((b) => /^(act:|close)/.test(b.callback_data || ''));

export function withActionRow(markup, code, n) {
  const rows = (markup?.inline_keyboard || []).filter((row) => !isActionRow(row));
  const actionRow = [
    { text: `${n}: ✅ Applied`, callback_data: `act:a:${code}:${n}` },
    { text: '⭐ Save', callback_data: `act:s:${code}:${n}` },
    { text: '❌ Dismiss', callback_data: `act:d:${code}:${n}` },
    { text: '✖', callback_data: 'close' },
  ];
  const prepareRow = [{ text: `${n}: 📝 Prepare application kit`, callback_data: `act:p:${code}:${n}` }];
  return { inline_keyboard: [actionRow, prepareRow, ...rows] };
}

export function afterAction(markup, n, emoji) {
  const rows = (markup?.inline_keyboard || []).filter((row) => !isActionRow(row));
  return { inline_keyboard: rows.map((row) => row.map((b) => (
    new RegExp(`^pick:[0-9a-f]{8}:${n}$`).test(b.callback_data || '') ? { ...b, text: `${emoji} ${n}` } : b))) };
}

async function editButtons(env, query, markup) {
  await telegram(env, 'editMessageReplyMarkup', {
    chat_id: query.message.chat.id, message_id: query.message.message_id, reply_markup: markup,
  });
}

async function handleButton(env, query) {
  if (String(query.message?.chat?.id) !== String(env.OWNER_CHAT_ID)) return;
  const data = query.data || '';
  const pick = /^pick:([0-9a-f]{8}):(\d{1,3})$/.exec(data);
  const act = /^act:([asdp]):([0-9a-f]{8}):(\d{1,3})$/.exec(data);
  const apply = /^apply:([0-9a-f]{8})$/.exec(data);
  const more = /^more:(\d{1,10}):(\d{1,3})$/.exec(data);
  const opick = /^opick:(\d{1,3}):([0-9a-f]{32})$/.exec(data);
  const out = /^out:([csivornw]):([0-9a-f]{32}):(\d{1,3})$/.exec(data);
  const ins = /^ins:([una]):([0-9a-f]{32})$/.exec(data);
  const answer = (text, alert = false) => telegram(env, 'answerCallbackQuery',
    { callback_query_id: query.id, text: text.slice(0, 200), show_alert: alert });
  try {
    if (pick) {
      await editButtons(env, query, withActionRow(query.message.reply_markup, pick[1], pick[2]));
      await answer(`Job ${pick[2]}: applied, save or dismiss?`);
    } else if (act) {
      const [action, emoji, text] = ACTIONS[act[1]];
      await dispatch(env, action ? { mode: 'apply', job: act[2], action } : { mode: 'prepare', job: act[2] });
      await editButtons(env, query, afterAction(query.message.reply_markup, act[3], emoji));
      await answer(text.replace('{where}', env.store ? '' : ' in Notion'));
    } else if (data === 'close') {
      await editButtons(env, query, afterAction(query.message.reply_markup, '-', ''));
      await answer('OK');
    } else if (apply) {
      await dispatch(env, { mode: 'apply', job: apply[1], action: 'applied' });
      await answer(`Marking it applied${env.store ? '' : ' in Notion'}…`);
    } else if (opick) {
      await editButtons(env, query, withOutcomeRows(query.message.reply_markup, opick[1], opick[2]));
      await answer(`Application ${opick[1]}: what happened?`);
    } else if (out) {
      const stage = OUTCOMES[out[1]];
      const title = env.store ? await env.store.recordOutcome(out[2], stage) : await recordOutcome(env, out[2], stage);
      await editButtons(env, query, afterOutcome(query.message.reply_markup, out[3], STAGE_EMOJI[stage] || '•'));
      await answer(`${title}: ${stage}. Saved${env.store ? '' : ' in Notion'}.`);
    } else if (ins) {
      const [feedback, label] = INSIGHT_FEEDBACK[ins[1]];
      if (env.store) await env.store.insightFeedback(ins[2], feedback);
      else {
        const patched = await notion(env, `pages/${ins[2]}`, 'PATCH', { properties: { Feedback: { select: { name: feedback } } } });
        if (!patched.ok) throw new Error(`Notion feedback not saved: ${patched.status}`);
      }
      await editButtons(env, query, { inline_keyboard: [[{ text: label, callback_data: 'noop' }]] });
      await answer('Thanks — future insights take this into account.');
    } else if (data === 'noop') {
      await answer('Already recorded.');
    } else if (data === 'oclose') {
      await editButtons(env, query, afterOutcome(query.message.reply_markup, '-', ''));
      await answer('OK');
    } else if (more) {
      await dispatch(env, { mode: 'more', seed: more[1], page: more[2] });
      await answer('Loading the next jobs (about a minute)…');
    } else {
      throw new Error('Unknown button');
    }
  } catch (error) {
    await answer(`⚠️ ${error.message}`, true);
  }
}

// Interview input: a recording (voice note, audio or video file), a transcript file (with a caption naming
// the interview), or /interview + notes. All start an interview run; recordings are transcribed there with
// speakers. Telegram lets bots fetch files up to 20 MB (getFile): about 2 hours of voice note.
const TRANSCRIPT_TYPES = /\.(txt|md|srt|vtt|text)$/i;
const RECORDING_TYPES = /\.(webm|m4a|mp3|wav|ogg|oga|opus|mp4|mov|aac|flac|aiff|mkv)$/i;
const MAX_FILE = 20 * 1024 * 1024;

export function interviewFile(message) {
  const media = message.voice || message.audio || message.video || message.video_note;
  if (media) return {...media, file_name: media.file_name || (message.voice ? 'voice note' : message.video_note ? 'video note' : 'recording'), recording: true};
  const doc = message.document;
  if (!doc) return null;
  return {...doc, recording: RECORDING_TYPES.test(doc.file_name || ''), transcript: TRANSCRIPT_TYPES.test(doc.file_name || '')};
}

export async function handleInterview(env, message) {
  const file = interviewFile(message);
  if (file) {
    if (!file.recording && !file.transcript) {
      return `⚠️ ${escapeHtml(file.file_name || 'That file')} isn't a recording or a text transcript. Send audio/video, or .txt, .md, .srt, .vtt.`;
    }
    if ((file.file_size || 0) > MAX_FILE) {
      return '⚠️ That file is over 20 MB, the most Telegram lets a bot download. Send it as a voice note (smaller), or use the Interviews page of the Jobadabra app.';
    }
    await dispatch(env, { mode: 'interview', file: file.file_id, note: (message.caption || '').slice(0, 500) });
    return file.recording
      ? `🎤 Got the ${escapeHtml(file.file_name)}. Transcribing it with speakers, then analysing; the summary arrives in a few minutes.`
      : `🎤 Got <b>${escapeHtml(file.file_name)}</b>. Analysing the interview; the summary arrives in 1–2 minutes.`;
  }
  const text = message.text || '';
  if (!text.includes('\n')) {
    return '🎤 Send the recording (a voice note works) or the transcript file with a caption like "Grafana, round 1", or write /interview Grafana round 1 and your notes on the next lines (one message).';
  }
  await dispatch(env, { mode: 'interview', note: text.slice(0, 4096) });
  return '🎤 Analysing your notes; the summary arrives in about a minute.';
}

// /add <job URL> [date]: track an application made outside Jobadabra; the rest of the line is its date.
// /add <a recruiter's message> (or a message forwarded to the bot): a recruiter lead, read by Claude (add mode, no job).
const LEAD_MIN = 40;
export async function handleAdd(env, text) {
  const body = (text || '').replace(/^\/add(@\w+)?/i, '').trim();
  const match = /^(https?:\/\/\S+)\s*(.*)$/s.exec(body);
  if (match && match[2].trim().length <= LEAD_MIN) {
    await dispatch(env, { mode: 'add', job: match[1], note: match[2].trim().slice(0, 100) });
    return '📥 Adding it to your applications; the confirmation arrives in about a minute.';
  }
  if (body.length < LEAD_MIN) {
    return '📥 Send /add followed by the job URL, and optionally when you applied: /add https://… on or before 23 Sep\n'
      + '🤝 Or /add followed by a recruiter\'s whole message (or forward it to me) to track it as a recruiter lead.';
  }
  return handleLead(env, body);
}

export async function handleLead(env, text) {
  await dispatch(env, { mode: 'add', note: text.slice(0, 6000) });
  return '📥 Reading it; the job it\'s about is updated (or added) in Notion in about a minute.';
}

// A screenshot (a photo, or an image sent as a file): LinkedIn, Gmail, WhatsApp… -> the job it's about.
const IMAGE_TYPES = /\.(png|jpe?g|webp|gif)$/i;
export function screenshot(message) {
  if (message.photo?.length) return message.photo[message.photo.length - 1];  // the largest size
  const doc = message.document;
  return doc && (/^image\//.test(doc.mime_type || '') || IMAGE_TYPES.test(doc.file_name || '')) ? doc : null;
}
export async function handleScreenshot(env, message) {
  const image = screenshot(message);
  if ((image.file_size || 0) > MAX_FILE) return '⚠️ That image is over 20 MB. Send a smaller screenshot.';
  await dispatch(env, { mode: 'add', file: image.file_id, note: (message.caption || '').slice(0, 2000) });
  return '📥 Reading the screenshot; the job it\'s about is updated (or added) in Notion in about a minute.';
}

// A message forwarded from someone else (a recruiter), long enough to be a pitch.
const forwarded = (message) => !!(message.forward_origin || message.forward_from || message.forward_sender_name)
  && (message.text || message.caption || '').trim().length >= LEAD_MIN;

export async function handleUpdate(env, update) {
  if (update.callback_query) return handleButton(env, update.callback_query);
  const message = update.message;
  // Only the owner's private chat may control the bot; ignore everyone else silently.
  if (!message || String(message.chat?.id) !== String(env.OWNER_CHAT_ID)) return;
  try {
    if (screenshot(message)) {
      await reply(env, await handleScreenshot(env, message));
      return;
    }
    if (forwarded(message)) {
      const origin = message.forward_origin?.sender_user_name || message.forward_sender_name
        || [message.forward_from?.first_name, message.forward_from?.last_name].filter(Boolean).join(' ');
      await reply(env, await handleLead(env, `${origin ? `From: ${origin}\n\n` : ''}${message.text || message.caption}`));
      return;
    }
    if (parseCommand(message.text)?.name === 'add') {
      await reply(env, await handleAdd(env, message.text));
      return;
    }
    if (interviewFile(message) || parseCommand(message.text)?.name === 'interview') {
      await reply(env, await handleInterview(env, message));
      return;
    }
    await reply(env, await handleCommand(env, parseCommand(message.text)));
  } catch (error) {
    await reply(env, `⚠️ ${escapeHtml(error.message)}`);
  }
}

// A refused scheduled start, on GitHub where the owner looks: a comment on the watchdog's open issue, or that issue opened (src/watchdog.js). Best effort: the
// GitHub-side watchdog notices the missing run anyway, even when the token is what failed.
async function reportStart(env, text) {
  const open = await github(env, `issues?labels=${WATCHDOG_LABEL}&state=open&per_page=1`);
  const [issue] = open.ok ? await open.json() : [];
  const body = `${text}\n\n<sub>Reported by the Worker (app-core/src/scheduler.js).</sub>`;
  if (issue) await github(env, `issues/${issue.number}/comments`, {method: 'POST', body: JSON.stringify({body})});
  else await github(env, 'issues', {method: 'POST', body: JSON.stringify({title: WATCHDOG_TITLE, body, labels: [WATCHDOG_LABEL]})});
}

export default {
  // Cloudflare cron triggers (wrangler.toml): the pipeline's schedules start on time, with GitHub's own cron as the backup (src/scheduler.js).
  async scheduled(event, env, ctx) {
    // Awaited, not waitUntil: a start that failed then fails the cron itself, where Cloudflare's cron history shows it (scheduler.js).
    await runScheduled(event, env, {dispatch, notify: text => reply(env, escapeHtml(text)).catch(() => {}), report: text => reportStart(env, text)});
  },
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/extension/')) return handleExtension(request, env);
    if (url.pathname === '/report/fill-failure') return handleReport(request, env, dispatch);
    if (request.method !== 'POST' || url.pathname !== '/telegram') return new Response('Not found', { status: 404 });
    if (request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.WEBHOOK_SECRET) {
      return new Response('Forbidden', { status: 403 });
    }
    const update = await request.json();
    // Answer Telegram immediately so it doesn't retry; finish the work in the background.
    ctx.waitUntil(handleUpdate(env, update));
    return new Response('ok');
  },
};
