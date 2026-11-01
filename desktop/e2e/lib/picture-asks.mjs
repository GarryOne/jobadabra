// The screenshot asks of a CI pool run, counted from its rows' app logs (the extension's "closer look: <action>" lines carry {picture: true, usd}; rung4-picture.js): how many pages were looked at with
// their picture and what it cost, on its own line of the pool summary beside the AI spend (cc and the owner, 13 Oct 2026: the screenshot step is ON in CI pool runs only). Guard: e2e/test/ai/picture-asks.test.mjs.
import fs from 'node:fs';
import path from 'node:path';

const LINE = /\[extension\] fill: closer look: [a-z_]+ (\{.*\})\s*$/;

// app log texts -> {count, usd, confirmed, notConfirmed, measured, partial} (a blind spot the picture confirmed or did not, fill-flow.js; measured = asks whose picture counted its controls, partial = those that showed more than the sketch lists, extension/ladder/picture-view.js)
export function pictureAsks(logs = []) {
  let count = 0, usd = 0, confirmed = 0, notConfirmed = 0, measured = 0, partial = 0;
  for (const text of logs) for (const line of String(text).split('\n')) {
    const found = LINE.exec(line);
    if (found) { let fields = {}; try { fields = JSON.parse(found[1]); } catch { /* a cut line */ } if (fields.picture === true) { count++; usd += Number(fields.usd) || 0; if (fields.shown >= 0 && fields.listed >= 0) { measured++; if (fields.partial === true) partial++; } } }
    if (/\[extension\] fill: blind spot confirmed:/.test(line)) confirmed++;
    else if (/\[extension\] fill: blind spot not confirmed:/.test(line)) notConfirmed++;
  }
  return {count, usd: Math.round(usd * 1e4) / 1e4, confirmed, notConfirmed, measured, partial};
}

export const pictureAsksLine = ({count, usd, confirmed, notConfirmed, measured = 0, partial = 0}) => `Screenshot asks: ${count} (${usd ? `$${usd.toFixed(4)}` : '$0'}); blind spots confirmed by the picture ${confirmed}, not confirmed ${notConfirmed}.${measured ? ` Partial views: ${partial} of ${measured} measured.` : ''}`;

// a smoke reports folder -> the line, from every row's app log (`*.app.log`); '' when no row looked at a picture and no blind spot was judged
export function pictureAsksOf(dir) {
  let names = [];
  try { names = fs.readdirSync(dir).filter(name => name.endsWith('.app.log')); } catch { return ''; }
  const found = pictureAsks(names.map(name => { try { return fs.readFileSync(path.join(dir, name), 'utf8'); } catch { return ''; } }));
  return found.count || found.confirmed || found.notConfirmed ? pictureAsksLine(found) : '';
}
