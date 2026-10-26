"""Reading a job list with "changed since?" (src/sources/feed_facts.py): the site's own tag (ETag, If-None-Match → 304) for a list read in one
request, or the newest page and total of a paged list sorted newest first (first_page). Moved out of ats.py (500-line rule); ats.py re-exports
every name and its _get asks conditional_state(). Tests: tests/test_feed_facts.py, tests/test_feed_facts_paged.py."""
import contextlib
import hashlib
import json
import threading
import types


class Unchanged(Exception):
    """The site answered 304: the job list is the one it tagged at the last read (src/sources/feed_facts.py)."""


_asking = threading.local()


@contextlib.contextmanager
def conditional(etag):
    """One reader's read with "changed since?": its first request carries If-None-Match: etag (when there is one) and a 304 raises
    Unchanged. Yields the state: .etag, the tag the site gave the first request; .pages, the requests made (a tag is kept for one only)."""
    state = types.SimpleNamespace(ask=etag, etag=None, pages=0)
    _asking.state = state
    try:
        yield state
    finally:
        _asking.state = None


def conditional_state():
    """This thread's conditional read, or None."""
    return getattr(_asking, 'state', None)


HEAD = 'head:'   # a tag of our own for a paged site's newest page: never sent to a site as an ETag


def first_page(ids, total):
    """A paged reader's first page of its list sorted newest first, and the list's total. The same job ids and the same total as at the
    last read mean no job was added (it would be on top) or removed (the total), so the other pages are not read: raises Unchanged.
    Else the page's tag is kept for the next read (src/sources/feed_facts.py). No-op outside a conditional read or without a total."""
    state = conditional_state()
    if state is None or not isinstance(total, int):
        return
    tag = HEAD + hashlib.sha256(json.dumps([sorted(str(i) for i in ids), total]).encode()).hexdigest()[:16]
    if state.ask == tag:
        raise Unchanged('newest page and total as last time')
    state.etag = tag
