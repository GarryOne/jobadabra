// Where crash reports and usage events go (config/analytics.json, overridden by env). Everything empty = nothing is sent. The DSN and the
// PostHog key are public by design: they only let a client send events to those projects.
import fs from 'node:fs';
import path from 'node:path';

export function load(repo, env = process.env) {
  let file = {};
  try { file = JSON.parse(fs.readFileSync(path.join(repo, 'config', 'analytics.json'), 'utf8')); } catch { /* no file: off */ }
  return {
    sentryDsn: String(env.JOBADABRA_SENTRY_DSN ?? file.sentry_dsn ?? '').trim(),
    posthogKey: String(env.JOBADABRA_POSTHOG_KEY ?? file.posthog_key ?? '').trim(),
    posthogHost: String(env.JOBADABRA_POSTHOG_HOST ?? file.posthog_host ?? 'https://eu.i.posthog.com').trim().replace(/\/+$/, ''),
  };
}
