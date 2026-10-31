"""Name a GitHub API rate limit, with its reset time, wherever CI meets one.

Why (31 Oct 2026, a8; beta 41226261602, owner: a limit must say so): the installation budget (5,000 REST calls an hour, shared by every workflow's
github.token) ran out at 18:01 UTC. `gh release upload` printed "release not found", beta_rate_gate.py exited 1 without a word, canary_promote.py
iterated GitHub's error object as a release list, and every PR verdict failed with a traceback. One recogniser and one message, used by all of them:

    GitHub API rate limit (403 … for installation), reset at 18:30:12 UTC

    python3 tools/github_limit.py explain "<what failed>"   a shell step that failed prints the limit if that is why (the rate_limit read is free)
"""
import json
import re
import subprocess
import sys
from datetime import datetime, timezone

LIMIT = re.compile(r'rate limit|abuse detection', re.I)


class GitHubLimit(RuntimeError):
    """GitHub refused a call because a rate limit is used up; the message names the limit and when it resets."""


def is_limit(text):
    """True when `text` (gh's stderr, or an error body's message) says a rate limit refused the call."""
    return bool(LIMIT.search(text or ''))


def read_rate(run=subprocess.run):
    """-> the `gh api rate_limit` answer as a dict, or None when it cannot be read. The call is free: it does not spend the budget it reports."""
    try:
        return json.loads(run(['gh', 'api', 'rate_limit'], capture_output=True, text=True, check=True).stdout)
    except Exception:
        return None


def limit_message(text, rate=None):
    """`text`: what GitHub said; `rate`: the rate_limit answer (None: unreadable) -> 'GitHub API rate limit (403 … for installation), reset at HH:MM:SS UTC'."""
    code = 429 if re.search(r'\b429\b|secondary', text or '', re.I) else 403
    scope = 'for installation' if 'installation' in (text or '') else 'for this token'
    reset = ((rate or {}).get('resources') or {}).get('core', {}).get('reset')
    when = f"reset at {datetime.fromtimestamp(reset, timezone.utc).strftime('%H:%M:%S')} UTC" if reset else 'reset time not readable'
    return f'GitHub API rate limit ({code} … {scope}), {when}'


def run_gh(*args, binary=False, run=subprocess.run, rate=read_rate):
    """Run `gh <args>` -> stdout. A rate-limit refusal raises GitHubLimit (named, with the reset); any other failure raises what it always did.
    `gh api` prints an error body on stdout, so both streams are read. binary=True: bytes out (an artifact ZIP)."""
    try:
        return run(['gh', *args], capture_output=True, text=not binary, check=True).stdout
    except subprocess.CalledProcessError as error:
        said = '\n'.join(part.decode('utf-8', 'replace') if isinstance(part, bytes) else (part or '') for part in (error.stderr, error.stdout))
        if is_limit(said):
            raise GitHubLimit(limit_message(said, rate())) from error
        raise


def expect_list(data, what, rate=read_rate):
    """`data`: parsed JSON that must be a list (a release list). GitHub's error object is never iterated as one: a limit raises GitHubLimit, anything else
    ValueError saying what GitHub answered."""
    if isinstance(data, list):
        return data
    said = data.get('message') if isinstance(data, dict) else None
    if is_limit(said):
        raise GitHubLimit(limit_message(said, rate()))
    raise ValueError(f'{what}: GitHub answered {said!r}, not a list' if said else f'{what}: expected a list, got {type(data).__name__}')


def explain(what, rate=read_rate):
    """A shell step `what` has failed: '::error::<what> failed: <the limit message>' when the core budget is spent, else '' (it was not the limit)."""
    answer = rate()
    core = ((answer or {}).get('resources') or {}).get('core') or {}
    if core.get('remaining') == 0:
        return f'::error::{what} failed: {limit_message("HTTP 403: API rate limit exceeded for installation", answer)}'
    return ''


def exit_code(run, what, rate=read_rate):
    """`run()` -> its return value. A rate-limit failure of a `gh` call (CalledProcessError) ends as one `::error::<what>: <limit message>` line on stderr and 1; any other failure raises as it always did.
    Why (31 Oct 2026, a8; CI run 41228178173): with the installation budget spent every PR verdict died in a traceback and the log never said when it would work again."""
    try:
        return run()
    except subprocess.CalledProcessError as error:
        said = '\n'.join(part.decode('utf-8', 'replace') if isinstance(part, bytes) else (part or '') for part in (error.stderr, error.stdout))
        if not is_limit(said):
            raise
        print(f'::error::{what}: {limit_message(said, rate())}', file=sys.stderr)
        return 1


def main(argv=None):
    args = sys.argv[1:] if argv is None else argv
    if len(args) == 2 and args[0] == 'explain':
        line = explain(args[1])
        if line:
            print(line)
        return 0
    print('usage: github_limit.py explain "<what failed>"', file=sys.stderr)
    return 2


if __name__ == '__main__':
    sys.exit(main())
