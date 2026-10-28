"""Checks that a PR description is laid out by tools/pr-body-format.py (owner, 16 Oct 2026: "this PR description missed our rules: didn't add separators,
didn't use headings"). #1043's body was replaced with `gh pr edit --body-file` on a raw summary, which skips the formatter that tools/ship.sh runs.
Reads the body on stdin; exit 1 naming what is missing. Run by the step "PR description laid out" of .github/workflows/pr-gate.yml on every opened, pushed or edited PR. Guard: tests/test_pr_body.py."""
import importlib.util
import os
import re
import sys

FIX = 'lay it out with tools/pr-body.sh <base> --body=<summary> (ship.sh does it), never a raw `gh pr edit --body-file`'


def missing(body):
    lines = [line for line in body.replace('\r\n', '\n').split('\n')]
    first = next((line for line in lines if line.strip()), '')
    out = []
    if not first.startswith('## '):
        out.append('the verdict line is not a "## " heading')
    if not any(re.match(r'^-{3,}\s*$', line) for line in lines):
        out.append('no "---" separator between sections')
    if not any(line.startswith('### ') for line in lines):
        out.append('no "### " section heading (Impact, What changed, Before → After)')
    spec = importlib.util.spec_from_file_location('pr_screens', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'pr-screens.py'))
    screens = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(screens)
    out += screens.problems(body)   # every image in a | What changed | Before | After | row (tools/pr-screens.py)
    return out


TAG_FIX = 'the title starts with the opening session\'s tag, e.g. "[75] Fix the thing": tools/ship.sh adds it (re-run it), or `gh pr edit <n> --title "[xx] <title>"`'


def title_gap(title):
    """21 Oct 2026: site#18 and #19 had no "[xx] " tag (opened or retitled by hand). PR_TITLE is set by pr-gate.yml / the site's tests.yml (empty for a bot's PR: no check)."""
    return None if not title or re.match(r'^\[[^\]]+\] \S', title) else f'the PR title "{title}" has no "[xx] " session tag: {TAG_FIX}'


STEP = re.compile(r'^\[[^\]]+\] (\d+)/(\d+) \S')
PLAN_ROWS = ('Done', 'This PR', 'Left')


def plan_gap(title, body):
    """A PR from a plan says where the plan stands. Why (owner, 28 Oct 2026, relayed by fl): "When we follow a plan, we should know from the beginning the name
    of the PRs, and we should show in the PR title 2/5 or 3/5... Also, we should have a short section in the PR body describing the overall progress on the plan.
    What's done, what's left." A title "[xx] n/N <what>" needs the "Plan progress" block of tools/pr-body-template.md: the plan's path and Done / This PR / Left rows."""
    step = STEP.match(title or '')
    if not step:
        return None
    n, total = int(step.group(1)), int(step.group(2))
    if not 1 <= n <= total:
        return f'the title says {n}/{total}: n must be between 1 and N'
    if 'Plan progress' not in body:
        return f'the title says {n}/{total} but the body has no "Plan progress" block (tools/pr-body-template.md)'
    gaps = [row for row in PLAN_ROWS if not re.search(rf'^\|[^|\n]*\b{row}\b[^|\n]*\|', body, re.M)]
    if not re.search(r'docs/superpowers/(plans|specs)/\S+\.md', body):
        gaps.append('the plan\'s path (docs/superpowers/plans/... or the spec with its PR list)')
    return f'"Plan progress" is missing: {", ".join(gaps)} (tools/pr-body-template.md)' if gaps else None


if __name__ == '__main__':
    text = sys.stdin.read()
    gaps = missing(text)
    gap = title_gap(os.environ.get('PR_TITLE', '').strip()) or plan_gap(os.environ.get('PR_TITLE', '').strip(), text)
    if gap:
        print('pr-title: ' + gap, file=sys.stderr)
        sys.exit(1)
    if gaps:
        print('pr-description: ' + '; '.join(gaps) + ': ' + FIX, file=sys.stderr)
        sys.exit(1)
    print('pr-description: laid out (headings and separators)')
