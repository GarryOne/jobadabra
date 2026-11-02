// Preloaded by `npm test` (node --import): no unit test may reach the live site. On 9 Oct 2026 every test run (131 on CI in a day, plus
// every local run) minted fresh installs through questions.collect -> aliases.lookup, ~260 installs a day, and used half of Cloudflare KV's
// 1,000 free writes a day. The request is refused and its test file fails, so a new caller shows up at once instead of in an alert email.
// Guarded by this file itself: a test that needs the site passes its own fetcher/base.
const real = globalThis.fetch;
let hits = 0;
globalThis.fetch = async (input, init) => {
  const url = String(input?.url || input);
  if (/(?:jobpilotto|jobadabra)\.(?:workers\.dev|top)/.test(url)) {
    hits += 1;
    console.error(`[no-live-site] a test reached the live site: ${new URL(url).pathname} (pass a fetcher/base, or settings telemetry:false)`);
    throw new Error('tests must not reach the live site');
  }
  return real(input, init);
};
process.on('exit', () => { if (hits && !process.exitCode) process.exitCode = 1; });
