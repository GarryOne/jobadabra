"""Fails when the public repo's docs carry business material again (owner, 20 Oct 2026: prices, margins and plans live in jobadabra-internal)."""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOCS = [ROOT / 'CLAUDE.md', ROOT / 'AGENTS.md']   # the other top-level docs are on the gate cache's ignore list: no test may read them
DOCS += sorted((ROOT / 'docs').rglob('*.md')) + sorted((ROOT / '.claude' / 'skills').rglob('*.md'))
# A price or margin of ours, never a per-call AI cost (those are product behaviour the README states).
BUSINESS = [r'Pro plan', r'Pro price', r'launch price', r'\bmargins?\b', r'\$(?:29|19)\b', r'Stripe Checkout', r'credit top-?ups?']
PRIVATE_SPEC = re.compile(r'(?:jobadabra-internal|jobadabra-lab):docs/specs/')


class NoBusinessDocsTests(unittest.TestCase):
    def test_no_public_doc_states_a_price_margin_or_plan_of_ours(self):
        for path in DOCS:
            if not path.exists():
                continue
            for number, line in enumerate(path.read_text().splitlines(), 1):
                if PRIVATE_SPEC.search(line):
                    continue
                for pattern in BUSINESS:
                    hit = re.search(pattern, line)
                    self.assertIsNone(hit, f'{path.relative_to(ROOT)}:{number} says "{hit and hit.group(0)}": business material lives in the private repo jobadabra-internal docs/specs')

    def test_the_moved_specs_stay_out(self):
        for name in ('2026-10-16-pro-plan', '2026-10-16-hosted-always-on', '2026-10-16-free-workers-ai', '2026-10-19-site-private-repo'):
            self.assertFalse((ROOT / 'docs' / 'superpowers' / 'specs' / f'{name}.md').exists(), f'{name}.md moved to jobadabra-internal')


if __name__ == '__main__':
    unittest.main()
