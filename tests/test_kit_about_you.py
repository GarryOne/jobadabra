"""Kits read the CV with the Experience bank from About you (owner, 28 Oct 2026, D1b option A; desktop/lib/about-you.js READERS.kit): the app writes it
for the run (JOB_PILOTTO_ABOUT_YOU_FILE), kit.draft puts it beside the Profile and standard answers, and a figure only the CV states survives the floors.
A run with no file (the cloud, no CV imported) drafts as before and names the CV as lacked (spec criterion 6). A recording fake AI; fictional data."""
import json
import os
import tempfile
import unittest
from types import SimpleNamespace
from unittest import mock

from src.ai import kit

CV = {'name': 'Alex Morgan', 'jobs': [{'company': 'Northwind', 'roles': [{'title': 'SRE', 'period': '2022 – Present',
      'bullets': ['Ran the on-call rotation.', 'Cut alert noise by 60% with a new paging policy.'], 'extra': [1]}]}]}
JOB = {'title': 'SRE', 'company': 'Acme', 'url': 'https://example.com/job', 'description': 'On-call for a payments platform.'}
BANK_ANSWER = 'I cut alert noise by 60% with a new paging policy.'


class Recording:
    """An AI client that keeps each request and answers one experience question from the bank bullet."""
    def __init__(self):
        self.requests, self.messages = [], self

    def create(self, **params):
        self.requests.append(params)
        drafted = {'eligible': True, 'eligibility_note': '', 'cover_letter': 'Para one.\n\nPara two.', 'highlights': ['On-call'], 'check_before_sending': [],
                   'answers': [{'field': 'q1', 'question': 'Tell us about reducing alert fatigue', 'answer': BANK_ANSWER, 'needs_review': False, 'category': 'normal'}]}
        return SimpleNamespace(stop_reason='end_turn', content=[SimpleNamespace(type='text', text=json.dumps(drafted))],
                               usage=SimpleNamespace(input_tokens=10, output_tokens=10, cache_read_input_tokens=0, cache_creation_input_tokens=0))


def bundle_file(bundle):
    file = tempfile.NamedTemporaryFile('w', suffix='.json', delete=False, encoding='utf-8')
    json.dump(bundle, file)
    file.close()
    return file.name


class KitAboutYouTest(unittest.TestCase):
    def test_a_kit_run_reads_the_bank_bullet_and_keeps_an_answer_resting_on_it(self):
        path = bundle_file({'reader': 'kit', 'parts': {'cv': CV}, 'lacked': []})
        with mock.patch.dict(os.environ, {'JOB_PILOTTO_ABOUT_YOU_FILE': path}):
            cv, lacked = kit.about_you()
        self.assertEqual(lacked, [])
        client = Recording()
        drafted, _ = kit.draft(client, 'm', JOB, 'Profile text', 'Answers text', [], cv)
        system = client.requests[0]['system'][0]['text']
        self.assertIn('Cut alert noise by 60% with a new paging policy.', system)
        self.assertIn('Profile text', system)
        self.assertIn('Answers text', system)
        self.assertEqual(drafted['answers'][0]['answer'], BANK_ANSWER, 'a figure the CV states is grounded')

    def test_without_a_bundle_the_kit_drafts_from_the_pages_names_the_cv_lacked_and_floors_an_unsupported_figure(self):
        with mock.patch.dict(os.environ, {'JOB_PILOTTO_ABOUT_YOU_FILE': ''}):
            cv, lacked = kit.about_you()
        self.assertEqual((cv, lacked), ('', ['cv']))
        client = Recording()
        drafted, _ = kit.draft(client, 'm', JOB, 'Profile text', 'Answers text', [], cv)
        self.assertNotIn('\n\nCV:\n', client.requests[0]['system'][0]['text'])
        self.assertNotEqual(drafted['answers'][0]['answer'], BANK_ANSWER, 'nothing given states 60%: the sentence is left out')
        self.assertTrue(drafted['answers'][0]['needs_review'])

    def test_an_unreadable_or_cv_less_bundle_is_a_lacked_cv_never_a_crash(self):
        for content in ['{not json', json.dumps({'reader': 'kit', 'parts': {}, 'lacked': ['cv']})]:
            with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False, encoding='utf-8') as file:
                file.write(content)
            path = file.name
            with mock.patch.dict(os.environ, {'JOB_PILOTTO_ABOUT_YOU_FILE': path}):
                self.assertEqual(kit.about_you(), ('', ['cv']))


    def test_the_kit_case_set_is_shaped_as_kit_draft_reads_it(self):
        # Why (28 Oct 2026): two replays of tools/kit-cases.py died on a question without options, then without kind: the shape is checked here, offline.
        from pathlib import Path
        fixture = json.loads((Path(__file__).parent / 'fixtures' / 'kit-cases.json').read_text(encoding='utf-8'))
        self.assertIn('extra', json.dumps(fixture['cv']), 'the set holds Experience bank bullets')
        for case in fixture['cases']:
            kit._question_text(case['questions'])
            fields = {q['field'] for q in case['questions']} | {'letter'}
            self.assertLessEqual(set(case['expect']), fields, case['id'])


if __name__ == '__main__':
    unittest.main()
