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
            page = int(path.split('&page=')[1]) if '&page=' in path else 1
            return self.issues[(page - 1) * 100:page * 100]
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

    def test_a_token_that_cannot_see_the_bypass_actors_is_a_note_not_drift(self):
        fake = Fake()
        del fake.ruleset['bypass_actors']   # what GitHub returns to a requester without write access to the ruleset
        code, out = run(fake, 'check', 'jobadabra-lab')
        self.assertEqual(code, 0)
        self.assertIn('note jobadabra-lab: bypass actors are not shown', out)

    def test_settings_a_token_gets_as_null_are_a_note_not_drift_but_a_real_wrong_value_still_is(self):
        fake = Fake(settings={'allow_auto_merge': None, 'allow_squash_merge': None, 'allow_update_branch': None, 'delete_branch_on_merge': None})
        code, out = run(fake, 'check', 'jobadabra-lab')
        self.assertEqual(code, 0)
        self.assertIn('note jobadabra-lab: settings', out)
        self.assertIn('allow_squash_merge', out)
        code, out = run(Fake(settings={'allow_auto_merge': None, 'allow_merge_commit': True}), 'check', 'jobadabra-lab')
        self.assertEqual(code, 1, 'a null beside a readable wrong value: the wrong value is still drift')
        self.assertIn('allow_merge_commit', out)

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


    def test_the_issue_is_found_past_the_first_hundred_open_issues(self):
        fake = Fake(ruleset='none')
        fake.issues = [{'number': n, 'title': f'other {n}'} for n in range(100)] + [{'number': 500, 'title': org_repo.ISSUE_TITLE}]
        run(fake, 'check', 'jobadabra-lab', '--issue')
        self.assertEqual(fake.writes[0][:2], ('PATCH', f'repos/{org_repo.ISSUE_REPO}/issues/500'), 'updated in place, no duplicate opened')

    def test_a_clean_result_never_claims_what_the_token_could_not_read(self):
        """Gitar on #2950: with the org's read token the merge settings are never compared; a clean report must say so, in the line and, when it opens or updates the issue, in its body."""
        unreadable = {'allow_auto_merge': None, 'allow_squash_merge': None, 'allow_update_branch': None, 'delete_branch_on_merge': None}
        fake = Fake(settings=unreadable)
        code, out = run(fake, 'check', 'jobadabra-lab', '--issue')
        self.assertEqual(code, 0)
        self.assertNotIn('every checked repo is on the shared setup', out)
        self.assertIn('no drift in what this token can read; not verified with this token in 1 repo(s): jobadabra-lab', out)
        fake = Fake(ruleset='none', settings=unreadable)
        run(fake, 'check', 'jobadabra-lab', '--issue')
        self.assertIn('Not verified with this token', fake.writes[0][2]['body'])

    def test_closing_the_report_on_a_clean_run_names_what_the_token_could_not_read(self):
        """Gitar on #2950: a clean run closes the issue; the closing comment must carry the unread settings so "closed" never reads as "all checked"."""
        unreadable = {'allow_auto_merge': None, 'allow_squash_merge': None, 'allow_update_branch': None, 'delete_branch_on_merge': None}
        fake = Fake(settings=unreadable)
        fake.issues = [{'number': 500, 'title': org_repo.ISSUE_TITLE}]
        run(fake, 'check', 'jobadabra-lab', '--issue')
        self.assertEqual([w[:2] for w in fake.writes], [('POST', f'repos/{org_repo.ISSUE_REPO}/issues/500/comments'), ('PATCH', f'repos/{org_repo.ISSUE_REPO}/issues/500')], 'comment first, then close')
        self.assertIn('Not verified with this token', fake.writes[0][2]['body'])
        fake = Fake()
        fake.issues = [{'number': 500, 'title': org_repo.ISSUE_TITLE}]
        run(fake, 'check', 'jobadabra-lab', '--issue')
        self.assertEqual([w[0] for w in fake.writes], ['PATCH'], 'a fully verified clean run closes with no comment')


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
            fake = Fake(ruleset='none', files={})
            code, out = run(fake, 'onboard', 'jobadabra-lab', clone)
            self.assertEqual(code, 0)
            self.assertIn('ruleset waits', out)
            self.assertEqual([w[0] for w in fake.writes], ['PATCH'], 'the settings are applied, the ruleset is not')
            names = sorted(p.name for p in (Path(clone) / '.github/workflows').iterdir())
            self.assertEqual(names, ['conflict-label.yml', 'gitar-label.yml', 'pr-checks.yml'])
            self.assertEqual(run(Fake(), 'files', 'jobadabra-lab', clone)[1], '', 'a second run writes nothing')

    def test_dry_run_writes_no_file_and_sends_nothing(self):
        with tempfile.TemporaryDirectory() as clone:
            fake = Fake(ruleset='none', files={})
            code, out = run(fake, 'onboard', 'jobadabra-lab', clone, '--dry-run')
            self.assertEqual((code, fake.writes, list(Path(clone).iterdir())), (0, [], []))
            self.assertIn('would write .github/workflows/pr-checks.yml', out)


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
