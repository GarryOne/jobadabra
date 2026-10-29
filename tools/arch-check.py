#!/usr/bin/env python3
"""Ratchet production JS cycles and folder boundaries with pinned dependency-cruiser.
Why (29 Oct 2026, owner): "Let's add/implement this" — deterministic import checks
catch AI edits that introduce a cycle or import against an existing folder boundary.

  python3 tools/arch-check.py [--base origin/main] [--offline] [--report]

The same config checks two isolated committed snapshots: origin/main and HEAD,
never local edits, installed modules or the owner's app. Only an increase in a
rule's violation count blocks. A finding reads: file -> imported file  (rule),
followed by a fix. Old violations and equal-count replacements do not block.
Justify an exception in one line beside a narrowly scoped config exclusion:
  // Why (<date or PR>, owner): <reason this specific dependency is allowed>
No blanket bypass or stored baseline: improvements on main lower the allowance.

--report writes only JSON {rule: {main: n, head: n}} to stdout. Stable keys:
no-circular, renderer-no-node-layer, extension-no-desktop. Counts are the tool's
summary.violations entries per rule, not unique files or cyclic components.
Unavailable tool/base: {} (unmeasured, NEVER invented zeroes), notice on stderr,
exit 0. Tool/config/parse errors: exit 2; growing counts: exit 1, else exit 0.

First use installs only dependency-cruiser into a versioned ~/.cache/jobadabra
folder (JOBADABRA_CACHE overrides it), never a repo node_modules or lockfile.
Offline with no cached tool: explicitly checks nothing; --offline never installs.
CI does not keep the cache, so it installs the pinned tool on every run: budget
about 13 s (12.7 s measured, including about 7 s for installation; warm cache 5.0 s).
"""
import argparse
from collections import Counter
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parent.parent
# Why (29 Oct 2026, owner): pin a mature 16.x release older than two weeks; no repo dependency changes.
DEPENDENCY_CRUISER_VERSION = '16.10.2'
FIXES = {
    'no-circular': 'break the cycle: move common code to a lower-level module or inject the dependency',
    'renderer-no-node-layer': 'use the preload/IPC interface, or move pure code to a shared module',
    'extension-no-desktop': 'use the app API, or move pure code to a shared module',
}
# Why (29 Oct 2026, owner): the config's options.exclude alone owns what is checked; snapshot skips only installed modules and symlinks.
EXCLUDED = re.compile(r'(^|/)node_modules/')


def cruiser_command(offline=False):
    """Return the exact pinned CLI argv, or None; bootstrap only inside its cache."""
    node = shutil.which('node')
    if not node:
        return None
    home = Path(os.environ.get('JOBADABRA_CACHE', Path.home() / '.cache/jobadabra')).resolve() / f'dependency-cruiser-{DEPENDENCY_CRUISER_VERSION}'
    package = home / 'node_modules/dependency-cruiser'
    binary = package / 'bin/dependency-cruise.mjs'

    def cached():
        try:
            return binary.is_file() and json.loads((package / 'package.json').read_text(encoding='utf-8'))['version'] == DEPENDENCY_CRUISER_VERSION
        except (OSError, ValueError, KeyError):
            return False

    if cached():
        return [node, str(binary)]
    available = shutil.which('depcruise')
    if available:
        try:
            result = subprocess.run([available, '--version'], capture_output=True, text=True, timeout=10)
            if result.returncode == 0 and result.stdout.strip() == DEPENDENCY_CRUISER_VERSION:
                return [available]
        except (OSError, subprocess.SubprocessError):
            pass
    npm = shutil.which('npm')
    if offline or not npm:
        return None
    # Invariant: npm's cwd, prefix and download cache all live outside the checkout.
    if home == ROOT or ROOT in home.parents or (home / 'node_modules').is_symlink():
        raise RuntimeError('refusing a tool cache inside the checkout or with linked node_modules')
    try:
        home.mkdir(parents=True, exist_ok=True)
        subprocess.run([npm, 'install', '--prefix', str(home), '--no-save', '--package-lock=false',
                        '--ignore-scripts', '--no-audit', '--no-fund', f'dependency-cruiser@{DEPENDENCY_CRUISER_VERSION}'],
                       cwd=home, env={**os.environ, 'npm_config_cache': str(home / 'npm-cache')},
                       check=True, capture_output=True, text=True, timeout=180)
    except (OSError, subprocess.SubprocessError):
        return None
    return [node, str(binary)] if cached() else None


def git(root, *args, data=None):
    """Read git objects as bytes, without a checkout, fetch or configuration change."""
    return subprocess.run(['git', *args], cwd=root, input=data, capture_output=True, check=True).stdout


def snapshot(root, ref, destination):
    """Materialize committed JS and package metadata, never node_modules or symlinks.

    Batched object reads avoid one git process per file. Preserve source folders
    so the config's options.exclude is the sole owner of the checked scope.
    """
    objects = []
    tree = git(root, 'ls-tree', '-rz', ref, '--', 'desktop', 'extension')
    for entry in tree.split(b'\0'):
        if not entry:
            continue
        meta, raw_name = entry.split(b'\t', 1)
        mode, kind, sha = meta.split()
        name = raw_name.decode('utf-8')
        if kind != b'blob' or mode == b'120000' or EXCLUDED.search(name):
            continue
        if re.search(r'\.[cm]?js$', name) or Path(name).name == 'package.json':
            objects.append((name, sha))
    payload = git(root, 'cat-file', '--batch', data=b''.join(sha + b'\n' for _, sha in objects))
    offset = 0
    for name, _ in objects:
        end = payload.index(b'\n', offset)
        size = int(payload[offset:end].split()[-1])
        offset = end + 1
        target = destination / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(payload[offset:offset + size])
        offset += size + 1


def cruise(command, directory, config):
    """Return dependency-cruiser violations; a broken tool/config is never a pass."""
    scope = [name for name in ('desktop', 'extension') if (directory / name).is_dir()]
    if not scope:
        return []
    result = subprocess.run([*command, '--config', str(config), '--output-type', 'json', *scope],
                            cwd=directory, capture_output=True, text=True, timeout=60)
    if result.returncode not in (0, 1):
        raise RuntimeError(f'dependency-cruiser failed (exit {result.returncode}): {result.stderr.strip()}')
    try:
        violations = json.loads(result.stdout)['summary']['violations']
        if not isinstance(violations, list):
            raise ValueError('violations is not a list')
        for item in violations:
            item['from'] = item['from'].replace('\\', '/')
            item['to'] = item['to'].replace('\\', '/')
            if item['rule']['name'] not in FIXES:
                raise ValueError(f"unknown rule {item['rule']['name']}")
        return violations
    except (ValueError, KeyError, TypeError, AttributeError) as error:
        raise RuntimeError(f'invalid dependency-cruiser output: {error}; {result.stderr.strip()}') from error


def identity(item):
    """Identify a finding across snapshots without absolute paths or platform slashes."""
    cycle = tuple(part['name'].replace('\\', '/') for part in item.get('cycle', []))
    return (item['rule']['name'], item['from'].replace('\\', '/'), item['to'].replace('\\', '/'), cycle)


def compare(main, head):
    """Return stable per-rule counts and new findings only for rules whose count grew."""
    before = Counter(item['rule']['name'] for item in main)
    after = Counter(item['rule']['name'] for item in head)
    report = {rule: {'main': before[rule], 'head': after[rule]} for rule in FIXES}
    old = Counter(identity(item) for item in main)
    added = []
    for item in head:
        key = identity(item)
        if old[key]:
            old[key] -= 1
        elif after[key[0]] > before[key[0]]:
            added.append(key)
    return report, sorted(added)


def main(argv=None, root=ROOT):
    """Run the committed graph ratchet; diagnostics use stderr, report JSON stdout."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', default='origin/main')
    parser.add_argument('--report', action='store_true')
    parser.add_argument('--offline', action='store_true')
    args = parser.parse_args(argv)
    try:
        git(root, 'rev-parse', '--verify', args.base + '^{commit}')
    except subprocess.CalledProcessError:
        print(f'arch-check: no {args.base} to compare with: nothing checked', file=sys.stderr)
        if args.report:
            print('{}')
        return 0
    try:
        command = cruiser_command(offline=args.offline)
        if command is None:
            print('arch-check: pinned dependency-cruiser unavailable (offline or install failed): nothing checked', file=sys.stderr)
            if args.report:
                print('{}')
            return 0
        # Why (29 Oct 2026, owner): compare both commits with ONE config, so adding a rule never creates a wall of old findings.
        config = root / '.dependency-cruiser.cjs'
        with tempfile.TemporaryDirectory(prefix='jobadabra-arch-') as temp:
            base, head = Path(temp) / 'main', Path(temp) / 'head'
            base.mkdir()
            head.mkdir()
            snapshot(root, args.base, base)
            snapshot(root, 'HEAD', head)
            report, added = compare(cruise(command, base, config), cruise(command, head, config))
        if args.report:
            print(json.dumps(report, sort_keys=True))
        for rule, source, target, cycle in added:
            print(f'{source} -> {target}  ({rule}) — {FIXES[rule]}', file=sys.stderr)
            if cycle:
                print('  cycle: ' + ' -> '.join(cycle), file=sys.stderr)
        growing = [rule for rule, counts in report.items() if counts['head'] > counts['main']]
        for rule in growing:
            counts = report[rule]
            print(f"arch-check: {rule}: main={counts['main']} head={counts['head']}", file=sys.stderr)
        return 1 if growing else 0
    except (OSError, subprocess.SubprocessError, RuntimeError) as error:
        print(f'arch-check: {error}', file=sys.stderr)
        return 2


if __name__ == '__main__':
    sys.exit(main())
