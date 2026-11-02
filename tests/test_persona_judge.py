"""The persona search check's top-10 judge (tools/persona-search/judge.py): it reads the fictional CV itself, never the app's drafted profile,
counts the jobs it calls right, drops answers about jobs it was not shown, and run.mjs keeps it off the tape and off the API engine."""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools' / 'persona-search'))
import judge  # noqa: E402


class FakeClient:
    def __init__(self, answer):
        self.answer, self.asked = answer, []
        self.messages = self

    def create(self, **call):
        self.asked.append(call)
        return SimpleNamespace(content=[SimpleNamespace(type='text', text=json.dumps(self.answer))])


def out_dir(top, draft=None):
    tmp = tempfile.TemporaryDirectory()
    path = Path(tmp.name)
    (path / 'presses.jsonl').write_text(json.dumps({'press': 1, 'top10': top}) + '\n')
    if draft:
        (path / 'draft.json').write_text(json.dumps(draft))
    return tmp, path


TOP = [{'fit': 80, 'title': 'Financial Analyst', 'company': 'Acme', 'location': 'Amsterdam'},
       {'fit': 74, 'title': 'Magazijnmedewerker', 'company': 'Depot', 'location': 'Almere'}]


class JudgeTest(unittest.TestCase):
    def test_it_counts_the_right_jobs_from_the_cv_itself(self):
        tmp, path = out_dir(TOP, draft={'profile_markdown': 'DRAFTED PROFILE'})
        self.addCleanup(tmp.cleanup)
        client = FakeClient({'jobs': [{'n': 1, 'right': True, 'why': 'FP&A in Amsterdam'}, {'n': 2, 'right': False, 'why': 'warehouse'},
                                      {'n': 7, 'right': True, 'why': 'not shown'}]})
        result = judge.judge(path, 'finance', client=client)
        self.assertEqual((result['right'], result['of']), (1, 2), 'an answer about a job it was not shown is dropped')
        sent = client.asked[0]['messages'][0]['content']
        self.assertIn('Senior Financial Analyst (FP&A)', sent)
        self.assertNotIn('DRAFTED PROFILE', sent, 'the fictional CV, not the strategy the app drafted from it')

    def test_the_sre_control_falls_back_to_the_drafted_profile(self):
        tmp, path = out_dir(TOP, draft={'profile_markdown': 'SRE in Zurich'})
        self.addCleanup(tmp.cleanup)
        client = FakeClient({'jobs': []})
        judge.judge(path, 'sre', client=client)
        self.assertIn('SRE in Zurich', client.asked[0]['messages'][0]['content'])

    def test_no_top_jobs_asks_nothing(self):
        tmp, path = out_dir([])
        self.addCleanup(tmp.cleanup)
        client = FakeClient({'jobs': []})
        self.assertEqual(judge.judge(path, 'finance', client=client), {'right': 0, 'of': 0, 'verdicts': []})
        self.assertEqual(client.asked, [])

    def test_run_mjs_keeps_the_judge_off_the_tape_and_off_the_api_engine(self):
        source = (ROOT / 'tools' / 'persona-search' / 'run.mjs').read_text()
        self.assertIn("process.argv.includes('--judge') && !api", source)
        self.assertIn("key.startsWith('JOBADABRA_SEARCH_TAPE')", source)


if __name__ == '__main__':
    unittest.main()
