// The component gallery: every token and component, built with the same code the screens use.
import {fillIcons, icon} from './icons.js';
import {chipRow, kindsTable} from './gallery-kinds.js';
import {cardSystem, pageBlocks, roomyCards} from './gallery-cards.js';
import {cardHead, choiceCards, el, moreButton, notionBenefits, notionGate, numberStrip, pill, tag, tile, TONES} from './components.js';
import {aiWriting} from './ai-writing.js';

const root = document.getElementById('gallery');
const section = (title, note, ...children) => {
  const box = el('section', 'g-section');
  box.append(el('h2', '', title), ...(note ? [el('p', 'muted small', note)] : []), ...children);
  root.append(box);
};
const row = (...children) => { const line = el('div', 'g-row'); line.append(...children); return line; };
const token = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// Colours: each token's swatch, name and value (read from tokens.css, so this can't go stale).
const COLOURS = ['bg', 'surface', 'surface-2', 'ink', 'ink-2', 'muted', 'line', 'line-strong', 'navy', 'navy-active', 'on-navy-2',
  'signal', 'signal-solid', 'signal-ink', 'signal-soft', 'field', 'field-line', 'teal', 'teal-soft', 'amber', 'good', 'good-soft', 'warn', 'warn-soft',
  'bad', 'bad-soft', 'info', 'info-soft', 'violet', 'violet-soft'];
section('Colours', 'tokens.css → var(--name)', row(...COLOURS.map(name => {
  const swatch = el('div', 'g-swatch');
  const chip = el('span', 'g-chip');
  chip.style.setProperty('--c', `var(--${name})`);
  swatch.append(chip, el('b', '', `--${name}`), el('code', '', token(`--${name}`)));
  return swatch;
})));

section('Type', 'var(--fs-…)', ...['display', '2xl', 'xl', 'lg', 'base', 'md', 'sm', 'xs'].map(step => {
  const line = el('div', 'g-type', `--fs-${step} · ${token(`--fs-${step}`)} · Your next job, found for you`);
  line.style.setProperty('--size', `var(--fs-${step})`);
  return line;
}));

section('Corners and shadows', 'var(--r-…), var(--shadow-…)', row(...['r-sm', 'r-md', 'r-lg', 'r-pill'].map(name => {
  const box = el('div', 'g-box', `--${name}`);
  box.style.setProperty('--radius', `var(--${name})`);
  return box;
}), ...['shadow-sm', 'shadow-md', 'shadow-lg', 'shadow-xl'].map(name => {
  const box = el('div', 'g-box g-shadow', `--${name}`);
  box.style.setProperty('--shadow', `var(--${name})`);
  return box;
})));

const button = (label, className, extra = {}) => Object.assign(el('button', className, label), extra);
const withIcon = (glyph, label, className) => { const b = el('button', `${className} with-icon`); b.append(icon(glyph), el('span', '', label)); return b; };
section('Buttons', 'button.primary / .secondary / .ghost / .link / .danger; .with-icon', row(
  button('Prepare', 'primary'), button('Save', 'secondary'), button('Close', 'ghost'), button('Open posting', 'link'),
  button('Delete', 'ghost danger'), withIcon('refresh', 'Find jobs', 'secondary'), withIcon('mic', 'Record interview', 'primary'),
  button('Disabled', 'primary', {disabled: true}), moreButton([{label: 'Open in Notion', run: () => {}}, '-', {label: 'Delete', danger: true, run: () => {}}]),
));

section('Pills', "pill(text, tone, {dot}) — tones: " + TONES.join(', '),
  row(...TONES.map(tone => pill(tone[0].toUpperCase() + tone.slice(1), tone))),
  row(...TONES.map(tone => pill(tone === 'good' ? 'Ready' : tone === 'signal' ? 'Transcribing' : tone === 'bad' ? 'Failed' : tone, tone, {dot: true}))));

section('Tags', 'tag(text, {title, onClick, busy})', row(
  tag('Kubernetes'), tag('Observability'), tag('+3', {title: 'AWS, Go, Linux'}), tag('📝 Kit', {onClick: () => {}}),
  tag('📄 Tailored CV', {onClick: () => {}}), tag('✂️ Tailoring CV…', {busy: true})));

section('Chips', 'chip(text, {detail, tone, onRemove}): a value from a list, written as a person writes it (no quotes, codes or regex). A pill is a status, a tag a label', chipRow());
section('Value → control', 'The kind of value picks the control (docs/rules/desktop-ui.md). Edit views are answerControl(formatFor(...)) from question-control.js', kindsTable());
section('Card shell', 'Read summary → quiet Edit (cardEdit) → editor in place (card-shell.js); one page save bar for every tab (save-bar.js). Filled orange only for Save', cardSystem());
section('Roomy cards', 'roomy-cards.css + card-shell.js cardHead, readRows icons; page-parts.js summaryTiles divided (mockup 03): icon tile headers, every label on its own line over its value, chip text aligned with plain text, dividers full width. Strategy and Profile cards', roomyCards());
section('Page blocks', 'page-parts.js: reviewList (pending first, done folded), emptyState (Not created + two actions), summaryTiles (icon, label, big value), referenceRow (From Your details + one link); shared-counts.js: one count for banner, chip and badge', pageBlocks());

section('AI writing', 'aiWriting(box, {title, note}) from ai-writing.js: a strip with a live m:ss above a box the AI rewrites, its kept text faded under a slow sweep, skeleton lines when it is empty; returns stop(). The base letter and a job\'s letter', (() => {
  const box = el('div', 'card');
  box.style.display = 'grid';
  box.style.gap = 'var(--sp-3)';
  const kept = Object.assign(el('textarea'), {rows: 4, readOnly: true, value: 'Dear hiring team,\n\nFour years of running dispatch in Lyon taught me that a plan is only as good as the morning it meets.'});
  const empty = Object.assign(el('textarea'), {rows: 4, readOnly: true});
  box.append(kept, empty);
  aiWriting(kept, {title: 'Writing a new draft', note: 'Your current letter stays until the new one is ready.'});
  aiWriting(empty, {title: 'Writing your first draft', note: 'From your CV, Profile and writing preferences.'});
  return box;
})());
section('Lit panel', '.is-lit (also .card.is-lit, .panel.is-lit): dot grid, amber glow from the top-left, thin amber edge. The one thing on a page that says "start here"', (() => {
  const box = document.createElement('div');
  box.className = 'card is-lit';
  box.style.padding = 'var(--sp-5)';
  box.innerHTML = '<h3>Up next</h3><p class="muted">Lit like the website\'s departures hall. Used by the sidebar, Focus → Up next and Settings → Appearance.</p>';
  return box;
})());
section('Result card head and figures', 'cardHead(category, title, {badges, subtitles}) and numberStrip(cells, {valueFirst}) inside .insight-card: every result card in Recent activity and Form fills', (() => {
  const box = el('div', 'insight-card');
  box.append(cardHead('Salary', 'The advertised ceiling sits under your floor', {badges: [pill('High confidence', 'good')], subtitles: ['12 postings in your search said a salary']}),
    numberStrip([{label: 'Jobs', value: '12'}, {label: 'Median', value: 'CHF 120k'}]),
    numberStrip([{label: 'employers checked', value: '48'}, {label: 'had a job for you', value: '9'}], {valueFirst: true}));
  return box;
})());
section('Tiles', 'tile(icon, tone)', row(tile('mic'), tile('file', 'teal'), tile('search', 'info'), tile('mail', 'info'), tile('check', 'good'), tile('shield', 'warn')));

section('Notion advantages', 'notionBenefits(count): why connect Notion (the connect dialog, Settings, Optional extras)', notionBenefits());   // about Notion
section('Locked page', 'notionGate({reasonText, onConnect}): a page that needs Notion, until it is connected', notionGate({reasonText: 'Connect Notion to see what to do next.'}));

section('Choice cards', 'choiceCards(choices, {selected, onPick}): one of a few options (Settings → Connections → AI, the setup wizard)',
  choiceCards([{id: 'api', icon: 'key', title: 'Anthropic API key', text: 'Uses your Anthropic API key.'},
    {id: 'cli', icon: 'terminal', title: 'Claude Code CLI', text: 'Uses your own Claude Code CLI and its Claude subscription.'}], {selected: 'cli'}));

section('Library table', '.lib-wrap > table.lib-table, name cell .lib-who (.logo + bold name + muted line): a list of records on its own page (Interviews, Employers). Inside a card use .data-table', (() => {
  const wrap = el('div', 'lib-wrap'), table = el('table', 'lib-table');
  const head = el('tr', ''); head.append(...['Name', 'Status', 'When'].map(text => el('th', '', text)));
  const row = el('tr', ''), who = el('div', 'lib-who'), lines = el('div', '');
  lines.append(el('b', '', 'Northwind Robotics'), el('div', 'muted small', 'Zürich · 200–500 people'));
  who.append(el('span', 'logo', 'NR'), lines);
  for (const cell of [who, pill('Feed found', 'good', {dot: true}), el('span', 'muted', '8 Oct')]) { const td = el('td', ''); td.append(cell); row.append(td); }
  const thead = el('thead', ''); thead.append(head); const tbody = el('tbody', ''); tbody.append(row);
  table.append(thead, tbody); wrap.append(table);
  return wrap;
})());

section('Data table', '.data-table: a few rows of figures to compare; .is-num right-aligns a number column', (() => {
  const box = el('div');
  box.innerHTML = `<table class="data-table"><tr><th>Family</th><th>Good-fit hits</th><th class="is-num">Rate</th></tr>
    <tr><td>SRE</td><td>7 of 19</td><td class="is-num">37%</td></tr><tr><td>Platform</td><td>12 of 43</td><td class="is-num">28%</td></tr></table>`;
  return box;
})());
section('Item rows', '.item-rows: one item per row (bold title, muted line) with its one action on the right (.item-action), a line between', (() => {
  const box = el('div');
  box.innerHTML = `<ul class="item-rows"><li><div class="item-words"><b><a class="link" href="#">Site Reliability Engineer</a></b><span class="muted">DeepJudge AG</span></div><button class="secondary item-action">View CV</button></li>
    <li><div class="item-words"><b><a class="link" href="#">Staff Platform Engineer</a></b><span class="muted">Nango</span></div><button class="secondary item-action">View CV</button></li></ul>`;
  return box;
})());
section('Dialog parts', '.panel-dialog with .dialog-head / .dialog-lead / .dialog-foot; .composer + .tool; .attachment + .soft-button; .select-search; .check-row; .choice-list; .segmented.is-fill', (() => {
  const box = el('div');
  box.innerHTML = `<div class="composer"><textarea rows="2" placeholder="Paste a message here…"></textarea>
    <div class="composer-tools"><button class="tool"><i data-icon="paperclip"></i>Add screenshot</button>
    <button class="tool"><i data-icon="image"></i>Paste image</button></div></div>
    <div class="attachment"><img src="logo.png" alt=""><span class="attachment-name">screenshot.png</span><button class="soft-button">Remove</button></div>
    <div class="select-search" style="margin-top: var(--sp-3)"><i data-icon="search"></i><select><option>Find the right job automatically</option></select></div>
    <div class="choice-list"><label><input type="radio" name="g-choice" checked><span><b>A new job</b><span class="muted">Create a job from this email.</span></span></label><label><input type="radio" name="g-choice"><span><b>Not about a job</b><span class="muted">Keep this email out of your applications.</span></span></label></div>
    <label class="check-row" style="margin-top: var(--sp-3)"><input type="checkbox"><span><span>I agreed to speak with the recruiter</span>
    <span class="muted small">Move the job to Screening</span></span></label>
    <div class="segmented is-fill" style="margin-top: var(--sp-3)"><button class="is-active">LinkedIn</button><button>Email</button>
    <button>Phone / call</button><button>Other</button></div>`;
  fillIcons(box);
  return box;
})());

section('Toggle chips', '.chip-row of .chip-button[aria-pressed] with a .chip-count (Jobs → saved views)', (() => {
  const box = el('div', 'chip-row');
  box.innerHTML = `<button class="chip-button" aria-pressed="true"><span>Active</span><span class="chip-count">4</span></button>
    <button class="chip-button" aria-pressed="false"><span>Rejected</span><span class="chip-count">12</span></button>
    <button class="chip-button" aria-pressed="false"><span>This week</span><span class="chip-count">0</span></button>`;
  return box;
})());
section('Alerts', '.alert.tone-warn | tone-good | tone-info | tone-bad: icon, title, text, optional link (.alert-actions: a row of them)', row(...['warn', 'good', 'info', 'bad'].map(tone => {
  const box = el('div', `alert tone-${tone}`);
  box.innerHTML = tone === 'good'
    ? '<i data-icon="check-circle"></i><div><strong>Job created — Platform Engineer</strong><div class="alert-actions"><button class="link">Open job in Notion ↗</button><button class="link">Show in Jobs</button></div></div>'
    : `<i data-icon="info"></i><div><strong>${tone === 'warn' ? 'No job activity found' : 'Logged'}</strong><p>One line of detail.</p></div>`;
  fillIcons(box);
  return box;
})));

section('Settings parts', '.settings-nav (+ .nav-dot), .service-card with .service-state, .summary-card with .summary-rows and .arrow-link', (() => {
  const box = el('div');
  box.innerHTML = `<div class="settings-layout"><nav class="settings-nav"><button class="is-active"><i data-icon="columns"></i>Overview</button>
    <button><i data-icon="link"></i>Connections<span class="nav-dot"></span></button></nav>
    <div><div class="service-grid"><button class="service-card"><span class="ui-tile tone-good"></span><span><b>Notion</b>
      <span class="service-state is-on"><i data-icon="check"></i>Connected</span></span></button>
      <button class="service-card"><span><b>Telegram</b><span class="service-state"><i data-icon="info"></i>Not connected</span></span></button></div>
    <div class="summary-grid card-grid"><article class="summary-card"><div class="summary-head"><i data-icon="clock"></i><h3>Automation</h3></div>
      <p class="muted">Your job search schedule.</p><dl class="summary-rows"><dt>Job search</dt><dd>Every 4 hours</dd></dl>
      <button class="arrow-link">Manage automation</button></article></div></div></div>`;
  fillIcons(box);
  return box;
})());
