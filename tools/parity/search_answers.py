"""One repo's answers for the owner's real search and jobs, AI off, no network (tools/meanings_parity.py runs it)."""
import json, os, sqlite3, sys
repo, out = sys.argv[1], sys.argv[2]
sys.path.insert(0, repo)
os.environ.update({'JOBADABRA_DATA_DIR': os.environ['RD'] + '/data', 'JOBADABRA_CONFIG_DIR': os.environ['RD'] + '/config',
                   'JOBADABRA_FOLLOW_APP': '0', 'JOBADABRA_DISABLE': 'mail,notion,telegram,google_jobs', 'ANTHROPIC_API_KEY': ''})
from src.ai import engine
engine.ready = lambda *a, **k: False   # AI off in both
from src import role_kinds, coverage, levels, contribute, employer_index, paths
from src.sources import aggregators, boards, feeds
try:
    from src.daily_helpers import scored_companies
except ImportError:   # before the split of daily.py
    from src.daily import scored_companies
search = paths.load_search_config()
res = {}
res['of_search'] = sorted(role_kinds.of_search(search) or [])
res['looks_technical'] = coverage.looks_technical(search.get('role_keywords') or [])
res['level_skips'] = levels.title_skips(search.get('level'))
res['swiss_word'] = boards.swiss_place_word(search)
res['adzuna'] = aggregators._countries(search)
res['tags'] = contribute.tags(search)
res['fine_tags'] = contribute.fine_tags() if hasattr(contribute, 'fine_tags') else None
index = employer_index.clean(json.load(open(os.environ['RD'] + '/data/employer_index.json'))['feeds'])
me = employer_index.me_now()
kept = employer_index.relevant(index, feeds.wanted_location, role_kinds.of_search(search), me=me, keep=scored_companies(), said=[])
res['employers_read'] = sorted(f"{f.get('ats')}:{f.get('slug')}" for f in kept)
db = sqlite3.connect(os.environ['RD'] + '/data/jobs.sqlite')
titles = sorted({r[0] for r in db.execute('SELECT title FROM jobs WHERE title IS NOT NULL') if r[0]})
kind = (lambda t: role_kinds.kind_of(t, 'job-title-kind')) if 'topic' in role_kinds.kind_of.__code__.co_varnames else role_kinds.kind_of
res['title_kinds'] = {t: kind(t) for t in titles}
json.dump(res, open(out, 'w'), indent=1, ensure_ascii=False, default=list)
print(out, len(titles), 'titles,', len(index), 'feeds in the index')
