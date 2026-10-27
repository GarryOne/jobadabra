"""The search PR check's blind judge: per job found, "right role?" and "right place?" for the persona, from title, employer and place only (no URL,
no source, no score), shuffled. The same prompt and rules as the benchmark round's judge (jobadabra-benchmarks search-bench/judge.py, 27 Oct 2026),
on Haiku 5.5 through Claude Code with PR_PROOF_ANTHROPIC_KEY as the only key in its environment; each call's cost is added up and the judge stops past JUDGE_CAP_USD.
Why (owner, 27 Oct 2026, "Right role + place"): the engine's own "in places" count called 16 jobs right for p3 that the blind judge called 0
(an interior architect for a carpenter); a check that trusts the engine's count can't see the engine get it wrong.
  python3 tools/persona-search/gate_judge.py <persona n> <jobs.json> <judged.json>      Tests: tests/test_search_personas_gate.py"""
import json
import random
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from gate import PERSONAS  # noqa: E402
from src.ai.providers.claude_code import find_binary  # noqa: E402

BATCH = 60
MODEL = 'claude-haiku-5-5'   # Why (owner, 27 Oct 2026, "Haiku on an API key"): Haiku only; a bigger judge model needs a new yes through the coordinator
JUDGE_CAP_USD = 0.03         # TODO(AI): set from the first measured run on the PR (27 Oct 2026); a judge past it stops asking and the persona says "judge over its cap"
SPENT = []                   # the cost of each call this process made (total_cost_usd of Claude Code's JSON reply)
SYSTEM = ('You check a job search for one job seeker. You get their short profile and a numbered list of jobs (title, employer, place). For EACH job decide two things on their own. '
          'role: would a person with this profile see it as their kind of job? yes = same occupation (any seniority, any employer, any language of the title); no = a different occupation. '
          'place: yes = in their city or a short commute from it, or remote and the text names their country; remote = says remote and names no country, or names many countries (a list such as "Remote - Moldova; Remote - Canada; ..." is worldwide remote, never yes); no = another city or country (including remote limited to another country); unknown = no place given. '
          'Judge only from the title, employer and place shown; do not guess beyond them. Answer with JSON only: {"jobs":[{"n":1,"role":"yes|no","place":"yes|remote|no|unknown"}, ...]} covering every number.')


def judge_env(parent):
    """The judge's environment. Why-changed (owner, 27 Oct 2026, "Haiku on an API key"): PR_PROOF_ANTHROPIC_KEY is the ONLY key that reaches it, handed over
    as ANTHROPIC_API_KEY; every other key, token, secret and ANTHROPIC_* variable (and the plan's sign-in) is dropped, so nothing else can bill."""
    env = {k: v for k, v in parent.items() if not k.endswith(('_KEY', '_TOKEN', '_SECRET', '_PASSWORD')) and not k.startswith('ANTHROPIC_')}
    if parent.get('PR_PROOF_ANTHROPIC_KEY'):
        env['ANTHROPIC_API_KEY'] = parent['PR_PROOF_ANTHROPIC_KEY']
    env['MAX_THINKING_TOKENS'] = '0'   # as src/ai/providers/claude_code.py call_env: Haiku answers without extended thinking
    return env


def key(row):
    return (row['title'].strip().lower(), (row.get('company') or '').strip().lower(), (row.get('location') or '').strip().lower())


def ask(profile, jobs, run=subprocess.run, env=None):
    """{n: verdict} for one batch, from `claude -p` on Haiku 5.5 with no tools, settings or session. Raises on a reply that is not the JSON asked."""
    import os  # noqa: PLC0415
    prompt = profile + '\n\nJOBS\n' + '\n'.join(f'{j["n"]}. {j["title"]} | {j["company"] or "?"} | {j["location"] or "(no place)"}' for j in jobs)
    out = run([find_binary() or 'claude', '-p', '--model', MODEL, '--system-prompt', SYSTEM, '--tools', '', '--setting-sources', '', '--disable-slash-commands',
               '--strict-mcp-config', '--no-session-persistence', '--output-format', 'json'], input=prompt, capture_output=True, text=True, timeout=600,
              cwd=tempfile.mkdtemp(), env=judge_env(os.environ if env is None else env))
    reply = json.loads(out.stdout)
    SPENT.append(float(reply.get('total_cost_usd') or 0))
    data = json.loads(re.search(r'\{.*\}', reply['result'], re.S).group(0))
    return complete({r['n']: r for r in data['jobs']}, jobs)


def complete(got, jobs):
    """The verdicts, or ValueError when the reply left jobs out. Why (gitar on #2243): a left-out job counted as wrong and showed as a search
    drop ("below main's lowest"); now the judge step fails and the result says the judge wrote no verdicts."""
    missing = [j['n'] for j in jobs if j['n'] not in got]
    if missing:
        raise ValueError(f'the judge left out {len(missing)} of {len(jobs)} jobs: {missing[:5]}')
    return got


def judge(n, pool, asker=ask):
    """The pool with role and place set on every row: one verdict per distinct job, in a seeded shuffle."""
    p = PERSONAS[int(n) - 1]
    profile = f'Profile: {p["title"]}, 6 years of experience, living in {p["city"]}, {p["country"]}; on-site or hybrid; speaks {p["language"]} and English.'
    unique = {}
    for row in pool:
        unique.setdefault(key(row), row)
    jobs = list(unique.values())
    random.Random(f'bench-judge-{n}').shuffle(jobs)
    verdicts = {}
    for start in range(0, len(jobs), BATCH):
        if sum(SPENT) > JUDGE_CAP_USD:
            raise ValueError(f'judge over its cost cap: ${sum(SPENT):.3f} spent, cap ${JUDGE_CAP_USD}; {len(jobs) - start} jobs not judged')
        chunk = jobs[start:start + BATCH]
        got = asker(profile, [{'n': i + 1, **{k: j.get(k, '') for k in ('title', 'company', 'location')}} for i, j in enumerate(chunk)])
        for i, j in enumerate(chunk):
            v = got.get(i + 1, {})
            verdicts[key(j)] = (v.get('role', 'missing'), v.get('place', 'missing'))
    for row in pool:
        row['role'], row['place'] = verdicts.get(key(row), ('not-judged', 'not-judged'))
    return {'persona': p, 'judged_jobs': len(jobs), 'model': f'{MODEL} (PR_PROOF_ANTHROPIC_KEY)', 'usd': round(sum(SPENT), 4), 'rows': pool}


def main(argv):
    n, jobs_path, out = argv[:3]
    pool = json.loads(Path(jobs_path).read_text(encoding='utf-8'))
    verdict = judge(n, pool)
    Path(out).write_text(json.dumps(verdict, ensure_ascii=False, indent=1), encoding='utf-8')
    local = sum(1 for r in verdict['rows'] if r['role'] == 'yes' and r['place'] == 'yes')
    print(f"p{n}: judge cost ${verdict['usd']:.3f}; judged {verdict['judged_jobs']} distinct jobs, {local} right role and place")


if __name__ == '__main__':
    main(sys.argv[1:])
