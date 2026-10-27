import sys
import tempfile
import unittest
from unittest import mock
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.sources import feed_facts, feeds  # noqa: E402
from src.sources.feeds import database, scan, render


class WatchTests(unittest.TestCase):
    def setUp(self):   # each scan here is a read: the 6-hour "unchanged" skip (src/sources/feed_facts.py) is off
        # No AI title sort has run here: an earlier test in the same process (a CI shard, #2178) may have left its "asked" mark in the
        # shared judged titles, and then every title the AI did not judge reads as unwanted. These tests check the words' floor.
        for patch in (mock.patch.object(feed_facts, 'FRESH_HOURS', 0), mock.patch.object(feeds, 'TRIAGED', {})):
            patch.start()
            self.addCleanup(patch.stop)

    def test_dedup_changes_and_source_failures(self):
        sources = [{"company": "A", "board": "a"}, {"company": "B", "ats": "lever", "slug": "b"}]
        job = {"id": "1", "title": "Site Reliability Engineer", "location": "Zurich", "url": "https://example.com/1",
               "remote": False}
        def fetch(source):
            if source.get("slug") == "b":
                raise TimeoutError("test outage")
            return [job, {**job, "id": "2", "title": "Sales Manager"},
                    {**job, "id": "3", "location": "Toronto, Canada"},
                    {**job, "id": "4", "location": "Remote (EMEA)", "remote": True}]
        with tempfile.TemporaryDirectory() as tmp:
            with database(Path(tmp) / "db") as db:
                first = scan(sources, db, fetch)
                # Sales title dropped; Toronto dropped; remote EMEA kept.
                self.assertEqual(sorted(j["id"] for j in first["jobs"]), ["1", "4"])
                self.assertEqual(first["jobs"][0]["status"], "new")
                self.assertFalse(first["sources"][1]["ok"])
                self.assertEqual(scan(sources, db, fetch)["jobs"][0]["status"], "seen")
                job["location"] = "Zurich <script>alert(1)</script>"
                changed = scan(sources, db, fetch)
                self.assertEqual([j["status"] for j in changed["jobs"] if j["id"] == "1"], ["changed"])
                self.assertNotIn("<script>alert(1)</script>", render(changed))
            with database(Path(tmp) / "db") as db:
                self.assertEqual(scan(sources, db, fetch)["jobs"][0]["status"], "seen")

    def test_feeds_share_the_store_file_without_clashing(self):
        # daily.py opens the canonical store and the feed watcher on the same data/jobs.sqlite.
        from src import store
        job = {"id": "1", "title": "Site Reliability Engineer", "location": "Zurich", "url": "https://example.com/1"}
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "jobs.sqlite"
            with store.connect(path):
                pass
            with database(path) as db:
                report = scan([{"company": "A", "board": "a"}], db, lambda source: [job])
            self.assertTrue(report["sources"][0]["ok"], report["sources"][0])
            self.assertEqual(len(report["jobs"]), 1)

    def test_titles_that_only_look_like_the_role_are_dropped(self):
        from src.sources.feeds import excluded_title, wanted_title
        self.assertTrue(wanted_title('Senior Site Reliability Engineer'))
        self.assertTrue(wanted_title('Infrastructure Engineer'))
        self.assertFalse(wanted_title('Infrastructure Tax Lead'))
        self.assertFalse(wanted_title('Sales Engineer, Cloud Infrastructure'))
        self.assertTrue(excluded_title('SAP ABAP Developer'))
        self.assertFalse(excluded_title('Platform Engineer (Kubernetes)'))

    def test_remote_must_be_open_to_europe(self):
        from src.sources.feeds import wanted_location
        self.assertTrue(wanted_location({"location": "Remote (EMEA)"}))
        self.assertTrue(wanted_location({"location": "Zürich, Switzerland"}))
        self.assertTrue(wanted_location({"location": "London, England, GBR"}))
        self.assertTrue(wanted_location({"location": "Anywhere", "remote": True}))
        self.assertFalse(wanted_location({"location": "USA - Remote", "remote": True}))
        self.assertFalse(wanted_location({"location": "Remote, Canada"}))
        self.assertFalse(wanted_location({"location": "Toronto, Canada"}))
        self.assertTrue(wanted_location({"location": "Remote - US; London, UK"}))

    def test_greenhouse_content_becomes_plain_text(self):
        from src.sources.feeds import plain_text
        self.assertEqual(plain_text("&lt;p&gt;Run &lt;b&gt;Kubernetes&lt;/b&gt; &amp;amp; Terraform&lt;/p&gt;"),
                         "Run Kubernetes & Terraform")
        self.assertEqual(plain_text(None), "")


if __name__ == "__main__":
    unittest.main()
