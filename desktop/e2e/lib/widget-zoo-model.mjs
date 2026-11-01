// The zoo's --model route (widget-zoo.mjs): the stand-in app's /extension/account-judge answered like the app does for the fill ladder: phase "fill" by the REAL model (the app's plan-path
// client, lib/ladder-score-path.mjs; never an API key: assertNoApiSpend), any other phase by the form judge's canned "ready" so the page's own flow is unchanged. Verdicts are collected per
// page host for the runner's table. Guard: test/widget-zoo.test.mjs.
import {judgeFill} from '../../lib/ladder/fill-verify.js';
import {pickEngine} from './engine.mjs';
import {assertNoApiSpend} from './ladder-score.mjs';
import {scoringClient} from './ladder-score-path.mjs';

export async function modelRoute(shadow, {client, env = process.env} = {}) {
  if (!client) { assertNoApiSpend({env, engine: pickEngine({family: 'claude'})}); client = scoringClient(); }
  return async sent => {
    let body = {};
    try { body = JSON.parse(sent || '{}'); } catch { /* the canned answer */ }
    if (body.phase !== 'fill') return {ok: true, answer: 'ready', step: 'final'};
    const found = await judgeFill(client, body.sketch || {});
    let host = '';
    try { host = new URL(body.sketch?.url).hostname; } catch { /* no address */ }
    if (host && !found.error) shadow.set(host, found.verdicts.filter(row => row.verdict !== 'ok'));
    return found.error ? {ok: true, answer: '', error: found.error} : {ok: true, answer: 'shadow', verdicts: found.verdicts, counts: found.counts};
  };
}
