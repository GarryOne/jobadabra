"""Whether a page a listing links to is one job posting a person can apply to, judged by the AI before it is kept as a job (26 Oct 2026: a
proof run stored irishjobs' "3,531 Assistant Psychology jobs" and "565 HR jobs" categories and itjobswatch's pages as new jobs, 9 of its 10;
the rules pick a board's category, salary-filter and salary-statistics links like job links). Only pages with no JobPosting data are asked: their title is just the page's heading (careers.job_from_page), so a site's
own page or a category page looks like a job to the title filter. Fixed answers through src/ai/decide.py, kept per address (asked once).
A failed, busy or capped AI leaves a page unjudged: not kept this time, asked again next read. With no AI page reader (no AI at all, or
switched off: careers.reader() is None) nothing is asked and the pages stand, as before (the offline floor). At most MAX_ASKS calls per run:
decide's call cap is shared with title sorting and kinds of work, which a run cannot do without. Tests: tests/test_one_posting.py."""

TOPIC = 'one-posting'
ANSWERS = ('one_posting', 'other')
MAX_ASKS = 20   # model calls per process for this question (one per listing page whose linked pages carry no job data)
_asks = {'n': 0}   # this process's calls; past MAX_ASKS only answers kept earlier count, the rest stay unjudged (not kept) for the next run
TEXT = 450   # characters of the page's own text sent with its heading and address
TASK = ('A page a job site links to from its list, read as a possible job: its heading, its address and the start of its text. one_posting: '
        'the page is one open position a person can apply to (one role at one employer, even when it names several places or levels). '
        "other: anything else: the site's own pages (about the site, contact, privacy, terms, help, sign-in), a category, search or list "
        'of many jobs (often a count of jobs), an article or guide, a company profile, a salary or market statistics page.')


def _text(job):
    return f"Heading: {job['title']}\nAddress: {job['url']}\nText: {(job.get('description') or '')[:TEXT]}"


def kept(jobs, reader_on, judge=None):
    """The jobs among `jobs` the AI judged one posting; all of them with no AI page reader. `judge` (tests): decide.decide's stand-in."""
    if not jobs or not reader_on:
        return list(jobs)
    from ..ai import decide
    before = decide._calls['n']
    answers = (judge or decide.decide)(TOPIC, {job['url']: _text(job) for job in jobs}, ANSWERS, TASK, ask=_asks['n'] < MAX_ASKS) or {}
    _asks['n'] += decide._calls['n'] - before   # model calls only: a page judged before costs nothing (other topics' calls meanwhile count too)
    return [job for job in jobs if answers.get(job['url']) == 'one_posting']
