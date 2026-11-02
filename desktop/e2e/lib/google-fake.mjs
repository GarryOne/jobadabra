// A fake Google API for the end-to-end tests (5 Oct 2026): the Gmail check reads invented emails (the qualityai mail eval's own, tests/fixtures/mail_eval.json) from here
// Job: run the backbone
// instead of a real inbox (JOBADABRA_E2E_GOOGLE_BASE_URL, test runs only: <base>/<google host>/<path>). It can also refuse the sign-in, as a revoked Google access does.
import http from 'node:http';
import {markPlanted} from './planted.mjs';

const b64 = text => Buffer.from(String(text), 'utf8').toString('base64url');
// One fixture email -> the Gmail API's message shape (headers + one text/plain part).
export function gmailMessage(id, email, date = new Date()) {
  return {id, threadId: id, labelIds: ['INBOX'], internalDate: String(date.getTime()),
    payload: {mimeType: 'text/plain', headers: [{name: 'From', value: email.from || ''}, {name: 'To', value: email.to || 'person@example.test'},
      {name: 'Subject', value: email.subject || ''}, {name: 'Date', value: date.toUTCString()}], body: {data: b64(email.body || '')}}};
}

export async function startGoogleFake({emails = []} = {}) {
  const stats = {token: 0, list: 0, read: 0, calendar: 0, armed: 0, failed: 0};   // armed / failed: the runner's check that a step's fault fired (lib/faults.mjs)
  let mode = 'pass';
  const now = Date.now();
  const messages = emails.map((email, i) => gmailMessage(`e2e${i + 1}`, email, new Date(now - (i + 1) * 3600000)));
  const server = http.createServer(async (req, res) => {
    for await (const chunk of req) void chunk;
    const url = new URL(req.url, 'http://x');
    const send = (status, data) => { const text = JSON.stringify(data); res.writeHead(status, {'content-type': 'application/json', 'content-length': Buffer.byteLength(text)}); res.end(text); };
    if (url.pathname.startsWith('/oauth2.googleapis.com/token')) {
      stats.token++;
      if (mode === 'revoked') { stats.failed++; markPlanted('google revoked'); }
      return mode === 'revoked' ? send(400, {error: 'invalid_grant', error_description: 'Token has been expired or revoked.'}) : send(200, {access_token: 'e2e-access', expires_in: 3600, token_type: 'Bearer'});
    }
    const read = /^\/gmail\.googleapis\.com\/gmail\/v1\/users\/me\/messages\/([^/]+)$/.exec(url.pathname);
    if (read) { stats.read++; const found = messages.find(item => item.id === read[1]); return found ? send(200, found) : send(404, {error: {code: 404, message: 'Not Found'}}); }
    if (url.pathname === '/gmail.googleapis.com/gmail/v1/users/me/messages') { stats.list++; return send(200, {messages: messages.map(item => ({id: item.id, threadId: item.id})), resultSizeEstimate: messages.length}); }
    if (url.pathname === '/gmail.googleapis.com/gmail/v1/users/me/profile') return send(200, {emailAddress: 'person@example.test', messagesTotal: messages.length});
    if (/^\/www\.googleapis\.com\/calendar\/v3\/calendars\/[^/]+\/events$/.test(url.pathname)) { stats.calendar++; return send(200, {items: []}); }
    return send(404, {error: {code: 404, message: `e2e fake: no ${url.pathname}`}});
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {url: `http://127.0.0.1:${server.address().port}`, stats, count: messages.length,
    revoke: () => { stats.armed++; mode = 'revoked'; }, pass: () => { mode = 'pass'; },
    close: () => { server.closeAllConnections?.(); return new Promise(resolve => server.close(resolve)); }};
}
