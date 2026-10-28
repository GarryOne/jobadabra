// The one "the AI is writing this text" state, for any box the AI rewrites (the base letter, a job's letter): a lit strip above the box and the box glowing.
// Why (28 Oct 2026, owner): "let's improve the loading state UI of the cover letter"; he picked option A of the lw sketch (a strip that says what runs with a
// live timer, the old text faded and kept until the new text lands), then "Make it more like a glowing/magic": the app's magic look (magic.css: amber light,
// a lit edge, star sparkles) around the box. An empty box shows letter-shaped skeleton lines. Look: ai-writing.css. Used by pages/base-letter.js and
// job-drawer/job-letter.js. Guarded by test/ai-writing.test.js.
import {el} from './components.js';
import {icon} from './icons.js';

/** m:ss for a whole number of seconds (the strip's timer). */
export const elapsed = seconds => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

const BONES = [30, 0, 92, 86, 64, 0, 90, 78, 0, 22, 34];   // a letter's shape: greeting, two paragraphs, sign-off (0 = the gap between paragraphs)
const SPARKS = 12;                                         // at most this many stars on the box at once (a paused animation never ends them)
const textOf = box => String(box.tagName === 'TEXTAREA' ? box.value : box.textContent).trim();
const calm = () => !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// One star over the box (magic.css .magic-spark shape), at a random point, drifting up as it twinkles; amber or teal.
function spark(frame, rand) {
  const star = el('span', `magic-spark ai-writing-spark${rand() < 0.35 ? ' is-teal' : ''}`);
  star.setAttribute('aria-hidden', 'true');
  for (const [name, value] of [['--x', `${(4 + rand() * 92).toFixed(1)}%`], ['--y', `${(10 + rand() * 80).toFixed(1)}%`],
    ['--dx', `${((rand() - 0.5) * 16).toFixed(1)}px`], ['--dy', `${(-14 - rand() * 18).toFixed(1)}px`], ['--size', `${(14 + rand() * 12).toFixed(1)}px`]]) star.style.setProperty(name, value);
  star.addEventListener('animationend', () => star.remove());
  frame.append(star);
  const stars = [...frame.children].filter(node => node.classList?.contains('ai-writing-spark'));
  if (stars.length > SPARKS) stars[0].remove();
}

/**
 * Shows that the AI is writing `box` (a textarea or a text panel) until the returned stop() is called.
 * title: what runs ("Writing a new draft"); note: one muted line after it. now/every/clear/rand are injectable for the test.
 * Invariants: the box's text is never changed here (the caller puts the new text in); stop() puts the box back where and as it was and is safe to call twice;
 * with reduced motion no stars are made (ai-writing.css stops the rest).
 * @returns {() => void} stop
 */
export function aiWriting(box, {title, note = '', now = Date.now, every = setInterval, clear = clearInterval, rand = Math.random} = {}) {
  const time = el('span', 'ai-writing-time', elapsed(0));
  time.setAttribute('aria-hidden', 'true');   // the live region says what runs once; a clock read aloud every second would drown it
  const head = el('b', '');
  head.append(el('span', 'ai-writing-title', title), ' · ', time);
  const words = el('div', 'ai-writing-words');
  words.append(head);
  if (note) words.append(el('small', 'muted', note));
  const strip = el('div', 'ai-writing-strip');
  strip.setAttribute('role', 'status');
  strip.append(icon('sparkle'), words);
  // The frame holds the box (a textarea draws no children of its own), its glow and its stars; it stands where the box stood.
  const frame = el('div', 'ai-writing-frame');
  const wasHidden = box.hidden, parent = box.parentNode;
  box.replaceWith(frame);
  parent.insertBefore(strip, frame);
  if (!textOf(box)) {   // nothing to fade yet (a first draft): the letter's shape in skeleton lines stands where the text will land
    const bones = el('div', 'ai-writing-bones');
    bones.setAttribute('aria-hidden', 'true');
    bones.append(...BONES.map(width => Object.assign(el('span', width ? 'skeleton' : 'ai-writing-gap'), width ? {style: `width:${width}%`} : {})));
    frame.append(bones);
    box.hidden = true;
  }
  frame.append(box);
  box.classList.add('is-ai-writing');
  box.setAttribute('aria-busy', 'true');
  const start = now();
  const timers = [every(() => { time.textContent = elapsed(Math.floor((now() - start) / 1000)); }, 1000)];
  if (!calm()) timers.push(every(() => spark(frame, rand), 220));
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    timers.forEach(clear);
    strip.remove();
    frame.replaceWith(box);
    box.hidden = wasHidden;
    box.classList.remove('is-ai-writing');
    box.removeAttribute('aria-busy');
  };
}
