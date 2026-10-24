"""The offline page probe and the quick check's local-jobs count (tools/persona-search/page-probe.py, run.mjs --first-only, metrics.py local_jobs)."""
import importlib.util
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), ROOT / 'tools' / 'persona-search' / f'{name}.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class PageProbeTests(unittest.TestCase):
    def test_a_saved_list_page_shows_its_job_links_and_next_pages(self):
        base = 'https://jobs.example/lista'
        cards = ''.join(f'<a href="/oglas/posao-{n}/{100000 + n}/">Posao {n}</a>' for n in range(6))
        paging = ''.join(f'<a href="{base}?offset={n}">{n}</a>' for n in (20, 40, 60))
        found = load('page-probe').probe(f'<html>{cards}{paging}</html>', base)
        self.assertEqual((found['job_links_n'], found['next_pages']), (6, [f'{base}?offset={n}' for n in (20, 40, 60)]))


class QuickCheckTests(unittest.TestCase):
    def test_first_only_is_documented_and_wired(self):
        text = (ROOT / 'tools' / 'persona-search' / 'run.mjs').read_text(encoding='utf-8')
        self.assertIn("process.argv.includes('--first-only')", text)
        self.assertIn('--first-only:', text)

    def test_metrics_counts_local_jobs_by_source(self):
        text = (ROOT / 'tools' / 'persona-search' / 'metrics.py').read_text(encoding='utf-8')
        self.assertIn("'local_jobs'", text)
        self.assertIn("'local_by_source'", text)

    def test_a_place_list_is_not_counted_as_local(self):
        text = (ROOT / 'tools' / 'persona-search' / 'metrics.py').read_text(encoding='utf-8')
        self.assertIn('LIST_LOCATION = 60', text)
        self.assertIn('len(row[2] or \'\') <= LIST_LOCATION', text)


if __name__ == '__main__':
    unittest.main()
