"""Seeds an e2e app's SQLite store with real-shaped, invented data, for the storemove integration tests (integration/store/storemove-*.test.mjs; the e2e suite left on 1 Nov 2026) and the notion-real suite.

`python3 desktop/e2e/lib/store_seed.py <app data folder>`: three applications (one with its kit section and a screenshot file), their
events, an interview, a finished run, a match and an employer, written through the store interface (src/stores), so the data has the
exact shape the app writes. Refuses any folder but a temporary one: never the owner's app data. Prints {entity: count} as JSON.
"""
import json
import os
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
KIT = '📝 Application kit'
PNG = bytes.fromhex('89504e470d0a1a0a0000000d4948445200000001000000010806000000') + b'e2e-storemove-screenshot'
JOBS = [
    ({'url': 'https://jobs.example.test/kestrel/sre', 'title': 'Senior SRE', 'company': 'Kestrel Labs', 'location': 'Zurich',
      'fit': 82}, 'Applied'),
    ({'url': 'https://jobs.example.test/huxley/platform', 'title': 'Platform Engineer', 'company': 'Huxley Systems',
      'location': 'Basel', 'fit': 77}, 'Interview'),
    ({'url': 'https://jobs.example.test/marlow/devops', 'title': 'DevOps Lead', 'company': 'Marlow Freight', 'location': 'Bern',
      'fit': 71}, 'Saved'),
]


def seed(data_dir):
    folder = Path(data_dir).resolve()
    if not str(folder).startswith(str(Path(tempfile.gettempdir()).resolve())):
        raise SystemExit(f'refused: {folder} is not a temporary folder (the e2e app\'s profile lives in the temp folder)')
    os.environ.update({'JOB_PILOTTO_STORE': 'sqlite', 'JOB_PILOTTO_DATA_DIR': str(folder), 'JOB_PILOTTO_FOLLOW_APP': '0',
                       'JOB_PILOTTO_NO_DOTENV': '1'})
    os.environ.pop('NOTION_TOKEN', None)
    sys.path.insert(0, str(REPO))
    from src.stores import sqlite
    stores = sqlite.open_store(dict(os.environ))
    apps = []
    for job, stage in JOBS:
        app, _ = stores.applications.set_stage(job, stage, today='2026-10-01')
        stores.applications.update(app['id'], {'fit': job['fit'], 'location': job['location']})
        apps.append(app)
    kestrel, huxley, _ = apps
    stores.applications.set_section(kestrel['id'], KIT, '## Cover letter\n\nDear Kestrel Labs team, I run platforms that stay up.\n\n'
                                                      '## Form answers\n\n- Notice period: 3 months')
    stores.applications.attach(kestrel['id'], 'reply.png', PNG, 'image/png')
    stores.events.add(kestrel['id'], 'Applied', '2026-10-01', source='e2e')
    stores.events.add(huxley['id'], 'Interview invite', '2026-10-03', source='e2e', note='First round')
    stores.interviews.save(None, {'app_id': huxley['id'], 'title': 'Huxley Systems: first round', 'at': '2026-10-06T10:00:00',
                                  'round': 'First round', 'overall': 'Went well', 'transcript': 'Q: Tell me about on-call.\nA: …'})
    run = stores.cron_runs.begin('mail', 'mac', {'trigger': 'button'})
    stores.cron_runs.finish(run['id'], 'OK', summary='Checked 4 emails', report='Checked 4 emails', result='Gmail check: 4 emails')
    stores.matches.upsert({'url': 'https://jobs.example.test/orrin/sre', 'title': 'Site Reliability Engineer', 'company': 'Orrin AG',
                           'fit': 68, 'status': 'New'})
    stores.employers.add({'name': 'Kestrel Labs', 'careers_url': 'https://kestrel.example.test/careers'})
    return {'applications': len(apps), 'events': 2, 'interviews': 1, 'cron_runs': 1, 'matches': 1, 'employers': 1, 'files': 1}


if __name__ == '__main__':
    print(json.dumps(seed(sys.argv[1])))
