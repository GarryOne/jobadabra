"""tools/keychain-copy-to-jobadabra.sh copies job-pilotto.* Keychain items to jobadabra.* (rename to Jobadabra, 1 Nov 2026): dry run by default, never deletes, never
prints a secret, leaves an existing new item alone. A fake `security` on PATH holds the items in a JSON file; the real Keychain is never reached."""
import json
import os
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / 'tools' / 'keychain-copy-to-jobadabra.sh'
FAKE = '''#!{python}
import json, sys
store = {store!r}
items = json.load(open(store))
args = sys.argv[1:]
arg = lambda flag: args[args.index(flag) + 1] if flag in args else None
if args[0] == 'dump-keychain':
    for it in items:
        print('keychain: "/x/login.keychain-db"\\nclass: "genp"\\nattributes:\\n    "acct"<blob>="%s"\\n    "icmt"<blob>=%s\\n    "svce"<blob>="%s"' % (it['acct'], '"%s"' % it['icmt'] if it.get('icmt') else '<NULL>', it['svce']))
elif args[0] == 'find-generic-password':
    hit = [it for it in items if it['acct'] == arg('-a') and it['svce'] == arg('-s')]
    if not hit:
        sys.exit(44)
    if '-w' in args:
        print(hit[0]['value'])
elif args[0] == 'add-generic-password':
    items = [it for it in items if not (it['acct'] == arg('-a') and it['svce'] == arg('-s'))]
    items.append({{'acct': arg('-a'), 'svce': arg('-s'), 'icmt': arg('-j') or '', 'value': arg('-w')}})
    json.dump(items, open(store, 'w'))
'''


@unittest.skipIf(sys.platform == 'win32', 'a bash script for the Mac')
class KeychainCopyTest(unittest.TestCase):
    def run_script(self, items, *flags):
        with tempfile.TemporaryDirectory() as folder:
            store = Path(folder) / 'items.json'
            store.write_text(json.dumps(items))
            fake = Path(folder) / 'security'
            fake.write_text(FAKE.format(python=sys.executable, store=str(store)))
            fake.chmod(fake.stat().st_mode | stat.S_IXUSR)
            env = {**os.environ, 'PATH': f'{folder}{os.pathsep}{os.environ["PATH"]}'}
            done = subprocess.run(['bash', str(SCRIPT), *flags], capture_output=True, text=True, env=env, cwd=folder)
            return done, json.loads(store.read_text())

    OLD = [{'acct': 'job-pilotto', 'svce': 'job-pilotto.notion.token', 'icmt': '', 'value': 'SECRET-N'},
           {'acct': 'igor', 'svce': 'job-pilotto.site.api_key', 'icmt': 'note=1', 'value': 'SECRET-S'},
           {'acct': 'job-pilotto', 'svce': 'job-pilotto.google.scopes', 'icmt': '', 'value': 'OLD-SCOPES'},
           {'acct': 'jobadabra', 'svce': 'jobadabra.google.scopes', 'icmt': '', 'value': 'NEW-SCOPES'},
           {'acct': 'igor', 'svce': 'unrelated.item', 'icmt': '', 'value': 'X'}]

    def test_a_dry_run_changes_nothing_and_names_what_it_would_copy(self):
        done, after = self.run_script(self.OLD)
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertEqual(after, self.OLD)
        self.assertIn('would copy  job-pilotto.notion.token -> jobadabra.notion.token', done.stdout)
        self.assertIn('exists   jobadabra.google.scopes', done.stdout)

    def test_go_copies_keeps_the_old_items_and_an_existing_new_one_and_prints_no_secret(self):
        done, after = self.run_script(self.OLD, '--go')
        self.assertEqual(done.returncode, 0, done.stderr)
        by = {(it['acct'], it['svce']): it for it in after}
        self.assertEqual(by[('jobadabra', 'jobadabra.notion.token')]['value'], 'SECRET-N')   # account job-pilotto -> jobadabra
        self.assertEqual(by[('igor', 'jobadabra.site.api_key')]['value'], 'SECRET-S')        # another account is kept
        self.assertEqual(by[('igor', 'jobadabra.site.api_key')]['icmt'], 'note=1')
        self.assertEqual(by[('jobadabra', 'jobadabra.google.scopes')]['value'], 'NEW-SCOPES')   # not overwritten
        for old in self.OLD:
            self.assertIn((old['acct'], old['svce']), by)   # nothing deleted
        self.assertNotRegex(done.stdout + done.stderr, 'SECRET|SCOPES')


if __name__ == '__main__':
    unittest.main()
