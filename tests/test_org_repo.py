"""Guard for tools/org_repo.py (owner, 2 Nov 2026: every org repo on the same setup; ruleset per repo after its check exists; merge with override: bypass actors on every ruleset).
A fake `api` stands in for GitHub: no network, no token."""
import base64
import contextlib
import copy
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'tools'))
import org_repo  # noqa: E402

SETTINGS = org_repo.template_json('settings.json')
RULESET = org_repo.template_json('ruleset.json')


def real_ruleset():
    """What GitHub answers for a conforming ruleset: the template plus defaults the API adds."""
    body = copy.deepcopy(RULESET)
    body['id'] = 7
    body['rules'][0]['parameters']['dismissal_restriction'] = {'enabled': False, 'allowed_actors': []}
    return body


class Fake:
    """A GitHub with one repo: settings, a ruleset list, files on the default branch; every write is recorded."""
    def __init__(self, repo='jobadabra-lab', ruleset='present', files=None, settings=None):
        self.repo, self.writes = repo, []
        self.settings = {**SETTINGS, 'default_branch': 'main', **(settings or {})}
        self.ruleset = real_ruleset() if ruleset == 'present' else None
        self.files = {name: (org_repo.TEMPLATES / name).read_text() for name in org_repo.files_for(repo)} if files is None else files
        self.issues = []

    def __call__(self, method, path, data=None):
        if method != 'GET':
            self.writes.append((method, path, data))
            return None
        base = f'repos/{org_repo.ORG}/{self.repo}'
        if path == base:
            return self.settings
        if path == f'{base}/rulesets':
            return [{'id': 7, 'name': self.ruleset['name']}] if self.ruleset else []
        if path == f'{base}/rulesets/7':
            return self.ruleset
        if path.startswith(f'{base}/contents/.github/workflows/'):
            name = path.split('/workflows/')[1].split('?')[0]
            if name not in self.files:
                raise org_repo.NotFound(path)
            return {'content': base64.b64encode(self.files[name].encode()).decode()}
        if path.startswith(f'repos/{org_repo.ISSUE_REPO}/issues'):
            return self.issues
        raise AssertionError(f'unexpected GET {path}')


def run(fake, *argv):
    org_repo.api = fake
    out = io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
        code = org_repo.main(list(argv))
    return code, out.getvalue()


class Check(unittest.TestCase):
    def test_a_conforming_repo_has_no_drift(self):
        self.assertEqual(run(Fake(), 'check', 'jobadabra-lab')[0], 0)

    def test_a_ruleset_without_the_bypass_actors_is_drift(self):
        fake = Fake()
        fake.ruleset['bypass_actors'] = []
        code, out = run(fake, 'check', 'jobadabra-lab')
        self.assertEqual(code, 1)
        self.assertIn('bypass actors', out)

    def test_an_extra_bypass_actor_is_drift_too(self):
        fake = Fake()
        fake.ruleset['bypass_actors'].append({'actor_id': 1, 'actor_type': 'RepositoryRole', 'bypass_mode': 'always'})
        self.assertIn('bypass actors', run(fake, 'check', 'jobadabra-lab')[1])

    def test_a_wrong_required_check_or_merge_method_is_drift(self):
        fake = Fake()
        fake.ruleset['rules'][1]['parameters']['required_status_checks'] = [{'context': 'tests'}]
        fake.ruleset['rules'][0]['parameters']['allowed_merge_methods'] = ['merge', 'squash']
        out = run(fake, 'check', 'jobadabra-lab')[1]
        self.assertIn('required checks are', out)
        self.assertIn('allowed_merge_methods', out)

    def test_no_ruleset_and_wrong_settings_are_drift(self):
        out = run(Fake(ruleset='none', settings={'allow_merge_commit': True}), 'check', 'jobadabra-lab')[1]
        self.assertIn('no ruleset', out)
        self.assertIn('allow_merge_commit', out)

    def test_a_missing_file_and_a_changed_file_are_drift_but_a_changed_comment_is_not(self):
        files = {name: (org_repo.TEMPLATES / name).read_text() for name in org_repo.files_for('jobadabra-lab')}
        files['gitar-label.yml'] = '# my own comment\n' + files['gitar-label.yml'].replace('# Puts one', '# Puts exactly one')
        self.assertEqual(run(Fake(files=files), 'check', 'jobadabra-lab')[0], 0, 'comments are not setup')
        del files['conflict-label.yml']
        files['pr-checks.yml'] = files['pr-checks.yml'].replace('always()', 'success()')
        out = run(Fake(files=files), 'check', 'jobadabra-lab')[1]
        self.assertIn('conflict-label.yml is missing', out)
        self.assertIn('pr-checks.yml differs', out)

    def test_each_repo_gets_its_profile(self):
        self.assertEqual(org_repo.files_for('jobadabra'), [])
        self.assertEqual(org_repo.files_for('jobadabra-web'), ['gitar-label.yml', 'conflict-label.yml'])
        self.assertEqual(len(org_repo.files_for('jobadabra-benchmarks')), 3)

    def test_the_issue_is_opened_updated_and_closed(self):
        fake = Fake(ruleset='none')
        self.assertEqual(run(fake, 'check', 'jobadabra-lab', '--issue')[0], 0, 'the issue is the report; the run stays green')
        self.assertEqual([w[0] for w in fake.writes], ['POST'])
        self.assertEqual(fake.writes[0][2]['title'], org_repo.ISSUE_TITLE)
        fake.writes.clear()
        fake.issues = [{'number': 5, 'title': org_repo.ISSUE_TITLE}]
        run(fake, 'check', 'jobadabra-lab', '--issue')
        self.assertEqual(fake.writes[0][:2], ('PATCH', f'repos/{org_repo.ISSUE_REPO}/issues/5'))
        fake.writes.clear()
        clean = Fake()
        clean.issues = [{'number': 5, 'title': org_repo.ISSUE_TITLE}]
        run(clean, 'check', 'jobadabra-lab', '--issue')
        self.assertEqual(clean.writes[0][2]['state'], 'closed')


class Ruleset(unittest.TestCase):
    def test_it_is_refused_until_the_check_exists_on_the_default_branch(self):
        fake = Fake(ruleset='none', files={})
        code, out = run(fake, 'ruleset', 'jobadabra-lab')
        self.assertEqual(code, 2)
        self.assertEqual(fake.writes, [], 'nothing is written: the first PR could never merge')
        self.assertIn('pr-checks.yml', out)

    def test_it_is_created_with_the_bypass_actors_then_updated_in_place(self):
        fake = Fake(ruleset='none')
        self.assertEqual(run(fake, 'ruleset', 'jobadabra-lab')[0], 0)
        method, path, body = fake.writes[0]
        self.assertEqual((method, path), ('POST', 'repos/jobadabra/jobadabra-lab/rulesets'))
        self.assertEqual({a['actor_type'] for a in body['bypass_actors']}, {'OrganizationAdmin', 'RepositoryRole'})
        self.assertEqual(body['rules'][1]['parameters']['required_status_checks'], [{'context': 'All checks passed'}])
        update = Fake()
        run(update, 'ruleset', 'jobadabra-lab')
        self.assertEqual(update.writes[0][:2], ('PUT', 'repos/jobadabra/jobadabra-lab/rulesets/7'))

    def test_a_repo_with_its_own_verdict_job_needs_no_pr_checks_file(self):
        fake = Fake(repo='jobadabra-web', ruleset='none', files={})
        self.assertEqual(run(fake, 'ruleset', 'jobadabra-web')[0], 0)

    def test_dry_run_sends_nothing(self):
        fake = Fake(ruleset='none')
        code, out = run(fake, 'ruleset', 'jobadabra-lab', '--dry-run')
        self.assertEqual((code, fake.writes), (0, []))
        self.assertIn('POST', out)


class Files(unittest.TestCase):
    def test_it_writes_only_what_differs_and_onboard_waits_for_the_check(self):
        with tempfile.TemporaryDirectory() as clone:
            code, out = run(Fake(ruleset='none', files={}), 'onboard', 'jobadabra-lab', clone, '--dry-run')
            self.assertEqual(code, 0)
            self.assertIn('ruleset waits', out)
            names = sorted(p.name for p in (Path(clone) / '.github/workflows').iterdir())
            self.assertEqual(names, ['conflict-label.yml', 'gitar-label.yml', 'pr-checks.yml'])
            self.assertEqual(run(Fake(), 'files', 'jobadabra-lab', clone)[1], '', 'a second run writes nothing')


class Templates(unittest.TestCase):
    def test_the_ruleset_template_carries_the_merge_with_override_bypass(self):
        """Owner, 2 Nov 2026 (via mac-07): merge with override on every org repo = OrganizationAdmin and repository role 5 (admin), mode pull_request."""
        actors = {(a['actor_type'], a['actor_id'], a['bypass_mode']) for a in RULESET['bypass_actors']}
        self.assertEqual(actors, {('OrganizationAdmin', None, 'pull_request'), ('RepositoryRole', 5, 'pull_request')})

    def test_the_required_context_is_the_name_of_the_caller_templates_verdict_job(self):
        self.assertIn('name: All checks passed', (TEMPLATES := org_repo.TEMPLATES / 'pr-checks.yml').read_text())
        self.assertEqual(RULESET['rules'][1]['parameters']['required_status_checks'], [{'context': 'All checks passed'}])

    def test_every_script_a_template_fetches_comes_with_the_files_it_imports(self):
        """Why (2 Nov 2026, web#307): conflict-label.mjs imports ./gitar-label.mjs and the web copy fetched only the first, so every web PR drew a red check. The templates are what
        onboarding copies, so they are checked here against the real scripts, as file patterns (cone mode off), with no comment inside the block."""
        import re
        for name in ('gitar-label.yml', 'conflict-label.yml', 'pr-checks.yml'):
            text = (org_repo.TEMPLATES / name).read_text()
            if 'sparse-checkout: |' not in text:
                continue
            block = text.split('sparse-checkout: |\n', 1)[1].split('\n          sparse-checkout-cone-mode', 1)[0]
            listed = [line.strip() for line in block.split('\n') if line.strip()]
            self.assertIn('sparse-checkout-cone-mode: false', text, name)
            for entry in listed:
                self.assertNotRegex(entry, r'[#\s]', f'{name}: {entry}')
                for target in re.findall(r"from\s+'\./([^']+)'", (ROOT / entry).read_text()):
                    self.assertIn(f'tools/{target}', listed, f'{name}: {entry} imports ./{target}')


if __name__ == '__main__':
    unittest.main()
