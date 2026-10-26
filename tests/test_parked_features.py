"""Parked features (src/features.py PARKED): off unless JOB_PILOTTO_ENABLE names them, and no visible entry in the app for any of them.

Owner, 26 Oct 2026, of the job-alert emails in Connections: "let's park/disable/hid this functionality for now. It's too advanced."
Owner, 26 Oct 2026, of the Adzuna and Jooble card: "let's hide/disable this functionality for noow. Is to hadr to use for my users." With its two
siblings that ask for a key (Google Jobs via SerpApi, Brave web search). Web search itself stays: without a key it is the user's own plan.
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
EVERYTHING = {'GOOGLE_REFRESH_TOKEN': 't', 'NOTION_TOKEN': 'n', 'ANTHROPIC_API_KEY': 'k', 'SERPAPI_API_KEY': 's', 'BRAVE_SEARCH_API_KEY': 'b',
              'ADZUNA_APP_ID': 'i', 'ADZUNA_APP_KEY': 'a', 'JOOBLE_API_KEY': 'j'}
RENDERER = ROOT / 'desktop' / 'renderer'
# Each parked feature: the words its screens used, so a copy left visible (or a new one) is found. Case matters for the key sources:
# their ids and variable names (serpapi, ADZUNA_APP_ID) are code, their names (SerpApi, Adzuna) are what a person reads.
WORDS = {'job_alerts': re.compile(r'job[- ]alert', re.I), 'adzuna': re.compile(r'Adzuna'), 'jooble': re.compile(r'Jooble'),
         'google_jobs': re.compile(r'Google Jobs|SerpApi'), 'brave_search': re.compile(r'Brave Search|Web search \(Brave\)')}
# The renderer's copy of the parked key sources: a script that names one draws it only through key-sources.js offered() (false while parked).
KEY_SOURCES = {'serpapi': {'google_jobs'}, 'brave': {'brave_search'}, 'aggregators': {'adzuna', 'jooble'}}
GATED = re.compile(r"import \{[^}]*\boffered\b[^}]*\} from '\.\.?/(\.\./)?key-sources\.js'")
START = re.compile(r'<(\w+)\b([^>]*\bdata-parked="([\w,]+)"[^>]*)>')


class Block:
    """One element with data-parked, to its own closing tag (nested tags of the same name counted)."""
    def __init__(self, html, start):
        self.attrs, self.names, tag = start.group(2), start.group(3).split(','), start.group(1)
        depth, at = 1, start.end()
        for tag_match in re.compile(rf'<(/?){tag}\b[^>]*>').finditer(html, at):
            depth += -1 if tag_match.group(1) else 1
            if not depth:
                self.span = (start.start(), tag_match.end())
                break
        self.text = html[self.span[0]:self.span[1]]


def parked_blocks(html):
    return [Block(html, start) for start in START.finditer(html)]


def outside_parked(html):
    blocks = parked_blocks(html)
    for block in sorted(blocks, key=lambda b: -b.span[0]):
        html = html[:block.span[0]] + html[block.span[1]:]
    return html, {match for block in blocks for match in re.findall(r'\bid="([\w-]+)"', block.text)}


class ParkedFeatureTests(unittest.TestCase):
    def test_job_alerts_and_the_key_sources_are_parked(self):
        self.assertTrue({'job_alerts', 'adzuna', 'jooble', 'google_jobs', 'brave_search'} <= features.PARKED)
        self.assertNotIn('web_search', features.PARKED, "keyless web search (the user's own plan) is not parked, only its keys")

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
        for block in parked_blocks(html):
            self.assertRegex(block.attrs, r'\bhidden\b', f'a data-parked block is not hidden: {block.text[:80]}')
        shown, parked_ids = outside_parked(html)
        scripts = {path: path.read_text() for path in RENDERER.rglob('*.js')}
        for name, words in WORDS.items():
            with self.subTest(name):
                self.assertIsNone(words.search(shown), 'index.html shows it outside a hidden data-parked block')
                for path, text in scripts.items():
                    gated = path.name == 'key-sources.js' or (GATED.search(text) and any(name in names for names in KEY_SOURCES.values()))
                    for line in text.splitlines():
                        if not words.search(line) or line.lstrip().startswith('//') or gated:
                            continue
                        if any(f"'{element}'" in line for element in parked_ids):
                            continue   # sets up an element inside a hidden data-parked block (an input's placeholder, a Save button)
                        self.fail(f'{path.relative_to(ROOT)} shows it: {line.strip()[:100]}')

    def test_the_renderer_and_python_park_the_same_key_sources(self):
        """key-sources.js (renderer) and coverage.KEY_SOURCES_OFFERED (Find jobs suggestions) stay off while their features are parked."""
        from src import coverage
        js = (RENDERER / 'key-sources.js').read_text()
        self.assertEqual(set(re.search(r'KEY_SOURCE_IDS = \[([^\]]*)\]', js).group(1).replace("'", '').replace(' ', '').split(',')), set(KEY_SOURCES))
        self.assertEqual({source['id'] for source in coverage.SOURCES}, set(KEY_SOURCES))
        if all(names <= features.PARKED for names in KEY_SOURCES.values()):
            self.assertRegex(js, r'keySources = \{offered: false\}')
            self.assertFalse(coverage.KEY_SOURCES_OFFERED)

    def test_a_parked_card_is_never_opened_or_listed_in_the_palette(self):
        """Owner's screenshot (26 Oct 2026) was the Adzuna and Jooble card reached while it was hidden: ⌘K lists closed Connections cards."""
        nav = (RENDERER / 'pages' / 'nav.js').read_text()
        settings = (RENDERER / 'pages' / 'settings.js').read_text()
        self.assertRegex(nav, r"onClosedPanel = section => section\.classList\.contains\('conn-panel'\) && !section\.dataset\.parked")
        self.assertRegex(settings, r"if \(!card \|\| card\.closest\('\[data-parked\]'\)\) return;")

    def test_every_hidden_block_belongs_to_a_parked_feature(self):
        """Un-parking a feature shows its screen again: no block stays hidden for a feature that is back."""
        html = (RENDERER / 'index.html').read_text()
        for block in parked_blocks(html):
            for name in block.names:
                self.assertIn(name, features.PARKED, f'data-parked="{name}" but {name} is not in features.PARKED')


if __name__ == '__main__':
    unittest.main()
