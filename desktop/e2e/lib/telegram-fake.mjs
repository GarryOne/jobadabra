// A fake Telegram Bot API for the end-to-end tests (5 Oct 2026): the app and the engine send here instead of Telegram (JOBADABRA_E2E_TELEGRAM_BASE_URL, test runs
// only), so a suite can read the digest a person would receive and make Telegram refuse a send. getUpdates answers "nothing new" at once; nothing reaches Telegram.
// Job: serve stored answers
import http from 'node:http';
import {markPlanted} from './planted.mjs';

export const TELEGRAM_FAILURES = {
  'unauthorized': {status: 401, description: 'Unauthorized'},
  'blocked': {status: 403, description: 'Forbidden: bot was blocked by the user'},
  'rate-limit': {status: 429, description: 'Too Many Requests: retry after 1', retry: 1},
  'server-error': {status: 500, description: 'Internal Server Error'},
};

// The body of a call, JSON or form-encoded (the engine posts a form, the app JSON).
export function fields(contentType, raw) {
  if (/json/.test(contentType || '')) { try { return JSON.parse(raw || '{}'); } catch { return {}; } }
  return Object.fromEntries(new URLSearchParams(raw || ''));
}

export async function startTelegramFake() {
  const sent = [];
  const stats = {armed: 0, failed: 0};   // the runner's check that a step's fault fired (lib/faults.mjs)
  let mode = 'pass';
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const method = /\/bot[^/]+\/(\w+)/.exec(req.url || '')?.[1] || '';
    const body = fields(req.headers['content-type'], Buffer.concat(chunks).toString('utf8'));
    const answer = (status, data) => { const text = JSON.stringify(data); res.writeHead(status, {'content-type': 'application/json', 'content-length': Buffer.byteLength(text)}); res.end(text); };
    const failure = TELEGRAM_FAILURES[mode];
    if (failure && /^(sendMessage|sendDocument|sendPhoto|editMessageText)$/.test(method)) return stats.failed++, markPlanted(`telegram ${mode}`), answer(failure.status, {ok: false, error_code: failure.status, description: failure.description, ...(failure.retry ? {parameters: {retry_after: failure.retry}} : {})});
    if (method === 'getMe') return answer(200, {ok: true, result: {id: 1, is_bot: true, first_name: 'E2E bot', username: 'e2e_test_bot'}});
    if (method === 'getUpdates') return answer(200, {ok: true, result: []});
    if (method === 'sendMessage') {
      sent.push({chat: String(body.chat_id || ''), text: String(body.text || ''), markup: body.reply_markup || null, at: Date.now()});
      return answer(200, {ok: true, result: {message_id: sent.length, chat: {id: Number(body.chat_id) || 0}, text: body.text}});
    }
    return answer(200, {ok: true, result: true});   // answerCallbackQuery, editMessage…, setMyCommands, deleteWebhook
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {url: `http://127.0.0.1:${server.address().port}`, sent, stats,
    fail: name => { if (!TELEGRAM_FAILURES[name]) throw new Error(`unknown Telegram failure: ${name}`); stats.armed++; mode = name; }, pass: () => { mode = 'pass'; },
    close: () => { server.closeAllConnections?.(); return new Promise(resolve => server.close(resolve)); }};
}

// What a digest a person receives must never carry: an empty or technical message, a job line without its link, a message Telegram would refuse (over 4096 characters).
export function digestProblems(text) {
  const problems = [];
  const plain = String(text || '').replace(/<[^>]+>/g, '');
  if (!/^✈️/.test(plain.trim())) problems.push('it does not start with the digest header');
  if (/\bundefined\b|\bnull\b|\[object Object\]|NaN|Traceback|"type":\s*"error"/.test(plain)) problems.push('technical text in the message');
  if (String(text).length > 4096) problems.push(`${String(text).length} characters: Telegram refuses more than 4096`);
  const items = plain.split('\n').filter(line => /^\s*\d+\.\s/.test(line));
  if (/top \d+ of [1-9]/i.test(plain) && !items.length) problems.push('the header promises jobs but none is listed');
  return problems;
}
