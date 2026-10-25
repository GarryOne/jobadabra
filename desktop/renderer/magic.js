// The shared magic effect: put data-magic on a card and it gets a wand glow under the cursor, a sparkle trail while the pointer moves
// and a burst when pressed. Mouse and pen only, off with reduced motion. Look: magic.css. Guard: test/welcome-magic.test.js.
const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;   // read at each event, so a changed setting counts at once

// Whether the effect runs for this pointer: never with reduced motion, never under a finger.
export const shouldRun = ({reduced, pointerType}) => !reduced && pointerType !== 'touch';

// n sparkles spread round a point: their end offsets (rand is injectable for the test).
export function burst(n, reach, rand = Math.random) {
  return Array.from({length: n}, (_, i) => {
    const angle = (i / n) * 2 * Math.PI + (rand() - 0.5) * 0.4, distance = reach * (0.5 + rand());
    return {dx: Math.cos(angle) * distance, dy: Math.sin(angle) * distance, size: 8 + rand() * 10};
  });
}

function sparkle(card, x, y, spec) {
  const spark = document.createElement('span');
  spark.className = 'magic-spark';
  spark.style.setProperty('--x', `${x}px`);
  spark.style.setProperty('--y', `${y}px`);
  spark.style.setProperty('--dx', `${spec.dx}px`);
  spark.style.setProperty('--dy', `${spec.dy}px`);
  spark.style.setProperty('--size', `${spec.size}px`);
  card.appendChild(spark);
  setTimeout(() => spark.remove(), 1000);
}

export function wire(card) {
  if (card.dataset.magicWired) return;   // a card drawn again keeps one set of listeners
  card.dataset.magicWired = '1';
  const point = event => { const box = card.getBoundingClientRect(); return {x: event.clientX - box.left, y: event.clientY - box.top}; };
  let queued = null, lastTrail = 0;
  card.addEventListener('pointermove', event => {
    if (!shouldRun({reduced: calm(), pointerType: event.pointerType})) return;
    if (!queued) requestAnimationFrame(() => {
      card.style.setProperty('--mx', `${queued.x}px`);
      card.style.setProperty('--my', `${queued.y}px`);
      queued = null;
    });
    queued = point(event);
    if (event.timeStamp - lastTrail > 60) { lastTrail = event.timeStamp; sparkle(card, queued.x, queued.y, burst(1, 18)[0]); }
  }, {passive: true});
  card.addEventListener('click', event => {
    if (calm()) return;
    const {x, y} = event.detail ? point(event) : {x: card.clientWidth / 2, y: card.clientHeight / 2};   // a keyboard press bursts from the middle
    for (const spec of burst(12, 90)) sparkle(card, x, y, spec);
  });
}

// Marks a button or menu row as one where the AI does the work: it gets the wand cursor (magic.css). Static buttons carry data-wand in index.html.
export const wand = node => { node.dataset.wand = ''; return node; };

export function initMagic(root = document) {
  root.querySelectorAll('[data-magic]').forEach(wire);
}
