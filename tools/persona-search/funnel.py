"""The funnel of one Find jobs press, read from its log (tools/persona-search/run.mjs adds it to each press's row): employers picked for the role's kind,
employer sites and job boards read, web searches made, jobs listed and matched. The search robot's alarm (jobadabra-web jobs/persona-search) puts it in the
issue it files, so a thin search says where it went thin (owner, 26 Oct 2026: "pilot, Europe: 0 jobs" was found by hand, never by the robot).
A count whose log line never came is None, never 0: a missing line is "not seen", not "nothing found". Guard: tests/test_persona_funnel.py.
Usage: python3 tools/persona-search/funnel.py <run-N.log> [--since <ISO time the press started>]   -> one JSON line (with --since: ai_usd, the press's AI cost)
"""
import json
import re
import sys

STEP = re.compile(r'^\[\d+s\] ')
EMPLOYERS = re.compile(r'^Employers: ([\d,]+) of ([\d,]+) in your places hire for your kind of role')
EMPLOYER_READ = re.compile(r'Reading employer job sites: ([\d,]+) of ([\d,]+)(?: · ([\d,]+) jobs listed)?')
BOARD = re.compile(r'^Job boards found: (.+?) ([\d,]+) job\(s\), ([\d,]+) relevant')
BOARD_WEB = re.compile(r'^Job boards: (?:a web search found (.+)|the web search for trade and local boards did not answer)')
SCOUT_WEB = re.compile(r'^Scout: employers with no job site found are looked up with a web search')
COUNTS = re.compile(r'^Run counts: looked=(\d+) matches=(\d+) scored=(\d+) good=(\d+)')
NO_BOARD = 'no trade or local board'


def number(text):
    return int(str(text).replace(',', ''))


def funnel(lines):
    """{employers_picked, employers_in_places, employer_sites_read, boards_read, board_jobs, board_relevant, web_searches, web_found,
    scout_web, looked, matches, scored, good} from a press's log lines; the CLI adds kinds (the role kinds the employers were picked by)."""
    out = dict.fromkeys(('employers_picked', 'employers_in_places', 'employer_sites_read', 'looked', 'matches', 'scored', 'good'))
    boards, web, found = {}, 0, 0
    scout_web = False
    for raw in lines:
        line = STEP.sub('', raw.rstrip('\n'))
        for part in line.split('⏳'):   # a progress line can follow another on the same line
            part = part.strip()
            if m := EMPLOYERS.match(part):
                out['employers_picked'], out['employers_in_places'] = number(m[1]), number(m[2])
            elif m := EMPLOYER_READ.search(part):
                out['employer_sites_read'] = max(out['employer_sites_read'] or 0, number(m[1]))
            elif m := BOARD.match(part):
                jobs, relevant = boards.get(m[1], (0, 0))
                boards[m[1]] = (max(jobs, number(m[2])), max(relevant, number(m[3])))   # a board read twice keeps its best read
            elif m := BOARD_WEB.match(part):
                web += 1
                found += 0 if not m[1] or m[1] == NO_BOARD else len(m[1].split(', '))
            elif SCOUT_WEB.match(part):
                scout_web = True
            elif m := COUNTS.match(part):
                out['looked'], out['matches'], out['scored'], out['good'] = map(int, m.groups())
    return {**out, 'boards_read': len(boards), 'board_jobs': sum(jobs for jobs, _ in boards.values()),
            'board_relevant': sum(relevant for _, relevant in boards.values()), 'web_searches': web, 'web_found': found, 'scout_web': scout_web}


def kinds():
    """The role kinds the search looked for (src/role_kinds.of_search, the engine's own answer, from its decision cache), or None outside an install."""
    import os
    if not os.environ.get('JOB_PILOTTO_CONFIG_DIR'):
        return None
    try:
        from src import role_kinds
        with open(os.path.join(os.environ['JOB_PILOTTO_CONFIG_DIR'], 'search.json'), encoding='utf-8') as file:
            found = role_kinds.of_search(json.load(file))
        return sorted(found) if found else []
    except Exception:   # a funnel line never fails the press
        return None


def ai_usd(since):
    """The AI dollars the runs started since `since` (ISO, UTC) recorded in their details (src/run_details.py 'ai': per stage), rounded to a cent
    tenth, or None when no run recorded any: the search robot's measured cost per draw (the strategy draft before press 1 is not a run)."""
    import sqlite3
    try:
        from src.paths import DATA
        rows = sqlite3.connect(DATA / 'tracker.sqlite').execute('SELECT data FROM cron_runs WHERE started_at >= ?', (since,)).fetchall()
    except Exception:
        return None
    spent = [stage.get('usd') for (data,) in rows for stage in ((json.loads(data).get('details') or {}).get('ai') or {}).values()
             if isinstance(stage.get('usd'), (int, float))]
    return round(sum(spent), 3) if spent else None


if __name__ == '__main__':
    if len(sys.argv) not in (2, 4) or (len(sys.argv) == 4 and sys.argv[2] != '--since'):
        sys.exit(__doc__)
    with open(sys.argv[1], encoding='utf-8', errors='replace') as log:
        out = {**funnel(log), 'kinds': kinds()}
    print(json.dumps({**out, 'ai_usd': ai_usd(sys.argv[3])} if len(sys.argv) == 4 else out))
