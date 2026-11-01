"""Fills a data folder with a demo job search through the store API of the release that runs this script (upgrade + data test, spec 2026-11-01-upgrade-data-test-design.md).

Run by an OLD release's own bundled Python with its pilot folder as the working directory, so the data is in that release's format by construction:
    JOB_PILOTTO_STORE=sqlite JOB_PILOTTO_DATA_DIR=<data folder>/data python upgrade-seed.py
Why (1 Nov 2026): it uses only Applications.create / set_section and Events.add, the calls every release since the SQLite store has. Exit 3 = the seed
itself could not run on this release (reported as "seed failed", never as lost data). Fake people and companies only; never the owner's data.
"""
import json
import os
import sys

sys.path.insert(0, os.getcwd())   # the release's pilot folder holds src/; this script lives outside it

STAGES = ['Saved', 'Saved', 'Saved', 'Applied', 'Applied', 'Interview', 'Offer', 'Rejected', 'Dismissed', 'Saved']
ROLES = ['Nurse', 'Electrician', 'Accountant', 'Teacher', 'Pharmacist', 'Welder']


def seed(count=30):
    """Creates `count` fake applications (stages, a note section each, events on the ones past Saved) in the store the environment names; returns how many it made. Any failure propagates to the caller below."""
    from src.stores import open_stores
    stores = open_stores()
    made = 0
    for n in range(1, count + 1):
        stage = STAGES[n % len(STAGES)]
        job = {'url': f'https://jobs.example.test/upgrade/{n}', 'title': f'{ROLES[n % len(ROLES)]} {n}', 'company': f'Example Company {n % 7}',
               'location': 'Zurich' if n % 2 else 'Berlin'}
        row = stores.applications.create(job, stage)
        app_id = row['id']
        stores.applications.set_section(app_id, 'Notes', f'Note for job {n}: a line the person wrote.')
        if stage != 'Saved':
            stores.events.add(app_id, 'note', f'2026-10-{(n % 28) + 1:02d}T09:00:00', note=f'Event for job {n}')
        made += 1
    return made


if __name__ == '__main__':
    try:
        print(json.dumps({'applications': seed()}))
    except Exception as error:   # any drift in an old release's API: the run says "seed failed", not "data lost"
        print(f'seed failed: {type(error).__name__}: {error}', file=sys.stderr)
        sys.exit(3)
