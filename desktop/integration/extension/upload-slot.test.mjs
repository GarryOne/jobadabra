/* global window, document, DataTransfer, File */
// The upload operator (extension/page/upload.js) on the SHAPES of upload slots, not on sites: a native input, a hidden input behind a styled
// label, a drop zone, a slot that creates its input when + is pressed (SuccessFactors / Coop), a page that swallows the input into a file
// chip. Also: which file goes to which slot comes from the wording's meaning (service phrases, then the floor), an unknown wording is left
// empty and reported, a recipe can name the trigger, and a missing CV is an open required row. A real Chrome, no network.
// JP_LIVE=1 also runs the real Coop form (a sample of the click-to-reveal shape).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {chromium} from 'playwright-core';

// The page scripts are the extension's own list (extension/page-files.js), never a copy: a copy went stale when required-mark.js was added (10 Oct 2026, 19 tests red on main).
import {PAGE_FILES} from '../../../extension/page-files.js';
const file = (name, label) => ({data: Buffer.from(`%PDF ${label}`).toString('base64'), name, type: 'application/pdf'});
const CV = {...file('cv.pdf', 'cv'), coverLetterFile: file('letter.pdf', 'letter')};
const CV_ONLY = file('cv.pdf', 'cv');

// Shared fixture script: pressing a + creates the one file input in a popup (like the real widget); each slot records what it received.
const REVEAL_JS = `<div id="popup" hidden>Select a source <button type="button">From device</button></div><script>
  window.got = {};
  function openPopup(id) {
    const popup = document.getElementById('popup'); popup.hidden = false; popup.querySelector('input')?.remove();
    const input = document.createElement('input'); input.type = 'file'; input.name = 'fileData' + id;
    input.addEventListener('change', () => { window.got[id] = input.files[0]?.name; document.getElementById(id).closest('.field').querySelector('.ok').hidden = false; });
    popup.appendChild(input);
  }
  document.addEventListener('keydown', e => { if (e.key === 'Escape') document.getElementById('popup').hidden = true; });
</script>`;
const REVEAL_SLOT = (id, title, decoy = '') => `<div class="field"><div class="lab">${title}</div><div class="attachWrapper"><div class="box">Add file</div>${decoy}
  <span role="button" tabindex="0" class="addAttachments real-plus" id="${id}" onclick="openPopup('${id}')">+</span><div class="ok" hidden>done</div></div></div>`;

// A choice among ways to give the CV (Deloitte's "Upload CV / Copy and paste CV / Upload later"): each button reveals its own part of the page, and the file
// input exists all along inside a hidden container. Pressing one hides the other (9 Oct 2026: the paste press hid the file input the upload press had shown).
const CHOICE = `<body><div class="how"><a role="button" class="uploadResumeTriggerFile" onclick="show('fileBox')">Upload CV</a><a role="button" class="uploadResumeTriggerPaste" onclick="show('pasteBox')">Copy and paste CV</a>
  <a role="button" class="uploadResumeTriggerLater" onclick="show('')">Upload later</a></div>
  <fieldset id="fileBox" style="display:none"><div class="fieldContainer"><input type="file" id="resumeFile" onchange="window.got = {resumeFile: this.files[0].name}"></div></fieldset>
  <fieldset id="pasteBox" style="display:none"><label>Copy and paste CV * <textarea id="resumePaste" required></textarea></label></fieldset>
  <script>function show(id) { for (const box of ['fileBox', 'pasteBox']) document.getElementById(box).style.display = box === id ? 'block' : 'none'; }</script></body>`;

const SHAPES = {
  choice: CHOICE,
  native: '<body><label>Resume/CV * <input type="file" id="r" onchange="window.got = {r: this.files[0].name}"></label><label>Email * <input id="e" type="email" required></label></body>',
  hiddenInput: '<body><div class="up"><label class="btn" for="f">Upload your CV *</label><input type="file" id="f" style="display:none" onchange="window.got = {f: this.files[0].name}"></div><input id="e" required></body>',
  dropzone: '<body><div class="dropzone"><p>Lebenslauf *</p><input type="file" id="d" style="opacity:0;position:absolute" onchange="window.got = {d: this.files[0].name}"></div><input id="e" required></body>',
  chip: '<body><div class="up"><label>CV *</label><input type="file" id="c" onchange="const n = this.files[0].name; this.insertAdjacentHTML(\'afterend\', `<span>${n}</span>`); this.remove(); window.got = {c: n}"></div><input id="e" required></body>',
  reveal: `<body>${REVEAL_SLOT('cvPlus', '* CV and diplomas/school transcripts')}${REVEAL_SLOT('docPlus', 'Cover letter, certificates, diplomas, etc.')}<input id="e" required>${REVEAL_JS}</body>`,
  revealFrench: `<body>${REVEAL_SLOT('cvPlus', '* CV et diplômes')}${REVEAL_SLOT('docPlus', 'Lettre de motivation, certificats')}<input id="e" required>${REVEAL_JS}</body>`,
  unknownWording: `<body>${REVEAL_SLOT('aPlus', '* Dossier principal')}${REVEAL_SLOT('bPlus', 'Pièces annexes')}<input id="e" required>${REVEAL_JS}</body>`,
  // The first pressable in the widget is an info icon that opens nothing; the real + is found only through a recipe's trigger.
  helpFirst: `<body>${REVEAL_SLOT('cvPlus', '* CV', '<span role="button" class="info" onclick="">i</span>')}<input id="e" required>${REVEAL_JS}</body>`,
};

// A drop-zone library's shape (12 Oct 2026, a Swiss board's application form): the page shows a pressable inside a container that names uploading TWO OR MORE levels above it
// (the pressable and its parent say nothing), and the real file input is made by script, hidden, as a direct child of <body> far from the field. Pressing the pressable would
// open the system's file dialog over the person's page, so the operator must use the input that is already there. Two pages, same shape, nothing else alike.
const DETACHED_JS = (where, hide) => `<script>(() => { const input = document.createElement('input'); input.type = 'file'; input.multiple = true; input.style.cssText = '${hide}';
  input.addEventListener('change', () => { window.got = {drop: input.files[0].name}; document.querySelector('.zone-note').textContent = input.files[0].name; });
  window.pressed = 0; document.querySelector('[data-press]').addEventListener('click', () => { window.pressed++; input.click(); });
  document.body.${where}(input); })();</script>`;
SHAPES.detachedDrop = `<body><form><label>Vorname *<input id="e" required></label><div class="col"><label class="form-label">Dokumente *</label>
  <div id="DocumentDropzoneId" class="dropzone dz-clickable"><div class="dz-default dz-message"><button class="dz-button" type="button" data-press>Datei(en) hier ablegen</button></div></div>
  <div class="small-info">Erlaubte Dateitypen: pdf, jpg</div><span class="zone-note"></span></div><label><input type="checkbox" required> Ich habe die Datenschutzerklärung gelesen</label></form>${DETACHED_JS('append', 'visibility:hidden;position:absolute;top:0;left:0;height:0;width:0')}</body>`;
SHAPES.detachedDropVariant = `<body>${'<p>Candidature</p>'}<div><input id="e" aria-label="Courriel" required></div><div class="block"><div class="ttl">Pièces jointes *</div>
  <section id="attachment-area"><div class="inner"><div class="hint"><div role="button" tabindex="0" class="pick" data-press>Déposer un fichier</div></div></div></section><i class="zone-note"></i></div>
  ${DETACHED_JS('prepend', 'display:none')}</body>`;

const open = async (html, run) => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({locale: 'en-US'});
    await page.setContent(html);
    for (const file of PAGE_FILES) await page.addScriptTag({content: fs.readFileSync(new URL(`../../../extension/${file}`, import.meta.url), 'utf8')});
    await run(page);
  } finally { await browser.close(); }
};
// Runs the real fill; -> what the panel and the report would see.
const fill = (page, resume, {aliases = [], recipes = {}, choice = null} = {}) => page.evaluate(async ({resume, aliases, recipes, choice}) => {
  window.__jobPilottoAliases = aliases; window.__jobPilottoRecipes = recipes; window.__jobPilottoUploadChoice = choice;
  const rowsBefore = window.__jobPilottoAuditVisibleFields().filter(row => row.type === 'file');
  const result = await window.__jobPilottoExtensionFill([], {}, resume);
  return {rowsBefore, rowsAfter: window.__jobPilottoAuditVisibleFields().filter(row => row.type === 'file'), got: window.got || {}, resumeAttached: result.resumeAttached,
    todo: result.todo, uploads: result.operated.filter(item => item.kind === 'upload'), unknown: result.unknownUploads};
}, {resume, aliases, recipes, choice});

for (const shape of ['native', 'hiddenInput', 'dropzone', 'chip']) {
  test(`${shape}: the CV goes into the one upload slot, which was a required unfilled row before and filled after`, async () => {
    await open(SHAPES[shape], async page => {
      const out = await fill(page, CV_ONLY);
      assert.equal(out.resumeAttached, true);
      assert.deepEqual(Object.values(out.got), ['cv.pdf']);
      assert.equal(out.rowsBefore.length, 1);
      assert.equal(out.rowsBefore[0].required, true, 'the page marks it required');
      assert.equal(out.rowsBefore[0].filled, false);
      assert.equal(out.rowsAfter[0].filled, true);
    });
  });
}

for (const shape of ['reveal', 'revealFrench']) {
  test(`${shape}: a slot that creates its input when + is pressed takes the CV, and the cover-letter slot only the letter`, async () => {
    await open(SHAPES[shape], async page => {
      const out = await fill(page, CV);
      assert.deepEqual(out.got, {cvPlus: 'cv.pdf', docPlus: 'letter.pdf'});
      assert.deepEqual(out.rowsBefore.map(row => [row.field, row.required]), [['resume', true], ['cover_letter', false]]);
      assert.deepEqual(out.uploads.map(item => item.ok), [true, true]);
    });
  });
  test(`${shape}: no cover-letter file means the cover-letter slot stays untouched, never the CV`, async () => {
    await open(SHAPES[shape], async page => {
      const out = await fill(page, CV_ONLY);
      assert.deepEqual(out.got, {cvPlus: 'cv.pdf'});
    });
  });
}

test('without a CV in the app the required slot is listed as to do and nothing is attached', async () => {
  await open(SHAPES.reveal, async page => {
    const out = await fill(page, null);
    assert.equal(out.resumeAttached, false);
    assert.deepEqual(out.got, {});
    assert.ok(out.todo.includes('Upload your CV'), `todo: ${out.todo}`);
    assert.equal(out.rowsAfter.find(row => row.field === 'resume').filled, false);
  });
});

test('a wording nobody knows is left empty and reported; a phrase from the service then gives it a meaning', async () => {
  await open(SHAPES.unknownWording, async page => {
    const out = await fill(page, CV);
    assert.deepEqual(out.got, {}, 'never guessed with two slots');
    assert.deepEqual(out.unknown, ['dossier principal', 'pièces annexes']);
    assert.ok(out.uploads.length === 0, 'an untouched slot is not an operator failure');
  });
  await open(SHAPES.unknownWording, async page => {
    const out = await fill(page, CV, {aliases: [{key: 'resume', phrase: 'dossier principal'}, {key: 'cover_letter', phrase: 'pièces annexes'}]});
    assert.deepEqual(out.got, {aPlus: 'cv.pdf', bPlus: 'letter.pdf'});
  });
});

test('a pressable that opens nothing is a reported miss with the slot\'s fingerprint, and a recipe naming the trigger fixes it', async () => {
  let fp = '';
  await open(SHAPES.helpFirst, async page => {
    const out = await fill(page, CV_ONLY);
    assert.equal(out.resumeAttached, false);
    assert.equal(out.uploads.length, 1);
    assert.equal(out.uploads[0].ok, false);
    assert.equal(out.uploads[0].why, 'no file input appeared');
    assert.match(out.uploads[0].fp, /^[a-z0-9]{6,16}$/);
    ({fp} = out.uploads[0]);
  });
  await open(SHAPES.helpFirst, async page => {
    const out = await fill(page, CV_ONLY, {recipes: {[fp]: {fingerprint: fp, version: 3, operator: 'upload', params: {trigger: '.real-plus'}}}});
    assert.equal(out.resumeAttached, true);
    assert.equal(out.uploads[0].recipe, 3, 'the report says which recipe version worked');
  });
});

test('a lone slot with a wording nobody knows takes the CV, as a lone file input always did', async () => {
  await open('<body><label>Attachment <input type="file" id="x" onchange="window.got = {x: this.files[0].name}"></label></body>', async page => {
    assert.deepEqual((await fill(page, CV_ONLY)).got, {x: 'cv.pdf'});
  });
});

test('the real Coop form takes the CV and the cover letter (JP_LIVE=1)', {skip: !process.env.JP_LIVE}, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({locale: 'en-US'});
    await page.goto('https://jobs.coop.ch/Coop/job/Nyon-Assistante-Assistant-du-commerce-de-d%C3%A9tail-AFP-Vaud/1405093533/?locale=en_US', {waitUntil: 'networkidle'});
    await page.getByRole('link', {name: /Apply|Postuler/i}).first().click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);
    for (const file of PAGE_FILES) await page.addScriptTag({content: fs.readFileSync(new URL(`../../../extension/${file}`, import.meta.url), 'utf8')});
    const out = await fill(page, CV);
    assert.deepEqual(out.rowsBefore.map(row => [row.field, row.filled]), [['resume', false], ['cover_letter', false]]);
    assert.deepEqual(out.uploads.map(item => item.ok), [true, true]);
    assert.deepEqual(out.rowsAfter.map(row => row.filled), [true, true]);
    const shown = await page.$$eval('[id$=_attachSuccess]', els => els.filter(el => !el.classList.contains('displayNone')).length);
    assert.equal(shown, 2, 'the site itself shows both slots as uploaded');
  } finally { await browser.close(); }
});

test('a choice that reveals an existing hidden input: the CV goes in, and the paste way is not pressed afterwards', async () => {
  await open(SHAPES.choice, async page => {
    await page.evaluate(() => document.querySelector('.uploadResumeTriggerFile').click());   // the Apply press had shown the input before the fill starts (9 Oct 2026)
    const out = await fill(page, CV_ONLY);
    assert.equal(out.got.resumeFile, 'cv.pdf', JSON.stringify(out.uploads));
    assert.equal(out.resumeAttached, true);
    assert.equal(await page.evaluate(() => document.getElementById('pasteBox').style.display), 'none', 'Copy and paste CV was not pressed after the upload worked');
    assert.ok(out.uploads.some(item => /already given/.test(item.why || '')) || out.uploads.length >= 1);
  });
});

test('a file already in the input: no trigger is pressed again (it would open the system file dialog over the person\'s page)', async () => {
  await open(SHAPES.choice.replace('<script>', '<script>window.pressed = 0; document.addEventListener("click", e => { if (e.target.closest(".how a")) window.pressed++; }, true);'), async page => {
    await page.evaluate(() => {   // the person pressed Upload CV and chose their own file
      document.querySelector('.uploadResumeTriggerFile').click(); window.pressed = 0;
      const input = document.getElementById('resumeFile'), transfer = new DataTransfer();
      transfer.items.add(new File(['%PDF mine'], 'mine.pdf', {type: 'application/pdf'})); input.files = transfer.files;
    });
    const out = await fill(page, CV_ONLY);
    assert.equal(await page.evaluate(() => window.pressed), 0, 'no trigger was pressed');
    assert.equal(await page.evaluate(() => document.getElementById('resumeFile').files[0].name), 'mine.pdf', 'their file stays');
    assert.equal(out.resumeAttached, true, JSON.stringify(out.uploads));
  });
});

// 11 Oct 2026 (Louis Vuitton jobs, live capture): the page's own "Import data from my CV" feature has a hidden file input of its own, labelled by its button, and its
// wording says "CV"; the form's real CV slot is titled "Currículo", a word no floor knows. The CV went into the import input and the site opened "your fields may be
// replaced, continue?" over the form. The app's AI picks, from the slots' own titles, the one that takes the CV as a document (lib/option-pick.js, kept); the others
// that only the floor called a CV are left alone.
const IMPORT_SHAPE = `<body><div class="fast"><button type="button" id="importBtn"><span id="importLbl">Importar datos desde mi CV</span></button>
  <form id="imp" aria-hidden="true"><input type="file" id="imp" class="hidden" aria-labelledby="importLbl" onchange="window.got = Object.assign(window.got || {}, {imp: this.files[0].name})"></form></div>
  <form id="main"><div class="field"><label>Nombre * <input id="n"></label></div>
  <style>.hidden{display:none}</style><div class="field"><div class="lab"><span>Currículo</span> <em>*</em></div><div class="drop"><button type="button" class="btn-upload" onclick="window.pressed = (window.pressed || 0) + 1">cargar archivo</button></div><input type="file" id="own" class="hidden" onchange="window.got = Object.assign(window.got || {}, {own: this.files[0].name})"></div></form></body>`;
test('an import-from-CV input beside the form\'s own CV slot: the AI\'s choice gets the CV, the import input gets nothing', async () => {
  await open(IMPORT_SHAPE, async page => {
    const wide = (await page.evaluate(() => window.__jobPilottoUpload.cvCandidates())).find(title => /Currículo/.test(title));
    const result = await fill(page, CV_ONLY, {choice: {resume: wide}});
    assert.deepEqual(result.got, {own: 'cv.pdf'});
    assert.equal(await page.evaluate(() => window.pressed || 0), 0, 'the button is not pressed: it would open the system file dialog over the page');
  });
});
test('no choice (no AI, or it said none): the operator behaves as before', async () => {
  await open(IMPORT_SHAPE, async page => {
    assert.deepEqual(Object.keys((await fill(page, CV_ONLY)).got), ['imp']);   // today's behaviour, the shape the choice exists for
    assert.deepEqual(Object.keys((await fill(page, CV_ONLY, {choice: {resume: ''}})).got), ['imp']);
  });
});
test('the slots\' titles are listed for the app to ask about, only when two or more slots could take the CV', async () => {
  await open(IMPORT_SHAPE, async page => {
    const titles = await page.evaluate(() => window.__jobPilottoUpload.cvCandidates());
    assert.equal(titles.length, 2); assert.ok(titles.some(title => /Currículo/.test(title)) && titles.some(title => /Importar datos/.test(title)), titles.join(' | '));
  });
  await open('<body><label>Attachment <input type="file" id="x"></label></body>', async page => {
    assert.deepEqual(await page.evaluate(() => window.__jobPilottoUpload.cvCandidates()), []);
  });
});

// Louis Vuitton, live (11 Oct 2026, plan-path engine): the own CV slot's label block sits where no climb reaches (another control shares its container), but the trigger names it
// through aria-describedby. The AI must see that label, or it can only answer "none".
test('a slot\'s label reached only through aria-describedby/labelledby is part of the title the AI sees', async () => {
  await open(`<body><div class="fast"><button type="button" id="importBtn"><span id="importLbl">Importar datos desde mi CV</span></button><form><input type="file" id="imp" aria-labelledby="importLbl"></form></div>
    <div class="row"><div id="label_cv" class="lab">Currículo <em>*</em></div></div>
    <div class="box"><input type="text" id="decoy"><div class="drop"><button type="button" class="btn-upload" aria-describedby="help_cv label_cv">cargar archivo</button></div><input type="file" id="own" style="display:none"></div></body>`, async page => {
    const titles = await page.evaluate(() => window.__jobPilottoUpload.cvCandidates());
    assert.ok(titles.some(title => /Currículo/.test(title)), titles.join(' | '));
  });
});

for (const shape of ['detachedDrop', 'detachedDropVariant']) {
  test(`${shape}: a pressable two levels under the container that names uploading takes the CV through the input the page already made, with no press`, async () => {
    await open(SHAPES[shape], async page => {
      const out = await fill(page, CV_ONLY);
      assert.equal(out.resumeAttached, true);
      assert.deepEqual(out.got, {drop: 'cv.pdf'});
      assert.equal(await page.evaluate(() => window.pressed), 0, 'the zone was never pressed (that opens the file dialog over the person)');
      assert.equal(out.rowsBefore.length, 1, 'one slot is listed');
      assert.equal(out.rowsBefore[0].required, true);
    });
  });
}
