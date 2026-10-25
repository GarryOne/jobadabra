// A fake GitHub release list for the update flow (suites/updates.mjs): the app's updater reads it through JOB_PILOTTO_E2E_UPDATES_URL (lib/updater.js apiBase,
// e2e only). `set(releases)` replaces the list; every installer download is counted. Nothing reaches GitHub.
import http from 'node:http';

// A release as GitHub lists it, with this platform's installers under the names lib/updater.js asset() looks for.
// `approved` writes both gate lines: Windows apps also need BETA_MARK_WINDOWS (lib/updater.js).
export function release(base, version, {prerelease = false, approved = false, body = ''} = {}) {
  const file = name => ({name, size: 4, browser_download_url: `${base}/download/${name}`});
  const marks = [approved && `Beta-approved: desktop-v${version} (every suite passed on its commit)`,
    approved && `Beta-approved (Windows): desktop-v${version} (every Windows suite passed on its commit)`].filter(Boolean);
  return {tag_name: `desktop-v${version}`, name: `Build · ${version}`, draft: false, prerelease, html_url: `${base}/release/${version}`,
    body: `${body}${marks.map(line => `\n${line}`).join('')}`,
    assets: [file(`Jobadabra-${version}-arm64.zip`), file(`Jobadabra-${version}-x64.exe`), file(`Job-Pilotto-${version}-arm64.zip`), file(`Job-Pilotto-${version}-x64.exe`)]};
}

export async function startReleasesFake() {
  let releases = [];
  const stats = {lists: 0, downloads: []};
  const server = http.createServer((req, res) => {
    const send = (status, data) => { res.writeHead(status, {'content-type': 'application/json'}); res.end(JSON.stringify(data)); };
    if (/^\/repos\/[^/]+\/[^/]+\/releases\/latest/.test(req.url)) { stats.lists++; const stable = releases.filter(item => !item.prerelease)[0]; return stable ? send(200, stable) : send(404, {message: 'Not Found'}); }
    if (/^\/repos\/[^/]+\/[^/]+\/releases/.test(req.url)) { stats.lists++; return send(200, releases); }
    if (req.url.startsWith('/download/')) { stats.downloads.push(decodeURIComponent(req.url.slice('/download/'.length))); res.writeHead(200, {'content-type': 'application/octet-stream'}); return res.end(Buffer.from('fake')); }
    send(404, {message: 'Not Found'});
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  return {url, stats, set: list => { releases = list; }, release: (version, options) => release(url, version, options),
    close: () => { server.closeAllConnections?.(); return new Promise(resolve => server.close(resolve)); }};
}
