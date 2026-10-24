"""The session-check upload (tools/persona-search/publish-session-check.py): the board lines of a run log, the row built from a press, and that no secret or job text is in the dry output."""
import argparse
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('publish_session_check', ROOT / 'tools' / 'persona-search' / 'publish-session-check.py')
publish = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publish)

LOG = '''[66s] Job boards proposed for Croatia: MojPosao, Posao.hr
[107s] Job boards found: MojPosao 34 job(s), 0 relevant
[113s] Job boards found: Jooble Hrvatska 0 job(s), 0 relevant (refuses automated reading: offered as a visit)
[166s] Job boards found: MojPosao 33 job(s), 0 relevant
[298s] Job boards found: Posao.hr read from its own section (23 relevant against 2)
[298s] Job boards found: Posao.hr 95 job(s), 23 relevant
[300s] Job boards found: Töö24 can't be reached
'''
PRESS = {'press': 1, 'crashes': [], 'seconds': 1148, 'in_places': 105, 'scored_in_places': 93, 'fit70_in_places': 0, 'local_jobs': 24, 'ttfr': {'first_in_places_s': 77}}


class PublishTests(unittest.TestCase):
    def test_the_last_counts_line_of_each_board_is_kept_with_its_note(self):
        found = {board['name']: board for board in publish.boards(LOG)}
        self.assertEqual((found['MojPosao']['listed'], found['MojPosao']['relevant']), (33, 0))
        self.assertEqual((found['Posao.hr']['listed'], found['Posao.hr']['relevant'], found['Posao.hr']['note']), (95, 23, 'own section read'))
        self.assertIn('refuses automated reading', found['Jooble Hrvatska']['note'])
        self.assertNotIn("Töö24", found, 'a board that cannot be reached has no counts')

    def test_the_row_carries_counts_and_boards_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp) / 'nurse-zagreb'
            folder.mkdir()
            (folder / 'presses.jsonl').write_text(json.dumps(PRESS) + '\n', encoding='utf-8')
            (folder / 'run-1.log').write_text(LOG, encoding='utf-8')
            args = argparse.Namespace(session='4e', label='Nurse, Zagreb', country='Croatia', role='nurse', build='1525fb1', mode='full', broke='', conclusion='ok', prs='#1825', local_jobs=None)
            made = publish.row(tmp, 'nurse-zagreb', args)
        self.assertEqual((made['local_jobs'], made['first_s'], made['state'], made['mode']), (24, 77, 'ok', 'full'))
        self.assertEqual(sorted(made), sorted(['session', 'case_id', 'label', 'country', 'role', 'run_at', 'build', 'mode', 'state', 'seconds', 'first_s', 'local_jobs', 'in_places',
                                               'scored', 'fit70', 'boards', 'broke', 'conclusion', 'prs']))

    def test_the_key_is_read_from_the_keychain_and_never_printed(self):
        text = (ROOT / 'tools' / 'persona-search' / 'publish-session-check.py').read_text(encoding='utf-8')
        self.assertIn('job-pilotto.site.session_checks_key', text)
        self.assertNotIn('print(key', text)

    def test_the_request_names_itself_because_cloudflare_refuses_the_default_agent(self):
        text = (ROOT / 'tools' / 'persona-search' / 'publish-session-check.py').read_text(encoding='utf-8')
        self.assertIn("'User-Agent': USER_AGENT", text)
        self.assertTrue(publish.USER_AGENT.startswith('jobadabra-'))


if __name__ == '__main__':
    unittest.main()
