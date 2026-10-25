// Strategy's one "scored using previous search settings" notice, under the tabs (owner, 18 Oct 2026: "one consolidated notice", "count unique
// affected jobs", "saving settings must not silently start a paid re-score", "while running, show progress and prevent duplicate starts"; it was two
// rows of the Improve-your-search panel, older scores and other places, 17 Oct 2026). The engine counts each job once whatever its reasons, from the
// SAVED settings (src/desktop_strategy.py outdated); Re-score starts only from its dialog's own button and queues each job once (rescore-outdated).
// Kept apart from Suggestions: a recommendation and an outdated score are different things. Guarded by test/strategy-rescore.test.js and
// tests/test_strategy_outdated.py.
import {el, tile} from '../components.js';
import {wand} from '../magic.js';
import {$, show} from './core.js';
import {startSearch} from './jobs.js';
import {toastMessage} from './startup.js';
import {dialogLead, jobs, noticeTitle, reasonsText} from '../rescore-words.js';

let busy = false;   // from the dialog's Re-score until its search has ended: one start at a time
// outdated: {count, method, places} from the strategy read (none: nothing outdated); reload: reads Strategy again when the re-score ends.
export function drawOutdated(outdated, reload) {
  const box = $('strategy-outdated');
  const count = outdated?.count || 0;
  if (!count) { show(box, false); box.replaceChildren(); return; }
  const words = el('div', 'notice-words');
  const title = el('b', '', busy ? `Re-scoring ${jobs(count)}` : noticeTitle(count));
  words.append(title);
  if (busy) words.append(el('span', 'muted small', `Up to 60 in this search, the rest in the next ones. Follow it in Recent activity.`));
  else {
    const why = el('details', 'plain notice-why');
    why.append(el('summary', 'small', 'Why'), el('span', 'muted small', `${reasonsText(outdated)}. Each job is counted once. Updating is optional.`));
    words.append(why);
  }
  const go = el('button', 'secondary item-action', busy ? 'Re-scoring…' : 'Re-score jobs');
  go.type = 'button';
  wand(go);
  go.disabled = busy;
  go.addEventListener('click', () => confirmRescore(count, outdated, reload));
  box.replaceChildren(tile('refresh', 'info'), words, go);
  show(box, true);
}

function confirmRescore(count, outdated, reload) {
  if (busy) return;
  const dialog = $('rescore-dialog');
  $('rescore-title').textContent = `Re-score ${jobs(count)}?`;
  $('rescore-lead').textContent = dialogLead(count);
  $('rescore-go').textContent = `Re-score ${count}`;
  dialog.returnValue = '';
  dialog.onclose = async () => {
    if (dialog.returnValue !== 'go' || busy) return;
    busy = true;
    drawOutdated(outdated, reload);
    try {
      const result = await window.pilot.rescoreOutdated().catch(error => ({ok: false, error: error.message}));
      if (!result.ok) { toastMessage('Not re-scored', result.error); return; }
      toastMessage({title: 'Re-scoring now', body: `${jobs(result.queued)} get a new score${result.queued > 60 ? ' (60 now, the rest in the next searches)' : ''}. ` +
        'It shows in Recent activity as "Re-scoring".', target: null});
      await startSearch({reason: 'rescore', count: result.queued});   // resolves when the search ends; its row says "Re-scoring N older scores"
    } finally {
      busy = false;
      reload();
    }
  };
  dialog.showModal();
}
