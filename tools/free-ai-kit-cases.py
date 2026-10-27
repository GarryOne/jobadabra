"""Builds the Free AI kit cases (tools/free-ai-eval.mjs): the app's own kit request (src/ai/kit.py: cover letter, answers, highlights) over the invented postings and the demo profile.
Usage: python3 tools/free-ai-kit-cases.py --jobs tools/free-ai-eval-jobs.json --profile desktop/demo/profile.md --answers desktop/demo/answers.md --out <cases.json>   (fictional data only: the cases go to a third party).
There is no single right letter, so a case checks what can be verified: eligible as the posting says, 3-5 highlights, a letter, and no figure that is not in the profile or the posting."""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.ai import kit  # noqa: E402

# Eligible for the demo profile (a senior SRE: English, German B1, Spanish) unless the posting requires a language the profile does not show.
ELIGIBLE = {f'fx-{n:02d}': True for n in range(1, 11)}
RULED_OUT = {'fx-13': False, 'fx-20': False, 'fx-21': False, 'fx-22': False}   # fluent French or German required


def cases(jobs, profile, answers, all_jobs=False):
    out = []
    for job in jobs:
        truth = {**ELIGIBLE, **RULED_OUT}.get(job['id'])
        if truth is None and not all_jobs:   # all_jobs: the writing eval (tools/free-ai-writing-cases.mjs) needs the letter request of postings whose eligibility is not asserted here
            continue
        facts = f"Title: {job['title']}\nCompany: {job['company']}\nLocation: {job.get('location') or ''}\n"
        ground = f"{profile}\n{answers}\n{facts}{job['description']}"
        out.append({
            'id': job['id'], 'action': 'kit', 'expect': {'eligible': truth}, 'ground': ground,
            'params': {'max_tokens': 8000,
                       'system': [{'type': 'text', 'text': kit.SYSTEM + profile + '\n\nStandard answers:\n' + answers}],
                       'messages': [{'role': 'user', 'content': (
                           f"{facts}URL: https://example.com/jobs/{job['id']}\nAnalysis so far: {json.dumps({'stage_1_facts': {}, 'fit': {}})}\n\n"
                           f"Application form questions:\n{kit._question_text([])}\n\nPosting:\n{job['description']}")}],
                       'output_config': {'format': {'type': 'json_schema', 'schema': kit.SCHEMA}}}})
    return out


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    for name in ('jobs', 'profile', 'answers', 'out'):
        parser.add_argument(f'--{name}', required=True)
    parser.add_argument('--all-jobs', action='store_true')
    args = parser.parse_args()
    Path(args.out).write_text(json.dumps(cases(json.loads(Path(args.jobs).read_text()), Path(args.profile).read_text(), Path(args.answers).read_text(), args.all_jobs), ensure_ascii=False))
