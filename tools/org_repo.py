"""Keeps every repo of the jobadabra GitHub org on the same setup (owner, 2 Nov 2026: "they should have the same PR Body, the same GH labels... the same workflow"; "One script + weekly check").
One source: templates/org-repo/ (settings.json, ruleset.json, profiles.json and the workflow files). `tools/org-repo.sh` runs this file.

  org-repo.sh files <repo> <clone-dir>   write the repo's workflow files into a clone (then ship it as a PR with tools/ship.sh)
  org-repo.sh settings <repo>            squash-only merges, delete branch on merge, auto-merge allowed
  org-repo.sh ruleset <repo>             the "All checks passed" ruleset; refused until that check exists on the default branch (owner, 2 Nov 2026: "ruleset per repo after its check exists")
  org-repo.sh onboard <repo> <clone-dir> files + settings, and the ruleset when its check is already on the default branch
  org-repo.sh check [repo...] [--issue]  report every difference from the templates (all repos of the org by default); --issue keeps ONE issue in jobadabra/jobadabra: opened or
                                         updated while a repo drifts, closed when none does (exit 0 then: the issue is the report). Without --issue: exit 1 when something drifts.
Writes take --dry-run (print the request, send nothing). Needs `gh` with admin rights on the org's repos for settings and rulesets. Guard: tests/test_org_repo.py."""
import argparse
import base64
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TEMPLATES = ROOT / 'templates' / 'org-repo'
ORG = 'jobadabra'
ISSUE_REPO, ISSUE_TITLE = f'{ORG}/jobadabra', 'Org repos drift from the shared setup'
WORKFLOWS = '.github/workflows'
UNVERIFIED = []   # what the last check could not read with this token; cmd_check prints it once


class NotFound(Exception):
    """The API answered 404 (a file, ruleset or repo that is not there)."""


def api(method, path, data=None):
    """One GitHub REST call through `gh api`; JSON in, parsed JSON out; raises NotFound on a 404."""
    command = ['gh', 'api', '-X', method, path] + (['--input', '-'] if data is not None else [])
    done = subprocess.run(command, input=json.dumps(data) if data is not None else None, capture_output=True, text=True)
    if done.returncode:
        if '404' in done.stderr or 'Not Found' in done.stderr:
            raise NotFound(path)
        raise SystemExit(f'gh api {method} {path} failed: {done.stderr.strip()[:300]}')
    return json.loads(done.stdout) if done.stdout.strip() else None


def template_json(name):
    """-> the parsed templates/org-repo/<name> (settings.json, ruleset.json, profiles.json); the one source of the desired setup. Raises if the file is missing."""
    return json.loads((TEMPLATES / name).read_text(encoding='utf-8'))


def files_for(repo):
    """The workflow files a repo gets, from profiles.json (jobadabra: none, it is their source; web: the two labels; everyone else: all three)."""
    profiles = template_json('profiles.json')
    return profiles.get(repo, profiles['default'])


def normalize(text):
    """A workflow without comments and blank lines: two files that differ only in comments are the same setup."""
    lines = [re.sub(r'\s+#\s.*$', '', line).rstrip() for line in text.replace('\r\n', '\n').split('\n') if not line.lstrip().startswith('#')]
    return '\n'.join(line for line in lines if line.strip())


def subset_gaps(want, have, where=''):
    """What `want` (the template) asks for that `have` (the API's answer) does not show; extra keys in `have` are the API's defaults and are ignored."""
    if isinstance(want, dict):
        gaps = []
        for key, value in want.items():
            if not isinstance(have, dict) or key not in have:
                gaps.append(f'{where}{key} is missing')
            else:
                gaps += subset_gaps(value, have[key], f'{where}{key}.')
        return gaps
    return [] if want == have else [f'{where.rstrip(".")} is {have!r}, should be {want!r}']


def ruleset_gaps(want, have):
    """The differences between the template ruleset and a repo's: enforcement, branch, bypass actors (exactly), and each rule's own parameters."""
    gaps = subset_gaps({k: want[k] for k in ('name', 'target', 'enforcement', 'conditions')}, have)
    actors = lambda body: sorted((a['actor_type'], a['actor_id'], a['bypass_mode']) for a in body.get('bypass_actors', []))
    # Why (2 Nov 2026, Gitar on #2945): GitHub documents bypass_actors as returned only to a requester with write access. The org's Administration-read token does see it (measured), but a token that does not gets no key at all: that is "cannot verify"
    # (a note, see UNVERIFIED), never an empty list, or every repo would drift for ever. A key that IS returned must match exactly (an extra bypass is drift too).
    if 'bypass_actors' not in have:
        UNVERIFIED.append('bypass actors are not shown to this token (this token cannot read them)')
    elif actors(want) != actors(have):
        gaps.append(f'bypass actors are {actors(have)}, should be {actors(want)}')
    have_rules = {rule['type']: rule for rule in have.get('rules', [])}
    for rule in want['rules']:
        if rule['type'] not in have_rules:
            gaps.append(f'rule {rule["type"]} is missing')
            continue
        params = rule.get('parameters') or {}
        if rule['type'] == 'required_status_checks':
            contexts = lambda body: sorted(c['context'] for c in (body.get('parameters') or {}).get('required_status_checks', []))
            if contexts(rule) != contexts(have_rules[rule['type']]):
                gaps.append(f'required checks are {contexts(have_rules[rule["type"]])}, should be {contexts(rule)}')
            params = {k: v for k, v in params.items() if k != 'required_status_checks'}
        gaps += [f'rule {rule["type"]}: {gap}' for gap in subset_gaps(params, have_rules[rule['type']].get('parameters') or {})]
    return gaps


def default_file(repo, branch, name):
    """The text of .github/workflows/<name> on the repo's default branch, or None."""
    try:
        found = api('GET', f'repos/{ORG}/{repo}/contents/{WORKFLOWS}/{name}?ref={branch}')
    except NotFound:
        return None
    return base64.b64decode(found['content']).decode('utf-8')


def find_ruleset(repo):
    """-> the id of the repo's ruleset named like templates/org-repo/ruleset.json, or None when it has none (a 404 on the repo raises NotFound)."""
    name = template_json('ruleset.json')['name']
    for listed in api('GET', f'repos/{ORG}/{repo}/rulesets') or []:
        if listed['name'] == name:
            return listed['id']
    return None


def check_repo(repo):
    """-> the list of differences between one repo and the templates (empty = on the shared setup)."""
    info = api('GET', f'repos/{ORG}/{repo}')
    # Why (2 Nov 2026, mac-07 measured the org's Administration-read token): the merge settings come back null to it. null is "cannot read", a note, never drift; a real value must match.
    wanted = template_json('settings.json')
    unreadable = sorted(key for key in wanted if info.get(key) is None)
    if unreadable:
        UNVERIFIED.append(f'settings {", ".join(unreadable)} are not shown to this token (null)')
    gaps = [f'settings: {gap}' for gap in subset_gaps({k: v for k, v in wanted.items() if k not in unreadable}, info)]
    ruleset_id = find_ruleset(repo)
    if ruleset_id is None:
        gaps.append(f'no ruleset "{template_json("ruleset.json")["name"]}"')
    else:
        gaps += [f'ruleset: {gap}' for gap in ruleset_gaps(template_json('ruleset.json'), api('GET', f'repos/{ORG}/{repo}/rulesets/{ruleset_id}'))]
    for name in files_for(repo):
        text = default_file(repo, info['default_branch'], name)
        if text is None:
            gaps.append(f'{WORKFLOWS}/{name} is missing')
        elif normalize(text) != normalize((TEMPLATES / name).read_text(encoding='utf-8')):
            gaps.append(f'{WORKFLOWS}/{name} differs from templates/org-repo/{name}')
    return gaps


def org_repos():
    """-> the names of the org's active repos (archived ones and profiles.json "exclude" left out), read from the GitHub API."""
    return [r['name'] for r in api('GET', f'orgs/{ORG}/repos?type=all&per_page=100') if not r.get('archived') and r['name'] not in template_json('profiles.json').get('exclude', [])]


def keep_issue(drift, dry, notes=None):
    """One open issue while any repo drifts (updated in place), closed when none does."""
    open_issues = []
    for page in range(1, 11):   # Why (2 Nov 2026, Gitar on #2949): one page of 100 loses the report issue once 100 newer issues/PRs are open, and a duplicate would open every week
        listed = api('GET', f'repos/{ISSUE_REPO}/issues?state=open&per_page=100&page={page}')
        open_issues += [i for i in listed if i['title'] == ISSUE_TITLE and 'pull_request' not in i]
        if len(listed) < 100:
            break
    unseen = '\n'.join(f'- {repo}: {note}' for repo, found in sorted((notes or {}).items()) for note in found)
    body = '\n'.join(f'- **{repo}**: {gap}' for repo, gaps in sorted(drift.items()) for gap in gaps) + (f'\n\n**Not verified with this token** (not drift):\n{unseen}' if unseen else '') + '\n\nFix: `tools/org-repo.sh onboard <repo> <clone>` (files + settings) and `tools/org-repo.sh ruleset <repo>`; the weekly check closes this issue when nothing drifts.'
    if dry:
        print(f'issue: would {"update/open" if drift else "close"}: {ISSUE_TITLE}')
    elif drift and open_issues:
        api('PATCH', f'repos/{ISSUE_REPO}/issues/{open_issues[0]["number"]}', {'body': body})
    elif drift:
        api('POST', f'repos/{ISSUE_REPO}/issues', {'title': ISSUE_TITLE, 'body': body})
    else:
        for issue in open_issues:
            if unseen:   # Why (2 Nov 2026, Gitar on #2950): closing on a clean run must not read as "everything was checked"; the closing comment names what the token could not read
                api('POST', f'repos/{ISSUE_REPO}/issues/{issue["number"]}/comments', {'body': f'No drift in what this token can read. **Not verified with this token** (not drift):\n{unseen}'})
            api('PATCH', f'repos/{ISSUE_REPO}/issues/{issue["number"]}', {'state': 'closed', 'state_reason': 'completed'})


def cmd_check(args):
    """`check`: print every difference between the repos (all, or the named ones) and the templates; with --issue keep the one report issue. -> exit code (1 on drift without --issue)."""
    drift, notes = {}, {}
    for repo in args.repos or org_repos():
        UNVERIFIED.clear()
        gaps = check_repo(repo)
        if UNVERIFIED:
            notes[repo] = list(UNVERIFIED)
        for note in UNVERIFIED:
            print(f'note {repo}: {note}')
        for gap in gaps:
            print(f'drift {repo}: {gap}')
        if gaps:
            drift[repo] = gaps
    # Why (2 Nov 2026, Gitar on #2950): a token that cannot read a setting must never make the report say "every repo is on the shared setup"; the unread part is named in the line and in the issue.
    unseen = f'; not verified with this token in {len(notes)} repo(s): {", ".join(sorted(notes))}' if notes else ''
    print(f'org-repo: {len(drift)} repo(s) drift{unseen}' if drift else f'org-repo: no drift in what this token can read{unseen}' if notes else 'org-repo: every checked repo is on the shared setup')
    if args.issue:
        keep_issue(drift, args.dry_run, notes)
        return 0   # the issue is the report: a scheduled run is red only when the check itself failed (an API error exits non-zero)
    return 1 if drift else 0


def cmd_files(args):
    """`files`: write the repo's workflow files from the templates into the clone at args.clone, only those that differ. -> 0."""
    target = Path(args.clone) / WORKFLOWS
    if not args.dry_run:
        target.mkdir(parents=True, exist_ok=True)
    for name in files_for(args.repo):
        source = (TEMPLATES / name).read_text(encoding='utf-8')
        if not (target / name).exists() or normalize((target / name).read_text(encoding='utf-8')) != normalize(source):
            if not args.dry_run:
                (target / name).write_text(source, encoding='utf-8')
            print(f'{"would write" if args.dry_run else "wrote"} {WORKFLOWS}/{name}')
    return 0


def cmd_settings(args):
    """`settings`: PATCH the repo with templates/org-repo/settings.json (or print the request with --dry-run). -> 0; an API error exits non-zero."""
    if args.dry_run:
        print(f'PATCH repos/{ORG}/{args.repo} {json.dumps(template_json("settings.json"))}')
    else:
        api('PATCH', f'repos/{ORG}/{args.repo}', template_json('settings.json'))
        print(f'settings applied to {args.repo}')
    return 0


def check_exists(repo):
    """The ruleset requires "All checks passed": it must already run on the default branch, or the first PR could never merge. A repo with its own verdict job (no pr-checks.yml in its profile) has it."""
    if 'pr-checks.yml' not in files_for(repo):
        return True
    return default_file(repo, api('GET', f'repos/{ORG}/{repo}')['default_branch'], 'pr-checks.yml') is not None


def cmd_ruleset(args):
    """`ruleset`: create or update the repo's ruleset from the template. -> 0, or 2 (nothing written) while its "All checks passed" job is not on the default branch."""
    if not check_exists(args.repo):
        print(f'ruleset refused: {args.repo} has no {WORKFLOWS}/pr-checks.yml on its default branch yet (ship the files first)', file=sys.stderr)
        return 2
    body, existing = template_json('ruleset.json'), find_ruleset(args.repo)
    method, path = ('PUT', f'repos/{ORG}/{args.repo}/rulesets/{existing}') if existing else ('POST', f'repos/{ORG}/{args.repo}/rulesets')
    if args.dry_run:
        print(f'{method} {path} {json.dumps(body)}')
    else:
        api(method, path, body)
        print(f'ruleset {"updated" if existing else "created"} on {args.repo}')
    return 0


def cmd_onboard(args):
    """`onboard`: files + settings, then the ruleset when its check already exists on the default branch, else say what to ship first. -> the ruleset step's exit code."""
    cmd_files(args)
    cmd_settings(args)
    if check_exists(args.repo):
        return cmd_ruleset(args)
    print(f'ruleset waits: ship the files in {args.clone} (tools/ship.sh), then run `org-repo.sh ruleset {args.repo}`')
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(prog='org-repo.sh')
    sub = parser.add_subparsers(dest='command', required=True)
    for name, handler, positional in (('files', cmd_files, ['repo', 'clone']), ('settings', cmd_settings, ['repo']), ('ruleset', cmd_ruleset, ['repo']), ('onboard', cmd_onboard, ['repo', 'clone'])):
        p = sub.add_parser(name)
        for arg in positional:
            p.add_argument(arg)
        p.add_argument('--dry-run', action='store_true')
        p.set_defaults(handler=handler)
    p = sub.add_parser('check')
    p.add_argument('repos', nargs='*')
    p.add_argument('--issue', action='store_true')
    p.add_argument('--dry-run', action='store_true')
    p.set_defaults(handler=cmd_check)
    args = parser.parse_args(argv)
    return args.handler(args)


if __name__ == '__main__':
    sys.exit(main())
