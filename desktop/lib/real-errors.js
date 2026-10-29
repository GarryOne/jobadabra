// Real-use fill errors, caught at once: reads the extension's own decision lines (worker /extension/log -> server-env onLog), picks the ones that are an
// error (the page fill failed, a fill that threw, an uncaught extension error, a dead end that carries an exception) and hands each to a sink: one Sentry event
// and one deduplicated Telegram line. Only the error's text, its stack frames, the host and the extension version leave: never a field value, a URL path or a name.
// Guards: desktop/test/real-errors.test.js (a fake error gives one scrubbed Sentry event and one notice per hour).
import {scrub} from './telemetry.js';

export const HOUR = 3600_000;
// The decision lines that ARE an error, by the extension's own words (extension/flow.js, flow-dropdowns, apply-press.js, log.js). A dead end is one only when it carries `error`.
const ERROR_LINES = [/^the page fill failed/, /^failed:/, /^the Apply button could not be pressed/, /^uncaught/, /^unhandled rejection/];
export function isFillError(entry) {
  const kind = String(entry?.kind || ''), text = String(entry?.text || '');
  if (entry?.fields?.stopped || /^(failed: )?Stopped by you/.test(String(entry?.fields?.error || text.replace(/^failed: /, '')))) return false;   // the person's own Stop ends a fill: not an error (#961)
  if (kind === 'error') return true;
  if (kind !== 'fill') return false;
  return ERROR_LINES.some(line => line.test(text)) || (/^dead end: /.test(text) && !!entry.fields?.error);
}

const hostOf = value => { try { return new URL(String(value)).host; } catch { return ''; } };   // the host only: a path or query can name a job or a person

// -> {message, stack, host, extVersion, key} or null. Scrubbed here, before any sink sees it.
export function classify(entry) {
  if (!isFillError(entry)) return null;
  const fields = entry.fields || {};
  const raw = fields.error || fields.message || String(entry.text || '').replace(/^failed: /, '');
  const message = scrub(raw, 200);
  const stack = String(fields.at || fields.stack || '').split(' | ').map(line => scrub(line, 200)).join('\n');
  const host = scrub(fields.host || hostOf(fields.url) || '', 80);
  return {message, stack, host, extVersion: scrub(fields.version || '', 20), line: scrub(entry.text, 80),
    key: `${entry.kind}|${message.replace(/\d+/g, '#').slice(0, 80)}`};
}

// One notice per error kind per hour (the Sentry client keeps its own 10-minute limit per problem). sink({...classified, notice}) - notice is true for the first of the hour.
export function createWatcher({sentry = () => false, notice = () => {}, now = () => Date.now()} = {}) {
  const told = new Map();
  return entries => {
    for (const entry of Array.isArray(entries) ? entries : []) {
      const found = classify(entry);
      if (!found) continue;
      if (entry.kind === 'error' && entry.fields?.source === 'extension') {
        const fields = entry.fields;
        try { sentry('extension_error', {message: found.message, type: fields.type, stack: found.stack, source: 'extension', rejection: fields.rejection, extVersion: found.extVersion}); } catch { /* never breaks the log */ }
        continue;
      }
      try { sentry('fill_error', {message: found.message, stack: found.stack, where: 'extension', host: found.host, extVersion: found.extVersion}); } catch { /* never breaks the log */ }
      const at = now();
      if (told.has(found.key) && at - told.get(found.key) < HOUR) continue;
      told.set(found.key, at);
      try { notice(`⚠️ Jobadabra fill error${found.host ? ` on ${found.host}` : ''}${found.extVersion ? ` (extension ${found.extVersion})` : ''}: ${found.message}`); } catch { /* idem */ }
    }
  };
}
