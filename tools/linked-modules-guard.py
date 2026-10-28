#!/usr/bin/env python3
"""Refuse an `npm ci/install/update` whose node_modules is a link into another checkout, before npm empties the folder it points at.
Run by tools/pre-push-check.sh (the project's PreToolUse Bash hook): reads the hook JSON on stdin, exit 2 with the way out on stderr.
Why (28 Oct 2026, mac-27): `npm ci` in a worktree wiped the shared desktop/node_modules that tools/worktree.sh links into every worktree; all lost lint and tests."""
import json
import os
import re
import shlex
import sys

INSTALLS = {'ci', 'install', 'i', 'add', 'update', 'up', 'uninstall', 'rebuild', 'dedupe', 'prune'}


def targets(command, cwd):
    """Each directory an npm install in `command` would write its node_modules into."""
    here = cwd
    for segment in re.split(r'&&|\|\||;|\n|\|', command):
        try:
            words = shlex.split(segment)
        except ValueError:
            words = segment.split()
        if words[:1] == ['cd'] and len(words) > 1:
            here = os.path.normpath(os.path.join(here, os.path.expanduser(words[1])))
            continue
        if 'npm' not in words:
            continue
        rest = words[words.index('npm') + 1:]
        prefix = None
        for flag in ('--prefix', '-C', '--workspace-root'):
            if flag in rest and rest.index(flag) + 1 < len(rest):
                prefix = rest[rest.index(flag) + 1]
        verb = next((w for w in rest if not w.startswith('-') and w != prefix), None)
        if verb in INSTALLS:
            yield os.path.normpath(os.path.join(here, prefix)) if prefix else here


def repo_dir(target):
    """The package dir relative to the checkout that holds it (the argument `tools/worktree.sh own-modules` takes)."""
    root = target
    while root != os.path.dirname(root) and not os.path.exists(os.path.join(root, '.git')):
        root = os.path.dirname(root)
    return os.path.relpath(target, root)


def main():
    data = json.load(sys.stdin)
    command, cwd = data.get('tool_input', {}).get('command', ''), data.get('cwd') or os.getcwd()
    for target in targets(command, cwd):
        modules = os.path.join(target, 'node_modules')
        if os.path.islink(modules):
            print(f'Blocked: {modules} is a link to {os.path.realpath(modules)}, and npm would empty that shared folder for every worktree.\n'
                  f'Give this worktree its own first: tools/worktree.sh own-modules {repo_dir(target)} (removes only the link), then run npm there.', file=sys.stderr)
            sys.exit(2)


if __name__ == '__main__':
    main()
