"""Replays the kit prompt's fixed case set (tests/fixtures/kit-cases.json) through the app's own kit.draft on the person's Claude plan ($0, never an API key).

Usage: python3 tools/kit-cases.py [--before] [--runs 3] [--model claude-sonnet-5-5]
  --before: origin/main's kit prompt and no CV (the kit before About you's CV); default: this checkout's prompt with the case set's CV.
Prints one line per case and run (pass, or what failed) and the input tokens per call, then the totals. Exit 1 when any case failed.
"""
import argparse
import json
import os
import re
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.environ['JOB_PILOTTO_AI_ENGINE'] = 'cli'   # the person's own Claude Code: the eval never reaches an API account
os.environ['ANTHROPIC_API_KEY'] = ''

from src.ai import engine, kit  # noqa: E402
from src.ai.writing_rules import RULES as WRITING_RULES  # noqa: E402


def main_system():
    """origin/main's kit SYSTEM text, as kit.py builds it."""
    source = subprocess.run(['git', 'show', 'origin/main:src/ai/kit.py'], cwd=ROOT, capture_output=True, text=True, check=True).stdout
    literal = re.search(r'^SYSTEM = ("""[\s\S]*?""")', source, re.M).group(1)
    names = {}
    exec(f'SYSTEM = {literal}', names)   # our own repo's text at origin/main, a string literal only
    return names['SYSTEM'].replace('{WRITING_RULES}', WRITING_RULES)


def failures(case, drafted):
    """What the drafted kit got wrong against the case's expectations: a list of short reasons, empty when it passed."""
    out = []
    answers = {item.get('field'): item for item in drafted.get('answers') or []}
    for key, rule in case['expect'].items():
        item = answers.get(key) or {}
        text = (drafted.get('cover_letter') or '') if key == 'letter' else (item.get('answer') or '')
        if rule.get('mentions') and not any(word.lower() in text.lower() for word in rule['mentions']):
            out.append(f'{key}: none of {rule["mentions"]}: {text[:120]!r}')
        for word in rule.get('not') or []:
            if word.lower() in text.lower():
                out.append(f'{key}: says {word!r}')
        if 'needs_review' in rule and bool(item.get('needs_review')) != rule['needs_review'] and text:
            out.append(f'{key}: needs_review {item.get("needs_review")}: {text[:120]!r}')
    return out


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--before', action='store_true')
    parser.add_argument('--runs', type=int, default=3)
    parser.add_argument('--model', default=kit.DEFAULT_MODEL)
    args = parser.parse_args()
    fixture = json.loads((ROOT / 'tests' / 'fixtures' / 'kit-cases.json').read_text(encoding='utf-8'))
    profile = (ROOT / 'desktop' / 'demo' / 'profile.md').read_text(encoding='utf-8')
    answers = (ROOT / 'desktop' / 'demo' / 'answers.md').read_text(encoding='utf-8')
    if args.before:
        kit.SYSTEM = main_system()
    cv = '' if args.before else json.dumps(fixture['cv'], ensure_ascii=False)
    client = engine.client(action='kit')

    def one(task):
        case, run = task
        job = dict(case['job'], url=f'https://example.com/{case["id"]}')
        try:
            drafted, usage = kit.draft(client, args.model, job, profile, answers, case['questions'], cv)
        except Exception as error:   # one failed call is a failed case, the others still run
            return case['id'], run, [f'error: {type(error).__name__}: {error}'], 0
        tokens = (getattr(usage, 'input_tokens', 0) or 0) + (getattr(usage, 'cache_read_input_tokens', 0) or 0) + (getattr(usage, 'cache_creation_input_tokens', 0) or 0)
        return case['id'], run, failures(case, drafted), tokens

    tasks = [(case, run) for run in range(1, args.runs + 1) for case in fixture['cases']]
    with ThreadPoolExecutor(max_workers=3) as pool:
        results = list(pool.map(one, tasks))
    for case_id, run, failed, tokens in results:
        print(f"{'pass' if not failed else 'FAIL'} {case_id} run {run} ({tokens} input tokens){'' if not failed else ': ' + '; '.join(failed)}", flush=True)
    passed = sum(1 for _, _, failed, _ in results if not failed)
    tokens = [t for _, _, _, t in results if t]
    print(f"{'before' if args.before else 'after'}: {passed} of {len(results)} passed; input tokens per call {round(sum(tokens) / len(tokens)) if tokens else 0}", flush=True)
    return 0 if passed == len(results) else 1


if __name__ == '__main__':
    sys.exit(main())
