// Careers pages that only exist after their scripts run, rendered for the engine (src/sources/render.py) in the app's own Chromium, so the Mac
// needs no Playwright download (6 Oct 2026: Migros's job site reads as an empty shell without scripts). A hidden window in its own empty
// session (no cookies, never the user's browser profile), no images, fonts or media, the engine's user agent plus "browser". The engine
// paces each site and gives up at a 401/403/429 or a bot check: a block is taken as it is (robots.txt is not consulted, owner, 6 Oct 2026).
import crypto from 'node:crypto';
import net from 'node:net';

// The engine's key to /engine/render (lib/server.js): made at each start, given only to the engine runs this app starts (lib/pipeline.js).
export const TOKEN = crypto.randomBytes(24).toString('hex');
const PARTITION = 'jobadabra-render';   // in memory only: nothing it is given is kept
let where = '';
export const setAddress = value => { where = value; };   // main.js, once the local server listens
export const address = () => where;
// The engine's own user agent plus "browser" (src/sources/render.py sends it): never a browser's, so a site always sees who it is.
export const agentOf = value => (/^Jobadabra\/[\w.]+ \([^)]*\) browser$/.test(String(value || '')) ? String(value) : 'Jobadabra browser');

// A public web address only: never this computer, the local network or a non-web scheme.
export function publicUrl(address) {
  let url;
  try { url = new URL(address); } catch { return false; }
  if (!['http:', 'https:'].includes(url.protocol)) return false;
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || !host.includes('.') && !net.isIP(host)) return false;
  if (net.isIPv4(host)) {
    const [a, b] = host.split('.').map(Number);
    return !(a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224);
  }
  if (net.isIPv6(host)) return !/^(::1?$|fc|fd|fe80)/.test(host);
  return true;
}

let queue = Promise.resolve();

// -> {status, html} or {error}. One page at a time; the window is destroyed after each page.
export function renderPage(url, {BrowserWindow, userAgent, timeoutMs = 20000, settleMs = 1500, wait = ms => new Promise(r => setTimeout(r, ms))}) {
  if (!publicUrl(url)) return Promise.resolve({error: 'not a public web address'});
  const run = () => new Promise(resolve => {
    const win = new BrowserWindow({show: false, webPreferences: {partition: PARTITION, images: false, javascript: true, sandbox: true,
      contextIsolation: true, nodeIntegration: false, backgroundThrottling: false}});
    let status = 0, done = false;
    const finish = result => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (!win.isDestroyed()) win.destroy();
      resolve(result);
    };
    const timer = setTimeout(() => finish({error: 'timeout', status}), timeoutMs);
    win.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({cancel: ['media', 'font', 'image'].includes(details.resourceType)}));
    win.webContents.on('did-navigate', (_event, _url, code) => { status = code; });
    win.webContents.setWindowOpenHandler(() => ({action: 'deny'}));   // a page opening windows or tabs gets none
    win.loadURL(url, {userAgent})
      .then(async () => {
        await wait(settleMs);   // the list its scripts fill in
        finish({status, html: await win.webContents.executeJavaScript('document.documentElement.outerHTML')});
      })
      .catch(error => finish({error: error.message, status}));
  });
  queue = queue.then(run, run);
  return queue;
}
