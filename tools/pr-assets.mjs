// Publishes PR screenshots under a git tag (never a release: a release can become "Latest") and prints their raw URLs:
// node tools/pr-assets.mjs <tag, e.g. pr-assets-<branch>> <file.png>... [--repo=<owner/repo>]
// The images are hosted in the repo that owns the PR: --repo (or GITHUB_REPOSITORY) names it; a PR in the private site repo uses --repo=GarryOne/jobadabra-web.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {publishFiles} from '../desktop/e2e/lib/evidence.mjs';

export function parseArgs(argv, env = {}) {
  const repoFlag = argv.find(arg => arg.startsWith('--repo='));
  const [tag, ...files] = argv.filter(arg => !arg.startsWith('--repo='));
  return {tag, files, repo: repoFlag ? repoFlag.slice('--repo='.length) : env.GITHUB_REPOSITORY || 'GarryOne/jobadabra'};
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const {tag, files, repo} = parseArgs(process.argv.slice(2), process.env);
  if (!tag || !files.length || !/^[^/\s]+\/[^/\s]+$/.test(repo)) { console.error('usage: node tools/pr-assets.mjs <tag, e.g. pr-assets-<branch>> <file.png>... [--repo=<owner/repo>]'); process.exit(2); }
  const out = publishFiles({repo, tag, message: `PR images ${tag}`, files: files.map(from => ({from, to: path.basename(from)})), remote: `https://github.com/${repo}.git`});
  for (const url of Object.values(out)) console.log(url);   // the tag may carry a number when its name was taken
}
