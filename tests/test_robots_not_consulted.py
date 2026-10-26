"""The board readers never refuse a page because of robots.txt (owner, 6 + 26 Oct 2026: "nobody cares about that, our users just want to
search/find jobs"); robots.txt is read only for its Sitemap: lines (discovery). A fixture site that disallows everything is still read."""
import re
import unittest
from pathlib import Path

from src.sources import board_forms, board_pages, board_sections

ROOT = Path(__file__).resolve().parent.parent
ROBOTS_DISALLOW_ALL = 'User-agent: *\nDisallow: /'
REFUSAL = re.compile(r'robotparser|RobotFileParser|can_fetch')


class RobotsNotConsultedTests(unittest.TestCase):
    def test_no_reader_keeps_a_robots_check(self):
        for module in (board_pages, board_forms, board_sections):
            self.assertFalse(hasattr(module, 'allowed') or hasattr(module, '_robots'), module.__name__)

    def test_a_site_disallowing_everything_is_still_paged(self):
        link = '<link rel="next" href="https://s.example/jobs?page=2">'
        pages = {'https://s.example/robots.txt': ROBOTS_DISALLOW_ALL, 'https://s.example/jobs?page=2': '<html>two</html>'}
        asked = []
        def fetch(url):
            asked.append(url)
            return pages[url]
        board_pages.more('https://s.example/jobs', f'<html>{link}</html>', [{'url': 'https://s.example/a', 'title': 'a'}], fetch,
                         lambda markup, url: [{'url': url, 'title': 'b'}], lambda some: True, sleep=lambda s: None)
        self.assertIn('https://s.example/jobs?page=2', asked)

    def test_no_source_file_refuses_a_page_through_robots_txt(self):
        found = [str(path.relative_to(ROOT)) for folder in ('src', 'extension', 'desktop/lib') for path in (ROOT / folder).rglob('*')
                 if path.suffix in ('.py', '.js', '.mjs') and 'node_modules' not in path.parts and REFUSAL.search(path.read_text(errors='ignore'))]
        self.assertEqual(found, [], 'robots.txt is not a reason to skip a public job page (CLAUDE.md safety rules)')


if __name__ == '__main__':
    unittest.main()
