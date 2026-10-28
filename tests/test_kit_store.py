"""A kit saved through the store (src/ai/kit.py kit_markdown + set_section) shows on a Notion page exactly as before the
store adapters: the same blocks under the same toggle heading. Checked twice: through the codec alone, and end to end on
the Notion stand-in (desktop/e2e/lib/notion-fake.mjs, node; skipped without it). The memory/sqlite side: tests/test_kit.py.
"""
import io
import json
import shutil
import sqlite3
import tempfile
import unittest
import urllib.request
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

from src import daily, desktop, desktop_jobs, store as job_store
from src.ai import kit, provenance, score
from src.notion import client as notion
from src.notion.client import Tracker
from src.stores import notion as notion_store
from src.stores.notion_blocks import to_blocks
from tests.test_kit import URL, FakeClient, opener
from tests import notion_stand_in

ROOT = Path(__file__).resolve().parent.parent
SCHEMA = json.loads((ROOT / 'config' / 'notion_schema.json').read_text())
COMPUTED = {'formula', 'rollup', 'last_edited_time', 'created_time', 'unique_id', 'people'}
JOB = {'title': 'SRE', 'company': 'Acme', 'url': URL}
KIT = {'eligible': True, 'check_before_sending': ['Salary range'], 'highlights': ['On-call **lead**'],
       'cover_letter': 'Dear Acme,\n\nI run platforms.\n\nBest', 'answers': [
           {'field': 'question_1', 'question': 'Why us?', 'answer': 'Because *you* ship.', 'needs_review': False},
           {'field': 'question_2', 'question': 'Visa?', 'answer': 'No', 'needs_review': True}]}


def shape(blocks):
    """What a reader sees of each block: its type, its text, whether any of it is bold, a code block's language."""
    out = []
    for block in blocks:
        body = block[block['type']]
        runs = body.get('rich_text', [])
        out.append((block['type'], ''.join(run.get('plain_text') or run['text']['content'] for run in runs),
                    any((run.get('annotations') or {}).get('bold') for run in runs), body.get('language')))
    return out


class KitMarkdownTests(unittest.TestCase):
    def test_the_kits_markdown_becomes_todays_blocks_again(self):
        today = kit.notion_blocks(JOB, KIT, [{'field': 'question_1'}], 'claude-sonnet-5-5')['heading_2']['children']
        self.assertEqual(shape(to_blocks(kit.kit_markdown(JOB, KIT, [{'field': 'question_1'}], 'claude-sonnet-5-5'))), shape(today))

    def test_the_kit_is_the_sections_last_json_fence(self):
        markdown = kit.kit_markdown(JOB, KIT, [], 'm')
        self.assertTrue(markdown.rstrip().endswith('```'))
        self.assertIn('### Machine-readable kit', markdown)
        fence = markdown.rsplit('```json', 1)[1].split('\n```', 1)[0]
        self.assertEqual(json.loads(fence)['answers'][1]['needs_review'], True)


def _direct(request, timeout=20):
    return urllib.request.urlopen(request, timeout=timeout)


@unittest.skipUnless(shutil.which('node'), 'node runs the Notion stand-in')
class KitOnNotionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        notion_stand_in.start(cls)

    @classmethod
    def tearDownClass(cls):
        notion_stand_in.stop(cls)

    def test_a_kit_drafted_through_the_store_is_todays_page(self):
        tracker = Tracker(self.token, opener=_direct)
        env = {'NOTION_TOKEN': self.token}
        for variable, spec in SCHEMA['databases'].items():
            columns = {name: {column['type']: {}} for name, column in spec['columns'].items() if column['type'] not in COMPUTED}
            env[variable] = tracker._request('POST', 'databases', {
                'parent': {'page_id': 'stand-in-root'}, 'title': [{'text': {'content': spec['title']}}], 'properties': columns})['id']
        stores = notion_store.open_store(env, tracker=tracker)
        with tempfile.TemporaryDirectory() as tmp, job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
            job_store.import_watch_report(db, {'jobs': [{'company': 'Acme', 'id': '1', 'title': 'SRE', 'location': 'Zurich',
                                                         'url': URL, 'description': 'Kubernetes.'}]})
            job = dict(db.execute('SELECT * FROM jobs WHERE url = ?', (URL,)).fetchone())
            score.save(db, job, 'test-model', {'score': 74, 'tier': 'B', 'components': {'role_fit': 80}}, 'Test profile')
            daily.prepare_kit(db, notion.job_code(URL), stores, FakeClient(), 'claude-sonnet-5-5', opener)
        record = stores.applications.get(URL)
        self.assertEqual(record['stage'], 'Kit ready')
        self.assertEqual(record['fit'], 74)
        headings = [b for b in tracker._children(record['id']) if b['type'] == 'heading_2' and not b.get('archived')]
        self.assertEqual([plain(b) for b in headings], [kit.KIT_HEADING])
        self.assertTrue(headings[0]['heading_2'].get('is_toggleable'))
        # Today's blocks for the same kit (its JSON is in the fence) vs what the page now holds under the heading.
        saved = json.loads(stores.applications.section(record['id'], kit.KIT_SECTION).rsplit('```json', 1)[1].split('\n```', 1)[0])
        questions = kit.form_questions(URL, opener)
        today = kit.notion_blocks(JOB, saved, questions, 'claude-sonnet-5-5')['heading_2']['children']
        on_page = [b for b in tracker._children(headings[0]['id']) if not b.get('archived')]
        self.assertEqual(shape(on_page), shape(today))
        self.assertEqual(shape(on_page)[-1][3], 'json')

    def drafted(self):
        """A Notion workspace on the stand-in with the real Profile template (headings, a table, bullets) and a kit drafted for URL."""
        tracker = Tracker(self.token, opener=_direct)
        env = {'NOTION_TOKEN': self.token}
        for variable, spec in SCHEMA['databases'].items():
            columns = {name: {column['type']: {}} for name, column in spec['columns'].items() if column['type'] not in COMPUTED}
            env[variable] = tracker._request('POST', 'databases', {
                'parent': {'page_id': 'stand-in-root'}, 'title': [{'text': {'content': spec['title']}}], 'properties': columns})['id']
        for variable in ('NOTION_PROFILE_PAGE_ID', 'NOTION_ANSWERS_PAGE_ID', 'NOTION_KNOWLEDGE_PAGE'):
            env[variable] = tracker._request('POST', 'pages', {
                'parent': {'page_id': 'stand-in-root'}, 'properties': {'title': {'title': [{'text': {'content': variable}}]}}})['id']
        stores = notion_store.open_store(env, tracker=tracker)
        template = (ROOT / 'docs' / 'notion-profile-template.md').read_text()
        stores.texts.set('profile', template.split('## 👤 Profile', 1)[1].split('\n## ', 1)[0].split('\n', 1)[1])
        stores.texts.set('answers', '# Contact\n\n- Email: me@example.test\n\n| Field | Answer |\n|---|---|\n| Notice | 3 months |')
        with tempfile.TemporaryDirectory() as tmp, job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
            job_store.import_watch_report(db, {'jobs': [{'company': 'Acme', 'id': '1', 'title': 'SRE', 'location': 'Zurich',
                                                         'url': URL, 'description': 'Kubernetes.'}]})
            daily.prepare_kit(db, notion.job_code(URL), stores, FakeClient(), 'claude-sonnet-5-5', opener)
        # Tracker.page_text reads the Profile page the environment names, as on a real install (its default is bound at import).
        tracker.page_text = lambda page_id=env['NOTION_PROFILE_PAGE_ID']: Tracker.page_text(tracker, page_id)
        return tracker, env, stores

    def listed_state(self, tracker, env, stores, recorded):
        """The kit state the Jobs list shows for a Kit ready job whose kit recorded `recorded`: `desktop jobs` run on the stand-in."""
        seen, out = {}, io.StringIO()
        listed = [{'url': URL, 'title': 'SRE', 'company': 'Acme', 'stage': 'Kit ready', 'next_step': '', 'kit_inputs': recorded}]
        def jobs(db, limit, notion_jobs=None, **kw):
            seen.update(kw)
            return {'jobs': notion_jobs}
        with mock.patch.dict('os.environ', env), mock.patch.object(Tracker, 'from_env', return_value=tracker), \
                mock.patch.object(tracker, 'notion_jobs', return_value=listed), \
                mock.patch('src.stores.open_stores', return_value=stores), mock.patch.object(desktop, 'jobs', side_effect=jobs), \
                mock.patch.object(desktop.store, 'connect', create=True), redirect_stdout(out):
            desktop.main(['jobs'])
        return listed_kit_state(listed, kit_inputs=seen.get('kit_inputs'))

    def test_a_kit_drafted_on_notion_lists_as_current(self):
        """The Jobs list's "current inputs" and the kit's recorded ones are the same reading of the same pages (D7): a kit just
        drafted is never "drafted with earlier inputs"."""
        tracker, env, stores = self.drafted()
        self.assertEqual(self.listed_state(tracker, env, stores, stores.applications.get(URL)['kit_inputs']), 'current')

    def test_a_kit_on_notion_reads_the_profile_as_before_the_stores(self):
        """Kits draft from the Profile as Tracker.page_text reads it (texts.plain), so a kit drafted through the store records the very
        digest a kit drafted before the store adapters did, and both list as current (D7); a changed Profile still shows, and the Markdown
        reading is never what a Notion kit recorded."""
        tracker, env, stores = self.drafted()
        answers = kit.standard_answers(stores)
        before, today = provenance.kit_inputs(tracker.page_text(), answers), provenance.kit_inputs(stores.texts.get('profile'), answers)
        self.assertNotEqual(before, today, 'the two readings differ, or this test proves nothing')
        self.assertEqual(stores.applications.get(URL)['kit_inputs'], before)
        self.assertEqual(self.listed_state(tracker, env, stores, before), 'current')
        stores.texts.set('profile', 'A new Profile.')
        tracker.__dict__.pop('_page_texts', None)
        self.assertEqual(self.listed_state(tracker, env, stores, before), 'earlier:profile')
        self.assertEqual(listed_kit_state([{'url': URL, 'stage': 'Kit ready', 'kit_inputs': before}], kit_inputs=today),
                         'earlier:profile', 'off Notion only the store\'s own reading counts')

class TestSiteRulesRetired(unittest.TestCase):
    def test_a_kit_drafts_from_the_standard_answers_only_never_the_old_form_knowledge(self):
        """PR B1 (owner, 28 Oct 2026: "Retire now, no replay"): an old 🧠 Form knowledge page stays in the store, unread by kits."""
        texts = {'answers': 'Driving license: B', 'knowledge': '[any · answer] Marital status: You entered this yourself → "Single"'}
        stores = mock.Mock(texts=mock.Mock(get=texts.__getitem__))
        self.assertEqual(kit.standard_answers(stores), 'Driving license: B')


def listed_kit_state(listed, **kw):
    """The kit state desktop_jobs.jobs() gives the first of `listed` (Notion's rows), with no cached search results."""
    with mock.patch.object(desktop_jobs.digest, 'eligible_jobs', lambda db: ([], [])):
        return desktop_jobs.jobs(sqlite3.connect(':memory:'), notion_jobs=listed, **kw)['jobs'][0]['kit_state']


def plain(block):
    return ''.join(run.get('plain_text') or run['text']['content'] for run in block[block['type']]['rich_text'])


if __name__ == '__main__':
    unittest.main()
