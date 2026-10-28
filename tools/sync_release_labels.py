#!/usr/bin/env python3
"""Make the release list readable: every release's title says what it IS, and a pinned issue names the ones that matter.

    python3 tools/sync_release_labels.py            # relabel the releases and update the pinned "Release channels" issue
    python3 tools/sync_release_labels.py --dry-run  # print what would change

Titles get a prefix (GitHub has no way to pin a release; the only badge it gives is "Latest"):
    ✅ STABLE · …                  the Latest release: what every user gets
    🧪 BETA (release candidate) · …  a pre-release a platform's release gate approved (`Beta-approved:` or `Beta-approved (Windows):`): offered to people who switched the beta on,
                                   and soaking towards stable
    🔨 Build · …                   any other pre-release (every push and nightly makes one): not offered to anyone
    📦 Previous stable · …         a release that was stable once and was replaced: where a manual rollback goes (tools/release-stable.sh <tag>)
The pinned issue (label `release-channels`, GitHub allows pinning issues) lists the current stable, the beta, the previous stable and the newest builds, with links.
Run by canary-promote.yml every 8 hours and after an approval or a promotion; safe to run any time (it only edits what differs).
"""
import json
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from release_guard import desktop_only, is_desktop  # noqa: E402  (only desktop-v* releases are ever stable, 17 Oct 2026)

REPO = 'GarryOne/jobadabra'
STABLE, BETA, BUILD, PREVIOUS = '✅ STABLE', '🧪 BETA (release candidate)', '🔨 Build', '📦 Previous stable'
PREFIX = re.compile(r'^(?:✅ STABLE|🧪 BETA(?: \(release candidate\))?|🔨 Build|📦 Previous stable) · ')
ISSUE_TITLE = '📌 Release channels (kept up to date automatically)'
LABEL = 'release-channels'


def base_name(name):
    return PREFIX.sub('', name or '')


def state_of(release, approved):
    """'stable' | 'previous' | 'beta' | 'build' for one release (draft releases are left alone by the caller)."""
    if release.get('isLatest') and is_desktop(release.get('tagName')):
        return 'stable'
    if not release.get('isPrerelease'):
        return 'previous'
    return 'beta' if approved else 'build'


def desired_title(release, approved):
    prefix = {'stable': STABLE, 'previous': PREVIOUS, 'beta': BETA, 'build': BUILD}[state_of(release, approved)]
    return f"{prefix} · {base_name(release.get('name') or release['tagName'])}"


def channels_body(releases, approved, repo=REPO, builds=3):
    """Markdown for the pinned issue. `releases`: newest first (non-draft); `approved`: set of tags with the Beta-approved line."""
    link = lambda r: f"[{base_name(r.get('name') or r['tagName'])}](https://github.com/{repo}/releases/tag/{r['tagName']})"
    states = [(r, state_of(r, r['tagName'] in approved)) for r in releases]
    pick = lambda wanted: [r for r, s in states if s == wanted]
    stable = pick('stable')
    out = ['**What each kind of release is.** Only the first two are ever offered to a user.', '',
           '| | Release | Who gets it |', '|---|---|---|',
           f"| ✅ **Stable** | {link(stable[0]) if stable else 'none yet'} | everyone: the app updates itself to this |"]
    beta = pick('beta')
    out.append(f"| 🧪 **Beta (release candidate)** | {', '.join(link(r) for r in beta) if beta else 'none right now'} | only people who switched the beta on (Settings → Diagnostics → Beta); soaking towards stable |")
    previous = pick('previous')
    out.append(f"| 📦 **Previous stable** | {link(previous[0]) if previous else 'none'} | nobody; the version to roll back to if the stable one turns out bad (`tools/release-stable.sh <tag>`) |")
    # Only builds newer than the stable one: an older build can never become stable, so listing it only misleads (3 Oct 2026: 0.4 Alpha 253 beside stable 0.5.0).
    newer = [r for r, s in states[:states.index(next(item for item in states if item[1] == 'stable'))] if s == 'build'] if stable else pick('build')
    newest = newer[:builds]
    nothing = f"none since {base_name(stable[0].get('name') or stable[0]['tagName'])}" if stable else 'none'
    out.append(f"| 🔨 **Newest builds** | {', '.join(link(r) for r in newest) if newest else nothing} | nobody: every push and nightly makes one; it becomes Beta only after the release gate approves it |")
    out += ['', 'A build becomes **Beta** after the unit suites and every end-to-end suite pass on it with no real high-severity finding. It becomes **Stable** after three more green end-to-end runs over a day, no blocking finding, and (once there are testers) healthy beta use. See `RELEASE.md`.',
            '', '<sub>Updated by `tools/sync_release_labels.py`. Do not edit by hand.</sub>']
    return '\n'.join(out)


def _gh(*args):
    return subprocess.run(['gh', *args], capture_output=True, text=True, check=True).stdout


def main(argv):
    dry = '--dry-run' in argv
    releases = [r for r in json.loads(_gh('release', 'list', '-R', REPO, '-L', '40', '--json', 'name,tagName,isPrerelease,isLatest,isDraft')) if not r.get('isDraft')]
    releases = desktop_only(releases)   # a screenshot or other release is never relabelled, whatever GitHub calls it
    approved = set()
    for r in releases:
        if r.get('isPrerelease'):
            body = _gh('release', 'view', r['tagName'], '-R', REPO, '--json', 'body', '-q', '.body')
            if re.search(r'^Beta-approved(?: \(Windows\))?:', body, re.M):   # either platform's line: each is offered on its own
                approved.add(r['tagName'])
    changed = 0
    for r in releases:
        want = desired_title(r, r['tagName'] in approved)
        if want != r.get('name'):
            changed += 1
            print(f"{r['tagName']}: {r.get('name')!r} -> {want!r}")
            if not dry:
                _gh('release', 'edit', r['tagName'], '-R', REPO, '--title', want)
    body = channels_body(releases, approved)
    if dry:
        print(f"{changed} title(s) would change.\n\n{body}")
        return 0
    numbers = json.loads(_gh('issue', 'list', '-R', REPO, '--label', LABEL, '--state', 'open', '--json', 'number,id'))
    if numbers:
        number, node = numbers[0]['number'], numbers[0]['id']
        _gh('issue', 'edit', str(number), '-R', REPO, '--title', ISSUE_TITLE, '--body', body)
    else:
        _gh('label', 'create', LABEL, '-R', REPO, '--force', '--color', '0E8A16', '--description', 'The pinned list of the current releases')
        url = _gh('issue', 'create', '-R', REPO, '--title', ISSUE_TITLE, '--body', body, '--label', LABEL).strip()
        number = int(url.rsplit('/', 1)[1])
        node = json.loads(_gh('issue', 'view', str(number), '-R', REPO, '--json', 'id'))['id']
    try:   # already pinned, or three issues are pinned already: not an error worth failing a release for
        _gh('api', 'graphql', '-f', f'query=mutation {{ pinIssue(input: {{issueId: "{node}"}}) {{ issue {{ id }} }} }}')
    except subprocess.CalledProcessError:
        pass
    print(f"{changed} title(s) changed; channels issue #{number} updated.")
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
