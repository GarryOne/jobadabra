"""The search PR check (search-personas.yml): 6 fictional job seekers each press Find jobs once; a PR is red when one finds fewer right jobs than
the lowest of main's last 3 runs, or a press runs past 3 minutes (owner, 27 Oct 2026: "Every time we improve search for an use-case, for a candidate,
for a profile, for a speed perspective.. We break other use-cases."; his four answers on the sketch: here with our own tools, all 6 in parallel,
right role + place by a blind judge, red below main's range).
  python3 tools/persona-search/gate.py cv <n> <out>                       the persona's fictional CV: <out>/draw/cv.pdf, cv.md, draw.json
  python3 tools/persona-search/gate.py extract <jobs.sqlite> <jobs.json>  the open jobs (title, company, place, source) for the judge
  python3 tools/persona-search/gate.py result <n> <out>                   <out>/result.json from presses.jsonl and judged.json
  python3 tools/persona-search/gate.py compare <results dir> <out dir> [<main run dir>...]   verdict.json + table.md; exit 1 when red
Judge: gate_judge.py. Personas: gate-personas.json (copied from the benchmark round). Tests: tests/test_search_personas_gate.py."""
import json
import sqlite3
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PERSONAS = json.loads((HERE / 'gate-personas.json').read_text(encoding='utf-8'))['personas']
PRESS_LIMIT = 180   # Why (owner, 26 Oct 2026): "A find jobs session should take at most 3min" (CLAUDE.md, tests/test_three_minutes.py)
MAIN_RUNS = 3       # Why (owner, 27 Oct 2026, "Below main's range"): one run is noise (the same commit found 53 and 20 jobs), so the floor is the
#                     lowest of main's last 3 runs, never one run's number
PERSONA_CAP_USD = 0.08   # Why (owner, 27 Oct 2026, "Haiku on an API key ... with a per-run $ cap"): 6 personas x $0.08 = $0.48, under the $0.50 the coordinator proposed;
#                          TODO(AI): lower it to the first measured run's cost with headroom (27 Oct 2026)
COST = 'Haiku 5.5 on PR_PROOF_ANTHROPIC_KEY'


def label(n):
    p = PERSONAS[int(n) - 1]
    return f"p{n} {p['title']}, {p['city']}"


def make_cv(n, out):
    """The persona's fictional CV through the random draw's own template (draw.cv), as the benchmark round made it (search-bench/make-cv.py)."""
    sys.path.insert(0, str(HERE))
    import draw  # noqa: PLC0415
    from personas import pdf  # noqa: PLC0415
    p = PERSONAS[int(n) - 1]
    family = next(f for f in draw.DATA['families'] if f['id'] == p['family'])
    city = next(c for c in draw.DATA['cities'] if c['city'] == p['city'])
    folder = Path(out) / 'draw'
    folder.mkdir(parents=True, exist_ok=True)
    lines = draw.cv(family, city, 'Alex Example')
    (folder / 'cv.pdf').write_bytes(pdf(lines))
    (folder / 'cv.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')
    (folder / 'draw.json').write_text(json.dumps({'seed': f'gate-{n}', 'family': p['family'], 'city': p['city'], 'country': p['country']}), encoding='utf-8')
    return p


def extract(db_path, out):
    """The open jobs of the persona's install, without URLs or posting text: what the judge reads."""
    db = sqlite3.connect(db_path)
    rows = [{'title': t, 'company': c or '', 'location': loc or '', 'provider': s or ''} for t, c, loc, s in db.execute(
        "SELECT j.title, co.name, j.location, s.name FROM jobs j LEFT JOIN companies co ON co.id = j.company_id "
        "LEFT JOIN sources s ON s.id = j.source_id WHERE j.state = 'open'")]
    Path(out).write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding='utf-8')
    return rows


def result(n, out):
    """One persona's numbers: local = jobs the blind judge called right role AND right place; seconds and code of press 1; a missing file is
    a failed press (silence is not success), never a zero that looks measured."""
    out = Path(out)
    row = {'persona': int(n), 'label': label(n)}
    press_usd = 0.0
    try:
        press = json.loads((out / 'draw' / 'presses.jsonl').read_text(encoding='utf-8').splitlines()[0])
        press_usd = float((press.get('funnel') or {}).get('ai_usd') or 0)   # the press's measured AI cost (funnel.py ai_usd); the strategy draft before it is not counted
        row.update(seconds=int(press['seconds']), code=int(press.get('code') or 0), crashes=len(press.get('crashes') or []))
    except (OSError, IndexError, ValueError, KeyError, TypeError):
        row['error'] = 'the press wrote no numbers (see run.log)'
    judge_usd = 0.0
    try:
        judged_file = json.loads((out / 'judged.json').read_text(encoding='utf-8'))
        judge_usd = float(judged_file.get('usd') or 0)
        judged = judged_file['rows']
        row.update(found=len(judged), local=sum(1 for r in judged if r.get('role') == 'yes' and r.get('place') == 'yes'))
    except (OSError, ValueError, KeyError):
        row.setdefault('error', 'the judge wrote no verdicts (see judge.log)')
    row['usd'] = round(press_usd + float(judge_usd), 4)
    try:
        row['non_haiku'] = int((out / 'non-haiku-steps.txt').read_text().strip() or 0)
    except (OSError, ValueError):
        pass
    (out / 'result.json').write_text(json.dumps(row, ensure_ascii=False), encoding='utf-8')
    return row


def load_results(folder):
    """{persona n: result} from the result.json / verdict.json files under a folder (a run's artifacts, downloaded)."""
    found = {}
    for path in sorted([*Path(folder).rglob('result.json'), *Path(folder).rglob('verdict.json')]):
        try:
            data = json.loads(path.read_text(encoding='utf-8'))
        except ValueError:
            continue
        rows = data.get('personas', {}).values() if isinstance(data, dict) and 'personas' in data else [data]
        for row in rows:
            if isinstance(row, dict) and 'persona' in row:
                found[int(row['persona'])] = row
    return found


def judge_one(row, mains):
    """-> (red reasons, the main numbers shown) for one persona. Invariant: `mains` is newest first and holds only main's measured rows."""
    if row is None:
        return ['no result: the job did not finish'], []
    if row.get('not_measured'):
        return [], []
    reasons = []
    if row.get('error'):
        reasons.append(row['error'])
    if row.get('code') or row.get('crashes'):
        reasons.append(f"the press failed (exit {row.get('code')}, {row.get('crashes', 0)} crash(es))")
    if row.get('seconds', 0) > PRESS_LIMIT:
        reasons.append(f"press took {row['seconds']} s (> {PRESS_LIMIT})")
    if row.get('usd', 0) > PERSONA_CAP_USD:
        reasons.append(f"cost ${row['usd']:.3f} over the ${PERSONA_CAP_USD} cap")
    if row.get('non_haiku'):
        reasons.append(f"{row['non_haiku']} AI step(s) not on Haiku 5.5")
    seen = [m['local'] for m in mains if isinstance(m.get('local'), int)][:MAIN_RUNS]
    if seen and isinstance(row.get('local'), int) and row['local'] < min(seen):
        reasons.append(f"{row['local']} right jobs, below main's lowest ({min(seen)})")
    return reasons, seen


def compare(pr, main_runs):
    """pr: {n: result}; main_runs: [{n: result}] newest first. -> {state: success|failure|neutral, rows, text}."""
    rows, red, unmeasured = [], 0, 0
    for n in range(1, len(PERSONAS) + 1):
        row = pr.get(n)
        reasons, seen = judge_one(row, [run[n] for run in main_runs if n in run and not run[n].get('not_measured')])
        unmeasured += bool(row and row.get('not_measured'))
        red += bool(reasons)
        rows.append({'persona': n, 'label': label(n), 'main': seen, 'local': (row or {}).get('local'), 'found': (row or {}).get('found'),
                     'seconds': (row or {}).get('seconds'), 'usd': (row or {}).get('usd'), 'reasons': reasons, 'not_measured': (row or {}).get('not_measured')})
    if red:
        state, head = 'failure', f'🔴 {red} persona(s) red'
    elif unmeasured:
        state, head = 'neutral', f'⚪ not measured ({unmeasured} of {len(PERSONAS)}): {next(r["not_measured"] for r in rows if r["not_measured"])}'
    else:
        state, head = 'success', "🟢 no persona below main's range · every press ≤ 180 s"
    if not main_runs and state == 'success':
        head += " · no main run to compare yet (the first merge records one)"
    return {'state': state, 'head': head, 'rows': rows, 'main_runs': len(main_runs)}


def table(verdict):
    spent = sum(r['usd'] or 0 for r in verdict['rows'])
    lines = [f"🔍 **Search check:** {verdict['head']} · {COST} · cost ${spent:.2f} (cap ${PERSONA_CAP_USD * len(PERSONAS):.2f})", '',
             f"| Persona | Main (last {MAIN_RUNS}) | This PR | Found | Press | Cost | |", '|---|---|---|---|---|---|---|']
    for r in verdict['rows']:
        main = ' · '.join(str(x) for x in r['main']) or '—'
        mark = '🔴 ' + '; '.join(r['reasons']) if r['reasons'] else ('⚪' if r['not_measured'] else '🟢')
        cell = lambda v, unit='': '—' if v is None else f'{v}{unit}'   # noqa: E731
        lines.append(f"| {r['label']} | {main} | {cell(r['local'])} | {cell(r['found'])} | {cell(r['seconds'], ' s')} | {'—' if r['usd'] is None else '$%.3f' % r['usd']} | {mark} |")
    lines += ['', '<sub>This PR / Main = jobs a blind judge (Haiku 5.5) called right role AND right place, of the jobs found; one press each, '
              'a fresh install. Red: a press over 180 s, or a persona below the lowest of main\'s last 3 runs.</sub>']
    return '\n'.join(lines) + '\n'


def main(argv):
    kind = argv[0]
    if kind == 'cv':
        print(json.dumps(make_cv(argv[1], argv[2]), ensure_ascii=False))
    elif kind == 'extract':
        print(len(extract(argv[1], argv[2])), 'open jobs')
    elif kind == 'result':
        print(json.dumps(result(argv[1], argv[2]), ensure_ascii=False))
    elif kind == 'compare':
        results, out, mains = argv[1], Path(argv[2]), argv[3:]
        verdict = compare(load_results(results), [load_results(m) for m in mains])
        out.mkdir(parents=True, exist_ok=True)
        (out / 'verdict.json').write_text(json.dumps({**verdict, 'personas': {str(k): v for k, v in load_results(results).items()}}, ensure_ascii=False, indent=1))
        (out / 'table.md').write_text(table(verdict), encoding='utf-8')
        print(table(verdict))
        return 1 if verdict['state'] == 'failure' else 0
    else:
        raise SystemExit(__doc__)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
