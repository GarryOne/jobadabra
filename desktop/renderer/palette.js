// ⌘K (Ctrl+K on Windows): a command palette. Type a few words ("check gmail", "record", "settings"), then
// Enter. Every command is a button the app already has (clicked as if by hand) or a page to open.

// Words that carry no meaning in a request ("check FOR gmail", "open THE settings").
const FILLER = new Set(['a', 'an', 'the', 'for', 'to', 'my', 'me', 'of', 'in', 'on', 'go', 'please', 'new', 'now']);
const words = text => String(text).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .split(/[^a-z0-9]+/).filter(Boolean);

// What a row shows: its path when it has one ("Settings → Connections → Chrome extension"), else its label.
export const shownLabel = command => (command.path?.length ? command.path.join(' → ') : command.label);
const sameWords = (a, b) => words(a).join(' ') === words(b).join(' ');

// Best matches first. A command matches when each meaningful query word starts one of its words (label first, then its keywords and hint); the label counts
// more, and a label the query names whole (its last path step: "plan", "find jobs") most. Filler words are ignored unless they're all you typed.
// One row per card (owner, 27 Oct 2026: "extension" listed 8 rows, he expected "Settings -> Connections -> Chrome extension. and that's pretty much it"):
// - a row found only by its keywords or hint goes when another row's label matches; it stays when nothing better matches;
// - a part (kind: 'part': a button or sub-heading of a card) folds under the card whose label holds every word typed; it shows on its own when the query
//   names the part itself ("manual connection", "stop extension", "chrome://"), or when its own card is not the one named and no card is named whole
//   ("export": Export job list and Your data → Export data);
// - rows with the same path in the same group are one row ("Open Settings: Plan" and the Plan card).
export function rank(commands, query) {
  const typed = words(query);
  const wanted = typed.filter(word => !FILLER.has(word));
  const terms = wanted.length ? wanted : typed;
  if (!terms.length) return commands.slice();
  const holds = text => { const all = words(text); return terms.every(term => all.some(word => word.startsWith(term))); };
  const scored = [];
  commands.forEach((command, index) => {
    const label = words(`${command.label} ${command.alias || ''}`), rest = words(`${command.keywords || ''} ${command.hint || ''}`);   // alias: a card's own words ("email" → Notifications)
    let score = 0, strong = false;
    for (const term of terms) {
      if (label.some(word => word.startsWith(term))) { score += label[0].startsWith(term) ? 4 : 3; strong = true; }
      else if (rest.some(word => word.startsWith(term))) score += 1;
      else return;  // every meaningful word has to be found
    }
    const name = words(command.path?.length ? command.path.at(-1) : command.label).filter(word => !FILLER.has(word) && word !== 'open');
    const whole = strong && name.length > 0 && name.every(word => terms.some(term => word.startsWith(term)));
    scored.push({command, score: score + (whole ? 2 : 0), index, strong, whole});
  });
  const best = scored.some(item => item.strong) ? scored.filter(item => item.strong) : scored;
  const named = best.filter(item => item.command.kind !== 'part' && holds(item.command.label)), cards = named.map(item => item.command);
  const wholeCard = named.some(item => item.whole);   // "notion", "cv", "plan": a card named whole folds every part
  const raw = String(query).trim().toLowerCase();
  const namesItself = command => /[^\p{L}\p{N}\s]/u.test(raw) && command.label.toLowerCase().includes(raw);   // "chrome://"
  const ofCard = command => !command.parent || holds(command.parent.label)
    || cards.some(card => sameWords(command.label.split(': ')[0], card.path?.at(-1) || card.label));   // "Chrome extension: manual connection"
  const folded = command => command.kind === 'part' && cards.length > 0 && !namesItself(command) && (wholeCard || ofCard(command));
  const seen = new Set();
  return best.filter(item => !folded(item.command)).sort((a, b) => b.score - a.score || a.index - b.index).map(item => item.command)
    .filter(command => { const key = `${command.group}|${shownLabel(command)}`; return !seen.has(key) && seen.add(key); });
}

// The palette: a dialog with a search box and the ranked commands; ↑/↓ to move, Enter or a click to run.
export function openPalette(commands) {
  document.getElementById('palette')?.remove();
  const dialog = Object.assign(document.createElement('dialog'), {id: 'palette', className: 'palette'});
  const input = Object.assign(document.createElement('input'), {type: 'search', placeholder: 'Type a command, e.g. check gmail',
    ariaLabel: 'Command'});
  input.setAttribute('aria-controls', 'palette-list');
  const list = Object.assign(document.createElement('ul'), {id: 'palette-list', role: 'listbox'});
  const empty = Object.assign(document.createElement('p'), {className: 'palette-empty muted', textContent: 'No command matches.', hidden: true});
  const foot = Object.assign(document.createElement('p'), {className: 'palette-foot muted', textContent: '↑↓ to move · Enter to run · Esc to close'});
  dialog.append(input, list, empty, foot);
  document.body.append(dialog);

  let shown = [], active = 0;
  const close = () => { dialog.close(); dialog.remove(); };
  const run = command => { close(); command.run(); };
  const highlight = index => {
    active = Math.max(0, Math.min(index, shown.length - 1));
    [...list.children].forEach((item, i) => item.setAttribute('aria-selected', String(i === active)));
    list.children[active]?.scrollIntoView({block: 'nearest'});
    foot.textContent = `↑↓ to move · Enter to ${shown[active]?.enter || (shown[active]?.path ? 'open' : 'run')} · Esc to close`;   // a row that only brings you to a card says "open"
  };
  const render = () => {
    shown = rank(commands, input.value);
    list.replaceChildren(...shown.map((command, i) => {
      const item = Object.assign(document.createElement('li'), {role: 'option'});
      const label = Object.assign(document.createElement('b'), {textContent: shownLabel(command)});
      // A task that is running now (palette-busy.js): the app's own small spinner after its name.
      if (command.running) label.append(Object.assign(document.createElement('i'), {className: 'spinner small', role: 'img', ariaLabel: 'Running now'}));
      item.append(label);
      if (command.hint) item.append(Object.assign(document.createElement('span'), {className: 'muted', textContent: command.hint}));
      if (command.group && command.path?.[0] !== command.group) item.append(Object.assign(document.createElement('small'), {textContent: command.group}));   // a path says its place already
      item.addEventListener('mousemove', () => { if (active !== i) highlight(i); });
      item.addEventListener('click', () => run(command));
      return item;
    }));
    empty.hidden = shown.length > 0;
    highlight(0);
  };
  input.addEventListener('input', render);
  input.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown') { event.preventDefault(); highlight(active + 1); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); highlight(active - 1); }
    else if (event.key === 'Enter' && shown[active]) { event.preventDefault(); run(shown[active]); }
  });
  dialog.addEventListener('close', () => dialog.remove());
  dialog.addEventListener('click', event => { if (event.target === dialog) close(); });  // a click on the backdrop
  render();
  dialog.showModal();
  input.focus();
}
