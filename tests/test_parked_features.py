"""Parked features (src/features.py PARKED): off unless JOB_PILOTTO_ENABLE names them, and no visible entry in the app for any of them.

Owner, 26 Oct 2026, of the job-alert emails in Connections: "let's park/disable/hid this functionality for now. It's too advanced."
The class test loops over every parked feature, so a feature parked later gets the same checks.
"""
import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from src import features  # noqa: E402

# Everything a feature can need, so only the parking keeps it off.
EVERYTHING = {'GOOGLE_REFRESH_TOKEN': 't', 'NOTION_TOKEN': 'n', 'ANTHROPIC_API_KEY': 'k', 'SERPAPI_API_KEY': 's'}
RENDERER = ROOT / 'desktop' / 'renderer'
# Each parked feature: the words its screens used, so a copy left visible (or a new one) is found.
WORDS = {'job_alerts': re.compile(r'job[- ]alert', re.I)}
PARKED_BLOCK = re.compile(r'<(\w+)\b([^>]*\bdata-parked="([\w,]+)"[^>]*)>.*?</\1>', re.S)


def parked_blocks(html):
    return list(PARKED_BLOCK.finditer(html))


class ParkedFeatureTests(unittest.TestCase):
    def test_job_alerts_is_parked(self):
        self.assertIn('job_alerts', features.PARKED)

    def test_a_parked_feature_is_off_even_when_everything_it_needs_is_set(self):
        for name in features.PARKED:
            with self.subTest(name):
                self.assertTrue(features.configured(name, EVERYTHING))
                self.assertFalse(features.enabled(name, EVERYTHING))
                self.assertTrue(features.parked(name, EVERYTHING))
                self.assertTrue(features.enabled(name, {**EVERYTHING, 'JOB_PILOTTO_ENABLE': f'other, {name.upper()} '}))
                self.assertFalse(features.enabled(name, {**EVERYTHING, 'JOB_PILOTTO_ENABLE': name, 'JOB_PILOTTO_DISABLE': name}))
                states = {f.name: state for f, state, _ in features.status(EVERYTHING)}
                self.assertEqual(states[name], 'parked')
        self.assertFalse(features.parked('mail', EVERYTHING))

    def test_every_parked_feature_names_its_screen_words(self):
        self.assertEqual(set(WORDS), set(features.PARKED))

    def test_a_parked_feature_has_no_visible_entry_in_the_app(self):
        """Connections, the ⌘K palette, the wizard, What's new, Recent activity: no renderer text offers a parked feature."""
        html = (RENDERER / 'index.html').read_text()
        for match in parked_blocks(html):
            self.assertRegex(match.group(2), r'\bhidden\b', f'a data-parked block is not hidden: {match.group(0)[:80]}')
        shown = PARKED_BLOCK.sub('', html)
        scripts = {path: path.read_text() for path in RENDERER.rglob('*.js')}
        for name, words in WORDS.items():
            with self.subTest(name):
                self.assertIsNone(words.search(shown), 'index.html shows it outside a hidden data-parked block')
                for path, text in scripts.items():
                    for line in text.splitlines():
                        if words.search(line) and not line.lstrip().startswith('//'):
                            self.fail(f'{path.relative_to(ROOT)} shows it: {line.strip()[:100]}')

    def test_every_hidden_block_belongs_to_a_parked_feature(self):
        """Un-parking a feature shows its screen again: no block stays hidden for a feature that is back."""
        html = (RENDERER / 'index.html').read_text()
        for match in parked_blocks(html):
            for name in match.group(3).split(','):
                self.assertIn(name, features.PARKED, f'data-parked="{name}" but {name} is not in features.PARKED')


if __name__ == '__main__':
    unittest.main()
