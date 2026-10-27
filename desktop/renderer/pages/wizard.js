// Setup wizard: the first-run steps (welcome, AI, CV, draft, extras) and saving each step's answers.
import {shared} from './shared.js';
import {refreshCv} from './activity.js';
import {$, STEPS, message, show} from './core.js';
import {init as hostedInit} from './hosted.js';
import {loadJobs} from './jobs.js';
import {toDraft} from './strategy-review.js';
import {hideCards} from './setup-strategy.js';
import {mountEngine} from './ai-engine.js';
import {canContinue} from '../ai-engine-view.js';
import {initMagic, initWandBurst} from '../magic.js';

// The AI step's engine chooser (pages/ai-engine.js): mounted the first time the step opens. Nothing is pre-selected;
// Continue once the user picked one that can run (Claude Code verified, or an API key saved or typed).
let chooser = null;
const aiDone = () => !!shared.state.secrets.ANTHROPIC_API_KEY || ['cli', 'codex'].includes(shared.state.settings.aiEngine)
  || (shared.state.settings.aiEngine === 'openai' && !!shared.state.secrets.OPENAI_API_KEY);
function aiStep() {
  const picked = chooser?.picked();
  show($('ai-key-part'), picked === 'api');
  show($('ai-openai-key-part'), picked === 'openai');
  show($('ai-free'), picked === 'free');   // the Free card's note
  const keyTyped = !!$({openai: 'openai-key'}[picked] || 'anthropic-key').value.trim();
  $('ai-save').disabled = !canContinue({picked, hasKey: !!shared.state.secrets.ANTHROPIC_API_KEY, hasOpenAiKey: !!shared.state.secrets.OPENAI_API_KEY,
    keyTyped, status: chooser?.status()});
  $('ai-save').textContent = picked === 'free' ? 'Use Free AI' : ['api', 'openai'].includes(picked) && keyTyped ? 'Check and save' : 'Continue';
}

// The Free card (lib/ai-free.js): this install's own token, no key or account.
async function useFree() {
  $('ai-save').disabled = true;
  message('ai-free-message', 'Setting up Free AI…');
  const result = await window.pilot.startFreeAi();
  $('ai-save').disabled = false;
  if (!result.ok) { message('ai-free-message', result.error, 'error'); return; }
  shared.state.secrets = {...shared.state.secrets, ANTHROPIC_API_KEY: true};
  shared.state.settings = {...shared.state.settings, aiFree: true, aiEngine: 'api'};
  message('ai-free-message', '✓ Free AI is on. Add your own key any time in Settings → Connections → AI.', 'ok');
  setTimeout(() => goStep('cv'), 900);
}

// The OpenAI API card: the key checked with a free call, saved, the engine set.
async function saveOpenAiKey() {
  const key = $('openai-key').value.trim();
  if (!key && shared.state.secrets.OPENAI_API_KEY) { shared.state.settings = await window.pilot.setAiEngine('openai'); goStep('cv'); return; }
  if (!key.startsWith('sk-')) { message('ai-openai-message', 'OpenAI keys start with sk-. Copy the whole key.', 'error'); return; }
  $('ai-save').disabled = true;
  message('ai-openai-message', 'Checking the key…');
  const result = await window.pilot.checkOpenAI(key);
  $('ai-save').disabled = false;
  if (!result.ok) { message('ai-openai-message', result.error, 'error'); return; }
  shared.state.secrets = await window.pilot.saveSecret('OPENAI_API_KEY', key);
  shared.state.settings = await window.pilot.setAiEngine('openai');
  $('openai-key').value = '';
  message('ai-openai-message', 'Saved ✓', 'ok');
  goStep('cv');
}

// ---------- wizard ----------
export function goStep(name) {
  const index = STEPS.indexOf(name);
  window.pilot.saveSettings({wizardStep: name});  // reopening the app continues here
  if (name === 'ai' && shared.state.secrets.ANTHROPIC_API_KEY && !$('anthropic-key').value) {
    message('ai-message', '✓ Your key is saved. Continue, or paste a new key to replace it.', 'ok');
    // The saved key, masked (dots and its last 4 characters), as in Settings.
    window.pilot.secretHints().then(hints => {
      if (hints.ANTHROPIC_API_KEY) $('anthropic-key').placeholder = `${hints.ANTHROPIC_API_KEY} · saved (paste a new one to replace it)`;
    });
  }
  if (name === 'extras') import('./settings.js').then(settings => settings.showExtrasStatus());  // Connected / Manage, as in Settings
  if (name === 'ai') {
    if (!chooser) chooser = mountEngine($('ai-engine'), {context: 'wizard', onChange: aiStep});
    aiStep();
  }
  if (name !== 'draft') hideCards();   // the Strategy page's cards go back home
  document.querySelectorAll('.step').forEach(step => show(step, step.dataset.step === name));
  document.querySelectorAll('#step-list li').forEach((li, i) => {
    li.classList.toggle('current', i === index);
    li.classList.toggle('done', i < index || !!shared.state.settings.setupDone);
    li.classList.toggle('jump', !!shared.state.settings.setupDone || i < index);
  });
  show($('wizard-exit'), !!shared.state.settings.setupDone);
  const done = !!shared.state.settings.setupDone;   // setup done before: this is a review, not a redo
  show($('review-mode'), done && name !== 'welcome');   // Welcome says it itself, in its own words
  document.querySelectorAll('.step[data-step="welcome"] [data-when]').forEach(node => show(node, node.dataset.when === (done ? 'done' : 'first')));
  $('draft-save').textContent = shared.state.settings.setupDone ? 'Replace my strategy…' : 'Save strategy & continue';
  if (name === 'cv') refreshCv();
}

// The save window: a step is ● while it runs (with blocks written), ✓ when it's done; the bar sums them.
const SAVE_STEPS = {snapshot: 15, local: 5, profile: 35, answers: 20, search: 15, details: 10};   // details: Your details read from the CV (lib/details-at-setup.js)
export const saveState = {};   // step -> 0..1; "<step>:note": a finished step's result line (details: "5 filled from your CV, 2 to check in Your details"), counts only

// Run at start-up, in the order the window has always done it (app.js calls each page's init in turn).
export async function init() {
  initMagic();   // the Welcome card's wand glow and sparkles (magic.css)
  initWandBurst();   // sparks and a flash when any wand button is pressed (magic.js)
  hostedInit();   // the hosted step and its Settings card are built in script (pages/hosted.js)
  // Finished steps (or any step once setup was done before) can be opened from the sidebar.
  document.querySelectorAll('#step-list li').forEach(li => li.addEventListener('click', () => {
    if (!li.classList.contains('jump') || li.classList.contains('current')) return;
    if (li.dataset.step === 'draft') toDraft(); else goStep(li.dataset.step);
  }));
  // Setup was done before (Run setup again, Rebuild from CV): leave the wizard any time, nothing changes.
  $('wizard-exit').addEventListener('click', () => { hideCards(); show($('wizard'), false); show($('app')); loadJobs(); });
  // A key already there (e.g. Free AI already on): no AI step to do.
  document.querySelectorAll('[data-next]').forEach(b => b.addEventListener('click', () => goStep(aiDone() ? 'cv' : 'ai')));
  document.querySelectorAll('[data-back]').forEach(b => b.addEventListener('click', () => {
    const current = STEPS.find(step => !document.querySelector(`.step[data-step="${step}"]`).hidden);
    goStep(STEPS[Math.max(0, STEPS.indexOf(current) - 1)]);
  }));

  $('anthropic-key').addEventListener('input', aiStep);
  $('openai-key').addEventListener('input', aiStep);
  $('ai-save').addEventListener('click', async () => {
    if (chooser?.picked() === 'free') { await useFree(); return; }
    if (['cli', 'codex'].includes(chooser?.picked())) {  // the user's own Claude Code or Codex, verified: no API key needed
      shared.state.settings = await window.pilot.setAiEngine(chooser.picked());
      message('ai-message', '', '');
      goStep('cv');
      return;
    }
    if (chooser?.picked() === 'openai') { await saveOpenAiKey(); return; }
    const key = $('anthropic-key').value.trim();
    if (!key && shared.state.secrets.ANTHROPIC_API_KEY) {  // saved earlier: just continue
      shared.state.settings = await window.pilot.setAiEngine('api');
      goStep('cv');
      return;
    }
    if (!key.startsWith('sk-ant-')) { message('ai-message', 'Anthropic keys start with sk-ant-. Copy the whole key.', 'error'); return; }
    $('ai-save').disabled = true;
    message('ai-message', 'Checking the key…');
    const result = await window.pilot.checkAnthropic(key);
    $('ai-save').disabled = false;
    if (!result.ok) { message('ai-message', result.error, 'error'); return; }
    shared.state.secrets = await window.pilot.saveSecret('ANTHROPIC_API_KEY', key);
    shared.state.settings = await window.pilot.setAiEngine('api');
    $('anthropic-key').value = '';
    message('ai-message', 'Saved ✓', 'ok');
    goStep('cv');
  });
  $('ai-skip').addEventListener('click', () => goStep('cv'));
  // What's happening, line by line: finished pieces ✓, the one being written last.
  window.pilot.onDraftProgress(({part, percent, notes = []}) => {
    $('draft-feed').replaceChildren(...notes.slice(-9).map((note, i, shown) => Object.assign(document.createElement('li'),
      {className: i === shown.length - 1 ? 'now' : 'done', textContent: note})));
    $('draft-part').textContent = part;
    if (percent == null) return;
    $('draft-percent').textContent = percent ? `${percent}%` : '';
    $('draft-bar').style.width = `${Math.max(2, percent)}%`;
  });
  window.pilot.onSaveProgress(({step, done, total, finished, note}) => {
    saveState[step] = finished ? 1 : total ? done / total : saveState[step] || 0;
    if (note) saveState[`${step}:note`] = note;
    document.querySelectorAll('#save-steps li').forEach(li => {
      const name = li.dataset.saveStep, value = saveState[name];
      li.className = value === 1 ? 'done' : value !== undefined ? 'now' : '';
      const count = li.querySelector('.count');
      if (count) count.textContent = name === step && total && !finished ? `· ${done} of ${total} blocks` : saveState[`${name}:note`] ? `· ${saveState[`${name}:note`]}` : '';
    });
    const percent = Object.entries(SAVE_STEPS).reduce((sum, [name, share]) => sum + share * (saveState[name] || 0), 0);
    $('save-bar').style.width = `${Math.max(3, Math.round(percent))}%`;
  });
}
