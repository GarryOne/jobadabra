// CI on Free AI's two checks (owner, 26 Oct 2026: "Let's just switch to Free AI"). The gate checks CI's Workers AI token once with Cloudflare's free verify call
// (key-preflight.mjs); each suite asks the relay on its runner one tiny question in the app's own shape, so a broken relay stops the suite named, before any step.
// Guarded by test/free-ai-check.test.mjs.
const VERIFY = 'https://api.cloudflare.com/client/v4/user/tokens/verify';

// A down network is not a verdict on the token: only Cloudflare's own answer stops the run.
export async function checkFreeToken({token, fetchImpl = fetch}) {
  if (!token) return;
  let answer;
  try { answer = await fetchImpl(VERIFY, {headers: {authorization: `Bearer ${token}`}, signal: AbortSignal.timeout(15000)}); } catch { return; }
  const body = await answer.json().catch(() => ({}));
  if (answer.status >= 400 || body?.result?.status !== 'active') throw new Error(`CI_FREE_AI_CF_TOKEN is not an active Cloudflare token (${answer.status}, ${body?.result?.status || 'no status'}): replace the secret before the next run`);
}

// The relay is on this runner: no answer means its start failed (its log is the step "Free AI relay" above).
export async function checkRelay({url, key, fetchImpl = fetch}) {
  let answer;
  try {
    answer = await fetchImpl(`${url}/v1/messages`, {method: 'POST', headers: {'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json'},
      body: JSON.stringify({model: 'claude-haiku-5-5', max_tokens: 16, messages: [{role: 'user', content: 'Answer ok.'}]}), signal: AbortSignal.timeout(60000)});
  } catch (error) { throw new Error(`the Free AI relay at ${url} is not answering (${error.message}): see the "Free AI relay" step's log`); }
  if (answer.status >= 400) {
    const said = await answer.json().then(body => String(body?.error?.message || '').slice(0, 160)).catch(() => '');
    throw new Error(`the Free AI relay refused its first question (${answer.status}): "${said}"`);
  }
}
