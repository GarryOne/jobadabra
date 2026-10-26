"""Refused sites are read in the browser only when they could hire for this search (owner, 26 Oct 2026: "The AI decides"). The night of 25-26 Oct a
pilot search's "Check for new jobs" read the same 13 refused sites 4 times (a bank, an energy and a telecom company, software firms): 49 browser reads,
0 jobs matching. The queue now asks the same AI judge as the visit list (visits.relevant: names and addresses, the roles and places, once per list);
a site the person opened a job on is read whatever it says; without any AI every site is read, as before."""
import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from src.sources import host_pace, refused_reads, visits

NOW = datetime(2026, 10, 26, 1, 0, tzinfo=timezone.utc)
SEARCH = {'role_keywords': ['First Officer', 'pilot'], 'locations': {'top_tier': ['Europe'], 'country_wide': []}}
EMPLOYERS = [('A Bank', 'https://www.bank.test/careers'), ('An Energy Company', 'https://energy.test/jobs'), ('An Airline', 'https://careers.airline.test')]
PICKS = [{'name': 'A Telecom', 'url': 'https://telecom.test'}, {'name': 'An Airport', 'url': 'https://jobs.airport.test'}]
FLYING = ('Airline', 'Airport')   # the stand-in AI keeps these


class Judge:
    """A stand-in AI for visits.relevant: keeps the numbered sites whose name says they fly people."""
    def __init__(self):
        self.asked = []
        self.messages = SimpleNamespace(create=self.create)

    def create(self, **kwargs):
        self.asked.append(kwargs)
        lines = kwargs['messages'][0]['content'].split('The sites:\n', 1)[1].split('\n')
        keep = [int(line.split('.', 1)[0]) for line in lines if any(word in line for word in FLYING)]
        return SimpleNamespace(content=[SimpleNamespace(type='text', text=json.dumps({'keep': keep}))], usage=SimpleNamespace(input_tokens=1, output_tokens=1))


class RefusedReadsFitTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.judge = Judge()
        self.patches = [mock.patch.object(visits, 'STORE', Path(self.tmp.name) / 'visits.json'),
                        mock.patch('src.ai.board_ideas.load', lambda: {'boards': {}}),
                        mock.patch.object(refused_reads, 'search_config', lambda: SEARCH),
                        mock.patch.object(visits, 'load_search_config', lambda **k: SEARCH),
                        mock.patch.object(visits, 'unread_picks', lambda *a, **k: list(PICKS)),
                        mock.patch.object(host_pace, 'FILE', Path(self.tmp.name) / 'host_pace.json'),
                        mock.patch('src.ai.engine.ready', lambda *a, **k: True),
                        mock.patch('src.ai.engine.client', lambda *a, **k: self.judge)]
        for patch in self.patches:
            patch.start()
        for name, url in EMPLOYERS:
            visits.refused(name, url, 'HTTP 403', now=NOW)

    def tearDown(self):
        for patch in self.patches:
            patch.stop()
        self.tmp.cleanup()

    def names(self, sites):
        return sorted(site['name'] for site in sites)

    def test_a_check_reads_only_the_refused_sites_that_could_hire_for_the_search(self):
        for everything in (False, True):   # True: "Check for new jobs" (desktop/lib/refused-now.js), which read every site 4 times that night
            with self.subTest(everything=everything):
                self.assertEqual(self.names(refused_reads.queue(now=NOW, everything=everything)), ['An Airline', 'An Airport'])

    def test_a_site_the_person_opened_a_job_on_is_read_whatever_the_ai_says(self):
        sites = refused_reads.queue(now=NOW, now_hosts=['www.bank.test'])
        self.assertIn('A Bank', self.names(sites))
        self.assertNotIn('An Energy Company', self.names(sites))

    def test_the_ai_is_asked_once_per_list_and_the_visit_list_keeps_its_own_answer(self):
        refused_reads.queue(now=NOW)
        visits.relevant([{'name': 'An Airline', 'url': 'https://careers.airline.test', 'kind': 'employer'}], SEARCH)   # the visit list's own, different list
        refused_reads.queue(now=NOW)
        self.assertEqual(len(self.judge.asked), 2, 'the queue and the visit list each asked once: one answer does not push the other out')

    def test_without_any_ai_every_refused_site_is_read_as_before(self):
        with mock.patch('src.ai.engine.ready', lambda *a, **k: False):
            self.assertEqual(self.names(refused_reads.queue(now=NOW)), sorted([name for name, _ in EMPLOYERS] + [p['name'] for p in PICKS]))
        self.assertEqual(self.judge.asked, [])


if __name__ == '__main__':
    unittest.main()
