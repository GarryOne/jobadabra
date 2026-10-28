"""Focus history: what you resolved (app events, rated insights), newest first, from the store."""
import unittest

from src import app_source, focus
from src.stores import memory


class FocusHistoryTest(unittest.TestCase):
    def test_events_and_rated_insights_newest_first(self):
        stores = memory.open_store()
        north = stores.applications.create({'url': 'https://x.test/n', 'company': 'Northwind'}, 'Screening')
        zephyr = stores.applications.create({'url': 'https://x.test/z', 'title': 'Zephyr AI'}, 'Rejected')
        stores.events.add(north['id'], 'Replied', '2099-09-29T10:00:00+00:00', source='Job Pilotto app',
                          note='You answered (marked done in Focus)')
        stores.events.add(zephyr['id'], 'Feedback skipped', '2099-09-27T09:00:00+00:00', source='Job Pilotto app')
        stores.events.add(north['id'], 'Screening', '2099-09-28T09:00:00+00:00', source='Gmail')  # not from the app
        stores.insights.save('2099-09-28', 'Location', 'Location limits your applications', '', {'feedback': 'Useful'})
        stores.insights.save('2099-09-29', 'Skills', 'Not rated', '')
        items = focus.history(stores)
        self.assertEqual([i['title'] for i in items], ['Replied to Northwind', 'Insight: Useful', 'Skipped asking Zephyr AI for feedback'])
        self.assertEqual(items[1]['note'], 'Location limits your applications')
        self.assertEqual(items[0]['note'], 'You answered (marked done in Focus)')

    def test_events_logged_under_either_app_name_are_listed(self):
        """Class test (25 Oct 2026 rename): rows written before it say 'Job Pilotto app'; new ones say 'Jobadabra app'; both are the app's own events."""
        for source in app_source.APP_SOURCES:
            stores = memory.open_store()
            app = stores.applications.create({'url': 'https://x.test/n', 'company': 'Northwind'}, 'Screening')
            stores.events.add(app['id'], 'Replied', '2099-09-29T10:00:00+00:00', source=source, note='n')
            self.assertEqual([i['title'] for i in focus.history(stores)], ['Replied to Northwind'], source)
        self.assertEqual(app_source.APP_SOURCE, 'Jobadabra app')   # what is written now

    def test_a_reader_never_compares_to_one_app_name(self):
        """Fails when src/ names 'Job Pilotto app' outside the shared constant, so a new reader cannot match only the old value."""
        import pathlib
        bad = [f'{path}:{n}' for path in pathlib.Path(focus.__file__).parent.rglob('*.py') if path.name != 'app_source.py'
               for n, line in enumerate(path.read_text().splitlines(), 1) if 'Job Pilotto app' in line]
        self.assertEqual(bad, [])


class HistoryInterviewTest(unittest.TestCase):
    def test_reviewed_interviews_show_in_history(self):
        from datetime import date as _date
        from src.stores import memory
        stores = memory.open_store()
        today = _date.today().isoformat()
        stores.interviews.put({'title': 'Unframe · Recruiter screen', 'overall': 'neutral', 'created_at': f'{today}T08:00:00+00:00'})
        stores.interviews.put({'title': 'Old', 'overall': 'positive', 'created_at': '2000-01-01T08:00:00+00:00'})
        stores.interviews.put({'title': 'Not reviewed', 'created_at': f'{today}T08:00:00+00:00'})
        items = focus.history(stores)
        self.assertEqual([i['title'] for i in items], ['Reviewed the interview: Unframe · Recruiter screen'])
        self.assertEqual(items[0]['note'], 'Outcome: Neutral')


if __name__ == '__main__':
    unittest.main()
