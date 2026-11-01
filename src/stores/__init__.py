"""Where the user's data lives: `open_stores()` picks the adapter, the only place that knows them by name.

The rest of the code asks `stores.applications`, `stores.texts`, … and never imports an adapter. Spec:
docs/superpowers/specs/2026-10-09-store-adapters.md. Guarded by tests/test_stores_open.py.
"""
import importlib
import os

from .base import CLOUD, FILES, LINKS, TEXTS, Stores, url_key  # noqa: F401 (the package's public names)

# name → module with `open_store(env)`. An adapter is registered here once it passes tests/store_contract.py.
ADAPTERS = {
    'memory': 'src.stores.memory',
    'sqlite': 'src.stores.sqlite',
    'notion': 'src.stores.notion',
}


def chosen(env=None):
    """The adapter's name: JOBADABRA_STORE (the app passes its `store` setting), else notion when a token is
    set (Always on, the terminal, every install from before 9 Oct 2026: no change), else sqlite."""
    env = os.environ if env is None else env
    return env.get('JOBADABRA_STORE') or ('notion' if env.get('NOTION_TOKEN') else 'sqlite')


def open_stores(env=None, tracker=None) -> Stores:
    """The active store. tracker: a Notion client the caller already holds (an engine command's, a test's fake): the
    caller is on Notion, so the store is JOBADABRA_STORE or notion, and the notion adapter uses that client
    instead of making a second one from the environment."""
    env = os.environ if env is None else env
    name = (env.get('JOBADABRA_STORE') or 'notion') if tracker is not None else chosen(env)
    if name not in ADAPTERS:
        raise LookupError(f'no store adapter "{name}" (known: {", ".join(sorted(ADAPTERS))})')
    module = importlib.import_module(ADAPTERS[name])
    return module.open_store(env, tracker=tracker) if tracker is not None and name == 'notion' else module.open_store(env)

