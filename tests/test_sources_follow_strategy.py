"""Every list of sites a run reads or offers follows the CURRENT strategy (owner, 26 Oct 2026: "the websites being read should be relevant and in
sync with my current strategy and jobs search"). Night of 25-26 Oct: after a first officer's "Find jobs", the browser read and offered Moldovan
bank, energy and telecom sites (maib, Premier Energy, Moldtelecom) that an earlier software search in Moldova had queued.

One pilot search; queues holding an earlier search's sites (a refused bank, a scout pick, a job board marked for the browser, an index employer);
a stand-in AI that says only flying employers fit. A new list of sites joins LISTS below. Lists in another session's open work are named in
SIBLINGS with their owner, so the gap is never silent."""
import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from src import employer_index, role_kinds
from src.sources import host_pace, refused_reads, visits

NOW = datetime(2026, 10, 26, 1, 0, tzinfo=timezone.utc)
SEARCH = {'role_keywords': ['First Officer', 'pilot'], 'locations': {'top_tier': ['Europe'], 'country_wide': []}}
OLD = [('maib - liderul sectorului bancar din Moldova', 'https://www.maib.md/careers'), ('Premier Energy', 'https://premierenergy.md/cariera'),
       ('Moldtelecom', 'https://www.moldtelecom.md/jobs')]
FIT = ('An Airline', 'https://careers.airline.test')
OFF = ('maib', 'Premier Energy', 'Moldtelecom', 'IT Jobs Moldova')   # what the earlier search queued: nothing of these may be read or offered
BOARDS = {'boards': {'itjobs.md': {'name': 'IT Jobs Moldova', 'search_url': 'https://www.itjobs.md/search?q={role}', 'state': 'browser'}}}


class Judge:
    """The stand-in AI for visits.relevant: keeps the numbered sites of flying employers."""
    def __init__(self, fail=False):
        self.fail, self.asked = fail, []
        self.messages = SimpleNamespace(create=self.create)

    def create(self, **kwargs):
        self.asked.append(kwargs)
        if self.fail:
            raise RuntimeError('busy')
        lines = kwargs['messages'][0]['content'].split('The sites:\n', 1)[1].split('\n')
        keep = [int(line.split('.', 1)[0]) for line in lines if 'Airline' in line]
        return SimpleNamespace(content=[SimpleNamespace(type='text', text=json.dumps({'keep': keep}))], usage=SimpleNamespace(input_tokens=1, output_tokens=1))


def queue():
    return refused_reads.queue(now=NOW)


def queue_on_check():   # "Check for new jobs" (desktop/lib/refused-now.js readAllNow): every refused site, due or resting
    return refused_reads.queue(now=NOW, everything=True)


def sites_only_you_can_open():   # the "Sites only you can open" list with its "Open it myself" offers (desktop_strategy.py)
    return visits.visit_list(SEARCH, {'aviation_transport'}, now=NOW)


LISTS = {'refused sites read in the browser': queue, 'refused sites read on Check for new jobs': queue_on_check,
         'Sites only you can open': sites_only_you_can_open}
FITS = {name: 'An Airline' for name in LISTS}   # per list, the site that fits the pilot search and must still be read or offered (a board list names a board)
SIBLINGS = {'job boards the run reads (found_boards, board_web)': 'jobadabra-33 [c2ad9c], its open boards-first work',
            'employer feeds with no kind mix yet (employer_index.relevant)': 'this audit, PR 4 (located kind counts)'}


class SourcesFollowStrategyTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.judge = Judge()
        self.patches = [mock.patch.object(visits, 'STORE', Path(self.tmp.name) / 'visits.json'),
                        mock.patch('src.ai.board_ideas.load', lambda: json.loads(json.dumps(BOARDS))),
                        mock.patch.object(refused_reads, 'search_config', lambda: SEARCH),
                        mock.patch.object(visits, 'load_search_config', lambda **k: SEARCH),
                        mock.patch.object(visits, 'unread_picks', lambda *a, **k: [{'name': 'Moldtelecom', 'url': 'https://www.moldtelecom.md/jobs'}]),
                        mock.patch.object(visits, 'portals', lambda *a, **k: []),
                        mock.patch.object(host_pace, 'FILE', Path(self.tmp.name) / 'host_pace.json'),
                        mock.patch('src.ai.engine.ready', lambda *a, **k: True),
                        mock.patch('src.ai.engine.client', lambda *a, **k: self.judge)]
        for patch in self.patches:
            patch.start()
        for name, url in [*OLD, FIT]:
            visits.refused(name, url, 'HTTP 403', now=NOW)
        data = visits._load()   # the browser stopped at each of them (as on the owner's card): each is offered "Open it myself"
        data['refused_reads'] = {visits.host_of(url): {'state': 'stopped', 'at': '2026-09-01T00:00:00+00:00'} for _, url in [*OLD, FIT]}
        visits._save(data)

    def tearDown(self):
        for patch in self.patches:
            patch.stop()
        self.tmp.cleanup()

    def test_no_list_reads_or_offers_a_site_the_ai_judged_off_the_current_search(self):
        for name, sites_of in LISTS.items():
            with self.subTest(list=name):
                names = [site['name'] for site in sites_of()]
                self.assertEqual([n for n in names if n.startswith(OFF)], [], f'{name}: an earlier search\'s sites')
                self.assertIn(FITS[name], names, f'{name}: the site that fits is still read or offered')

    def test_when_the_ai_fails_the_browser_reads_none_of_them(self):
        self.judge.fail = True
        for name in ('refused sites read in the browser', 'refused sites read on Check for new jobs'):
            with self.subTest(list=name):
                self.assertEqual(LISTS[name](), [], 'not judged this time: asked again next time, never read on a guess')

    def test_an_index_employer_that_hires_other_kinds_is_not_read(self):
        bank = {'company': 'maib', 'kinds': {'finance_admin': 0.9, 'software': 0.1}, 'places': ['Chisinau']}
        airline = {'company': 'An Airline', 'kinds': {'aviation_transport': 0.4, 'hospitality': 0.6}, 'places': ['Chisinau']}
        kept = employer_index.relevant([bank, airline], lambda job: True, {'aviation_transport'})
        self.assertEqual([f['company'] for f in kept], ['An Airline'])

    @unittest.expectedFailure   # SIBLINGS: PR 4 replaces "no mix: keep" with located kind counts; then this passes and the mark goes
    def test_an_index_employer_with_no_kind_mix_yet_is_not_read_on_a_guess(self):
        bank = {'company': 'maib', 'places': ['Chisinau']}
        self.assertEqual(employer_index.relevant([bank], lambda job: True, {'aviation_transport'}), [])

    def test_every_list_names_its_fitting_site_and_every_sibling_its_owner(self):
        self.assertEqual(set(FITS), set(LISTS), 'a new list says which site of the pilot search it must keep')
        self.assertTrue(all(SIBLINGS.values()))
        self.assertTrue(role_kinds.KINDS)


if __name__ == '__main__':
    unittest.main()
