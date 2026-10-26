"""What each employer feed gave this install, as the pool share sends it (src/contribute.py payload; spec
docs/superpowers/specs/2026-10-18-search-learns-sources.md item B, owner 26 Oct 2026): jobs LOCATED in your places, those with a fit of 70+, and
the seconds its read took. The site sums them per role kind × country into one ranking of every source (jobadabra-web api/source-ranking.js),
served back in the employer index (src/source_rank.py). Counts only, nothing about the person. Tests: tests/test_source_rank.py."""


def employer_counts(db):
    """{company: {'local', 'fit70'}} measured now, or None without a job cache (nothing is sent then). Never stops a share."""
    if db is None:
        return None
    try:
        from . import source_yield
        return source_yield.employer_counts(db)
    except Exception as error:  # noqa: BLE001 — a share without counts is still a share
        print(f'Warning: per-feed counts not measured for the pool: {type(error).__name__}')
        return None


def feed_counts(given, company, seen):
    """The counts one feed's share carries: only for a feed this run read fine (a failed read says nothing about the source). A feed read fine
    with no job in your places sends 0: that is what makes a source dead for your kind and country once 3 installs agree."""
    if not seen.get('ok'):
        return {}
    counts = given.get(company) or {'local': 0, 'fit70': 0}
    took = seen.get('seconds')
    return {'local': int(counts['local']), 'fit70': int(counts['fit70']), **({'seconds': float(took)} if isinstance(took, (int, float)) and took >= 0 else {})}
