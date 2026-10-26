"""Kinds of role (software, retail, logistics, …): what an employer or a job board mostly hires for, and what a search looks for.

The central scout counts each feed's job titles by kind and publishes the shares (the employer index's `kinds`); the jobs check then skips
employers in the user's places that hire nothing of the user's kind (6 Oct 2026: a photographer's check read 190 employers in Geneva, nearly all
software companies, and matched 0 of 18,641 postings). Fixed words only: the website keeps the same list (jobadabra-web shared/pool-labels.js KINDS); every copy here is checked by tests/test_role_kinds_split.py.
"""
import re

# Order matters for the seed: tech first, then each kind ("Retail data analyst" is software, "Store manager" retail). 26 Oct 2026 (owner: "where is the
# plane pilot jobs fitting here?"): 8 kinds split out of 'other', from 14,101 measured titles of 'other' employers; the site accepts them (jobadabra-web #130).
KINDS = ('software', 'sales_b2b', 'sales_retail', 'logistics', 'hospitality', 'healthcare', 'creative_media', 'finance_admin', 'education', 'trades', 'engineering', 'business_ops', 'manufacturing', 'science', 'customer_service', 'legal', 'aviation_transport', 'public_security', 'other')
# Which kind a title or a role word is, in any language: the meanings pack (the old word lists of this file and coverage.py as seed, plus what
# the site learned) and, for any other wording, the AI (src/ai/decide.py). A title nobody judged has no kind (left out of a mix, never 'other').
WORK = {'software': 'software, IT, data, devops, security engineering', 'sales_b2b': 'selling to companies, account management, business development',
        'sales_retail': 'shop and store sales', 'logistics': 'warehouse, driving, delivery, supply chain, purchasing', 'hospitality': 'kitchen, restaurant, hotel, bar',
        'healthcare': 'nursing, medical, pharmacy, care, therapy, veterinary', 'creative_media': 'photo, video, design, content, journalism, marketing',
        'finance_admin': 'accounting, finance, banking, insurance, office, HR, admin', 'education': 'teaching, training, childcare',
        'trades': 'technicians, mechanics, electricians, construction', 'engineering': 'mechanical, electrical, civil, chip, quality and production engineering',
        'business_ops': 'product, project, strategy, consulting, operations', 'manufacturing': 'production, plant and machine operators',
        'science': 'research, laboratory, R&D', 'customer_service': 'call centre, customer support', 'legal': 'law, compliance, patents, policy',
        'aviation_transport': 'pilots, cabin crew, air traffic, rail and ship crews', 'public_security': 'government, public service, police, military, security guards',
        'other': 'anything else'}   # the work of each kind, in plain words
TASK = ('A job title, or a role a job seeker looks for, in any language. Answer its kind of work: '
        + '; '.join(f'{kind} = {WORK[kind]}' for kind in KINDS) + '.')
UNSURE = 'unsure'     # a search word's answer when no kind fits well: never forced to the nearest wrong kind (a pilot was finance_admin)
UNKNOWN = 'unknown'   # of_search's kind for a search whose words are all unsure: it reads no employer list (employer_index.relevant)
SEARCH_TASK = TASK + f' Answer {UNSURE} when none of these fits the role well.'
SINCE = '2026-10-26T00:00:00+00:00'   # answers kept before the kinds grew are asked again (decide.kept since)


def judged(texts, topic='role-kind'):
    """{text: kind} for the texts the pack or the AI judged (asked together); a text nobody judged is left out. Search words may be UNSURE."""
    from .ai import decide
    texts = list(dict.fromkeys(str(t or '').strip() for t in texts if str(t or '').strip()))
    answers, task = ((*KINDS, UNSURE), SEARCH_TASK) if topic == 'role-kind' else (KINDS, TASK)
    found = decide.decide(topic, {t.lower(): t for t in texts}, answers, task, since=SINCE) or {}
    return {t: found[t.lower()] for t in texts if t.lower() in found}


def kinds_of(texts, topic='role-kind'):
    """{text: kind} for these titles or role words, asked together; 'other' for what nothing knows or the AI is unsure of. job-title-kind: titles
    from public postings (the site may learn them); role-kind: the user's own words (they never leave the machine)."""
    found = judged(texts, topic)
    texts = list(dict.fromkeys(str(t or '').strip() for t in texts if str(t or '').strip()))
    return {t: found.get(t) if found.get(t) in KINDS else 'other' for t in texts}


MIN_TITLES = 5        # fewer titles say little about an employer: no mix published (a feed with fewer titles needs them all judged)
MIN_JUDGED = 0.5     # the share of a feed's titles judged before its mix is published: one judged title never speaks for 400 (26 Oct 2026)
MIN_SHARE = 0.05      # smaller shares are noise and left out of the mix


def kind_of(text, topic='role-kind'):
    """The kind of one job title or search phrase, or 'other'."""
    return kinds_of([text], topic).get(str(text or '').strip(), 'other')


def mix(titles):
    """{kind: share} of a feed's job titles (shares of MIN_SHARE or more, two decimals), over the titles judged so far; None until MIN_TITLES
    (or all of a smaller feed's) and MIN_JUDGED of them are judged. A title the AI has not reached yet (the scout's calls a run are capped) is
    left out and asked at the next check (26 Oct 2026: counted as 'other', it put 42% of the index in Other). A small feed gets a mix too
    (owner, 26 Oct 2026: "If we don't know, we should save this information for each employer"): 648 European ones had 1-4 jobs and none."""
    titles = [t for t in titles if t and str(t).strip()]
    kinds = judged(titles, 'job-title-kind')
    counted = [kinds[str(t).strip()] for t in titles if str(t).strip() in kinds]
    if not counted or len(counted) < min(MIN_TITLES, len(titles)) or len(counted) < MIN_JUDGED * len(titles):
        return None
    counts = {}
    for kind in counted:
        counts[kind] = counts.get(kind, 0) + 1
    return {kind: round(n / len(counted), 2) for kind, n in sorted(counts.items(), key=lambda kv: -kv[1]) if n / len(counted) >= MIN_SHARE}


def valid(kinds):
    """A published mix as the engine keeps it: known kinds, shares between 0 and 1; None when it is not one."""
    if not isinstance(kinds, dict):
        return None
    clean = {k: float(v) for k, v in kinds.items() if k in KINDS and isinstance(v, (int, float)) and 0 <= v <= 1}
    return clean or None


def of_search(search):
    """The kinds a search looks for (from its role keywords); {UNKNOWN} when the AI is unsure of every word (no kind is forced: it reads the web
    search and learned sources, no employer list); None when it is not known yet (no keywords, no AI): then nothing is skipped."""
    # Regex fragments read as their words ("photograph(e|er)?" -> "photograph e er"), as coverage.looks_technical does: none is dropped.
    # "vendeu(r|se)" -> "vendeur": a group's first choice joined to the word; then the remaining regex marks as spaces.
    first = lambda word: re.sub(r'\(([^()|]*)\|[^()]*\)\??', r'\1', str(word))
    words = [re.sub(r'\\[bwsd]|[\\^$()|?*+\[\]{}.]', ' ', first(word)) for word in (search or {}).get('role_keywords') or []][:30]
    if not words:
        return None
    found = judged(words)
    kinds = set(found.values()) - {'other', UNSURE}
    if kinds:
        return kinds
    return {UNKNOWN} if UNSURE in found.values() else None   # the AI unsure of every word: unknown; no AI or only 'other': not known yet


MIN_FIT = 0.15        # the wanted kinds' share of an employer's jobs below which it is not read (any share passed before 7 Oct 2026)
TECH_HEAVY = 0.3      # a software share from which an employer counts as a tech company, for a search that wants no software


def fits(feed_kinds, wanted):
    """Whether an employer with this mix hires for the wanted kinds: at least MIN_FIT of its jobs (7 Oct 2026: 7% "creative" kept a tech
    startup for a photographer), and for a search with no software, not a company whose software jobs outnumber the wanted ones. An employer
    with no mix yet is not read on a guess, nor one whose wanted share is small (an old mostly-'other' mix too): the scout counts it (owner,
    26 Oct 2026, audit PR 4: a pilot search read 763 employers none known to hire pilots). The search's kinds not known (no AI): nothing skipped."""
    if wanted and UNKNOWN in wanted:
        return False   # a field no kind fits: no employer list is read in bulk (26 Oct 2026: a pilot search read 1,025 office employers)
    if not wanted:
        return True
    feed_kinds = valid(feed_kinds)
    if not feed_kinds:
        return False
    share, tech = sum(feed_kinds.get(kind, 0) for kind in wanted), feed_kinds.get('software', 0)
    if 'software' not in wanted and tech >= TECH_HEAVY and share < tech:
        return False
    return share >= MIN_FIT


def valid_counts(counts):
    """A published `kind_counts` as the engine keeps it ({country id: {kind: whole count from 1}}, src/scout_kind_counts.py); None when it is not one."""
    from .pool_tags import COUNTRIES
    if not isinstance(counts, dict):
        return None
    out = {}
    for country, kinds in counts.items():
        if country in COUNTRIES and isinstance(kinds, dict):
            kept = {kind: int(n) for kind, n in kinds.items() if kind in KINDS and isinstance(n, (int, float)) and not isinstance(n, bool) and n >= 1}
            if kept:
                out[country] = kept
    return out or None


def located(feed, countries):
    """The mix of a feed's jobs in these countries (its kind_counts), or its whole mix when none of them is counted there."""
    counts, here = valid_counts(feed.get('kind_counts')) or {}, {}
    for country in countries or ():
        for kind, n in counts.get(country, {}).items():
            here[kind] = here.get(kind, 0) + n
    total = sum(here.values())
    return {kind: n / total for kind, n in here.items()} if total else feed.get('kinds')
