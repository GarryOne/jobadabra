# A job that checks out only some files must check out every file it then runs: the ledger's action and script, and the sibling modules of a listed tool.
# Why (31 Oct 2026, a8): the call-ledger steps were added to 14 jobs whose checkout is sparse (the verdict, the e2e suites' lock-tools, report, alert); none of them had
# .github/actions/gh-ledger, so each would have died on "Can't find action.yml" and every PR verdict with it. The first guard only counted steps.
# Why (1 Nov 2026, a8): the class is wider than the ledger: a step that runs a repo file must have a checkout in its job that brings that file, at the commit the step means.
# It escaped 3 times in 8 days: the stable canary (26 Oct, bash tools/apt-install.sh missing at the tag it tested), tools/scan-e2e-artifacts.py (31 Oct, c124a28) and
# python3 tools/canary_verdict.py in a job with no checkout (22 Oct to 1 Nov: every non-green canary crashed there). `EveryFileAStepRunsIsThere` loops over every workflow.
import posixpath
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORKFLOWS = sorted((ROOT / '.github' / 'workflows').glob('*.yml'))
SPARSE = re.compile(r'^(?P<indent> +)sparse-checkout: \|\n(?P<body>(?:(?P=indent) {2,}\S.*\n)+)', re.M)
SPARSE_ONE_LINE = re.compile(r'^ +sparse-checkout: (?P<body>[^\s|#][^\n#]*?)\s*(?:#.*)?$', re.M)   # `sparse-checkout: worker`: the block form's twin
RUNS = re.compile(r'(?<![\w/.-])(?:python3?|node|bash|sh)\s+"?(\$GITHUB_WORKSPACE/|\./)?((?:\.\./)*[\w][\w./-]*\.(?:py|mjs|js|sh))\b')
CD = re.compile(r'^\s*(\()?\s*cd\s+([\w./-]+)\s*(?:&&|;|$)')   # `cd dir && cmd` or a line of its own; `(cd dir && cmd)` stays in its parentheses
# A file a step runs that is not in the repo at the commit: made by an earlier step of the job. Why (1 Nov 2026, a8; Gitar on #2768): without this list a path the guard cannot
# resolve would pass unchecked, as `cd dir && node scripts/x.mjs` did.
GENERATED = {'desktop/node_modules/electron/install.js'}   # the electron package's own install script, run by hand in build.yml after the dependencies are in
OWN_COMMIT = ('${{ github.sha }}', '${{ github.ref }}', '${{ github.event.repository.default_branch }}', 'main')   # refs that are this workflow's own commit or main
# A step that runs a file of a commit it checked out on purpose (the thing it publishes), not this workflow's tools. Why (1 Nov 2026, a8): the extension store
# publish uploads the build of the tag it is given, with that tag's own publisher script.
FROM_ANOTHER_COMMIT_ON_PURPOSE = {('extension-store-publish.yml', 'publish', 'tools/webstore-publish.mjs')}
IMPORT = re.compile(r'^\s*(?:from|import)\s+([A-Za-z_][A-Za-z0-9_]*)', re.M)


def jobs(text):
    body = text.split('\njobs:\n', 1)[1] if '\njobs:\n' in text else ''
    parts = re.split(r'\n(?=  [A-Za-z0-9_-]+:\s*\n)', '\n' + body)
    return {part.strip().split(':', 1)[0]: part for part in parts if part.strip()}


def checkout_of(step):
    """-> (path or '', the sparse list or None, ref or None) for an `actions/checkout` step, else None."""
    if 'uses: actions/checkout@' not in step:
        return None
    path = re.search(r'^\s+path:\s*(\S+)', step, re.M)
    ref = re.search(r'^\s+ref:\s*(.+?)(?:\s+#.*)?$', step, re.M)
    sparse = SPARSE.search(step + '\n')   # the split ate the newline after the step's last line
    one_line = None if sparse else SPARSE_ONE_LINE.search(step)
    # Why (1 Nov 2026, nm; found on schedule-watchdog.yml): the guard read only the block form, so `sparse-checkout: worker` counted as no sparse list and passed while the
    # job ran app-core/scripts/watchdog.mjs, a file that checkout did not bring (the watchdog was dead behind `|| true` from #2882 until this guard saw it).
    return (path.group(1) if path else '', sparse.group('body').split() if sparse else one_line.group('body').split() if one_line else None, ref.group(1).strip() if ref else None)


def checkouts(job):
    """-> [(path or '', the sparse list or None, ref or None)] for each `actions/checkout` step of the job."""
    return [found for found in map(checkout_of, re.split(r'\n(?=      - )', job)) if found]


class TheLedgerIsCheckedOut(unittest.TestCase):
    def test_a_sparse_checkout_that_provides_the_ledger_lists_its_files(self):
        missing = []
        for workflow in WORKFLOWS:
            for name, job in jobs(workflow.read_text()).items():
                from_lock_tools = 'lock-tools/tools/gh-ledger.sh' in job
                local_action = './.github/actions/gh-ledger' in job
                if not (from_lock_tools or local_action):
                    continue
                for path, sparse, _ in checkouts(job):
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
                for _, sparse, _ in checkouts(job):
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


class EveryFileAStepRunsIsThere(unittest.TestCase):
    """Every `python3 tools/x.py`, `node scripts/x.mjs`, `bash tools/x.sh` step has, before it in its job, a checkout that brings that file: at the path the
    step reads (`lock-tools/` for the workflow's own tools), listing the file when the checkout is sparse, and at the workflow's own commit for `lock-tools/`."""

    def steps_that_run_a_file(self):
        """-> (workflow, job, file from the repo root, the checkouts so far) for every step that runs a file. A path is read against the directory the step runs in:
        the job's `defaults.run.working-directory`, the step's own, and any `cd dir` before it; `$GITHUB_WORKSPACE/` is the root. A file the repo does not hold is
        yielded too: the caller decides (GENERATED, or a failure)."""
        for workflow in WORKFLOWS:
            for name, job in jobs(workflow.read_text()).items():
                seen, other_repos = [], []
                default = re.search(r'^\s+defaults:\n\s+run:\n(?:\s+shell:.*\n)?\s+working-directory:\s*([\w./-]+)', job, re.M)
                for step in re.split(r'\n(?=      - )', job):
                    found = checkout_of(step)
                    if found:
                        if re.search(r'^\s+repository:', step, re.M):
                            other_repos.append(found[0] + '/')   # a checkout of another repository (the lab's ops/): its files are not this repo's
                        else:
                            seen.append(found)
                        continue
                    own = re.search(r'^\s+working-directory:\s*([\w./-]+)\s*$', step, re.M)
                    directory = own.group(1) if own else default.group(1) if default else ''
                    for line in step.splitlines():
                        line = re.sub(r'(^|\s)#(\s.*)?$', '', line)   # a comment, whole-line or trailing, that names a command does not run it
                        if not line.strip():
                            continue
                        here = directory
                        moved = CD.match(line)
                        if moved:
                            here = posixpath.normpath(posixpath.join(directory, moved.group(2)))
                            if not moved.group(1):
                                directory = here
                        for root, written in RUNS.findall(line):
                            file = posixpath.normpath(posixpath.join('' if root.startswith('$') else here, written))
                            if not file.startswith(tuple(other_repos)):
                                yield workflow.name, name, file, list(seen)

    def exists(self, file):
        return (ROOT / file.removeprefix('lock-tools/')).exists() if file.startswith('lock-tools/') else (ROOT / file).exists()

    def test_a_cd_before_the_command_is_read(self):
        """`cd desktop && node scripts/stage.mjs` (build.yml, search-personas.yml) runs desktop/scripts/stage.mjs: read from the root it is a file that does not exist, and the guard would skip it."""
        files = {file for _, _, file, _ in self.steps_that_run_a_file()}
        self.assertIn('desktop/scripts/stage.mjs', files)
        self.assertNotIn('scripts/stage.mjs', files)

    def test_every_file_a_step_runs_is_one_the_guard_can_check(self):
        unknown = sorted({f'{workflow} {job}: {file}' for workflow, job, file, _ in self.steps_that_run_a_file() if not self.exists(file) and file not in GENERATED})
        self.assertEqual(unknown, [], 'the guard cannot find these in the repo: fix the path the guard reads, or list a file an earlier step makes in GENERATED with a Why')

    def test_the_job_checked_out_the_file_before_running_it(self):
        missing = []
        for workflow, job, file, seen in self.steps_that_run_a_file():
            if not self.exists(file):
                continue
            where = 'lock-tools' if file.startswith('lock-tools/') else ''
            bare = file.removeprefix('lock-tools/')
            provided = any(path == where and (sparse is None or any(bare == e or bare.startswith(e.rstrip('/') + '/') for e in sparse)) for path, sparse, _ in seen)
            if not provided:
                missing.append(f'{workflow} {job}: runs {file}, but no checkout before it brings {bare}' + (f' into {where}/' if where else ''))
        self.assertEqual(sorted(set(missing)), [], 'add an actions/checkout step (sparse-checkout: the file) before the step; a job with no checkout has no repo files')

    def test_the_workflows_own_tools_come_from_the_workflows_own_commit(self):
        wrong = []
        for workflow, job, file, seen in self.steps_that_run_a_file():
            if not file.startswith(('tools/', 'lock-tools/')) or not self.exists(file) or (workflow, job, file) in FROM_ANOTHER_COMMIT_ON_PURPOSE:
                continue
            where = 'lock-tools' if file.startswith('lock-tools/') else ''
            refs = [ref for path, _, ref in seen if path == where]
            if refs and refs[-1] is not None and refs[-1] not in OWN_COMMIT:
                wrong.append(f'{workflow} {job}: runs {file} from a checkout of {refs[-1]}, an older commit may not have it (the stable canary tests old tags)')
        self.assertEqual(sorted(set(wrong)), [], 'run it from a second checkout of this workflow\'s own commit: `path: lock-tools`, `ref: ${{ github.sha }}`, sparse-checkout: the file')


if __name__ == '__main__':
    unittest.main()
