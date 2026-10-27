"""tools/free-ai-kit-cases.py builds the Free AI kit (CV highlights, cover letter) cases from the app's own kit request (src/ai/kit.py) over the invented postings and the demo profile."""
import importlib.util
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('free_ai_kit_cases', ROOT / 'tools' / 'free-ai-kit-cases.py')
tool = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(tool)


class FreeAiKitCasesTest(unittest.TestCase):
    def setUp(self):
        self.jobs = json.loads((ROOT / 'tools' / 'free-ai-eval-jobs.json').read_text())
        self.profile = (ROOT / 'desktop' / 'demo' / 'profile.md').read_text()
        self.answers = (ROOT / 'desktop' / 'demo' / 'answers.md').read_text()
        self.out = tool.cases(self.jobs, self.profile, self.answers)

    def test_each_case_is_the_apps_kit_request_with_the_demo_profile_and_an_eligibility_expectation(self):
        self.assertGreaterEqual(len(self.out), 12)
        by_id = {job['id']: job for job in self.jobs}
        for case in self.out:
            params = case['params']
            system = params['system'][0]['text']
            self.assertIn('You prepare job applications for one candidate', system)
            self.assertIn('Alex Morgan', system)
            self.assertIn(by_id[case['id']]['description'], params['messages'][0]['content'])
            self.assertIn('eligible', case['expect'])
            self.assertIn(by_id[case['id']]['description'], case['ground'])
            self.assertIn('Alex Morgan', case['ground'])
        self.assertEqual({case['expect']['eligible'] for case in self.out}, {True, False})

    def test_the_schema_is_the_kits(self):
        self.assertEqual(self.out[0]['params']['output_config']['format']['schema']['required'][0], 'eligible')

    def test_all_jobs_adds_the_postings_without_an_asserted_eligibility(self):
        everything = tool.cases(self.jobs, self.profile, self.answers, all_jobs=True)
        self.assertEqual(len(everything), len(self.jobs))
        self.assertGreater(len(everything), len(self.out))
        self.assertEqual([case['id'] for case in everything if case['id'] in {c['id'] for c in self.out}], [c['id'] for c in self.out])


if __name__ == '__main__':
    unittest.main()
