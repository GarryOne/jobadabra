"""Interview analysis, the job an interview belongs to, on the store: finding it (by id, by URL), adding a job an interview
names that isn't tracked yet, and adding its 📈 event. Application records (src/stores/base.py), never Notion pages.
Re-exported by src/ai/interviews.py. Tests: tests/test_interviews_store.py.

Events go through src/stores/rules.add_event and an untracked job is added by src/ledger_store.add_application: the ledger's
rules, on any store.
"""
import os

from ..notion import titles
from ..stores import rules
from ..stores.base import url_key


def key(record_id):
    return (record_id or '').replace('-', '')


def role(app):
    """The application's role, its job title without the "· via …" suffix."""
    return titles.role_of((app or {}).get('title') or '', (app or {}).get('company') or '', (app or {}).get('via') or '')


def who(app):
    return (app or {}).get('company') or (app or {}).get('via') or ''


def app_by_id(stores, app_id, apps=None):
    """The application with this id (Notion ids compare with or without dashes), or None."""
    return next((r for r in (apps if apps is not None else stores.applications.list()) if key(r['id']) == key(app_id)), None)


def by_url(stores, apps, job_url):
    """The application with this Job URL: among the candidates, else any stage (the owner chose it)."""
    wanted = url_key(job_url)
    return next((r for r in apps if url_key(r.get('url')) == wanted), None) or stores.applications.get(job_url.strip())


def application_for(stores, job_url):
    """The application for a job the owner picked; a job not tracked yet is added (an interview means they applied;
    the date is marked approximate)."""
    found = by_url(stores, [], job_url)
    if found:
        return found
    from ..ledger_store import add_application
    added = {}
    add_application(stores, job_url.strip(), approx=True, source=os.getenv('JOBADABRA_SOURCE') or 'Manual', found=added)
    if added.get('row'):
        return added['row']
    found = by_url(stores, [], job_url)
    if not found:
        raise ValueError(f'Could not add {job_url} to your Applications')
    return found
