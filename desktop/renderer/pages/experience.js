// Settings → Profile → Experience: the sources of what tailoring knows about the person (the main CV, other CV versions) and, per job,
// the facts they add. Data and AI match: lib/experience.js (IPC experienceGet / AddCv / Remove / Rematch). Guarded by test/experience-page.test.js.
import {plainError} from '../run-warnings.js';
import {el, pill, tile} from '../components.js';
import {icon} from '../icons.js';
import {$, message, runWhen} from './core.js';
import {loadExperienceProfile} from './experience-profile.js';
import {swr} from '../swr.js';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// One source row: its name and what it adds, then its action. The main CV is the reference and is replaced on the CV tab.
export function sourceRow(source) {
  const row = el('li');
  const words = el('div', 'item-words');
  const name = el('b', '', source.name);
  name.append(' ', source.reference ? pill('Reference', 'info') : source.stale ? pill('Needs matching', 'warn', {title: 'Your main CV changed since this version was compared with it'}) : pill(source.added ? `+${plural(source.added, 'detail')}` : 'Nothing new', source.added ? 'good' : 'neutral'));
  words.append(name);
  const meta = source.reference ? `${plural(source.roles, 'job role')}: tailored CVs keep its jobs, titles and dates` : `${plural(source.roles, 'job role')} · added ${runWhen(source.addedAt)}`;
  words.append(el('span', 'muted', meta));
  row.append(tile(source.reference ? 'file' : source.kind === 'linkedin' ? 'link' : 'layers', source.reference ? 'info' : 'signal'), words);
  return row;
}

// One job as a Work history row (mockup 09, owner 18 Oct 2026: a neutral initial tile, no logos, no skill chips): company and role, dates · place, and
// "+N details" when other CV versions add facts to it, which opens the bullets (each extra one names its version). It never looks like another job.
export function roleBlock(role) {
  const extras = role.bullets.filter(b => b.from !== 'Main CV').length;
  const box = el('details', 'exp-role exp-job');
  const head = el('summary');
  const who = el('div', 'job-who'), when = el('span', 'muted small job-when', [role.period, role.place].filter(Boolean).join(' · '));
  who.append(el('b', '', role.company || role.title), el('span', 'small', role.company ? role.title : ''));
  head.append(el('span', 'job-initial', String(role.company || role.title || '?').trim().charAt(0).toUpperCase()), who, when);
  if (extras) head.append(pill(`+${plural(extras, 'detail')}`, 'good', {title: `${plural(extras, 'detail')} from other CV versions: tailoring may use them for this job`}));
  head.append(icon('chevron', 'icon job-chevron'));
  const list = el('ul');
  for (const bullet of role.bullets) {
    const item = el('li', '', bullet.text.replace(/\*\*/g, ''));
    if (bullet.from !== 'Main CV') item.append(' ', pill(bullet.from, 'good'));
    list.append(item);
  }
  box.append(head, list);   // the "+N details" pill says where they come from (its title); each extra bullet names its version
  return box;
}

// The sources as one line, for the folded Experience sources card: "Main CV + LinkedIn + 2 other CV versions".
export function sourcesSummary(view) {
  if (!view?.main) return 'Main CV not read yet';
  const cvs = view.sources.filter(source => source.kind !== 'linkedin').length;
  return ['Main CV', ...(view.sources.some(source => source.kind === 'linkedin') ? ['LinkedIn'] : []), ...(cvs ? [`${cvs} other CV version${cvs === 1 ? '' : 's'}`] : [])].join(' + ');
}

// Roles another version has and the main CV does not: listed, never added (a tailored CV keeps the main CV's jobs). Stale matches are left out.
export function onlyHereBlock(sources) {
  const items = sources.filter(source => !source.stale).flatMap(source => source.onlyHere.map(role => ({...role, from: source.name})));
  if (!items.length) return null;
  const box = el('details', 'exp-role');
  const head = el('summary');
  head.append(el('b', '', 'Not in your main CV'), ' ', pill(String(items.length), 'warn', {title: 'Roles found in other versions only'}));
  const list = el('ul');
  for (const role of items) {
    const item = el('li', '', [role.title, role.company, role.period].filter(Boolean).join(' · '));
    item.append(' ', pill(role.from, 'neutral'));
    list.append(item);
  }
  box.append(head, el('p', 'muted small', 'Tailored CVs keep your main CV\'s jobs, so these are not used. If they belong on your CV, add them to it and replace it on the CV tab.'), list);
  return box;
}

// The other versions (CV files, LinkedIn) as one box that opens and closes: its rows keep Match again and Remove. It stays open unless the person closes it.
let versionsOpen = true;
export function versionsBlock(rows, count) {
  const box = el('details', 'exp-role');
  box.open = versionsOpen;
  box.addEventListener('toggle', () => { versionsOpen = box.open; });
  const head = el('summary');
  head.append(el('b', '', 'Other versions'), ' ', pill(String(count), 'neutral'));
  const list = el('ul', 'item-rows');
  list.append(...rows);
  box.append(head, list);
  return box;
}

// What an add, a removal or a match again did to the profile, in plain words. A removal only stops offering what came from that version:
// tailoring reads the other versions at use time (withExtras), so nothing was copied into the main CV and nothing is left behind.
export function changeLines(answer) {
  const c = answer.changes || {}, lines = [], list = items => items.slice(0, 8).join(', ') + (items.length > 8 ? `, +${items.length - 8} more` : '');
  const done = (answer.results || []).filter(r => r.ok).map(r => r.name), failed = (answer.results || []).filter(r => !r.ok);
  if (done.length) lines.push([`Added ${done.length === 1 ? `“${done[0]}”` : plural(done.length, 'version')}`, 'good']);
  for (const r of failed) lines.push([`Could not add “${r.name}”: ${plainError(r.error)}`, 'bad']);
  if (answer.removed) lines.push([`Removed “${answer.removed}”`, 'neutral']);
  if (c.details > 0) lines.push([`Tailoring has ${plural(c.details, 'more detail')} to choose from`, 'good']);
  if (c.details < 0) lines.push([`Tailoring has ${plural(-c.details, 'detail')} fewer to choose from`, 'neutral']);
  if (c.skillsAdded?.length) lines.push([`New technologies and skills: ${list(c.skillsAdded)}`, 'good']);
  if (c.skillsRemoved?.length) lines.push([`No longer offered: ${list(c.skillsRemoved)}`, 'neutral']);
  if (c.newRoles?.length) lines.push([`Jobs not in your main CV (listed, not used): ${list(c.newRoles)}`, 'warn']);
  if (c.goneRoles?.length) lines.push([`No longer listed as missing from your main CV: ${list(c.goneRoles)}`, 'neutral']);
  const changed = c.details || c.skillsAdded?.length || c.skillsRemoved?.length || c.newRoles?.length || c.goneRoles?.length;
  if (!changed && (done.length || answer.removed)) lines.push([done.length ? 'Nothing new: this says what your main CV already says' : 'Nothing was offered from it that other versions do not also say', 'neutral']);
  if (answer.removed) lines.push(['Your main CV and your profile are not changed: other versions are only read when a CV is tailored', 'neutral']);
  return lines;
}
export function showChanges(answer) {
  const lines = answer.ok === false && !answer.results ? [] : changeLines(answer);
  if (!lines.length) { $('exp-changes').replaceChildren(); return; }
  const box = el('details', 'exp-role');
  box.open = true;
  const head = el('summary');
  head.append(el('b', '', 'What changed in your profile'));
  const list = el('ul');
  for (const [text, tone] of lines) { const item = el('li', '', text); if (tone === 'bad') item.append(' ', pill('Not added', 'bad')); list.append(item); }
  box.append(head, list);
  $('exp-changes').replaceChildren(box);
}

export function showExperience(view) {
  const rows = view.sources.map(sourceRow);
  for (const [i, source] of view.sources.entries()) {
    const row = rows[i];
    if (source.stale) {
      const again = Object.assign(el('button', 'secondary item-action', 'Match again'), {type: 'button'});
      again.addEventListener('click', () => run(again, () => window.pilot.experienceRematch()));
      row.append(again);
    }
    const button = Object.assign(el('button', 'link item-action', 'Remove'), {type: 'button', title: 'Tailored CVs stop drawing on this version. Your main CV is not changed.'});
    button.addEventListener('click', async () => {
      button.disabled = true;
      const answer = await window.pilot.experienceRemove(source.id).catch(error => ({ok: false, error: error.message}));
      if (answer.ok) { showExperience(answer); showChanges(answer); } else message('exp-message', answer.error || 'Could not remove it.', 'error');
    });
    row.append(button);
  }
  $('exp-sources').replaceChildren(...(view.main ? [sourceRow({reference: true, name: 'Main CV', roles: view.main.roles})] : [el('li', 'muted', 'Read your main CV first (CV → Read my CV PDF).')]));
  const removeAdded = async id => {
    const answer = await window.pilot.experienceRemoveAdded(id).catch(error => ({ok: false, error: error.message}));
    if (answer.ok) showExperience(answer); else message('exp-message', answer.error || 'Could not remove it.', 'error');
  };
  $('exp-versions').replaceChildren(...(view.sources.length ? [versionsBlock(rows, view.sources.length)] : []), ...addedBlock(view.added, removeAdded));
  const extras = view.roles.reduce((n, r) => n + r.bullets.filter(b => b.from !== 'Main CV').length, 0);
  $('exp-count').textContent = view.roles.length ? `${plural(view.roles.length, 'role')}${extras ? ` · ${plural(extras, 'detail')} from other versions` : ''}` : '';
  $('setting-experience-sources').dataset.summary = sourcesSummary(view);   // the folded card's one line (profile-fold.js)
  const notInMain = onlyHereBlock(view.sources);
  $('exp-roles').replaceChildren(...(view.roles.length ? view.roles.map(roleBlock) : [el('p', 'muted', 'Nothing yet: your main CV is read the first time you tailor one, or on the CV tab.')]), ...(notInMain ? [notInMain] : []));
  $('exp-add').disabled = $('exp-add-linkedin').disabled = !view.main;
}

// "Added by you" (Insights PR 2, lib/experience-added.js): the skills, bullets and corrections the person added after an insight, each removable.
// The main CV is not changed by any of them. Hidden when there are none.
export function addedBlock(items, remove) {
  if (!items?.length) return [];
  const KIND = {skill: 'Skill', bullet: 'Detail', correction: 'Correction'};
  const list = el('ul', 'item-rows');
  for (const item of items) {
    const row = el('li'), words = el('div', 'item-words');
    const name = el('b', '', item.text);
    name.append(' ', pill(KIND[item.kind] || 'Added', 'info'));
    words.append(name, el('span', 'muted', 'Tailored CVs may use this. Your main CV is not changed.'));
    const button = Object.assign(el('button', 'secondary item-action', 'Remove'), {type: 'button'});
    button.addEventListener('click', () => { button.disabled = true; remove(item.id); });
    row.append(tile('user', 'signal'), words, button);
    list.append(row);
  }
  return [el('h4', '', 'Added by you'), list];
}

// The words for one live step from the app (experienceStep): which file of how many, and what it is doing now.
export function stepText({what, name, index, total}) {
  const of = total > 1 ? ` (${index} of ${total})` : '';
  if (what === 'reading') return `Reading “${name}”${of}…`;
  if (what === 'comparing') return `Comparing “${name}” with your main CV${of}…`;
  if (what === 'done') return `Finished “${name}”${of}`;
  return `Could not use “${name}”${of}`;
}

async function run(button, action) {
  button.classList.add('busy'); document.querySelectorAll('#setting-experience-sources button').forEach(b => { b.disabled = true; });
  $('exp-changes').replaceChildren();
  message('exp-message', 'Waiting for your file…', 'waiting');
  const answer = await action().catch(error => ({ok: false, error: error.message}));
  button.classList.remove('busy'); document.querySelectorAll('#setting-experience-sources button').forEach(b => { b.disabled = false; });
  if (answer.ok) { message('exp-message', 'Done ✓ Tailored CVs can use it from now on.', 'ok'); showExperience(answer); showChanges(answer); }
  else { message('exp-message', answer.cancelled ? '' : answer.error || 'That did not work.', answer.cancelled ? '' : 'error'); if (answer.results) showChanges(answer); }
}

// "Connect with LinkedIn": who you are on LinkedIn (name, email), not your experience (that comes from the export above). Never a token kept.
const OWN = [['first_name', 'givenName'], ['last_name', 'familyName'], ['email', 'email']];
export function showLinkedin(status) {
  const line = $('exp-linkedin-line');
  const button = (text, className, onClick, glyph) => {
    const node = Object.assign(el('button', className, glyph ? null : text), {type: 'button'});
    if (glyph) { node.className = `${className} with-icon`; node.append(icon(glyph), el('span', '', text)); }
    node.addEventListener('click', () => onClick(node));
    return node;
  };
  if (!status) {
    line.replaceChildren(button('Connect with LinkedIn', 'secondary', async node => {
      node.classList.add('busy'); node.disabled = true;
      message('exp-message', 'Waiting for LinkedIn… approve in your browser, then come back here.');
      const answer = await window.pilot.linkedinConnect().catch(error => ({ok: false, error: error.message}));
      node.classList.remove('busy'); node.disabled = false;
      if (answer.ok) { message('exp-message', 'Connected ✓', 'ok'); showLinkedin(answer); }
      else message('exp-message', answer.error || 'That did not work.', 'error');
    }, 'link'), el('span', 'muted small', 'Your name and email only: LinkedIn shares positions and skills only with registered companies, so add your data export for those.'));
    return;
  }
  line.replaceChildren(pill('LinkedIn connected', 'good'), el('span', '', ` ${status.name || ''}${status.email ? ` · ${status.email}` : ''}`),
    button('Use my name and email', 'secondary', async node => {
      node.disabled = true;
      const contact = await window.pilot.contact().catch(() => ({}));
      const filled = [];
      for (const [key, own] of OWN) if (status[own] && !String(contact?.[key] || '').trim()) {
        const saved = await window.pilot.saveContactField(key, status[own]).catch(() => ({ok: false}));
        if (saved?.ok) filled.push(key.replace('_', ' '));
      }
      node.disabled = false;
      message('exp-message', filled.length ? `Filled in your details: ${filled.join(', ')}. Check them under Your details.` : 'Your details already have them.', filled.length ? 'ok' : '');
    }),
    button('Disconnect', 'link', async node => { node.disabled = true; await window.pilot.linkedinDisconnect(); showLinkedin(null); }));
}

export async function loadExperience() {
  loadExperienceProfile();   // Professional summary and Strengths, from the Profile page
  showLinkedin(await window.pilot.linkedinStatus().catch(() => null));
  message('exp-message', '');
  await swr('experience', async () => ({ok: true, view: await window.pilot.experienceGet()}), {paint: answer => { if (answer.view) showExperience(answer.view); }});
}

export function initExperience() {
  window.pilot.onExperienceStep?.(step => message('exp-message', stepText(step), step.what === 'reading' || step.what === 'comparing' ? 'waiting' : step.what === 'failed' ? 'error' : 'ok'));
  $('exp-add-linkedin').addEventListener('click', () => run($('exp-add-linkedin'), () => window.pilot.experienceAddLinkedin()));
  $('exp-add').addEventListener('click', () => run($('exp-add'), () => window.pilot.experienceAddCv()));
}
