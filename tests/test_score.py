import json
import tempfile
from datetime import datetime, timezone
import unittest
from pathlib import Path
from types import SimpleNamespace
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src import daily, digest
from src import store as job_store
from src.ai import score


def fit(value, reason='Kubernetes + Datadog match; salary not stated'):
    return {'score': value, 'tier': 'A' if value >= 75 else 'B', 'reason': reason,
            'components': {'role_fit': value, 'location': 80, 'compensation': 50, 'growth': 70, 'risk': 20},
            'strengths': ['Kubernetes'], 'gaps': ['salary not stated'], 'confidence': 'medium'}


class PayUnknownTest(unittest.TestCase):
    def test_schema_allows_null_pay_and_clamp_keeps_it(self):
        props = score.SCHEMA['properties']['components']['properties']
        # only the parts in UNKNOWN_OK may be unknown; the others stay whole numbers
        for key in ('role_fit', 'location', 'compensation', 'growth'):
            self.assertEqual('null' in props[key]['type'], key in score.UNKNOWN_OK, key)
        data = {**fit(70), 'components': {**fit(70)['components'], 'compensation': None, 'growth': None}}
        client = FakeClient()
        client.create = lambda **p: SimpleNamespace(stop_reason='end_turn', content=[SimpleNamespace(type='text', text=json.dumps(data))],
                                                    usage=SimpleNamespace(input_tokens=1, output_tokens=1, cache_read_input_tokens=0))
        out, _ = score.score_one(client, 'm', {'title': 't', 'company': 'c', 'description': 'd'}, 'Profile')
        self.assertIsNone(out['components']['compensation'])
        self.assertIsNone(out['components']['growth'])
        self.assertNotIn('give 50', score.SYSTEM)


class UnreadPartTest(unittest.TestCase):
    """A part the posting gives a basis for is never saved empty: the scorer asks again, naming it."""
    FACTS = {'salary': {'stated': True, 'text': 'EUR 95,000 - 120,000'}, 'seniority': {'value': 'senior', 'evidence': 'Senior'}, 'work_mode': {'value': 'remote'}}

    def client(self, first_empty, basis=None):
        answers = []
        def create(**params):
            answers.append(params)
            comps = dict(fit(70)['components'])
            schema = params['output_config']['format']['schema']
            allowed = 'null' in schema['properties']['components']['properties'][first_empty]['type']
            if allowed:   # the model answers null whenever the answer's shape lets it (a EUR range against a CHF target)
                comps[first_empty] = None
            data = {**fit(70), 'components': comps, **({'basis': basis} if basis is not None else {})}
            return SimpleNamespace(stop_reason='end_turn', content=[SimpleNamespace(type='text', text=json.dumps(data))],
                                   usage=SimpleNamespace(input_tokens=1, output_tokens=1, cache_read_input_tokens=0))
        client = SimpleNamespace(messages=SimpleNamespace(create=create))
        client.requests = answers
        return client

    def test_every_unknown_ok_part_with_a_basis_is_asked_again(self):
        self.assertEqual(set(score.HAS_BASIS), set(score.UNKNOWN_OK))   # a new nullable part needs a basis rule here
        for part in score.UNKNOWN_OK:
            with self.subTest(part=part):
                client = self.client(part)
                data, _ = score.score_one(client, 'm', {'title': 't', 'company': 'c', 'description': 'd', 'ai': self.FACTS}, 'p')
                self.assertEqual(2, len(client.requests))
                self.assertIn(part, client.requests[1]['messages'][0]['content'])
                self.assertNotIn('null', client.requests[1]['output_config']['format']['schema']['properties']['components']['properties'][part]['type'])
                self.assertEqual(fit(70)['components'][part], data['components'][part])

    def test_scored_before_the_facts_are_read_the_answer_own_basis_asks_again(self):
        # A refresh scores first and reads the facts after (src/daily_search.py): the scorer's own answer says what the posting states
        # (nightly beta 15 Oct 2026: "EUR 95,000-120,000" against a CHF target came back null, no facts yet, no second ask).
        self.assertEqual(set(score.BASIS), set(score.UNKNOWN_OK))
        self.assertEqual(set(score.BASIS.values()) | {'one_job'}, set(score.SCHEMA['properties']['basis']['required']))   # one_job: src/ai/score_not_a_job.py
        for part in score.UNKNOWN_OK:
            with self.subTest(part=part):
                client = self.client(part, basis={key: True for key in score.BASIS.values()})
                data, _ = score.score_one(client, 'm', {'title': 't', 'company': 'c', 'description': 'd'}, 'p')
                self.assertEqual(2, len(client.requests))
                self.assertIn(part, client.requests[1]['messages'][0]['content'])
                self.assertEqual(fit(70)['components'][part], data['components'][part])
                client = self.client(part, basis={key: False for key in score.BASIS.values()})
                data, _ = score.score_one(client, 'm', {'title': 't', 'company': 'c', 'description': 'd'}, 'p')
                self.assertEqual(1, len(client.requests))
                self.assertIsNone(data['components'][part])

    def test_the_basis_question_counts_the_people_a_role_leads_as_a_stated_scope(self):
        # "Engineering Manager, Infrastructure" ("Lead a team of 8 ... Management role") came back level_stated=false on 5 of 6 local runs, so Growth
        # stayed empty until the facts arrived (quality suite, 16 Oct 2026); with this wording 8 of 8 gave a number and a posting with no role kept null.
        text = score.SCHEMA['properties']['basis']['properties']['level_stated']['description']
        self.assertIn('leads', text)
        self.assertIn('team', text)

    def schema_blind(self, part, nulls):
        """A model that answers null for `part` on its first `nulls` asks whatever the schema says (Free AI checks only that the answer is JSON)."""
        answers = []
        def create(**params):
            answers.append(params)
            comps = dict(fit(70)['components'])
            if len(answers) <= nulls:
                comps[part] = None
            return SimpleNamespace(stop_reason='end_turn', content=[SimpleNamespace(type='text', text=json.dumps({**fit(70), 'components': comps}))],
                                   usage=SimpleNamespace(input_tokens=1, output_tokens=1, cache_read_input_tokens=0))
        client = SimpleNamespace(messages=SimpleNamespace(create=create))
        client.requests = answers
        return client

    def test_a_second_answer_that_ignores_the_whole_number_shape_is_asked_once_more(self):
        # Main's quality, 27 Oct 2026 (runs 40434477266, 40435903584): "Senior DevOps Engineer" and "Senior Site Reliability Engineer" kept an empty Growth
        # after their facts said "senior". The re-ask's shape allows no null, but Free AI's relay checks only that the answer is JSON (jobadabra-web
        # shared/free-ai.js), and Workers AI answered null again; the scorer kept it as sure.
        for part in score.UNKNOWN_OK:
            with self.subTest(part=part):
                client = self.schema_blind(part, nulls=2)
                data, _ = score.score_one(client, 'm', {'title': 't', 'company': 'c', 'description': 'd', 'ai': self.FACTS}, 'p')
                self.assertEqual(3, len(client.requests))
                self.assertEqual(fit(70)['components'][part], data['components'][part])

    def test_a_part_never_answered_stays_unknown_after_a_bounded_number_of_asks(self):
        for part in score.UNKNOWN_OK:
            with self.subTest(part=part):
                client = self.schema_blind(part, nulls=99)
                data, _ = score.score_one(client, 'm', {'title': 't', 'company': 'c', 'description': 'd', 'ai': self.FACTS}, 'p')
                self.assertEqual(1 + score.ASK_AGAIN_MAX, len(client.requests))
                self.assertIsNone(data['components'][part])   # never invented

    def test_a_part_with_no_basis_stays_unknown_without_a_second_call(self):
        for part in score.UNKNOWN_OK:
            with self.subTest(part=part):
                client = self.client(part)
                data, _ = score.score_one(client, 'm', {'title': 't', 'company': 'c', 'description': 'd', 'ai': {'salary': {'stated': False, 'text': ''}, 'seniority': {'value': 'unknown'}}}, 'p')
                self.assertEqual(1, len(client.requests))
                self.assertIsNone(data['components'][part])


class FakeClient:
    def __init__(self, value=80):
        self.value, self.requests = value, []
        self.messages = self

    def create(self, **params):
        self.requests.append(params)
        return SimpleNamespace(stop_reason='end_turn',
                               content=[SimpleNamespace(type='text', text=json.dumps(fit(self.value)))],
                               usage=SimpleNamespace(input_tokens=100, output_tokens=40, cache_read_input_tokens=0))


def seed_jobs(db, count, old=True):
    job_store.import_watch_report(db, {'jobs': [
        {'company': 'Example', 'id': str(i), 'title': f'SRE {i}', 'location': 'Zurich',
         'url': f'https://x.test/{i}', 'description': 'Kubernetes, Terraform, Datadog.'} for i in range(count)]})
    if old:
        db.execute("UPDATE jobs SET last_seen_at = '2099-01-01T00:00:00+00:00'")


class ModelClient:
    """Answers by model: each model has its own score per job title, so a cheap first pass and the main model can disagree."""
    def __init__(self, by_model):
        self.by_model, self.requests = by_model, []
        self.messages = self

    def create(self, **params):
        self.requests.append(params)
        title = params['messages'][0]['content'].split('\n', 1)[0]
        value = self.by_model[params['model']](title)
        return SimpleNamespace(stop_reason='end_turn', content=[SimpleNamespace(type='text', text=json.dumps(fit(value)))],
                               usage=SimpleNamespace(input_tokens=100, output_tokens=40, cache_read_input_tokens=0))


class RescoreTests(unittest.TestCase):
    """Editing the Profile used to re-score every open job (28 Sep: 60 re-scores, no new job, about $0.6). Now only jobs that matter are."""
    FIRST = {'SRE 0': 90, 'SRE 1': 60, 'SRE 2': 40, 'SRE 3': 10}

    def scored_db(self, tmp):
        db = job_store.connect(Path(tmp) / 'jobs.sqlite').__enter__()
        seed_jobs(db, 4)
        candidates, _ = digest.eligible_jobs(db)
        client = ModelClient({'m': lambda title: self.FIRST[title.split(': ')[1]]})
        score.run(db, candidates, 'Profile v1', 'm', 10, client=client)
        return db, candidates

    def titles(self, jobs):
        return [job['title'] for job in jobs]

    def test_after_a_profile_edit_only_jobs_that_scored_well_are_scored_again_best_first(self):
        with tempfile.TemporaryDirectory() as tmp:
            db, candidates = self.scored_db(tmp)
            self.assertEqual(self.titles(score.pending_jobs(db, candidates, 'Profile v2', 10)), ['SRE 0', 'SRE 1'])   # best first; 40 and 10 rest
            rows = {r['job_id']: json.loads(r['data_json']) for r in db.execute('SELECT job_id, data_json FROM scores')}
            by_title = {job['title']: rows[job['id']] for job in candidates}
            self.assertEqual({t: (d['score'], d['method']) for t, d in by_title.items()},
                             {'SRE 0': (90, 'Current'), 'SRE 1': (60, 'Current'), 'SRE 2': (40, score.PREVIOUS_METHOD), 'SRE 3': (10, score.PREVIOUS_METHOD)})
            # the kept ones are settled for this Profile: asking again finds the same two, nothing new to spend on
            self.assertEqual(self.titles(score.pending_jobs(db, candidates, 'Profile v2', 10)), ['SRE 0', 'SRE 1'])

    def test_the_run_spends_on_those_two_only_and_the_kept_scores_stay_visible(self):
        with tempfile.TemporaryDirectory() as tmp:
            db, candidates = self.scored_db(tmp)
            client = FakeClient(value=70)
            self.assertIn('Scored 2 of 2', score.run(db, candidates, 'Profile v2', 'm', 10, client=client))
            self.assertEqual(len(client.requests), 2)
            self.assertEqual(sorted(score.load(db)[job['id']]['score'] for job in candidates), [10, 40, 70, 70])
            self.assertEqual(len(score.previous_method(db)), 2)
            self.assertIn('0 job(s)', score.run(db, candidates, 'Profile v2', 'm', 10, client=client))

    def test_asking_to_re_score_them_scores_the_kept_ones_too(self):
        with tempfile.TemporaryDirectory() as tmp:
            db, candidates = self.scored_db(tmp)
            score.pending_jobs(db, candidates, 'Profile v2', 10)
            self.assertEqual(score.rescore_previous(db), 2)
            self.assertEqual(sorted(self.titles(score.pending_jobs(db, candidates, 'Profile v2', 10))), ['SRE 0', 'SRE 1', 'SRE 2', 'SRE 3'])

    def test_a_job_whose_text_changed_is_scored_again_whatever_it_scored_before(self):
        with tempfile.TemporaryDirectory() as tmp:
            db, candidates = self.scored_db(tmp)
            edited = [dict(job, description=job['description'] + ' Now also Go.') if job['title'] == 'SRE 3' else job for job in candidates]
            self.assertEqual(self.titles(score.pending_jobs(db, edited, 'Profile v1', 10)), ['SRE 3'])

    def test_new_jobs_come_first_then_changed_ones_then_profile_edits_by_score(self):
        with tempfile.TemporaryDirectory() as tmp:
            db, candidates = self.scored_db(tmp)
            fresh = dict(candidates[0], id=999, title='SRE NEW', first_seen_at='2099-01-01T00:00:00+00:00')
            changed = [dict(job, description='rewritten') if job['title'] == 'SRE 2' else job for job in candidates]
            order = self.titles(score.pending_jobs(db, changed + [fresh], 'Profile v2', 10))
            self.assertEqual(order, ['SRE NEW', 'SRE 2', 'SRE 0', 'SRE 1'])
            self.assertEqual(self.titles(score.pending_jobs(db, changed + [fresh], 'Profile v2', 1)), ['SRE NEW'])   # a cap spends on the new one first

    def test_scores_made_before_this_change_are_treated_as_a_profile_edit_not_a_changed_job(self):
        with tempfile.TemporaryDirectory() as tmp:
            db, candidates = self.scored_db(tmp)
            for row in db.execute('SELECT job_id, data_json FROM scores').fetchall():   # older rows have no job_hash
                data = json.loads(row['data_json']); data.pop('job_hash', None)
                db.execute('UPDATE scores SET data_json=? WHERE job_id=?', (json.dumps(data), row['job_id']))
            db.commit()
            self.assertEqual(self.titles(score.pending_jobs(db, candidates, 'Profile v2', 10)), ['SRE 0', 'SRE 1'])


class CascadeTests(unittest.TestCase):
    def test_effort_is_set_for_sonnet_and_left_out_for_haiku(self):
        client = FakeClient()
        job = {'title': 'SRE', 'company': 'X', 'description': 'd'}
        score.score_one(client, 'claude-sonnet-5-5', job, 'p', effort='low')
        score.score_one(client, 'claude-haiku-4-5', job, 'p', effort='low')
        self.assertEqual(client.requests[0]['output_config']['effort'], 'low')
        self.assertNotIn('effort', client.requests[1]['output_config'])
        score.score_one(client, 'claude-sonnet-5-5', job, 'p')
        self.assertEqual(client.requests[2]['output_config']['effort'], score.EFFORT)

    def test_only_jobs_the_cheap_pass_likes_reach_the_main_model(self):
        with tempfile.TemporaryDirectory() as tmp:
            with job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
                seed_jobs(db, 4)
                candidates, _ = digest.eligible_jobs(db)
                # the cheap model gives 20, 30, 60, 90 to SRE 0..3; the main model rescoring the two it liked gives 55 and 95
                cheap = lambda title: {'SRE 0': 20, 'SRE 1': 30, 'SRE 2': 60, 'SRE 3': 90}[title.split(': ')[1]]
                main = lambda title: {'SRE 2': 55, 'SRE 3': 95}[title.split(': ')[1]]
                client = ModelClient({'cheap': cheap, 'main': main})
                stats = {}
                summary = score.run(db, candidates, 'Profile', 'main', 10, client=client, stats=stats, first_pass='cheap', escalate_min=50)
                self.assertIn('first pass cheap', summary)
                self.assertEqual([r['model'] for r in client.requests].count('cheap'), 4)
                self.assertEqual([r['model'] for r in client.requests].count('main'), 2)
                self.assertEqual(stats['cascade'], {'first_pass': 4, 'escalated': 2})
                rows = {r['job_id']: (r['model'], json.loads(r['data_json'])) for r in db.execute('SELECT job_id, model, data_json FROM scores')}
                by_title = {j['title']: rows[j['id']] for j in candidates}
                self.assertEqual({t: (m, d['score'], d.get('first_pass', False)) for t, (m, d) in by_title.items()},
                                 {'SRE 0': ('cheap', 20, True), 'SRE 1': ('cheap', 30, True), 'SRE 2': ('main', 55, False), 'SRE 3': ('main', 95, False)})
                # nothing is pending afterwards: the quick scores count as scored until the job or profile changes
                self.assertIn('0 job(s)', score.run(db, candidates, 'Profile', 'main', 10, client=client, first_pass='cheap', escalate_min=50))

    def test_no_first_pass_model_means_the_main_model_scores_everything_as_before(self):
        with tempfile.TemporaryDirectory() as tmp:
            with job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
                seed_jobs(db, 3)
                candidates, _ = digest.eligible_jobs(db)
                client = FakeClient()
                self.assertIn('Scored 3 of 3 job(s) with m;', score.run(db, candidates, 'P', 'm', 10, client=client, first_pass=''))
                self.assertEqual(len(client.requests), 3)
                # a first pass named like the main model is no cascade either
                self.assertIn('0 job(s)', score.run(db, candidates, 'P', 'm', 10, client=client, first_pass='m'))


class ScoreTests(unittest.TestCase):
    def test_rescores_only_when_job_or_profile_changes(self):
        with tempfile.TemporaryDirectory() as tmp:
            with job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
                seed_jobs(db, 3)
                candidates, _ = digest.eligible_jobs(db)
                client = FakeClient()
                self.assertIn('Scored 3 of 3', score.run(db, candidates, 'Profile v1', 'm', 10, client=client))
                self.assertIn('0 job(s)', score.run(db, candidates, 'Profile v1', 'm', 10, client=client))
                self.assertIn('Scored 3 of 3', score.run(db, candidates, 'Profile v2', 'm', 10, client=client))
                system = client.requests[0]['system'][0]
                self.assertIn('Profile v1', system['text'])
                self.assertEqual(system['cache_control'], {'type': 'ephemeral'})
                self.assertEqual(client.requests[0]['output_config']['format']['type'], 'json_schema')

    def test_scores_are_clamped(self):
        client = FakeClient(value=140)
        data, _ = score.score_one(client, 'm', {'title': 'SRE', 'company': 'X', 'description': 'd'}, 'p')
        self.assertEqual(data['score'], 100)

    def test_best_matches_lead_and_rotate(self):
        with tempfile.TemporaryDirectory() as tmp:
            with job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
                seed_jobs(db, 20)
                candidates, _ = digest.eligible_jobs(db)
                for job in candidates:
                    # ids 1-3: low fit (hidden); 4-10: 64..70; 11-20: 86..95, a gap wider than the rotation jitter
                    value = 30 if job['id'] <= 3 else 60 + job['id'] if job['id'] <= 10 else 75 + job['id']
                    score.save(db, job, 'm', fit(value), 'p')
                db.execute("UPDATE jobs SET first_seen_at = '1999-01-01T00:00:00+00:00'"); digest.mark_shown(db, [row[0] for row in db.execute('SELECT id FROM jobs')], seed=0, now=datetime(2000, 1, 1, tzinfo=timezone.utc))  # sent long ago: older jobs
                first = []
                message = digest.build_digest(db, seed=1, shown_ids=first)[0][0]
                digest.mark_shown(db, first, seed=1)
                second = []
                digest.build_digest(db, seed=2, shown_ids=second)
        self.assertIn('Best matches · ', message)
        self.assertIn('<b>Fit:</b> 95/100', message)
        self.assertNotIn('low fit', message)   # the pipeline counts block is gone (owner, 24 Oct 2026)
        self.assertEqual(message.count('Best matches · '), 1)
        self.assertIn('Kubernetes + Datadog match; salary not stated', message)
        self.assertNotIn('<i>', message)   # no italics for content
        self.assertEqual(set(first), set(range(11, 21)))  # the ten highest scores
        self.assertFalse({1, 2, 3} & set(first + second))  # below digest_min_score: never in the digest
        # Light rotation: some best matches return, but the list is not identical.
        self.assertNotEqual(first, second)
        self.assertTrue(set(first) & set(second))


if __name__ == '__main__':
    unittest.main()


class ScoringProfileTests(unittest.TestCase):
    PROFILE = ('# Hard constraints\n- EU citizen\n# Contact\n- Phone: +00 000\n# Links\n- LinkedIn: x\n## 📎 CV\n- cv.pdf\n'
               '# Experience\n## SRE — Acme\n- Kubernetes\n# Application form answers — surveys\n- Gender: …')

    def test_the_fit_score_reads_goals_and_experience_but_not_contact_links_or_form_answers(self):
        kept = score.scoring_profile(self.PROFILE)
        self.assertEqual(kept, '# Hard constraints\n- EU citizen\n# Experience\n## SRE — Acme\n- Kubernetes')

    def test_your_details_facts_are_read_even_under_a_links_heading(self):
        # The owner's Profile (18 Oct 2026): 🛂 / 💶 / 🗣️ sat under "# Links", so the scorer never saw his work permit or languages.
        profile = ('# Links\n- Medium: x\n## 📎 CV\n- cv.pdf\n## 📇 Contact details\n- Phone: +00 000\n## 🛂 Work eligibility\n- Work permit: B permit\n'
                   '## 💶 Availability & compensation\n- Notice period: 1 month\n## 🗣️ Languages\n- Languages I can work in: English\n# Experience\n- SRE')
        self.assertEqual(score.scoring_profile(profile), '## 🛂 Work eligibility\n- Work permit: B permit\n## 💶 Availability & compensation\n- Notice period: 1 month\n'
                         '## 🗣️ Languages\n- Languages I can work in: English\n# Experience\n- SRE')

    def test_the_fact_sections_are_the_desktop_ones(self):
        from src import desktop_strategy
        for _, title in desktop_strategy.DETAILS_SECTIONS:
            self.assertTrue(score.FACT_SECTION.search(f'🛂 {title}'), title)
        self.assertFalse(score.FACT_SECTION.search('📇 Contact details'))

    def test_a_new_phone_number_rescores_nothing_but_a_new_skill_does(self):
        import sqlite3
        db = sqlite3.connect(':memory:')
        db.row_factory = sqlite3.Row
        job = {'id': 1, 'title': 'SRE', 'description': 'Run Kubernetes', 'ai': {}, 'first_seen_at': '2026-09-28'}
        score.save(db, job, 'm', {'score': 80}, score.scoring_profile(self.PROFILE))
        phone = self.PROFILE.replace('+00 000', '+11 111')
        self.assertEqual(score.stale_count(db, [job], phone), 0)
        skill = self.PROFILE.replace('- Kubernetes', '- Kubernetes, Terraform')
        self.assertEqual(score.stale_count(db, [job], skill), 1)

    def test_scores_made_from_the_whole_profile_stay_current_without_a_new_ai_call(self):
        import sqlite3
        db = sqlite3.connect(':memory:')
        db.row_factory = sqlite3.Row
        job = {'id': 1, 'title': 'SRE', 'description': 'Run Kubernetes', 'ai': {}, 'first_seen_at': '2026-09-28'}
        score.save(db, job, 'm', {'score': 80}, self.PROFILE)  # scored before scoring_profile existed
        self.assertEqual(score.stale_count(db, [job], self.PROFILE), 0)  # adopted: its hash is updated, no re-score
        self.assertEqual(score.stale_count(db, [job], self.PROFILE.replace('+00 000', '+2')), 0)


class ProvenanceTests(unittest.TestCase):
    def test_kept_scores_are_labelled_previous_method_and_can_be_queued_for_a_new_score(self):
        import sqlite3
        db = sqlite3.connect(':memory:')
        db.row_factory = sqlite3.Row
        profile = '# Goals\n- SRE\n# Contact\n- Phone: 1'
        job = {'id': 1, 'title': 'SRE', 'description': 'Run Kubernetes', 'ai': {}, 'first_seen_at': '2026-09-28'}
        score.save(db, job, 'm', {'score': 80}, profile)  # the whole Profile: the previous method
        score.stale_count(db, [job], profile)  # kept without an AI call...
        self.assertEqual(score.load(db)[1]['method'], 'Previous')  # ...but labelled as such
        self.assertEqual(score.previous_method(db), [1])
        self.assertEqual(score.rescore_previous(db), 1)
        self.assertEqual(score.stale_count(db, [job], profile), 1)  # queued: the next search re-scores it
        score.save(db, job, 'm', {'score': 82}, score.scoring_profile(profile))
        self.assertEqual((score.load(db)[1]['method'], score.load(db)[1]['scorer_version']), ('Current', score.SCORER_VERSION))


class KitProvenanceTests(unittest.TestCase):
    def test_a_kit_is_current_until_its_cv_profile_or_answers_change_and_unknown_without_a_record(self):
        import tempfile
        from pathlib import Path
        from src.ai import provenance
        with tempfile.TemporaryDirectory() as tmp:
            cv = Path(tmp) / 'cv.pdf'
            cv.write_bytes(b'%PDF one')
            recorded = provenance.kit_inputs('# Goals\n- SRE\n# Contact\n- Phone: 1', '# A\n- x', cv)
            self.assertEqual(provenance.kit_state(recorded, provenance.kit_inputs('# Goals\n- SRE\n# Contact\n- Phone: 2', '# A\n- x', cv)), 'current')
            self.assertEqual(provenance.kit_state(recorded, provenance.kit_inputs('# Goals\n- SRE, platform', '# A\n- y', cv)), 'earlier:profile,answers')
            cv.write_bytes(b'%PDF two')
            self.assertEqual(provenance.kit_state(recorded, provenance.kit_inputs('# Goals\n- SRE', '# A\n- x', cv)), 'earlier:cv')
        self.assertEqual(provenance.kit_state('', 'cv:a profile:b answers:c'), 'unknown')


class SpendLimitTests(unittest.TestCase):
    def test_the_spend_limit_stops_scoring_and_the_run_says_what_was_left_out(self):
        # 29 Sep 2026: every remaining job was still sent and failed the same way (23 raw errors), and the run was "OK".
        class Limited(FakeClient):
            def create(self, **params):
                self.requests.append(params)
                raise RuntimeError('Error code: 400 - You have reached your specified API usage limits.')
        with tempfile.TemporaryDirectory() as tmp:
            with job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
                seed_jobs(db, 8)
                candidates, _ = digest.eligible_jobs(db)
                client, stats = Limited(), {}
                score.run(db, candidates, 'Profile', 'm', 10, client=client, workers=1, stats=stats)
                self.assertLess(len(client.requests), 8)  # stopped, not one call per job
                self.assertTrue(stats['limit'])
                self.assertEqual(daily.left_out(stats, 'scored'), ['8 job(s) not scored: the Anthropic API spending limit was reached'])
                self.assertEqual(daily.left_out({'pending': 3, 'done': 3}, 'scored'), [])
                # Time up is not a failure: no warning (8 Oct 2026); a real failure still is.
                self.assertEqual(daily.left_out({'pending': 1, 'done': 0, 'failed': 0, 'late': 4}, 'read by AI'), [])
                self.assertEqual(daily.left_out({'pending': 5, 'done': 2, 'failed': 1, 'late': 2}, 'scored'), ['1 job(s) not scored: the AI call failed'])

    def test_scoring_on_without_any_profile_is_a_warning_not_a_silent_skip(self):
        # 6 Oct 2026: an import brought no Profile and no Notion; 24 new jobs stayed unscored under a green "Completed".
        self.assertEqual(daily.no_profile(60, None, ''), [daily.NO_PROFILE])
        self.assertEqual(daily.no_profile(60, object(), ''), [])        # Notion connected: its Profile page is read
        self.assertEqual(daily.no_profile(60, None, '# Me'), [])        # Trying: this Mac's profile.md
        self.assertEqual(daily.no_profile(0, None, ''), [])             # scoring off: nothing to warn about


class ScoringPromptGroundingTests(unittest.TestCase):
    """The score text is read by a person deciding whether to apply. The golden-postings e2e judge (2 Oct 2026) found the scorer writing figures and places
    that were in neither the posting nor the profile: "30% below minimum" for a 7-21% gap, "Geneva fits your Zurich home base" for a 5-day on-site job,
    "in target range" for a figure outside it, and a tool (Docker) and a level (Staff) the profile does not give the candidate. The prompt must forbid each."""

    def test_the_prompt_forbids_made_up_numbers_and_distances(self):
        text = score.SYSTEM.lower()
        for rule in ('do not compute percentages', 'commute times or distances', 'minimum and the target are different figures',
                     'in the target range', 'in another city', 'credit the candidate only with', 'level the profile does not state'):
            self.assertIn(rule, text)


class SoFarTests(unittest.TestCase):
    def test_every_few_scores_the_run_hands_them_on(self):
        # 7 Oct 2026: Job Matches waited for the whole search; now the search writes the scores so far every 10 (here every 2).
        with tempfile.TemporaryDirectory() as tmp, job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
            seed_jobs(db, 5)
            candidates, _ = digest.eligible_jobs(db)
            calls = []
            score.run(db, candidates, 'Profile', 'm', 10, client=ModelClient({'m': lambda title: 70}), on_scored=lambda: calls.append(1), every=2)
            self.assertEqual(len(calls), 2, '5 scores: after the 2nd and the 4th')


class BatchOnlyTests(unittest.TestCase):
    def test_only_the_refreshs_batch_is_scored(self):
        with tempfile.TemporaryDirectory() as tmp, job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
            seed_jobs(db, 4)
            candidates, _ = digest.eligible_jobs(db)
            client = ModelClient({'m': lambda title: 70})
            score.run(db, candidates, 'Profile', 'm', 10, client=client, only_ids={candidates[0]['id']})
            self.assertEqual(len(client.requests), 1)


class QueueTests(unittest.TestCase):
    """A refresh sizes its batches from score.queue(); a job run() has just scored is not waiting any more (7 Oct 2026: the queue was asked
    with the whole Profile, every scored job looked out of date, the next batch found "0 job(s) to score" and the refresh stopped)."""
    PROFILE = '# Experience\nSRE, Kubernetes.\n# Contact\nphone 079 000 00 00'

    def test_a_scored_job_leaves_the_queue(self):
        with tempfile.TemporaryDirectory() as tmp:
            with job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
                seed_jobs(db, 3)
                candidates, _ = digest.eligible_jobs(db)
                self.assertEqual(len(score.queue(db, candidates, self.PROFILE)), 3)
                score.run(db, candidates, self.PROFILE, 'm', 2, client=FakeClient(), only_ids={candidates[0]['id'], candidates[1]['id']})
                self.assertEqual([job['id'] for job in score.queue(db, candidates, self.PROFILE)], [candidates[2]['id']])

    def test_the_refresh_asks_only_through_queue(self):
        source = ''.join(path.read_text() for path in Path(daily.__file__).parent.glob('daily*.py'))
        self.assertNotIn('score.pending_jobs(', source, 'pending_jobs hashes with the profile it is given; use score.queue()')
