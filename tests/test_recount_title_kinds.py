"""The index's job titles re-counted by kind on the owner's Claude plan (tools/recount_title_kinds.py) and seeded into the central scout
(src/scout_title_seed.py; owner, 26 Oct 2026: "do that from local, to rely on subscription. not costs")."""
import gzip
import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / 'tools'))
import recount_title_kinds as recount  # noqa: E402
from src import role_kinds, scout_title_seed  # noqa: E402
from src.ai import decide  # noqa: E402


class ToolTests(unittest.TestCase):
    def folder(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        return Path(folder.name)

    def test_it_runs_on_the_plan_only_and_in_its_own_folder(self):
        work, env = self.folder(), {'ANTHROPIC_API_KEY': 'sk-test', 'JOB_PILOTTO_AI_FALLBACK': 'api', 'JOB_PILOTTO_AI_ENGINE': 'api'}
        recount.prepare(work, env)
        self.assertEqual(env['JOB_PILOTTO_AI_ENGINE'], 'cli')
        self.assertNotIn('ANTHROPIC_API_KEY', env)
        self.assertNotIn('JOB_PILOTTO_AI_FALLBACK', env)
        self.assertEqual((env['JOB_PILOTTO_DATA_DIR'], env['JOB_PILOTTO_CONFIG_DIR']), (str(work / 'data'), str(work / 'config')))

    def test_titles_are_read_once_and_page_readers_are_left_to_the_scout(self):
        work, reads = self.folder(), []

        def fetch(ats, slug):
            reads.append(slug)
            if slug == 'dead':
                raise OSError('gone')
            return [{'title': f'{slug} pilot'}]
        feeds = [{'ats': 'greenhouse', 'slug': 'air'}, {'ats': 'careers', 'slug': 'page'}, {'ats': 'lever', 'slug': 'dead'}]
        self.assertEqual(recount.titles_of(feeds, work, 2, fetch, say=lambda line: None), {'greenhouse:air': ['air pilot']})
        recount.titles_of(feeds, work, 2, fetch, say=lambda line: None)
        self.assertEqual(sorted(reads), ['air', 'dead'], 'the second run reads no feed again')

    def test_the_most_frequent_unknown_titles_are_asked_first(self):
        by_feed = {'a': ['First Officer', 'Nurse', 'first officer'], 'b': ['Cabin Crew', 'First Officer']}
        self.assertEqual(recount.to_judge(by_feed, lambda title: title == 'Nurse'), ['First Officer', 'Cabin Crew'])

    def test_the_export_keeps_answers_since_the_kinds_grew(self):
        work = self.folder()
        db = work / 'jobs.sqlite'
        with sqlite3.connect(db) as conn:
            decide._table(conn)
            conn.executemany('INSERT INTO decisions VALUES (?, ?, ?, ?)', [
                ('job-title-kind', 'first officer', 'aviation_transport', '2026-10-27T01:00:00+00:00'),
                ('job-title-kind', 'old answer', 'finance_admin', '2026-10-01T01:00:00+00:00'),
                ('role-kind', 'pilot', 'aviation_transport', '2026-10-27T01:00:00+00:00')])
        out = work / 'out' / 'title_kinds.json.gz'
        self.assertEqual(recount.export(db, role_kinds.SINCE, out, role_kinds.KINDS), 1)
        with gzip.open(out, 'rt', encoding='utf-8') as handle:
            self.assertEqual(json.load(handle), {'first officer': 'aviation_transport'})


class SeedTests(unittest.TestCase):
    def test_the_scout_keeps_the_seed_and_asks_only_new_titles(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        path = Path(folder.name) / 'title_kinds.json.gz'
        with gzip.open(path, 'wt', encoding='utf-8') as handle:
            json.dump({'First Officer': 'aviation_transport', 'process engineer': 'engineering', 'hacker': 'not-a-kind', 'nurse': 'healthcare'}, handle)
        db = sqlite3.connect(':memory:')
        decide._table(db)
        db.execute("INSERT INTO decisions VALUES ('job-title-kind', 'process engineer', 'other', '2026-10-01T00:00:00+00:00')")   # before the kinds grew
        db.execute("INSERT INTO decisions VALUES ('job-title-kind', 'nurse', 'education', '2026-10-27T00:00:00+00:00')")   # judged since: kept
        self.assertEqual(scout_title_seed.load(path, db), 2)
        self.assertEqual(decide.kept('job-title-kind', ['first officer', 'process engineer', 'nurse', 'hacker'], db, since=role_kinds.SINCE),
                         {'first officer': 'aviation_transport', 'process engineer': 'engineering', 'nurse': 'education'})

    def test_no_file_changes_nothing(self):
        self.assertEqual(scout_title_seed.load(Path('/nonexistent/title_kinds.json.gz')), 0)

    def test_the_central_scout_is_given_the_seed_from_the_private_repo(self):
        workflow = (ROOT / '.github' / 'workflows' / 'central-scout.yml').read_text(encoding='utf-8')
        self.assertIn('SCOUT_TITLE_KINDS: ops/config/title_kinds.json.gz', workflow)
        self.assertIn('scout_title_seed.load()', (ROOT / 'src' / 'scout_index.py').read_text(encoding='utf-8'))


if __name__ == '__main__':
    unittest.main()
