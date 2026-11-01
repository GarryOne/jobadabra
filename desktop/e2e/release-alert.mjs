// Tells the owner on Telegram ("Jobadabra · CI alerts") the moment a new version is released, beta or stable, with links to the release and the commit it was built from.
//   node release-alert.mjs <beta|stable> <tag> [--lanes "Mac=success,Windows=success"]      (GITHUB_REPOSITORY, GITHUB_SERVER_URL, GITHUB_RUN_ID, GH_TOKEN, CI_ALERTS_TELEGRAM_BOT_TOKEN + _CHAT_ID from the runner)
// Why (1 Nov 2026, owner: "I'd like to receive on Telegram, CI Alerts, when a new version (beta or stable) is released"): a release was only visible on the Releases page; the beta's last job and
// tools/release-stable.sh (every way a build becomes stable) call this once per release. A lookup or a send that fails prints one line and never fails the release.
// Job: report health
import path from 'node:path';
import {alertHtml} from './lib/telegram-html.mjs';
import {send} from './ci-alert.mjs';

const KINDS = {
  beta: {icon: '🧪', word: 'Beta', verdict: 'Offered to beta testers'},
  stable: {icon: '🚀', word: 'Stable', verdict: 'Every app offers it within 10 minutes'},
};

/** "Mac=success,Windows=failure" -> [['Mac','success'],['Windows','failure']]. */
export const parseLanes = text => String(text || '').split(',').map(one => one.split('=').map(part => part.trim())).filter(([name, result]) => name && result);

/** The commit a tag points to, from the GitHub API -> {sha, subject, date} or null when it cannot be read. */
export async function commitOf(tag, env = process.env, fetcher = fetch) {
  try {
    const answer = await fetcher(`${env.GITHUB_API_URL || 'https://api.github.com'}/repos/${env.GITHUB_REPOSITORY}/commits/${encodeURIComponent(tag)}`,
      {headers: {Authorization: `Bearer ${env.GH_TOKEN || ''}`, Accept: 'application/vnd.github+json'}, signal: AbortSignal.timeout(15000)});
    if (!answer.ok) return null;
    const body = await answer.json();
    return body.sha ? {sha: body.sha, subject: String(body.commit?.message || '').split('\n')[0], date: body.commit?.committer?.date || ''} : null;
  } catch { return null; }
}

/** Whether the tag's release is still a pre-release: true, false, or null when GitHub cannot say (then a beta alert is sent, never suppressed on a guess). */
export async function isPrerelease(tag, env = process.env, fetcher = fetch) {
  try {
    const answer = await fetcher(`${env.GITHUB_API_URL || 'https://api.github.com'}/repos/${env.GITHUB_REPOSITORY}/releases/tags/${encodeURIComponent(tag)}`,
      {headers: {Authorization: `Bearer ${env.GH_TOKEN || ''}`, Accept: 'application/vnd.github+json'}, signal: AbortSignal.timeout(15000)});
    if (!answer.ok) return null;
    const body = await answer.json();
    return typeof body.prerelease === 'boolean' ? body.prerelease : null;
  } catch { return null; }
}

/** The Telegram message: what was released (kind, version), its release page, the commit, and for a beta which lanes released. */
export function releaseMessage({kind, tag, commit = null, lanes = [], env = process.env}) {
  const {icon, word, verdict} = KINDS[kind];
  const server = env.GITHUB_SERVER_URL || 'https://github.com', repo = env.GITHUB_REPOSITORY || '';
  const version = String(tag).replace(/^desktop-v/, '');
  const run = env.GITHUB_RUN_ID && repo ? `${server}/${repo}/actions/runs/${env.GITHUB_RUN_ID}` : '';
  const released = lanes.filter(([, result]) => result === 'success').map(([name]) => name), missed = lanes.filter(([, result]) => result !== 'success').map(([name]) => name);
  const said = kind === 'beta' && lanes.length ? (missed.length ? `Offered on ${released.join(' and ')} only; ${missed.join(' and ')} was not offered` : `${verdict} on ${released.join(' and ')}`) : verdict;
  const when = commit?.date ? new Date(commit.date).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '';
  return alertHtml({icon: missed.length ? '⚠️' : icon, title: `${word} ${version} released`, verdict: said,
    bullets: [
      {label: 'Release', parts: [repo ? {text: tag, url: `${server}/${repo}/releases/tag/${tag}`} : tag]},
      ...(commit ? [{label: 'Commit', parts: [{text: commit.sha.slice(0, 7), url: `${server}/${repo}/commit/${commit.sha}`}, ` ${commit.subject}`]}] : []),
      ...(when ? [{label: 'Committed', parts: [when]}] : [])],
    links: run ? [{text: 'Open the run', url: run}] : []});
}

/** Looks the commit up, sends the alert; returns the line to print. Never throws, never prints the token. */
export async function alertRelease({kind, tag, lanes = [], env = process.env, fetcher = fetch}) {
  if (!KINDS[kind] || !tag) return 'release-alert: nothing to send (needs beta|stable and a tag)';
  // Why (1 Nov 2026, Gitar on #2923): with the soak off the offer jobs promote straight to stable, and release-stable.sh has already said "Stable"; a second "Beta" message for the same tag is wrong and a duplicate.
  if (kind === 'beta' && await isPrerelease(tag, env, fetcher) === false) return 'release-alert: not sent (already stable: the stable alert covers it)';
  return send(releaseMessage({kind, tag, commit: await commitOf(tag, env, fetcher), lanes, env}), env, fetcher);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const [kind, tag, ...rest] = process.argv.slice(2);
  const at = rest.indexOf('--lanes');
  console.log(await alertRelease({kind, tag, lanes: at >= 0 ? parseLanes(rest[at + 1]) : []}));
}
