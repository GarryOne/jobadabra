"""Builds the meanings pack's seed (config/meanings_seed.json) from the keyword lists the code used before they became AI decisions, read
from pinned commits, so a Swiss or English user gets exactly the answers they got before, offline and without AI (owner, 8 Oct 2026:
"I'd like my experience as Swiss/english to not worsen by a bit. Just to improve"). The same seed is loaded into the site's meanings
table (db/migrations) and shipped with the app as the offline floor; the site's learned rows are added on top.

    python3 tools/meanings_seed.py          write config/meanings_seed.json and, when the seed changed, a new db/migrations/NNNN_meanings_seed.sql
    python3 tools/meanings_seed.py --check  exit 1 when the files are not what the sources give (tests/test_meanings_pack.py)
"""
import ast
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SEED = ROOT / 'config' / 'meanings_seed.json'
MIGRATIONS = ROOT / 'db' / 'migrations'


def latest_sql():
    """The newest seed migration: an applied migration never runs again on D1, so a changed seed is a new file that replaces the seed rows."""
    return sorted(MIGRATIONS.glob('*_meanings_seed*.sql'))[-1]


def sql_known(seed, folder=None):
    """The site has this seed as one of its seed migrations. It may be ahead (a newer reseed lands on the site first, owner 21 Oct 2026:
    "the site lands first"), never behind: the newest one need not be this seed's."""
    want = sql(seed)
    return any(p.read_text() == want for p in (folder or MIGRATIONS).glob('*_meanings_seed*.sql'))


def next_sql():
    number = max(int(p.name[:4]) for p in MIGRATIONS.glob('[0-9][0-9][0-9][0-9]_*.sql')) + 1
    return MIGRATIONS / f'{number:04d}_meanings_seed.sql'
REMOVED = '4df410c^'   # the last commit with the mail/calendar/round lists, before they became AI decisions
PLACES = '10893d2'     # the place and role lists of the pool, Adzuna and Google Jobs, before they became AI decisions
PAGES = 'feb9595'      # the careers-page and job-site word lists (careers.py, boards.py, visits.py), before they became pack rows
KINDS = 'e35860b'      # the kinds of role (role_kinds.py) and the tech words (coverage.py), before they became AI decisions


def _tree(rev, path):
    return ast.parse(subprocess.run(['git', 'show', f'{rev}:{path}'], cwd=ROOT, capture_output=True, text=True, check=True).stdout)


def _value(node):
    """A regex string, from r'...' or re.compile(r'...', ...); a dict of them; or a function's re.search patterns in order."""
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    if isinstance(node, ast.Call) and node.args:
        return _value(node.args[0])
    if isinstance(node, ast.Tuple):
        return [_value(item) for item in node.elts]
    if isinstance(node, ast.Dict):
        return {k.value: _value(v) for k, v in zip(node.keys, node.values)}
    if isinstance(node, ast.BinOp):   # 'a|' 'b' + 'c'
        return _value(node.left) + _value(node.right)
    raise ValueError(f'not a literal: {ast.dump(node)[:80]}')


def assigned(rev, path, name):
    for node in _tree(rev, path).body:
        if isinstance(node, ast.Assign) and any(getattr(t, 'id', None) == name for t in node.targets):
            return _value(node.value)
    raise KeyError(f'{name} not in {rev}:{path}')


def searches(rev, path, function):
    """The re.search patterns of one function, in the order it tries them."""
    for node in ast.walk(_tree(rev, path)):
        if isinstance(node, ast.FunctionDef) and node.name == function:
            return [_value(call.args[0]) for call in ast.walk(node) if isinstance(call, ast.Call)
                    and getattr(call.func, 'attr', '') == 'search' and getattr(call.func.value, 'id', '') == 're']
    raise KeyError(f'{function} not in {rev}:{path}')


def rows():
    out = []
    add = lambda topic, pattern, answer, source: out.append({'topic': topic, 'pattern': pattern, 'answer': answer, 'source': source})
    add('calendar-event', assigned(REMOVED, 'src/ai/mail.py', 'INTERVIEWISH'), 'job_interview', 'mail.py INTERVIEWISH')
    add('asks-to-book', assigned(REMOVED, 'src/focus.py', 'BOOKING'), 'asks_to_book', 'focus.py BOOKING')
    technical, manager = searches(REMOVED, 'src/ai/interview_insights.py', 'round_type')
    add('interview-round', technical, 'technical', 'interview_insights.py round_type')
    add('interview-round', manager, 'hiring_manager', 'interview_insights.py round_type')
    add('interview-round', assigned(REMOVED, 'src/ai/interviews.py', 'SCREEN'), 'recruiter_screen', 'interviews.py SCREEN')
    for topic, path, name in (('pool-country', 'src/pool_tags.py', 'COUNTRIES'), ('pool-metro', 'src/pool_tags.py', 'METROS'),
                              ('pool-family', 'src/pool_tags.py', 'FAMILIES'), ('pool-role', 'src/contribute.py', 'ROLES'),
                              ('pool-region', 'src/contribute.py', 'REGIONS'), ('job-region', 'src/contribute.py', 'REGIONS'),
                              ('place-country', 'src/sources/aggregators.py', 'ADZUNA_COUNTRIES')):
        for answer, pattern in assigned(PLACES, path, name).items():
            add(topic, pattern, answer, f'{path.rsplit("/", 1)[1]} {name}')
    add('job-region', assigned(PLACES, 'src/contribute.py', 'REMOTE'), 'remote', 'contribute.py REMOTE')
    # Careers pages and job sites: each list whole, as one row, so the crawl reads them exactly as before; the site may add more rows.
    for path, name, answer in [('src/sources/careers.py', 'CAREER_WORDS', 'careers_link'), ('src/sources/careers.py', 'JOB_PATH', 'job_path'), ('src/sources/careers.py', 'NO_JOBS', 'no_jobs'), ('src/sources/careers.py', 'STRONG_WORDS', 'strong_jobs'), ('src/sources/careers.py', 'JOB_HOST', 'job_host'), ('src/sources/careers.py', 'NOT_JOBS', 'not_jobs'), ('src/sources/careers.py', 'TITLE_LIKE', 'job_title'), ('src/sources/careers.py', 'NOT_A_JOB', 'not_a_job'), ('src/sources/boards.py', 'CAREER', 'board_careers_link'), ('src/sources/visits.py', 'JOBLIST', 'job_list'), ('src/sources/visits.py', 'NOT_A_LIST', 'not_a_list')]:
        add('page-words', assigned(PAGES, path, name), answer, f'{path.rsplit("/", 1)[1]} {name}')
    for answer, name in (('senior', 'SENIOR'), ('entry', 'ENTRY')):   # titles that plainly name a level (levels.py): skipped for another level
        for pattern in assigned(KINDS, 'src/levels.py', name):
            add('title-level', pattern, answer, f'levels.py {name}')
    # A job title's or a role's kind: tech first (as role_kinds.kind_of checked it), then each kind in its order ("Store manager" is retail).
    stems = '(' + '|'.join(assigned(KINDS, 'src/coverage.py', '_TECH_STEMS')) + ')'
    for topic in ('job-title-kind', 'role-kind'):
        add(topic, assigned(KINDS, 'src/coverage.py', '_TECH_WORDS'), 'software', 'coverage.py _TECH_WORDS')
        add(topic, stems, 'software', 'coverage.py _TECH_STEMS')
        for kind, words in assigned(KINDS, 'src/role_kinds.py', '_WORDS').items():
            add(topic, rf'(?<![a-z])({words})', kind, 'role_kinds.py _WORDS')
    return out


def sql(seed):
    quote = lambda s: "'" + str(s).replace("'", "''") + "'"
    lines = ['-- The meanings pack seed (tools/meanings_seed.py): the keyword lists the code used before 8 Oct 2026, as rows. Generated; do not edit.',
             'CREATE TABLE IF NOT EXISTS meanings (topic TEXT NOT NULL, kind TEXT NOT NULL, wording TEXT NOT NULL, answer TEXT NOT NULL, ord INTEGER NOT NULL DEFAULT 0,',
             "  status TEXT NOT NULL DEFAULT 'verified', rollout INTEGER NOT NULL DEFAULT 100, source TEXT, updated_at TEXT, PRIMARY KEY (topic, kind, wording));",
             # A reseed keeps each row's status and rollout (a seed row switched off on the site stays off); rows no longer in the seed go.
             "UPDATE meanings SET ord = -1 WHERE source LIKE 'seed:%';"]
    for i, row in enumerate(seed):
        lines.append(f"INSERT INTO meanings (topic, kind, wording, answer, ord, status, rollout, source, updated_at) VALUES "
                     f"({quote(row['topic'])}, 'pattern', {quote(row['pattern'])}, {quote(row['answer'])}, {i}, 'verified', 100, {quote('seed:' + row['source'])}, '2026-10-08') "
                     "ON CONFLICT (topic, kind, wording) DO UPDATE SET answer = excluded.answer, ord = excluded.ord, source = excluded.source;")
    lines.append("DELETE FROM meanings WHERE source LIKE 'seed:%' AND ord = -1;")
    return '\n'.join(lines) + '\n'


def main():
    try:
        seed = rows()
    except subprocess.CalledProcessError:   # a shallow clone (CI) has no old commits: check that the SQL is the JSON's, at least
        if '--check' not in sys.argv:
            raise
        seed = json.loads(SEED.read_text())['patterns']
        print('sources not in this clone (shallow): checking the SQL against the JSON only')
    text = json.dumps({'_doc': 'Generated by tools/meanings_seed.py: the offline floor of the meanings pack. Do not edit.', 'patterns': seed},
                      indent=1, ensure_ascii=False) + '\n'
    if '--check' in sys.argv:
        stale = ([SEED.name] if SEED.read_text() != text else []) + ([] if sql_known(seed) else [f'{latest_sql().name} (no seed migration is this seed)'])
        print('stale: ' + ', '.join(stale) if stale else 'meanings seed up to date')
        return 1 if stale else 0
    SEED.write_text(text)
    latest = latest_sql()
    shipped = subprocess.run(['git', 'cat-file', '-e', f'origin/main:db/migrations/{latest.name}'], cwd=ROOT, capture_output=True).returncode == 0
    target = latest if latest.read_text() == sql(seed) or not shipped else next_sql()   # an unshipped migration is rewritten, a shipped one never
    target.write_text(sql(seed))
    print(f'{len(seed)} seed patterns -> {SEED.relative_to(ROOT)}, {target.relative_to(ROOT)}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
