import os
import sys
import unittest
from unittest import mock

from src import secret_store
from src.ai import passwords
from src.sources import google


class FakeKeyring:
    def __init__(self):
        self.items = {}

    def get_password(self, service, user):
        return self.items.get((service, user))

    def set_password(self, service, user, value):
        self.items[(service, user)] = value

    def delete_password(self, service, user):
        self.items.pop((service, user))


class RealStoreIsOffLimitsToTestsTest(unittest.TestCase):
    """24 Oct 2026: a test wrote job-pilotto.google.scopes into the owner's real Keychain. An unmocked write or delete from a test now raises."""
    def test_an_unmocked_change_fails_loudly_and_reaches_nothing(self):
        for platform in ('darwin', 'win32'):
            with mock.patch.object(sys, 'platform', platform), mock.patch.dict('os.environ', {'JOB_PILOTTO_E2E': '', 'JOB_PILOTTO_TWIN': ''}), \
                    mock.patch.object(secret_store.subprocess, 'Popen', side_effect=AssertionError('reached the real tool')):
                for change in (lambda: secret_store.put('job-pilotto.x.token', 'v'), lambda: secret_store.delete('job-pilotto.x.token')):
                    with self.assertRaisesRegex(RuntimeError, 'real secret store'):
                        change()

    def test_the_guard_knows_a_test_is_running(self):
        self.assertTrue(secret_store.under_test())


class SecretStoreTest(unittest.TestCase):
    def test_windows_uses_the_credential_manager_through_keyring(self):
        store = FakeKeyring()
        with mock.patch.object(sys, 'platform', 'win32'), mock.patch.object(secret_store, '_keyring', return_value=store):
            secret_store.put('job-pilotto.google.refresh-token', 'r1', 'igor')
            self.assertEqual(secret_store.get('job-pilotto.google.refresh-token', 'igor'), 'r1')
            secret_store.delete('job-pilotto.google.refresh-token', 'igor')
            secret_store.delete('job-pilotto.google.refresh-token', 'igor')  # already gone: no error
            self.assertIsNone(secret_store.get('job-pilotto.google.refresh-token', 'igor'))

    def test_the_mac_keeps_its_keychain_items(self):
        calls = []
        def run(args, **kwargs):
            calls.append(args)
            return mock.Mock(returncode=0, stdout='secret\n')
        with mock.patch.object(sys, 'platform', 'darwin'), mock.patch.object(secret_store.subprocess, 'run', run):
            self.assertEqual(secret_store.get('job-pilotto.x.password', 'job-pilotto'), 'secret')
            secret_store.put('job-pilotto.x.password', 'pw', 'job-pilotto', label='Jobadabra: x')
        self.assertEqual(calls[0], ['security', 'find-generic-password', '-a', 'job-pilotto', '-s', 'job-pilotto.x.password', '-w'])
        self.assertEqual(calls[1], ['security', 'add-generic-password', '-U', '-a', 'job-pilotto', '-s', 'job-pilotto.x.password',
                                    '-l', 'Jobadabra: x', '-w', 'pw'])

    def test_a_site_password_keeps_its_email_and_job_beside_it_never_in_the_password(self):
        calls = []
        with mock.patch.object(sys, 'platform', 'darwin'), \
                mock.patch.object(secret_store.subprocess, 'run', lambda args, **_: calls.append(args) or mock.Mock(returncode=1, stdout='')), \
                mock.patch.object(passwords, 'copy', lambda text: None), mock.patch('builtins.print'):
            passwords.main(['new', 'career2.successfactors.eu', '--email', 'ilie@example.com', '--job', 'https://jobs.migros.ch/x'])
        stored = [call for call in calls if call[:2] == ['security', 'add-generic-password'] and 'job-pilotto.career2.successfactors.eu.password' in call][0]
        self.assertEqual(stored[stored.index('-j') + 1], 'email=ilie@example.com job=https://jobs.migros.ch/x')
        self.assertEqual(passwords.note('', ''), None)

    def test_a_site_account_is_named_after_the_profile_so_profiles_never_share_one(self):
        with mock.patch.dict('os.environ', {'JOB_PILOTTO_PROFILE_ID': 'profile-0123456789ab'}):
            self.assertEqual(passwords.service('a.example.com'), 'job-pilotto.profile-0123456789ab.a.example.com.password')
        with mock.patch.dict('os.environ', {'JOB_PILOTTO_PROFILE_ID': 'x; evil'}):   # not an id: the old name, which the app lists as unassigned
            self.assertEqual(passwords.service('a.example.com'), 'job-pilotto.a.example.com.password')

    def test_new_with_no_copy_stores_and_leaves_the_clipboard_alone(self):
        store, copied = FakeKeyring(), []
        with mock.patch.object(sys, 'platform', 'win32'), mock.patch.object(secret_store, '_keyring', return_value=store), \
                mock.patch.object(passwords, 'copy', copied.append), mock.patch('builtins.print') as printed:
            self.assertEqual(passwords.main(['new', 'auth.jobs.ch', '--no-copy']), 0)
        own = store.items[('job-pilotto.auth.jobs.ch.password', 'job-pilotto')]
        self.assertNotIn(('job-pilotto.sites.password', 'job-pilotto'), store.items, 'a new account no longer makes or reuses the one job-site password')
        self.assertEqual(copied, [])
        self.assertNotIn(own, str(printed.call_args_list))
        self.assertEqual(passwords.note('a b@c', 'https://x'), 'job=https://x')   # a value with a space is left out

    def test_no_store_elsewhere_reads_nothing(self):
        with mock.patch.object(sys, 'platform', 'linux'):
            self.assertIsNone(secret_store.get('anything'))
            with self.assertRaises(SystemExit):
                secret_store.put('anything', 'x')

    def test_google_sign_in_is_stored_through_it(self):
        store = FakeKeyring()
        with mock.patch.object(sys, 'platform', 'win32'), mock.patch.object(secret_store, '_keyring', return_value=store), \
                mock.patch.dict('os.environ', {'USER': 'igor'}):
            google.store('id', 'secret', 'refresh', production=False, github=False)
            self.assertEqual(google.credentials(), ('id', 'secret', 'refresh'))
        self.assertIn(('job-pilotto.google.auth-at', 'igor'), store.items)


class EndToEndIsolationTest(unittest.TestCase):
    """The end-to-end test app runs on the owner's own Mac: the Keychain there holds the owner's real Google sign-in and Telegram bot (2 Oct 2026: a test
    "Gmail check" read the owner's real mail). With JOB_PILOTTO_E2E set the engine sees no Keychain at all."""

    def _keychain_answers(self):
        return mock.patch.object(secret_store.subprocess, 'run', return_value=mock.Mock(returncode=0, stdout='real-secret\n'))

    def test_the_keychain_is_not_read(self):
        with mock.patch.object(sys, 'platform', 'darwin'), self._keychain_answers() as asked, mock.patch.dict('os.environ', {'JOB_PILOTTO_E2E': '1'}):
            self.assertIsNone(secret_store.get('job-pilotto.google.refresh-token', 'igor'))
        asked.assert_not_called()

    def test_a_twin_reads_the_owners_google_sign_in_and_nothing_else_and_never_writes_it(self):
        """10 Oct 2026 (owner: "let the twin use the original app Gmail connection"): the twin's sign-up needs the confirmation mail. Only the three
        Google items are read through from the real store (read-only Gmail and Calendar); Telegram, the admin key and every write stay cut off."""
        import tempfile
        google_items = ('job-pilotto.google.client-id', 'job-pilotto.google.client-secret', 'job-pilotto.google.refresh-token')
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, 'isolated-secrets.json')
            with mock.patch.object(sys, 'platform', 'darwin'), self._keychain_answers() as asked, \
                    mock.patch.dict('os.environ', {'JOB_PILOTTO_TWIN': '1', 'JOB_PILOTTO_ISOLATED_SECRETS': path}):
                for service in google_items:
                    self.assertEqual(secret_store.get(service, 'igor'), 'real-secret', service)
                asked.reset_mock()
                for service in ('job-pilotto.telegram.bot-token', 'job-pilotto.anthropic.admin-key', 'job-pilotto.google.auth-at'):
                    self.assertIsNone(secret_store.get(service, 'igor'), service)
                asked.assert_not_called()
                secret_store.put('job-pilotto.google.refresh-token', 'twin-made', 'igor')   # a write stays in the twin's own file, and wins over the real one
                self.assertEqual(secret_store.get('job-pilotto.google.refresh-token', 'igor'), 'twin-made')
                writes = [call for call in asked.call_args_list if 'add-generic-password' in call.args[0]]
                self.assertEqual(writes, [])
        with mock.patch.object(sys, 'platform', 'darwin'), self._keychain_answers() as asked, mock.patch.dict('os.environ', {'JOB_PILOTTO_TWIN': '1', 'JOB_PILOTTO_E2E': '1'}):
            self.assertIsNone(secret_store.get('job-pilotto.google.refresh-token', 'igor'))   # a test run is never a twin: it reads nothing
        asked.assert_not_called()

    def test_without_the_flag_the_keychain_is_read_as_before(self):
        with mock.patch.object(sys, 'platform', 'darwin'), self._keychain_answers(), mock.patch.dict('os.environ'):
            os.environ.pop('JOB_PILOTTO_E2E', None)
            self.assertEqual(secret_store.get('job-pilotto.google.refresh-token', 'igor'), 'real-secret')

    def test_google_is_not_connected_and_telegram_has_no_token(self):
        from src import telegram
        env = {'JOB_PILOTTO_E2E': '1'}
        with mock.patch.object(sys, 'platform', 'darwin'), self._keychain_answers(), mock.patch.dict('os.environ', env), \
                mock.patch('src.sources.google.os.getenv', side_effect=lambda name, default=None: {'JOB_PILOTTO_E2E': '1'}.get(name, default)):
            self.assertIsNone(google.credentials())
        with mock.patch.object(sys, 'platform', 'darwin'), mock.patch.object(telegram.subprocess, 'run',
                return_value=mock.Mock(stdout='123456:real-bot-token\n')) as asked, mock.patch.dict('os.environ', env):
            self.assertIsNone(telegram.keychain_token())
        asked.assert_not_called()

    def test_telegram_keychain_token_does_not_need_os_uname_which_windows_lacks(self):
        from src import telegram
        with mock.patch.object(sys, 'platform', 'win32'), mock.patch.object(telegram.os, 'uname', side_effect=AttributeError("module 'os' has no attribute 'uname'"), create=True), \
                mock.patch.object(telegram.subprocess, 'run') as asked, mock.patch.dict('os.environ'):
            os.environ.pop('JOB_PILOTTO_E2E', None)
            self.assertIsNone(telegram.keychain_token())
        asked.assert_not_called()

    def test_the_admin_key_and_the_notion_fallback_do_not_read_the_keychain_either(self):
        from src.ai import apply_run, budget
        env = {'JOB_PILOTTO_E2E': '1'}
        with mock.patch.object(sys, 'platform', 'darwin'), mock.patch.dict('os.environ', env), mock.patch.object(budget.subprocess, 'run') as budget_asked, \
                mock.patch.object(apply_run.subprocess, 'run') as apply_asked:
            os.environ.pop('ANTHROPIC_ADMIN_KEY', None)
            self.assertIsNone(budget.admin_key())
            self.assertEqual(apply_run._keychain_token(), '')
        budget_asked.assert_not_called()
        apply_asked.assert_not_called()

    def test_writes_never_reach_the_keychain_and_go_to_the_runs_own_file(self):
        """8 Oct 2026: reads were isolated but put() was not, so `passwords new` on an account page made a "new" job-site password and
        overwrote the owner's real job-pilotto.sites.password (-U). A test run and a twin write to their own file only."""
        import tempfile
        for flag in ('JOB_PILOTTO_E2E', 'JOB_PILOTTO_TWIN'):
            with self.subTest(flag=flag), tempfile.TemporaryDirectory() as folder:
                path = os.path.join(folder, 'isolated-secrets.json')
                with mock.patch.object(sys, 'platform', 'darwin'), self._keychain_answers() as asked, \
                        mock.patch.dict('os.environ', {flag: '1', 'JOB_PILOTTO_ISOLATED_SECRETS': path}), \
                        mock.patch.object(passwords, 'copy'), mock.patch('sys.stdout'):
                    self.assertEqual(passwords.main(['new', 'e2e.wd3.myworkdayjobs.com', '--email', 'e2e@example.com']), 0)
                    own = secret_store.get('job-pilotto.e2e.wd3.myworkdayjobs.com.password', 'job-pilotto')
                    self.assertTrue(own)   # made in the run's file and read back from it
                    self.assertIsNone(secret_store.get(passwords.SHARED, passwords.ACCOUNT), 'no shared job-site password is made for a new account')
                    secret_store.delete('job-pilotto.e2e.wd3.myworkdayjobs.com.password', 'job-pilotto')
                    self.assertIsNone(secret_store.get('job-pilotto.e2e.wd3.myworkdayjobs.com.password', 'job-pilotto'))
                asked.assert_not_called()   # no `security` call at all: neither the read, the write nor the delete
                self.assertTrue(os.path.exists(path), 'the run\'s own file was written')

    def test_an_isolated_run_without_its_own_file_keeps_nothing(self):
        with mock.patch.object(sys, 'platform', 'darwin'), self._keychain_answers() as asked, mock.patch.dict('os.environ', {'JOB_PILOTTO_E2E': '1'}):
            os.environ.pop('JOB_PILOTTO_ISOLATED_SECRETS', None)
            secret_store.put('job-pilotto.sites.password', 'Made-In-A-Test-42', 'job-pilotto')
            self.assertIsNone(secret_store.get('job-pilotto.sites.password', 'job-pilotto'))
        asked.assert_not_called()

    def test_a_users_app_still_writes_the_keychain(self):
        with mock.patch.object(sys, 'platform', 'darwin'), self._keychain_answers() as asked, mock.patch.dict('os.environ'):
            for name in ('JOB_PILOTTO_E2E', 'JOB_PILOTTO_TWIN', 'JOB_PILOTTO_ISOLATED_SECRETS'):
                os.environ.pop(name, None)
            secret_store.put('job-pilotto.example.com.password', 'p', 'job-pilotto')
        self.assertEqual(asked.call_args[0][0][:3], ['security', 'add-generic-password', '-U'])


class PasswordsTest(unittest.TestCase):
    def test_generated_passwords_have_every_class_or_none_of_the_refused_symbols(self):
        for _ in range(50):
            password = passwords.generate()
            self.assertEqual(len(password), 16)
            self.assertTrue(any(c.islower() for c in password) and any(c.isupper() for c in password))
            self.assertTrue(any(c.isdigit() for c in password) and any(not c.isalnum() for c in password))
            self.assertTrue(passwords.generate(12, '').isalnum())

    def test_every_new_account_gets_its_own_password_and_existing_ones_are_left_alone(self):
        """10 Oct 2026 (owner): a different generated password per site for NEW accounts; accounts made before keep theirs (one leaked site must not open the others)."""
        store = FakeKeyring()
        store.items[('job-pilotto.sites.password', 'job-pilotto')] = 'Maple-Rocket-42'
        store.items[('job-pilotto.old.example.com.password', 'job-pilotto')] = 'Maple-Rocket-42'
        with mock.patch.object(sys, 'platform', 'win32'), mock.patch.object(secret_store, '_keyring', return_value=store), \
                mock.patch.object(passwords, 'copy', lambda text: None), mock.patch('builtins.print'):
            for host in ('a.example.com', 'b.example.com'):
                self.assertEqual(passwords.main(['new', host, '--no-copy']), 0)
            self.assertEqual(passwords.main(['new', 'c.example.com', '--no-copy', '--no-symbols', '--length', '12']), 0)
        made = [store.items[(f'job-pilotto.{host}.password', 'job-pilotto')] for host in ('a.example.com', 'b.example.com', 'c.example.com')]
        self.assertEqual(len(set(made)), 3, 'a different password each')
        self.assertNotIn('Maple-Rocket-42', made)
        self.assertEqual(len(made[0]), 16)
        self.assertTrue(made[2].isalnum() and len(made[2]) == 12, 'a site\'s rule (no symbols, shorter) is still followed')
        self.assertEqual(store.items[('job-pilotto.old.example.com.password', 'job-pilotto')], 'Maple-Rocket-42', 'an existing account keeps its password')

    def test_new_stores_and_copies_without_printing_the_password(self):
        store, copied = FakeKeyring(), []
        with mock.patch.object(sys, 'platform', 'win32'), mock.patch.object(secret_store, '_keyring', return_value=store), \
                mock.patch.object(passwords, 'copy', copied.append), mock.patch('builtins.print') as printed:
            self.assertEqual(passwords.main(['have', 'careers.example.com']), 1)
            self.assertEqual(passwords.main(['new', 'careers.example.com']), 0)
            self.assertEqual(passwords.main(['have', 'careers.example.com']), 0)
            self.assertEqual(passwords.main(['copy', 'careers.example.com']), 0)
            self.assertEqual(passwords.main(['clear']), 0)
        stored = store.items[('job-pilotto.careers.example.com.password', 'job-pilotto')]
        self.assertEqual(copied, [stored, stored, ''])
        self.assertNotIn(stored, str(printed.call_args_list))

    def test_the_old_job_site_password_is_still_made_on_request_but_a_new_site_never_gets_it(self):
        store, copied = FakeKeyring(), []
        with mock.patch.object(sys, 'platform', 'win32'), mock.patch.object(secret_store, '_keyring', return_value=store), \
                mock.patch.object(passwords, 'copy', copied.append), mock.patch('builtins.print') as printed:
            self.assertEqual(passwords.main(['shared']), 0)   # Settings' "Show" for the accounts made before 10 Oct 2026
            self.assertEqual(passwords.main(['new', 'careers.a.com']), 0)
            self.assertEqual(passwords.main(['new', 'auth.b.ch']), 0)
        shared = store.items[('job-pilotto.sites.password', 'job-pilotto')]
        self.assertRegex(shared, r'^[A-Z][a-x]{2,5}-[A-Z][a-x]{2,5}-[1-9][0-9]$')   # Maple-Rocket-42: no y/z (QWERTZ)
        self.assertEqual([w for w in __import__('src.ai.passwords', fromlist=['WORDS']).WORDS if set(w) & set('yz')], [], 'no y/z in any word (8 Oct 2026: "Hazel" failed one run in ~60)')
        own = [store.items[('job-pilotto.careers.a.com.password', 'job-pilotto')], store.items[('job-pilotto.auth.b.ch.password', 'job-pilotto')]]
        self.assertNotIn(shared, own)
        self.assertNotEqual(own[0], own[1])
        self.assertEqual(copied, [shared, own[0], own[1]])
        self.assertNotIn(shared, str(printed.call_args_list))   # the app's run log keeps what is printed

    def test_memorable_passwords_fit_common_sign_up_rules(self):
        for _ in range(500):
            password = passwords.memorable()
            self.assertLessEqual(len(password), 16)
            self.assertGreaterEqual(len(password.replace('-', '')), 12)   # 12-18, no symbols (Migros)
            self.assertTrue(any(c.isupper() for c in password) and any(c.islower() for c in password))
            self.assertTrue(any(c.isdigit() for c in password) and '-' in password)


if __name__ == '__main__':
    unittest.main()
