// Shared local-server protocol helpers; headers and bodies stay separate to preserve callback ordering.
import {extensionToken} from './server-env.js';

export const POST_CORS = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type'};

// -> whether the request carries this installation's extension token.
export function hasToken(req, storage) {
  return req.headers.authorization === `Bearer ${extensionToken(storage)}`;
}

// -> a JSON value, or the original empty-object fallback for an absent or malformed body.
export function jsonPayload(body) {
  try { return JSON.parse(body?.toString() || '{}'); } catch { return {}; }
}

// Write the JSON headers before invoking handlers that may await or throw.
export function jsonHeaders(res, status, cors = {}) {
  res.writeHead(status, {'Content-Type': 'application/json', ...cors});
}

// Write the JSON body after the route has performed its original intervening effects.
export function jsonBody(res, value) {
  res.end(JSON.stringify(value));
}

// -> true after answering an unauthenticated preflight, false for all other methods.
export function preflight(req, res, cors) {
  if (req.method !== 'OPTIONS') return false;
  res.writeHead(204, cors); res.end(); return true;
}

// -> null after preflight, else token access and the parsed JSON payload ({} for an absent or malformed body).
export function tokenRequest(req, res, body, storage, cors = POST_CORS) {
  if (preflight(req, res, cors)) return null;
  return {
    ok: hasToken(req, storage),
    payload: jsonPayload(body),
  };
}
