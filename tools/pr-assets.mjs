// Publishes PR screenshots under a git tag (never a release: a release can become "Latest") and prints their raw URLs:
// node tools/pr-assets.mjs <tag, e.g. pr-assets-<branch>> <file.png>... [--repo=<owner/repo>]
// The images are hosted in the repo that owns the PR: --repo (or GITHUB_REPOSITORY) names it; a PR in the private site repo uses --repo=GarryOne/jobadabra-web.
// The URL is github.com/<repo>/raw/<tag>/<file>, not raw.githubusercontent.com: measured 25 Oct 2026 on the private jobadabra-lab (a probe issue, opened in the browser),
// the raw.githubusercontent.com image did not render, the github.com/.../raw/... one did (for anyone who can open the repo, so also after jobadabra-web goes private on 1 Nov).
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {publishFiles} from '../desktop/e2e/lib/evidence.mjs';

// The image URL a PR body uses, for a public or a private repo.
export const imageUrl = (repo, tag, file) => `https://github.com/${repo}/raw/${tag}/${file.split('/').map(encodeURIComponent).join('/')}`;

export function parseArgs(argv, env = {}) {
  const repoFlag = argv.find(arg => arg.startsWith('--repo='));
  const [tag, ...files] = argv.filter(arg => !arg.startsWith('--repo='));
  return {tag, files, repo: repoFlag ? repoFlag.slice('--repo='.length) : env.GITHUB_REPOSITORY || 'GarryOne/jobadabra'};
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const {tag, files, repo} = parseArgs(process.argv.slice(2), process.env);
  if (!tag || !files.length || !/^[^/\s]+\/[^/\s]+$/.test(repo)) { console.error('usage: node tools/pr-assets.mjs <tag, e.g. pr-assets-<branch>> <file.png>... [--repo=<owner/repo>]'); process.exit(2); }
  const out = publishFiles({repo, tag, message: `PR images ${tag}`, files: files.map(from => ({from, to: path.basename(from)})), remote: `https://github.com/${repo}.git`});
  for (const [file, url] of Object.entries(out)) console.log(imageUrl(repo, url.split('/')[5], file));   // the tag may carry a number when its name was taken: read it back from the published URL
}
