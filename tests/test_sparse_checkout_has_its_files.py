# A job that checks out only some files must check out every file it then runs: the ledger's action and script, and the sibling modules of a listed tool.
# Why (31 Oct 2026, a8): the call-ledger steps were added to 14 jobs whose checkout is sparse (the verdict, the e2e suites' lock-tools, report, alert); none of them had
# .github/actions/gh-ledger, so each would have died on "Can't find action.yml" and every PR verdict with it. The first guard only counted steps.
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORKFLOWS = sorted((ROOT / '.github' / 'workflows').glob('*.yml'))
SPARSE = re.compile(r'^(?P<indent> +)sparse-checkout: \|\n(?P<body>(?:(?P=indent) {2,}\S.*\n)+)', re.M)
IMPORT = re.compile(r'^\s*(?:from|import)\s+([A-Za-z_][A-Za-z0-9_]*)', re.M)


def jobs(text):
    body = text.split('\njobs:\n', 1)[1] if '\njobs:\n' in text else ''
    parts = re.split(r'\n(?=  [A-Za-z0-9_-]+:\s*\n)', '\n' + body)
    return {part.strip().split(':', 1)[0]: part for part in parts if part.strip()}


def checkouts(job):
    """-> [(path or '', the sparse list or None)] for each `actions/checkout` step of the job."""
    found = []
    for step in re.split(r'\n(?=      - )', job):
        if 'uses: actions/checkout@' not in step:
            continue
        path = re.search(r'^\s+path:\s*(\S+)', step, re.M)
        sparse = SPARSE.search(step + '\n')   # the split ate the newline after the step's last line
        found.append((path.group(1) if path else '', sparse.group('body').split() if sparse else None))
    return found


class TheLedgerIsCheckedOut(unittest.TestCase):
    def test_a_sparse_checkout_that_provides_the_ledger_lists_its_files(self):
        missing = []
        for workflow in WORKFLOWS:
            for name, job in jobs(workflow.read_text()).items():
                from_lock_tools = 'lock-tools/tools/gh-ledger.sh' in job
                local_action = './.github/actions/gh-ledger' in job
                if not (from_lock_tools or local_action):
                    continue
                for path, sparse in checkouts(job):
                    if sparse is None or (from_lock_tools and path != 'lock-tools') or (local_action and path):
                        continue
                    needed = ['tools/gh-ledger.sh'] + (['.github/actions/gh-ledger'] if local_action else [])
                    for item in needed:
                        if not any(item == entry or item.startswith(entry.rstrip('/') + '/') for entry in sparse):
                            missing.append(f'{workflow.name} {name}: the sparse checkout lacks {item}')
        self.assertEqual(missing, [], 'add these paths to the job\'s sparse-checkout list')


class SiblingsOfAListedToolAreListed(unittest.TestCase):
    def test_every_imported_sibling_of_a_listed_tool_is_listed_too(self):
        missing = []
        for workflow in WORKFLOWS:
            for name, job in jobs(workflow.read_text()).items():
                for _, sparse in checkouts(job):
                    for entry in sparse or []:
                        if not (entry.startswith('tools/') and entry.endswith('.py')) or not (ROOT / entry).exists():
                            continue
                        for sibling in sorted(self.siblings(entry)):
                            if sibling not in sparse and 'tools' not in sparse:
                                missing.append(f'{workflow.name} {name}: {entry} imports {sibling}, which the sparse checkout lacks')
        self.assertEqual(missing, [], 'list the sibling module next to the tool that imports it')

    def siblings(self, entry, seen=None):
        """The tools/*.py files `entry` imports (at the top or lazily), and theirs."""
        seen = set() if seen is None else seen
        for module in IMPORT.findall((ROOT / entry).read_text()):
            path = f'tools/{module}.py'
            if path != entry and path not in seen and (ROOT / path).exists():
                seen.add(path)
                self.siblings(path, seen)
        return seen


class ASkippedCheckoutSkipsTheLedgerToo(unittest.TestCase):
    """Why (31 Oct 2026, a8; Gitar on #2733): the persona job checks out only when its OIDC token is trusted (fork runs skip it and finish green); the ledger steps had no such
    condition, so they died on a missing action.yml and turned that green run red."""

    def test_the_ledger_steps_carry_the_condition_of_the_checkout_that_provides_them(self):
        wrong = []
        for workflow in WORKFLOWS:
            for name, job in jobs(workflow.read_text()).items():
                from_lock_tools = 'lock-tools/tools/gh-ledger.sh' in job
                if not (from_lock_tools or './.github/actions/gh-ledger' in job):
                    continue
                steps = re.split(r'\n(?=      - )', job)
                provider = next((s for s in steps if 'uses: actions/checkout@' in s and bool(re.search(r'^\s+path:\s*lock-tools', s, re.M)) == from_lock_tools), '')
                condition = re.search(r'^\s+if:\s*(.+)$', provider, re.M)
                if not condition:
                    continue
                for step in steps:
                    if ('gh-ledger' in step) and 'actions/checkout@' not in step and condition.group(1).strip() not in step:
                        wrong.append(f'{workflow.name} {name}: a ledger step lacks the checkout\'s condition ({condition.group(1).strip()})')
        self.assertEqual(wrong, [], 'give the ledger start `if: <condition>` and the end `if: always() && <condition>`')


if __name__ == '__main__':
    unittest.main()
