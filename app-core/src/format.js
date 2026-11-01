// Telegram message text for the worker: HTML escaping and the run / applications / saved-jobs listings.
// Pure functions of Notion/GitHub rows, no I/O. Re-exported by index.js. Guarded by app-core/test/index.test.js and status.test.js.

export const STAGE_EMOJI = {
  Saved: '⭐', Applied: '📨', 'Confirmation received': '📬', Screening: '📞',
  'Interview scheduled': '🗓', Interviewing: '🎤', Offer: '🎉', Rejected: '❌',
  Withdrawn: '↩️', 'No response': '💤', 'Recruiter lead': '🤝',
};

export function escapeHtml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function formatRuns(runs) {
  if (!runs.length) return 'No workflow runs yet.';
  const icon = (run) => run.status !== 'completed' ? '⏳' : run.conclusion === 'success' ? '✅' : '❌';
  const lines = runs.map((run) => {
    const when = run.created_at.replace('T', ' ').slice(0, 16);
    return `${icon(run)} <a href="${escapeHtml(run.html_url)}">${escapeHtml(run.display_title)}</a> · ${when} UTC`;
  });
  return [`🛠 <b>Recent runs</b>\n${lines.length} latest`, lines.join('\n\n')].join('\n\n');
}

// The bot's lists read plain items, whichever store holds the data: a Notion row becomes one here (appItem, runItem); the desktop's
// store on this Mac hands the same items (desktop/lib/store/telegram-store.js). `link`: a page to open, or '' (no page on this Mac).
const plainText = (prop) => (prop?.rich_text || prop?.title || []).map((t) => t.plain_text).join('');
export function appItem(page) {
  const p = page.properties || {};
  return { id: page.id, title: plainText(p.Job), company: plainText(p.Company), stage: p.Stage?.select?.name || '',
    applied_on: p['Applied on']?.date?.start || '', next_interview: p['Next interview']?.date?.start || '', url: p['Job URL']?.url || '' };
}
export function runItem(page) {
  const p = page.properties || {};
  return { link: page.url || '', mode: p.Mode?.select?.name || '', status: p.Status?.select?.name || '', started: p.Started?.date?.start || '',
    where: p['Run URL']?.url ? 'github' : /^Mac/.test(p.Trigger?.select?.name || '') ? 'mac' : '', summary: plainText(p.Summary) };
}
const linked = (link, html) => (link ? `<a href="${escapeHtml(link)}">${html}</a>` : html);

// /status: the latest runs (⏱️ Search runs, or the store's), wherever they ran (the Mac, GitHub, a button here), with the one running.
export function formatRunItems(runs) {
  if (!runs.length) return 'No runs yet.';
  const ICON = { Running: '⏳', Failed: '❌', Warnings: '⚠️' };
  const lines = runs.map((run) => {
    const when = (run.started || '').replace('T', ' ').slice(0, 16);
    const where = run.where === 'github' ? ' · GitHub' : run.where === 'mac' ? ' · Mac' : '';
    const summary = (run.summary || '').replace(/;?\s*\(?AI cost \$[\d.]+\)?\.?$/, '');
    return `${ICON[run.status] || '✅'} ${linked(run.link, escapeHtml(run.mode || 'run'))} · ${when} UTC${where}`
      + (summary ? `\n${escapeHtml(summary.slice(0, 160))}` : '');
  });
  return [`🛠 <b>Recent runs</b>\n${lines.length} latest`, lines.join('\n\n')].join('\n\n');
}
export const formatNotionRuns = (pages) => formatRunItems(pages.map(runItem));

// `databaseUrl`: the Applications database in Notion, or '' with the data on this Mac.
export function formatAppliedItems(items, databaseUrl) {
  if (!items.length) return `No applications yet. Tap /apply_&lt;code&gt; under a job${databaseUrl ? `, or add one in <a href="${databaseUrl}">Notion</a>` : ', or add one in the Jobadabra app'}.`;
  const lines = items.map((item, index) => {
    const stage = item.stage || 'No stage';
    const title = `<b>${escapeHtml(item.title || 'Untitled')}</b>`;
    const interview = item.next_interview ? `\nInterview: ${item.next_interview.slice(0, 16).replace('T', ' · ')}` : '';
    return `${index + 1}. ${linked(item.url, title)}\n`
      + `${escapeHtml(item.company)} · ${STAGE_EMOJI[stage] || ''} ${escapeHtml(stage)}\n`
      + `Applied: ${item.applied_on || 'date not set'}${interview}`;
  });
  return [`📋 <b>Applications</b>\n${items.length} tracked${databaseUrl ? ` · <a href="${databaseUrl}">Open in Notion</a>` : ''}`, lines.join('\n\n')].join('\n\n');
}
export const formatApplied = (pages, databaseUrl) => formatAppliedItems(pages.map(appItem), databaseUrl);

export function formatSavedItems(items, databaseUrl) {
  if (!items.length) return 'No saved jobs. Tap a job number in a digest, then ⭐ Save.';
  const lines = items.map((item, i) => `${i + 1}. ${linked(item.url, `<b>${escapeHtml(item.title || 'Untitled')}</b>`)}\n${escapeHtml(item.company)}`);
  return [`⭐ <b>Saved jobs</b>\n${items.length} saved${databaseUrl ? ` · <a href="${databaseUrl}">Open in Notion</a>` : ''}`, lines.join('\n\n')].join('\n\n');
}
export const formatSaved = (pages, databaseUrl) => formatSavedItems(pages.map(appItem), databaseUrl);
