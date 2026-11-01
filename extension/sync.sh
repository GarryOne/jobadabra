#!/usr/bin/env bash
# The page helpers are shared with the Playwright launchers; tools/ holds the originals.
# Run after changing tools/browser-submit-guard.js or tools/browser-form-fastpath.js
# (app-core/test/extension-files.test.js fails while the copies differ).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
cp "$here/../tools/browser-submit-guard.js" "$here/../tools/browser-form-fastpath.js" "$here/page/"
cp "$here/../desktop/renderer/tips-pool.js" "$here/tips-pool.js"   # the form panel's tip line draws from the same pool as the app (app-core/test/extension-files.test.js)
echo "Synced page helpers into extension/page/ and the tips pool"
# The snapshot scrubber (extension/page/snapshot.js, between "// <scrub>" and "// </scrub>") has a copy in
# app-core/src/snapshot.js (app-core/test/snapshot.test.js fails while they differ).
node -e '
const fs = require("fs"), page = fs.readFileSync(process.argv[1], "utf8"), file = process.argv[2], worker = fs.readFileSync(file, "utf8");
const cut = (s, start, end) => [s.indexOf(start), s.indexOf(end) + end.length];
const [a, b] = cut(page, "  // <scrub>", "  // </scrub>\n"), [c, d] = cut(worker, "// <scrub>", "// </scrub>\n");
const block = page.slice(a, b).split("\n").map(l => l.replace(/^  /, "")).join("\n");
fs.writeFileSync(file, worker.slice(0, c) + block + worker.slice(d));
' "$here/page/snapshot.js" "$here/../app-core/src/snapshot.js"
echo "Synced the snapshot scrubber into app-core/src/snapshot.js"
