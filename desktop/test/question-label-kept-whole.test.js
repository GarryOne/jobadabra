// A form question's wording reaches the app whole (owner, 17 Oct 2026): labels cut at 120 characters were saved as "…We t: Yes" / "…Please sele: ❓", so they never
// matched the form again (data loss). Every page file that reports a label (the fill trace, the panel's lists, the marks) caps it far above a real question.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const page = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../extension/page');
for (const file of ['fill.js', 'fill-report.js', 'fill-marks.js', 'review-payload.js']) {
  test(`${file}: no label is cut at 120 characters`, () => {
    const code = fs.readFileSync(path.join(page, file), 'utf8');
    const cuts = code.split('\n').flatMap((line, at) => [...line.matchAll(/(?:\blabel|clean\(label\)|f\.label \|\| '[^']*'\)|f\.label)\)?\.slice\(0, *(\d+)\)/g)].map(match => ({at: at + 1, size: Number(match[1])})));
    for (const cut of cuts) assert.ok(cut.size >= 300, `${file}:${cut.at} cuts a label at ${cut.size}`);
    if (file === 'fill-report.js') assert.match(code, /TRACE_LABEL_MAX = (\d+)/);
  });
}
