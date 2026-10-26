"""Each AI prompt with an answer schema says every field's guidance itself: Free AI's model reads the prompt, not the schema's descriptions."""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from src.ai import enrich, score  # noqa: E402


def described(properties, prefix=''):
    for name, spec in properties.items():
        if spec.get('description'):
            yield f'{prefix}{name}', spec['description']
        inner = spec.get('properties') or (spec.get('items') or {}).get('properties')
        if inner:
            yield from described(inner, f'{prefix}{name}.')


class FieldGuidanceInPrompt(unittest.TestCase):
    # E2E quality on Free AI (26 Oct 2026, #1992): SRE jobs came back "engineering", two jobs with empty Technologies, a senior role with a
    # null Growth, while each rule sat only in a schema description. A description missing from the prompt is guidance some models never read.
    PROMPTS = {'job facts (src/ai/enrich.py)': (enrich.SCHEMA, enrich.SYSTEM), 'scoring (src/ai/score.py)': (score.SCHEMA, score.SYSTEM)}

    def test_every_described_field_is_in_its_prompt(self):
        for where, (schema, prompt) in self.PROMPTS.items():
            with self.subTest(where):
                self.assertEqual([name for name, note in described(schema['properties']) if note not in prompt], [])

    def test_every_fact_with_a_judged_value_says_what_it_means(self):
        # 26 Oct 2026: "English is the working language; French is a plus" came back english_is_enough = no; the field had no words at all.
        unexplained = [name for name, spec in enrich.SCHEMA['properties'].items()
                       if spec.get('type') == 'object' and 'value' in spec.get('properties', {}) and not spec.get('description')
                       and f'{name} ' not in enrich.SYSTEM and f'{name}:' not in enrich.SYSTEM]
        self.assertEqual(unexplained, [])
        self.assertIn('a plus', enrich.SCHEMA['properties']['english_is_enough']['description'])

    def test_years_asked_give_the_level(self):
        # 26 Oct 2026, #2056's run: "5 years of enterprise sales experience" with no level word came back seniority unknown (so Growth empty)
        # after #2052 said "the level the title or text states".
        self.assertIn('the years of experience it asks', enrich.SYSTEM)

    def test_a_title_that_names_its_work_decides_the_family(self):
        # 26 Oct 2026, #2056's quality run: "Senior Site Reliability Engineer" came back "software" on Free AI.
        self.assertIn('when the title names a kind of work below', enrich.SYSTEM)

    def test_the_scorer_is_told_when_growth_may_stay_unknown(self):
        self.assertIn('components.growth: 0-100, or null when the posting gives no basis', score.SYSTEM)
        self.assertIn('basis.level_stated: ', score.SYSTEM)


if __name__ == '__main__':
    unittest.main()
