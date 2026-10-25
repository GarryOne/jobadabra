// A grid of cards (components.css .card-grid): marks the card that has no partner in its row .is-wide, so it takes the whole row and no half row stays empty.
// Wide cards (.is-wide: a log, a long list) break the pairs; the small cards between two of them pair up in order. Pure over the DOM it is given.
// Used by the Searches report (pages/reports-searches.js) and every page's card grid. Guard: test/card-grid.test.js.
export function pairRows(grid) {
  const cards = [...grid.children].filter(card => !card.hidden);
  for (const card of cards) if (card.classList.contains('is-unpaired')) card.classList.remove('is-wide', 'is-unpaired');   // drawn again: start over
  let run = [];
  const close = () => { if (run.length % 2) run.at(-1).classList.add('is-wide', 'is-unpaired'); run = []; };
  for (const card of cards) {
    if (card.classList.contains('is-wide')) close();
    else run.push(card);
  }
  close();
  return grid;
}
