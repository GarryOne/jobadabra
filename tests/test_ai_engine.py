"""The AI engine (src/ai/engine.py): the API key or the user's own Claude Code, with a FAKE `claude` on disk.

No real Claude Code, no API call, no key: a small Python script named `claude` answers like `claude -p
--output-format json` would, as FAKE_CLAUDE_MODE says, and records its arguments, stdin and folder.
"""
import base64
import json
import os
import stat
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src import features
from src.ai import cost, engine, enrich
from src.notion import cron_runs
from src import store as job_store

FAKE = r'''#!{python}
import json, os, sys, time
args = sys.argv[1:]
mode = os.environ.get('FAKE_CLAUDE_MODE', 'text')
if args == ['--help']:
    flags = '--output-format --model --system-prompt --tools --allowedTools --disallowedTools --permission-mode --effort --no-session-persistence --strict-mcp-config'
    if os.environ.get('FAKE_CLAUDE_OLD') != '1':
        flags += ' --json-schema --max-turns'
    print(flags)
    sys.exit(0)
prompt = sys.stdin.read()
log = os.environ['FAKE_CLAUDE_LOG']
calls = json.load(open(log)) if os.path.exists(log) else []
calls.append({{'args': args, 'prompt': prompt, 'cwd': os.getcwd(), 'files': sorted(os.listdir('.')),
               'api_key': os.environ.get('ANTHROPIC_API_KEY'), 'base_url': os.environ.get('ANTHROPIC_BASE_URL')}})
json.dump(calls, open(log, 'w'))
usage = {{'input_tokens': 11, 'output_tokens': 7, 'cache_read_input_tokens': 3, 'cache_creation_input_tokens': 2}}
def done(result, **extra):
    print(json.dumps(dict({{'type': 'result', 'subtype': 'success', 'is_error': False, 'result': result, 'usage': usage}}, **extra)))
    sys.exit(0)
if mode == 'text':
    done('Hello from the plan')
if mode == 'schema':
    done('', structured_output={{'answer': 'yes', 'score': 7}})
if mode == 'repair':  # the first answer is not JSON, the second is
    done('Sure! Here it is: not json' if len(calls) == 1 else '```json\n{{"answer": "fixed", "score": 1}}\n```')
if mode == 'bad':
    done('never json')
if mode == 'limit':
    print(json.dumps({{'type': 'result', 'subtype': 'success', 'is_error': True,
                      'result': 'Claude AI usage limit reached|1760000000', 'usage': usage}}))
    sys.exit(1)
if mode == 'signed-out':
    print(json.dumps({{'type': 'result', 'subtype': 'success', 'is_error': True,
                      'result': 'Invalid API key · Please run /login', 'usage': usage}}))
    sys.exit(1)
if mode == 'sleep':
    time.sleep(5)
    done('late')
'''

SCHEMA = {'type': 'object', 'properties': {'answer': {'type': 'string'}, 'score': {'type': 'integer'}},
          'required': ['answer', 'score'], 'additionalProperties': False}


class FakeClaude:
    """A fake `claude` in a temp folder; .calls reads what it was asked."""

    def __init__(self, test, mode='text', old=False):
        self.dir = tempfile.TemporaryDirectory()
        test.addCleanup(self.dir.cleanup)
        self.binary = str(Path(self.dir.name) / 'claude')
        Path(self.binary).write_text(FAKE.format(python=sys.executable))
        os.chmod(self.binary, os.stat(self.binary).st_mode | stat.S_IEXEC)
        # Windows cannot run a script by its shebang: there the fake is run through the interpreter, by the `run` hook CliClient already takes (and flags() probes with).
        self.run = (lambda args, **kwargs: subprocess.run([sys.executable, self.binary, *args[1:]], **kwargs)) if sys.platform == 'win32' else subprocess.run
        self.log = str(Path(self.dir.name) / 'calls.json')
        patcher = mock.patch.dict(os.environ, {'FAKE_CLAUDE_MODE': mode, 'FAKE_CLAUDE_LOG': self.log,
                                               'FAKE_CLAUDE_OLD': '1' if old else '0',
                                               'ANTHROPIC_API_KEY': 'sk-test-not-real',
                                               'ANTHROPIC_BASE_URL': 'https://relay.test'})
        patcher.start()
        test.addCleanup(patcher.stop)
        engine._help.pop(self.binary, None)

    @property
    def calls(self):
        return json.loads(Path(self.log).read_text()) if os.path.exists(self.log) else []

    def client(self, **kwargs):
        return engine.CliClient(binary=self.binary, log=kwargs.pop('log', lambda text: None), **({'run': self.run} if sys.platform == 'win32' else {}), **kwargs)


class CliClientTests(unittest.TestCase):
    def test_text_call_is_a_drop_in_for_the_sdk(self):
        fake = FakeClaude(self)
        response = fake.client().messages.create(
            model='claude-haiku-4-5', max_tokens=100,
            system=[{'type': 'text', 'text': 'Be brief.', 'cache_control': {'type': 'ephemeral'}}],
            messages=[{'role': 'user', 'content': 'Say hello'}])
        self.assertEqual(response.stop_reason, 'end_turn')
        self.assertEqual(response.model, 'claude-haiku-4-5')
        self.assertEqual([(b.type, b.text) for b in response.content], [('text', 'Hello from the plan')])
        self.assertEqual((response.usage.input_tokens, response.usage.output_tokens, response.usage.cache_read_input_tokens,
                          response.usage.cache_creation_input_tokens), (11, 7, 3, 2))
        call = fake.calls[0]
        args = call['args']
        self.assertEqual(args[:5], ['-p', '--output-format', 'json', '--model', 'haiku'])
        self.assertEqual(args[args.index('--system-prompt') + 1], 'Be brief.')
        self.assertEqual(args[args.index('--tools') + 1], '')  # no tools for a text call
        self.assertEqual(args[args.index('--permission-mode') + 1], 'dontAsk')
        self.assertEqual(args[args.index('--max-turns') + 1], '1')
        self.assertNotIn('--dangerously-skip-permissions', args)
        self.assertEqual(call['prompt'], 'Say hello')  # on stdin, never in the process list
        # The user's own sign-in: the API key and the relay the app gives Python never reach Claude Code.
        self.assertIsNone(call['api_key'])
        self.assertIsNone(call['base_url'])
        self.assertTrue(Path(call['cwd']).name.startswith('job-pilotto-claude-'))
        self.assertFalse(Path(call['cwd']).exists())  # the fresh folder is gone afterwards

    def test_models_map_to_claude_code_aliases(self):
        self.assertEqual([engine.alias(m) for m in ('claude-haiku-4-5', 'claude-sonnet-5-5', 'claude-opus-5-5', 'other')],
                         ['haiku', 'sonnet', 'opus', 'other'])

    def test_structured_output_uses_the_json_schema_flag(self):
        fake = FakeClaude(self, 'schema')
        response = fake.client().messages.create(
            model='claude-sonnet-5-5', max_tokens=100, messages=[{'role': 'user', 'content': 'Score it'}],
            output_config={'format': {'type': 'json_schema', 'schema': SCHEMA}, 'effort': 'low'})
        self.assertEqual(json.loads(response.content[0].text), {'answer': 'yes', 'score': 7})
        args = fake.calls[0]['args']
        self.assertEqual(json.loads(args[args.index('--json-schema') + 1]), SCHEMA)
        self.assertEqual(args[args.index('--effort') + 1], 'low')
        self.assertEqual(args[args.index('--model') + 1], 'sonnet')

    def test_old_claude_code_gets_the_schema_in_the_prompt_and_one_repair(self):
        fake = FakeClaude(self, 'repair', old=True)
        logged = []
        response = fake.client(log=logged.append).messages.create(
            model='claude-sonnet-5-5', max_tokens=100, messages=[{'role': 'user', 'content': 'Score it'}],
            output_config={'format': {'type': 'json_schema', 'schema': SCHEMA}})
        self.assertEqual(json.loads(response.content[0].text), {'answer': 'fixed', 'score': 1})
        calls = fake.calls
        self.assertEqual(len(calls), 2)
        self.assertNotIn('--json-schema', calls[0]['args'])
        self.assertIn('matches this JSON schema', calls[0]['prompt'])
        self.assertIn('previous answer was not valid', calls[1]['prompt'])
        self.assertEqual(response.usage.input_tokens, 22)  # both calls counted
        self.assertTrue(any('asking once more' in line for line in logged))

    def test_a_second_invalid_answer_is_an_error_not_a_loop(self):
        fake = FakeClaude(self, 'bad', old=True)
        with self.assertRaises(engine.CliError):
            fake.client().messages.create(model='claude-sonnet-5-5', messages=[{'role': 'user', 'content': 'x'}],
                                          output_config={'format': {'type': 'json_schema', 'schema': SCHEMA}})
        self.assertEqual(len(fake.calls), 2)

    def test_images_are_files_in_the_call_folder_with_read_only_there(self):
        fake = FakeClaude(self)
        png = base64.b64encode(b'\x89PNG fake').decode()
        fake.client().messages.create(model='claude-haiku-4-5', messages=[{'role': 'user', 'content': [
            {'type': 'image', 'source': {'type': 'base64', 'media_type': 'image/png', 'data': png}},
            {'type': 'image', 'source': {'type': 'base64', 'media_type': 'image/jpeg', 'data': png}},
            {'type': 'text', 'text': 'Transcribe these'}]}])
        call = fake.calls[0]
        self.assertEqual(call['files'], ['image-1.png', 'image-2.jpg'])
        args = call['args']
        self.assertEqual(args[args.index('--tools') + 1], 'Read')
        self.assertEqual(args[args.index('--allowedTools') + 1], 'Read(./**)')
        self.assertIn('./image-1.png, ./image-2.jpg', call['prompt'])
        self.assertIn('Transcribe these', call['prompt'])
        self.assertFalse(Path(call['cwd']).exists())

    def test_usage_limit_stops_the_run_like_the_api_spend_limit(self):
        fake = FakeClaude(self, 'limit')
        with self.assertRaises(engine.CliLimitError) as caught:
            fake.client().messages.create(model='claude-haiku-4-5', messages=[{'role': 'user', 'content': 'x'}])
        self.assertTrue(cost.limit_reached(caught.exception))
        self.assertTrue(cost.cli_limit(caught.exception))
        self.assertIn('usage window is exhausted', str(caught.exception))
        self.assertIn('try again later', cost.limit_message(caught.exception, 'the weekly report'))
        self.assertIn('Anthropic API spend limit', cost.limit_message(RuntimeError('usage limit'), 'the weekly report'))

    def test_signed_out_tells_the_user_to_sign_in_themselves(self):
        fake = FakeClaude(self, 'signed-out')
        with self.assertRaises(engine.CliLimitError) as caught:
            fake.client().messages.create(model='claude-haiku-4-5', messages=[{'role': 'user', 'content': 'x'}])
        self.assertIn('run `claude` and sign in', str(caught.exception))
        self.assertTrue(cost.limit_reached(caught.exception))

    def test_a_hard_timeout(self):
        fake = FakeClaude(self, 'sleep')
        started = time.monotonic()
        with self.assertRaises(engine.CliError) as caught:
            fake.client(timeout=1).messages.create(model='claude-haiku-4-5', messages=[{'role': 'user', 'content': 'x'}])
        self.assertLess(time.monotonic() - started, 4)
        self.assertIn('did not answer within 1 s', str(caught.exception))
        self.assertFalse(cost.limit_reached(caught.exception))

    def test_two_timeouts_in_a_row_stop_the_run_instead_of_waiting_for_every_job(self):
        # 2 Oct 2026: a friend's Claude Code did not answer; each of ~60 jobs waited the full 10 minutes (hours, "Running"
        # forever). After two timeouts in a row Claude Code is treated like a limit: the run stops and says what to check.
        fake = FakeClaude(self, 'sleep')
        client = fake.client(timeout=1)
        ask = lambda: client.messages.create(model='claude-haiku-4-5', messages=[{'role': 'user', 'content': 'x'}])
        with self.assertRaises(engine.CliError) as first:
            ask()
        self.assertNotIsInstance(first.exception, engine.CliLimitError)       # one timeout is just that job
        with self.assertRaises(engine.CliError) as second:
            ask()
        self.assertIsInstance(second.exception, engine.CliLimitError)         # the second stops the run
        self.assertTrue(cost.limit_reached(second.exception))
        self.assertIn('did not answer twice in a row', str(second.exception))
        self.assertIn('run `claude`', str(second.exception))
        started = time.monotonic()
        with self.assertRaises(engine.CliLimitError):                          # and nothing waits again
            ask()
        self.assertLess(time.monotonic() - started, 0.5)

    def test_missing_binary(self):
        with self.assertRaises(engine.CliLimitError) as caught:
            engine.CliClient(binary='', log=lambda t: None).messages.create(model='claude-haiku-4-5', messages=[])
        self.assertIn('not found', str(caught.exception))

    def test_plan_limit_falls_back_to_the_api_only_when_allowed_and_then_stays_there(self):
        fake = FakeClaude(self, 'limit')
        api = SimpleNamespace(calls=0)
        api.messages = SimpleNamespace(create=lambda **p: (setattr(api, 'calls', api.calls + 1) or 'api answer'))
        logged = []
        client = fake.client(fallback=lambda: api, log=logged.append)
        self.assertEqual(client.messages.create(model='claude-haiku-4-5', messages=[{'role': 'user', 'content': 'x'}]), 'api answer')
        self.assertEqual(client.messages.create(model='claude-haiku-4-5', messages=[{'role': 'user', 'content': 'y'}]), 'api answer')
        self.assertEqual((len(fake.calls), api.calls), (1, 2))  # no retry storm on the plan
        self.assertTrue(any('Using your Anthropic API key' in line for line in logged))

    def test_at_most_two_claude_code_processes_at_once(self):
        live, most, lock = [0], [0], threading.Lock()

        def run(args, **kwargs):
            if args[1:] == ['--help']:
                return SimpleNamespace(stdout='--tools', stderr='', returncode=0)
            with lock:
                live[0] += 1
                most[0] = max(most[0], live[0])
            time.sleep(0.05)
            with lock:
                live[0] -= 1
            return SimpleNamespace(stdout=json.dumps({'type': 'result', 'is_error': False, 'result': 'ok', 'usage': {}}),
                                   stderr='', returncode=0)

        client = engine.CliClient(binary='/fake/claude-parallel', run=run, log=lambda t: None)
        threads = [threading.Thread(target=client.messages.create, kwargs={
            'model': 'claude-haiku-4-5', 'messages': [{'role': 'user', 'content': 'x'}]}) for _ in range(6)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(most[0], engine.PARALLEL)

    def test_enrich_runs_unchanged_on_claude_code(self):
        fake = FakeClaude(self, 'text')
        facts = {'languages': [], 'english_is_enough': {'value': 'yes', 'evidence': ''}, 'seniority': {'value': 'senior', 'evidence': 'Senior'},
                 'work_mode': {'value': 'hybrid', 'remote_scope': '', 'evidence': 'hybrid'}, 'technologies': ['Kubernetes']}   # all filled: one call
        with mock.patch.dict(os.environ, {'FAKE_CLAUDE_MODE': 'text'}), \
                mock.patch.object(engine.CliClient, '_answer', staticmethod(lambda data, schema: json.dumps(facts))), \
                mock.patch('src.ai.providers.cli_base.problems', lambda value, schema, where='$': []):
            with tempfile.TemporaryDirectory() as tmp, job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
                job_store.import_watch_report(db, {'jobs': [{'id': '1', 'url': 'https://x.test/1', 'title': 'SRE',
                                                             'company': 'Example', 'description': 'Kubernetes.'}]})
                stats = {}
                summary = enrich.run(db, 'claude-haiku-4-5', 5, client=fake.client(), stats=stats)
        self.assertIn('Enriched 1 of 1', summary)
        self.assertEqual((stats['usd'], stats['cli_calls'], stats.get('api_calls')), (0.0, 1, None))
        self.assertEqual(stats['tokens_in'], 11)


class SelectionTests(unittest.TestCase):
    def test_the_users_choice_nothing_automatic(self):
        self.assertEqual(engine.choice({}), 'api')
        self.assertEqual(engine.choice({'JOB_PILOTTO_AI_ENGINE': 'cli'}), 'cli')
        self.assertEqual(engine.choice({'JOB_PILOTTO_AI_ENGINE': 'CLI '}), 'cli')
        self.assertEqual(engine.choice({'JOB_PILOTTO_AI_ENGINE': 'auto'}), 'api')  # no silent automatic choice

    def test_client_matrix(self):
        with mock.patch('src.ai.providers.anthropic_api.sdk', lambda action='': 'sdk client'):
            self.assertEqual(engine.client({'ANTHROPIC_API_KEY': 'k'}).client, 'sdk client')
            self.assertEqual(engine.client({}).client, 'sdk client')  # the SDK says what's missing, as before
            cli = engine.client({'JOB_PILOTTO_AI_ENGINE': 'cli', 'JOB_PILOTTO_CLAUDE_BIN': sys.executable})
            self.assertIsInstance(cli, engine.CliClient)
            self.assertEqual(cli.binary, sys.executable)
            self.assertIsNone(cli.fallback)
            with_key = engine.client({'JOB_PILOTTO_AI_ENGINE': 'cli', 'JOB_PILOTTO_AI_FALLBACK': 'api', 'ANTHROPIC_API_KEY': 'k'})
            self.assertIsNotNone(with_key.fallback)
            no_key = engine.client({'JOB_PILOTTO_AI_ENGINE': 'cli', 'JOB_PILOTTO_AI_FALLBACK': 'api'})
            self.assertIsNone(no_key.fallback)  # the fallback needs a key

    def test_ready_and_features(self):
        self.assertFalse(engine.ready({}))
        self.assertTrue(engine.ready({'ANTHROPIC_API_KEY': 'k'}))
        self.assertTrue(engine.ready({'JOB_PILOTTO_AI_ENGINE': 'cli'}))
        cli = {'JOB_PILOTTO_AI_ENGINE': 'cli', 'JOB_PILOTTO_ENRICH_MODEL': 'claude-haiku-4-5'}
        self.assertTrue(features.configured('enrich', cli))
        self.assertFalse(features.configured('enrich', dict(cli, JOB_PILOTTO_AI_ENGINE='api')))
        self.assertTrue(features.configured('enrich', {'ANTHROPIC_API_KEY': 'k', 'JOB_PILOTTO_ENRICH_MODEL': 'm'}))

    def test_find_binary_prefers_the_apps_path(self):
        self.assertEqual(engine.find_binary({'JOB_PILOTTO_CLAUDE_BIN': '/x/claude', 'PATH': ''}, exists=lambda p: p == '/x/claude'), '/x/claude')
        installed = str(Path('/h') / '.local' / 'bin' / 'claude')   # the path as this OS writes it
        self.assertEqual(engine.find_binary({'PATH': '', 'HOME': '/h'}, exists=lambda p: p == installed), installed)
        self.assertEqual(engine.find_binary({'PATH': '', 'HOME': '/h'}, exists=lambda p: False), '')


class BillingTests(unittest.TestCase):
    def test_subscription_calls_cost_nothing_in_api_dollars(self):
        cli = engine.Usage(1_000_000, 1_000_000)
        api = SimpleNamespace(input_tokens=1_000_000, output_tokens=0)
        self.assertEqual(cost.usd('claude-sonnet-5-5', cli), 0.0)
        self.assertEqual(cost.usd('claude-sonnet-5-5', api), 2.0)
        stats = {}
        cost.add(stats, 'claude-sonnet-5-5', cli)
        cost.add(stats, 'claude-sonnet-5-5', api)
        self.assertEqual((stats['cli_calls'], stats['api_calls'], stats['usd']), (1, 1, 2.0))

    def test_run_row_says_claude_code_and_logs_zero_api_dollars(self):
        run = cron_runs.new_run('insight')
        run.update(headline='Insight sent', insight={'model': 'claude-sonnet-5-5', 'tokens_in': 100, 'tokens_out': 10,
                                                     'usd': 0.0, 'cli_calls': 1})
        properties, children = cron_runs.run_page(run)
        self.assertEqual(properties['AI cost (USD)'], {'number': 0})  # the budget guard sums this column
        self.assertEqual(properties['Billed to'], {'select': {'name': 'Claude subscription'}})
        self.assertEqual(properties['Summary']['rich_text'][0]['text']['content'], 'Insight sent (Claude Code, your plan)')
        stage = [c['bulleted_list_item']['rich_text'][0]['text']['content'] for c in children if c['type'] == 'bulleted_list_item']
        self.assertTrue(any(line.endswith('Claude Code, your plan') for line in stage))

    def test_api_and_fallback_rows(self):
        run = cron_runs.new_run('insight')
        run.update(headline='Insight sent', insight={'model': 'claude-sonnet-5-5', 'usd': 0.02, 'api_calls': 1})
        properties, _ = cron_runs.run_page(run)
        self.assertEqual(properties['Billed to'], {'select': {'name': 'Anthropic API credits'}})
        self.assertEqual(properties['Summary']['rich_text'][0]['text']['content'], 'Insight sent (AI cost $0.020)')
        run['insight']['cli_calls'] = 2
        self.assertEqual(cron_runs.billed_to(run), 'Both')
        self.assertIsNone(cron_runs.billed_to(cron_runs.new_run('scout')))

    def test_budget_counts_only_api_dollars(self):
        from src.ai import budget
        from datetime import datetime, timezone
        from src.stores import memory
        stores, now = memory.open_store(), datetime.now(timezone.utc).isoformat(timespec='seconds')
        stores.cron_runs.put({'kind': 'insight', 'started_at': now, 'stats': {'ai_cost_usd': 0, 'billed_to': 'Claude subscription'}})
        stores.cron_runs.put({'kind': 'insight', 'started_at': now, 'stats': {'ai_cost_usd': 1.5}})
        with mock.patch.object(budget, 'admin_key', lambda: None):
            info = budget.status(stores)
        self.assertEqual(info['spent'], 1.5)


class StructuredSchemaTests(unittest.TestCase):
    def test_no_array_limits_are_sent(self):
        from src.ai import engine, page_reader, scout_ideas
        from src.sources import job_alerts
        for schema in (page_reader.SCHEMA, page_reader.CHOOSE_SCHEMA, scout_ideas.IDEAS_SCHEMA, job_alerts.SCHEMA):
            sent = json.dumps(engine.structured(schema, 'claude-haiku-4-5')['format']['schema'])
            self.assertNotIn('maxItems', sent)
            self.assertNotIn('minItems', sent)
            self.assertIn('maxItems', json.dumps(schema).replace('minItems', 'maxItems'))  # the originals keep their limits


if __name__ == '__main__':
    unittest.main()


class TimingLine(unittest.TestCase):
    def test_says_where_the_time_went_without_the_prompt(self):
        from src.ai.engine import timing_line
        line = timing_line(['claude', '-p', '--model', 'haiku'], {'duration_ms': 48000, 'duration_api_ms': 6000, 'num_turns': 2, 'result': 'secret answer'}, 3.2, 48.4)
        self.assertEqual(line, 'Claude Code haiku: answered in 48 s (model 6 s, Claude Code itself 42 s, waited 3 s for a free slot; turns 2; reported 48 s)')
        self.assertNotIn('secret', line)
        self.assertNotIn('free slot', timing_line(['claude'], {}, 0.2, 5))

    def test_says_how_much_of_the_answer_was_thinking(self):
        from src.ai.engine import timing_line
        data = {'duration_api_ms': 82000, 'num_turns': 2, 'usage': {'output_tokens': 9110, 'output_tokens_details': {'thinking_tokens': 8656}}}
        self.assertTrue(timing_line(['claude', '--model', 'haiku'], data, 0, 84).endswith('; thinking 8,656 of 9,110 output tokens)'))


class HaikuThinking(unittest.TestCase):
    """7 Oct 2026: Claude Code thinks by default; Haiku through the API never does (no effort setting). Sorting 100 titles: 84 s -> 8 s."""
    def test_haiku_runs_without_thinking_and_the_others_keep_theirs(self):
        from src.ai.engine import CliClient, call_env
        client = CliClient(binary='claude', run=lambda *a, **k: None)
        from src.ai.providers import claude_code
        with mock.patch.object(claude_code, 'flags', lambda *a: {'--tools', '--json-schema', '--effort', '--max-turns'}):
            haiku = client.command('claude-haiku-4-5', 'system', {'type': 'object'})
            sonnet = client.command('claude-sonnet-4-6', 'system', {'type': 'object'}, 'medium')
        self.assertEqual(call_env(haiku, {'PATH': '/bin'})['MAX_THINKING_TOKENS'], '0')
        self.assertNotIn('MAX_THINKING_TOKENS', call_env(sonnet, {'PATH': '/bin'}))
        self.assertNotIn('ANTHROPIC_API_KEY', call_env(haiku, {'ANTHROPIC_API_KEY': 'k'}))   # still the user's sign-in, never the key


class SignedOutTests(unittest.TestCase):
    def test_an_expired_sign_in_stops_the_run_with_how_to_sign_in(self):
        # 7 Oct 2026: a search failed 40 calls in a row on this message, each a "Skipped job", instead of stopping and saying to sign in.
        error = engine.classify('Failed to authenticate: OAuth session expired and could not be refreshed')
        self.assertIsInstance(error, engine.CliLimitError)
        self.assertIn('not signed in', str(error))
        self.assertNotIsInstance(engine.classify('Some other failure'), engine.CliLimitError)
