// The nightly smoke pool as a second, labelled source for the form-filling learning loop (docs/superpowers/specs/2026-10-10-pool-feeds-learning.md): one fill card
// per form reached, built by the SAME fillCard()/causeOf as a user's, sent to the same POST /api/controls with source 'pool' and the owner's key. Fixed words and
// counts only: never a field label, an answer, a posting address or a host (only the board name, a known board or a short hash). Same guard as the applying report:
// never from CI, a control run on an old build, or JP_NO_REPORT. Guard: test/pool-card.test.mjs.
import crypto from 'node:crypto';
import {fillCard, cleanCard} from '../../../extension/fill-card.js';
import {boardName} from '../../lib/control-events.js';
import {extensionVersion, ownerKey, skipReason} from './applying-report.mjs';

export const CONTROLS = 'https://www.jobpilotto.top/api/controls';
const INSTALL = 'pool-qa-smoke';   // not a real install: the site counts pool cards by source, never by this

// The host where the journey ended, from the flow signature `kinds@host#step` ('' when there is none).
export const endHost = signature => (String(signature || '').match(/@([a-z0-9.-]+)#/) || [])[1] || '';

// -> the card to send, or null when no form was reached or no fields were read (nothing to learn from).
export function poolCard(shape, result, {day, version = extensionVersion()} = {}) {
  if (!['form', 'ready'].includes(result?.reached) || !(result.fieldList || []).length) return null;
  const trace = result.fieldList.map(({label, type, required, outcome, reason}) => ({label, type, required: required !== false, outcome, reason}));
  const card = fillCard({id: `pool-${day}-${crypto.createHash('sha256').update(String(shape)).digest('hex').slice(0, 8)}`, trace, kit: false, useAI: true, version});
  const host = endHost(result.signature);
  const clean = cleanCard({...card, ai: 'none', seconds: 0});
  return clean && host ? {...clean, board: boardName(host), source: 'pool'} : null;
}

// -> a one-line outcome for the run's own output; never throws.
export async function sendPoolCard(card, {env = process.env, key, fetcher = fetch} = {}) {
  const why = skipReason(env);
  if (why) return `pool card: not sent (${why})`;
  if (!card) return 'pool card: none (no form fields read)';
  const token = ownerKey(key);
  if (!token) return 'pool card: not sent (no site key in the Keychain)';
  try {
    const answer = await fetcher(CONTROLS, {method: 'POST', headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
      body: JSON.stringify({install: INSTALL, cards: [card]}), signal: AbortSignal.timeout(20000)});
    return answer.ok ? `pool card: sent (${card.board}, ${card.left} of ${card.required} required left)` : `pool card: refused (${answer.status})`;
  } catch (error) { return `pool card: not sent (${String(error?.message || error).slice(0, 80)})`; }
}
