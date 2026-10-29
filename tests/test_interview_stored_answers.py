"""Validate authored backbone replies with the engine's schemas, review parser and insight evidence checks."""
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock

from src.ai import engine, interview_insights, interviews_ai
from src.ai.interviews_blocks import analysis_blocks
from src.stores.notion_blocks import plain_text

ROOT = Path(__file__).resolve().parent.parent
TABLE = ROOT / 'desktop/e2e/fixtures/golden/ai-answers.json'


class StoredInterviewAnswers(unittest.TestCase):
    def setUp(self):
        self.table = json.loads(TABLE.read_text())

    def reviews(self):
        return self.table['answers']['app.interview'].items()

    def test_stored_reviews_pass_the_engine_validator_and_real_analyse_parser(self):
        for caption, entry in self.reviews():
            with self.subTest(caption=caption):
                reply = entry['reply']
                result = json.loads(reply['content'][0]['text'])
                self.assertEqual(engine.problems(result, interviews_ai.SCHEMA), [])
                # Why (29 Oct 2026, ap): the chosen job wins; stored replies must not guess a mutable application-list index.
                self.assertEqual(result['application'], -1)
                response = SimpleNamespace(stop_reason=reply['stop_reason'], usage=SimpleNamespace(**reply['usage']),
                                           content=[SimpleNamespace(**block) for block in reply['content']])
                client = SimpleNamespace(messages=SimpleNamespace(create=Mock(return_value=response)))
                parsed, _, _ = interviews_ai.analyse(client, interviews_ai.DEFAULT_MODEL, '', [], caption, 'fixture transcript')
                self.assertEqual(parsed, result)
                schema = client.messages.create.call_args.kwargs['output_config']['format']['schema']
                self.assertEqual(engine.problems(parsed, schema), [])

    def test_stored_reviews_render_the_sections_and_next_step_the_suite_asserts(self):
        for caption, entry in self.reviews():
            with self.subTest(caption=caption):
                result = json.loads(entry['reply']['content'][0]['text'])
                self.assertIn(result['overall'], ('positive', 'neutral', 'negative'))
                self.assertTrue(result['next_step'].strip())
                blocks = analysis_blocks(result)
                headings = [plain_text(b['heading_3']['rich_text']) for b in blocks if b['type'] == 'heading_3']
                for heading in ('Strengths', 'Questions', 'Practise before the next round'):
                    self.assertEqual(headings.count(heading), 1)
                self.assertNotIn('SEED', json.dumps(blocks))

    def test_patterns_reply_passes_schema_and_real_evidence_validation(self):
        result = json.loads(self.table['kinds']['interview_patterns']['answer']['reply']['content'][0]['text'])
        self.assertEqual(engine.problems(result, interview_insights.SCHEMA), [])
        transcript = (ROOT / 'desktop/e2e/lib/interview-data.mjs').read_text().split('export const TRANSCRIPT = `', 1)[1].split('`;', 1)[0]
        items = [{'label': 'I1', 'id': 'fixture-review', 'transcript': transcript,
                  'summary': '', 'next_step': '', 'round': 'Recruiter screen', 'topics': [], 'weak_topics': [],
                  'strengths': [], 'weak_spots': [], 'practice': [], 'signals': [], 'weak_answers': []}]
        validated = interview_insights.validate(result, items)
        self.assertFalse(validated['nothing_useful'])
        self.assertEqual(len(validated['patterns']), 1)
        self.assertTrue(validated['patterns'][0]['tentative'])
        self.assertEqual(validated['patterns'][0]['evidence'][0]['interview'], 'fixture-review')
        self.assertEqual(len(validated['next_steps']), 1)
