// "Your Profile is empty, so fit scores are paused": one notice on two pages, Strategy (the words live in index.html #strategy-profile-empty) and Jobs (a copy of it).
// Why (#2759, owner's account: "Setup can finish with your Notion Profile still blank, and nothing tells you"): setup ends on Jobs, which said nothing while score.py paused every fit score.
// Invariant: one writer (showProfileEmpty), one source of words (the Strategy block), one action (the Rebuild from CV button, #strategy-redo).
// Jobs learns it from the jobs read it already makes (`profile_empty`, src/desktop.py _profile_blank), never from Strategy's read: that one runs the whole strategy pipeline and can write the search level.
import {show} from './pages/core.js';

let wired = false;

/** Show or hide the notice on both pages; the Jobs copy is made from the Strategy block when it is first needed. */
export function showProfileEmpty(empty) {
  const source = document.getElementById('strategy-profile-empty'), copy = document.getElementById('jobs-profile-empty');
  if (source) show(source, !!empty);
  if (!copy) return;
  if (empty && source && !copy.childElementCount) {
    const whole = source.cloneNode(true), button = whole.querySelector('#profile-empty-rebuild');
    button.removeAttribute('id');   // an id is the original's
    button.dataset.profileEmptyRebuild = '';
    copy.append(...whole.childNodes);
  }
  show(copy, !!empty);
}

/** The Jobs copy's button does what the Strategy one does: the same Rebuild from CV. */
export function wireProfileEmpty() {
  const copy = document.getElementById('jobs-profile-empty');
  if (wired || !copy) return;
  wired = true;
  copy.addEventListener('click', event => { if (event.target.closest('[data-profile-empty-rebuild]')?.tagName === 'BUTTON') document.getElementById('strategy-redo').click(); });
}
