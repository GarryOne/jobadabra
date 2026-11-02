"""The pool's engine-site contract: test/fixtures/pool-payloads.json holds the bodies the engine's own code sends (made by tools/pool_e2e.py),
and the site's contract test posts exactly those. This fails when the engine's bodies change and the fixture was not made again, so the site
test can never pass on bodies the engine no longer sends (7 Oct 2026)."""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from site_private import needs_site

REPO = Path(__file__).resolve().parents[1]
FIXTURE = REPO / 'test' / 'fixtures' / 'pool-payloads.json'


@needs_site
class PoolContractTest(unittest.TestCase):
    def test_the_sites_fixture_is_what_the_engine_sends_today(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / 'payloads.json'
            env = {k: v for k, v in os.environ.items() if not k.startswith('JOBADABRA_')}
            run = subprocess.run([sys.executable, str(REPO / 'tools' / 'pool_e2e.py')], cwd=REPO, env={**env, 'POOL_PAYLOADS_OUT': str(out)},
                                 capture_output=True, text=True, timeout=120)
            self.assertTrue(out.exists(), f'tools/pool_e2e.py made no payloads: {run.stderr[-500:]}')
            self.assertEqual(json.loads(out.read_text()), json.loads(FIXTURE.read_text()),
                             'the engine sends other bodies now: run POOL_PAYLOADS_OUT=test/fixtures/pool-payloads.json python3 tools/pool_e2e.py')


if __name__ == '__main__':
    unittest.main()
