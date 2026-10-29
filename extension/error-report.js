// Build a worker exception's diagnostic payload without reading arbitrary messages, page content, URLs or form values.
const NATIVE_TYPE = /^(?:Error|EvalError|RangeError|ReferenceError|SyntaxError|TypeError|URIError|AggregateError)$/;

function locationFrame(url, line, column, origin) {
  if (!origin || !url.startsWith(origin)) return '';
  const file = url.slice(origin.length).split('/').pop();
  if (!/^[\w-]+\.m?js$/.test(file) || !/^\d+$/.test(String(line)) || !/^\d+$/.test(String(column))) return '';
  return `at ${file}:${line}:${column}`;
}

/** Return only native error types, fixed diagnostic wording and file/line locations from this extension's own origin. */
export function errorReport(error, {origin, rejection = false, filename = '', lineno = 0, colno = 0} = {}) {
  // Why (29 Oct 2026, owner): an exception message can contain page text or answers; no arbitrary message or function name may enter a report.
  const type = NATIVE_TYPE.test(error?.name) ? error.name : 'Error';
  const frames = String(error?.stack || '').split('\n').slice(1, 41).map(line => {
    const match = /([^\s()]+):(\d+):(\d+)\)?$/.exec(line);
    return match ? locationFrame(match[1], match[2], match[3], origin) : '';
  }).filter(Boolean).slice(0, 8);
  if (!frames.length) {
    const fallback = locationFrame(filename, lineno, colno, origin);
    if (fallback) frames.push(fallback);
  }
  return {source: 'extension', type, error: rejection ? `Unhandled ${type} rejection` : `Uncaught ${type}`, rejection, at: frames.join('\n')};
}
