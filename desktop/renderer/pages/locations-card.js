// Strategy → Locations card, the rows it owns besides the lists (owner, 17 Oct 2026): the relocation choice (Yes / No / Not specified) and the "Custom search
// coverage active" line with Reset to preferences, shown even while Advanced is collapsed. Words and edits: renderer/locations-model.js. Guarded by test/locations-card.test.js.
import {el} from '../components.js';
import {RELOCATION, coverage, relocationNow, resetCoverage} from '../locations-model.js';
import {strategyState} from './strategy-state.js';
import {sink} from '../strategy-sink.js';
import {toastMessage} from './startup.js';

// The search-only list is active: say where the crawlers look instead, and offer the one-click way back. Nothing when it is not set.
export function coverageLine(reload) {
  const now = coverage(strategyState.lastStrategy);
  if (!now.active) return null;
  const line = el('div', 'setting-row coverage-line');
  const reset = Object.assign(el('button', 'link', 'Reset to preferences'), {type: 'button'});
  reset.addEventListener('click', async () => {
    reset.disabled = true;
    const result = await sink.editTargets(resetCoverage(now)).catch(error => ({ok: false, error: error.message}));
    if (!result.ok) { reset.disabled = false; toastMessage('Not reset', result.error || 'Try again.', {card: 'strategy-locations'}, 'bad'); return; }
    toastMessage('Search coverage reset ✓', 'Searches use your preferred and acceptable locations again.', {card: 'strategy-locations'}, 'good');
    await reload();
  });
  const words = el('div', 'setting-body');
  words.append(el('b', '', `Custom search coverage active · ${now.places.join(', ')}`), el('span', 'muted small', 'Searches look here instead of your preferences. Scoring still uses your preferences.'));
  line.append(words, reset);
  return line;
}

// Yes / No / Not specified while editing (the draft is edits.relocation); back to the stored mode drops the edit.
export function relocationChoice(redraw) {
  const stored = strategyState.lastStrategy?.relocation || 'unspecified', chosen = relocationNow(strategyState.lastStrategy, strategyState.targetEdits);
  const group = el('div', 'segmented');
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Relocation');
  for (const [value, label] of RELOCATION) {
    const button = el('button', value === chosen ? 'is-active' : '', label);
    button.type = 'button';
    button.setAttribute('aria-pressed', String(value === chosen));
    button.addEventListener('click', () => {
      if (value === stored) delete strategyState.targetEdits.relocation; else strategyState.targetEdits.relocation = {set: value};
      redraw();
    });
    group.append(button);
  }
  return group;
}
