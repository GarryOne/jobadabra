#!/usr/bin/env python3
"""Refuse an `npm ci/install/update` whose node_modules is a link into another checkout, before npm empties the folder it points at.
Run by tools/pre-push-check.sh (the project's PreToolUse Bash hook): reads the hook JSON on stdin, exit 2 with the way out on stderr.
Why (28 Oct 2026, mac-27): `npm ci` in a worktree wiped the shared desktop/node_modules that tools/worktree.sh links into every worktree; all lost lint and tests."""
import json
import os
import re
import sys

INSTALL = re.compile(r'\bnpm\b[^;&|\n)]*?\s(ci|install|i|add|update|up|uninstall|rebuild|dedupe|prune)(\s|$|;|\))')
PACKAGE_DIRS = ('.', 'desktop', 'desktop/e2e', 'worker', 'site')   # the folders tools/worktree.sh links


def repo_root(start):
    root = os.path.abspath(start)
    while root != os.path.dirname(root) and not os.path.exists(os.path.join(root, '.git')):
        root = os.path.dirname(root)
    return root


def linked(root):
    """Package dirs of this checkout whose node_modules is a link into another checkout."""
    return [d for d in PACKAGE_DIRS if os.path.islink(os.path.join(root, d, 'node_modules'))]


def main():
    data = json.load(sys.stdin)
    command, cwd = data.get('tool_input', {}).get('command', ''), data.get('cwd') or os.getcwd()
    # Why (28 Oct 2026, #2414): a parser of cd/--prefix/subshell forms was bypassed twice; the state is judged instead: any npm install verb anywhere,
    # while any package dir of this checkout is linked, is refused (an over-block costs one `own-modules` call, a miss empties every worktree).
    if not INSTALL.search(command):
        return
    root = repo_root(cwd)
    links = linked(root)
    if links:
        print('Blocked: npm install/ci/update while ' + ', '.join(f'{d}/node_modules' for d in links) + ' link into another checkout: npm would empty that shared folder for every worktree.\n'
              + 'Give this worktree its own first (removes only the link): ' + ' && '.join(f'tools/worktree.sh own-modules {d}' for d in links) + ', then run npm.', file=sys.stderr)
        sys.exit(2)


if __name__ == '__main__':
    main()
