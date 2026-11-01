#!/usr/bin/env python3
"""Queue every ready application kit into the ChatGPT/Codex desktop app, one chat each.

"Ready" = a job in Notion Applications at Stage Kit ready (or Saved, i.e. starred) with a kit already drafted (by 📝 Prepare or the
auto-kit step) and not yet Applied/Dismissed. For each, pastes (and by default sends) a plain-text
prompt built from the kit into a new Codex chat via tools/send-to-chatgpt.sh.

Codex fills the form and stops before Submit on its own (its "Ask for approval" gate); review each
chat, click Submit yourself, then mark it applied. There is no tool to read a chat's result back,
so the owner is the one watching every chat this queues.

Usage:
  python -m src.ai.apply_batch [--max 5] [--paste-only] [--dry-run]
  python -m src.ai.apply_batch <job_url> [job_url ...] [--paste-only] [--dry-run]
  python -m src.ai.apply_batch -f jobs.txt [--paste-only] [--dry-run]

Same input shape as tools/apply-batch-claude.sh and tools/apply-batch-codex-terminal.sh: with no
URLs/-f given, auto-picks the --max highest-scored jobs with a kit; with explicit URLs or -f,
uses exactly those (each must already have a kit — Stage isn't used to select them, only
to fetch the kit) and --max is ignored.
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from ..notion import client as notion
from ..sources import ats
from .. import ledger_store
from ..stores import base, open_stores, rules

REPO_ROOT = Path(__file__).resolve().parents[2]
SEND_SCRIPT = REPO_ROOT / 'tools' / 'send-to-chatgpt.sh'
WAIT_SCRIPT = REPO_ROOT / 'tools' / 'wait-and-mark-applied.sh'
NOTIFY_SCRIPT = REPO_ROOT / 'tools' / 'notify.sh'
DEFAULT_CV = os.getenv('JOBADABRA_CV_PATH', str(Path.home() / 'Documents' / 'CV.pdf'))

PROMPT = """Open a browser, navigate to {url}, and fill out the job application form. Do not \
click Submit — stop once every field is filled and show me a summary.
Use only the applicant details given here; never a name, e-mail address, phone number, country, city, street address or other location from any other context (such as an account you are signed in with): when a detail is not given, leave it empty.

{fields}

Resume: attach {cv}

If a field appears that isn't listed above, don't guess — ask me."""


def _kit(stores, record):
    """A job's kit from its section (base.kit_from), or None."""
    return base.kit_from(stores.applications.section(record['id'], base.KIT_SECTION) or '')


def ready_jobs(stores, max_jobs):
    """(record, kit) pairs for Kit ready / Saved jobs that have a kit, newest first."""
    records = sorted(stores.applications.list(stages=['Kit ready', 'Saved']), key=lambda r: r.get('created_at') or '', reverse=True)
    pairs = []
    for record in records:
        kit_data = _kit(stores, record)
        if kit_data:
            pairs.append((record, kit_data))
        if len(pairs) >= max_jobs:
            break
    return pairs


def mark_closed(stores, url):
    """Stage -> Closed (the posting is gone) and a notification; returns the store's outcome."""
    _, outcome = rules.mark(stores, {'url': url}, 'Closed')
    subprocess.run([str(NOTIFY_SCRIPT), url, 'Posting closed — marked Closed, skipped'], check=False)
    return outcome


def still_open(stores, url):
    """False (and the job is marked Closed) only when its board confirms the posting is gone;
    unsupported boards and outages count as open, so nothing is closed on a guess."""
    if ats.is_live(url) is False:
        mark_closed(stores, url)
        print(f'Skipped, posting closed: {url}', file=sys.stderr)
        return False
    return True


KIT_STEP = '📝 Kit ready'  # the Next step a drafted kit writes (src/ai/kit.py)


def unstarted_urls_by_score(stores, max_jobs):
    """Job URLs with a kit (not yet Applying/Applied/...), ranked by AI fit score descending.

    Fast: whether a job has a kit is on its record (Stage Kit ready, or Next step "📝 Kit ready" on a Saved job), so
    no kit is opened here (the Claude session reads its own). The applications and the matches' scores are read at
    the same time, and the top candidates' postings are checked at the same time. Score comes from the matches; jobs
    not scored yet sort last rather than being excluded."""
    records, found = notion.together(lambda: stores.applications.list(stages=['Kit ready', 'Saved']),
                                     lambda: stores.matches.list())
    url_score = {match['url']: match['fit'] for match in found if match.get('url') and match.get('fit') not in (None, '')}
    for record in records:  # a job you added has no match: its own fit score counts instead
        if record.get('url') and record.get('fit') not in (None, ''):
            url_score.setdefault(record['url'], record['fit'])
    candidates = [record['url'] for record in records
                  if record.get('url') and (record.get('stage') == 'Kit ready' or (record.get('next_step') or '').startswith(KIT_STEP))]
    unstarted_urls_by_score.rows = {record['url']: record for record in records if record.get('url')}  # for job_details()
    candidates = sorted(dict.fromkeys(candidates), key=lambda url: url_score.get(url, -1), reverse=True)
    urls, batch = [], max(max_jobs * 2, 4)
    for start in range(0, len(candidates), batch):
        chunk = candidates[start:start + batch]
        open_now = notion.together(*[lambda url=url: still_open(stores, url) for url in chunk])
        urls += [url for url, alive in zip(chunk, open_now) if alive]
        if len(urls) >= max_jobs:
            break
    return urls[:max_jobs]


def job_details(url):
    """What the app shows for a picked job (its session card, the notification): title, company, place."""
    record = getattr(unstarted_urls_by_score, 'rows', {}).get(url)
    if not record:
        return {'url': url}
    return {'url': url, 'title': record.get('title') or '', 'company': record.get('company') or record.get('via') or '',
            'location': record.get('location') or '', 'workMode': record.get('work_mode') or ''}


def top_unprepared_urls(stores, max_jobs):
    """Highest-scored open matches with no kit yet and not applied/dismissed — the jobs worth a 📝 Prepare run next.
    Scores come from the matches (synced by stage 2)."""
    stages = stores.applications.stages()
    ranked = []
    for match in stores.matches.list():
        url, score = match.get('url'), match.get('fit')
        if url and score not in (None, '') and (match.get('status') or None) in (None, 'Open', 'Not seen') \
                and stages.get(base.url_key(url)) in (None, 'Saved', 'Kit ready'):
            ranked.append((score, url))
    urls = []
    for _, url in sorted(ranked, reverse=True):
        record = stores.applications.get(url)
        if record and _kit(stores, record):
            continue
        if not still_open(stores, url):
            continue
        urls.append(url)
        if len(urls) >= max_jobs:
            break
    return urls


def pairs_for_urls(stores, urls):
    """(record, kit) pairs for explicit job URLs, in the given order. Raises if a URL has no record or
    no kit yet — explicit URLs are a deliberate choice, so fail loud rather than silently skip."""
    pairs = []
    for url in urls:
        record = stores.applications.get(url)
        if not record:
            raise SystemExit(f'No Applications row for {url} — prepare a kit first (📝 Prepare).')
        kit_data = _kit(stores, record)
        if not kit_data:
            raise SystemExit(f'No kit drafted yet for {url} — prepare a kit first (📝 Prepare).')
        pairs.append((record, kit_data))
    return pairs


def build_prompt(kit_data, cv):
    lines = [f"- Cover letter: {kit_data['cover_letter']}"]
    for answer in kit_data['answers']:
        if answer['answer']:
            lines.append(f"- {answer['question']}: {answer['answer']}")
    return PROMPT.format(url=kit_data['url'], fields='\n'.join(lines), cv=cv)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('urls', nargs='*', metavar='job_url',
                        help='explicit job URL(s) to queue; each must already have a kit drafted. '
                             'Mutually exclusive with --max/-n (default auto-pick).')
    parser.add_argument('-f', '--file', metavar='PATH',
                        help='file of job URLs, one per line, same as passing them as positional args')
    parser.add_argument('--max', '-n', type=int, default=5, dest='max', metavar='N',
                        help='at most this many chats, auto-picked by score — ignored if urls/-f given')
    parser.add_argument('--cv', default=str(DEFAULT_CV))
    parser.add_argument('--paste-only', action='store_true',
                        help="don't press Return in each chat; review the pasted text first")
    parser.add_argument('--gap', type=float, default=3.0, help='seconds between chats')
    parser.add_argument('--dry-run', action='store_true', help='print what would run; touch nothing')
    parser.add_argument('--next', type=int, metavar='N',
                        help='print the N highest-scored not-yet-started job URLs with a kit, '
                             'one per line, and exit — for apply-batch-claude.sh --max; touches nothing')
    parser.add_argument('--details', action='store_true', help='with --next: one JSON line per job (url, title, company)')
    parser.add_argument('--top-unprepared', type=int, metavar='N',
                        help='print the N highest-scored open jobs with no kit yet, one per line, and '
                             'exit — for tools/prepare-top.sh; touches nothing')
    parser.add_argument('--mark-applying', metavar='URL',
                        help="flip one job's Stage to Applying and exit — for apply-batch-claude.sh, "
                             'so a Claude Code session queued for a job is deduped the same way the '
                             'ChatGPT/Codex path already dedupes its own queued chats')
    parser.add_argument('--has-kit', metavar='URL',
                        help='exit 0 if this job has a drafted kit in Notion, else print why and exit 1 — '
                             'Apply with Claude (Mac app and apply-batch-claude.sh) only starts on a kit; touches nothing')
    parser.add_argument('--mark-closed', metavar='URL',
                        help="flip one job's Stage to Closed (posting gone) and notify, then exit")
    parser.add_argument('--mark-applied', metavar='URL',
                        help="flip one job's Stage to Applied and exit. Reliable even when "
                             "`src.daily --mode apply` can't find the job (that path looks it up in "
                             'the local jobs.sqlite crawl cache, which can be stale, evicted in CI, or '
                             "never populated for a job you only ever saw in Notion) — this looks the "
                             'row up by URL directly in Notion instead, the same way --mark-applying does.')
    parser.add_argument('--source', default='CLI', choices=('CLI', 'Watcher'),
                        help='with --mark-applied: who noticed the submission, for the Applied event')
    args = parser.parse_args()

    if args.file and args.urls:
        raise SystemExit('Use -f or explicit URLs, not both')
    if args.file:
        args.urls = [line.strip() for line in Path(args.file).read_text().splitlines() if line.strip()]

    stores = open_stores()   # the active store: Notion, or this Mac's

    if args.has_kit:
        try:
            pairs_for_urls(stores, [args.has_kit])
        except SystemExit as missing:
            print(missing)
            return 1
        except Exception as error:  # can't tell: don't start a session that may have nothing to fill from
            print(f"Couldn't check the kit ({type(error).__name__}: {str(error)[:120]}); not starting.")
            return 1
        return 0

    if args.mark_applying:
        if not stores.applications.get(args.mark_applying):  # a bare URL has no title to make a row from: say so, never a traceback
            print(f'{args.mark_applying}: not on the tracker, left as it is')
            return 0
        _, outcome = rules.mark(stores, {'url': args.mark_applying}, 'Applying')
        print(f'{args.mark_applying}: {outcome}')
        return 0

    if args.mark_closed:
        print(f'{args.mark_closed}: {mark_closed(stores, args.mark_closed)}')
        return 0

    if args.mark_applied:
        # Also logs an Applied event and freezes the application record (questions, answers sent), in the active store.
        print(ledger_store.mark_applied(stores, args.mark_applied, args.source))
        return 0

    if args.top_unprepared is not None:
        for url in top_unprepared_urls(stores, args.top_unprepared):
            print(url)
        return 0

    if args.next is not None:
        for url in unstarted_urls_by_score(stores, args.next):
            # --details (the app): one JSON line per job with its title and company; else the plain URL (the scripts).
            print(json.dumps(job_details(url), ensure_ascii=False) if args.details else url)
        return 0

    if not SEND_SCRIPT.exists():
        raise SystemExit(f'{SEND_SCRIPT} not found')

    if args.urls:
        pairs = pairs_for_urls(stores, args.urls)
    else:
        pairs = ready_jobs(stores, args.max)
        if not pairs:
            print('No job has a kit ready. Prepare one first: 📝 Prepare in Telegram, or '
                  '`gh workflow run daily.yml -f mode=prepare -f job=<job URL>`.')
            from .. import doctor  # lazy: the full checklist is only needed on this empty path
            tracker = getattr(stores.applications, 'tracker', None)   # the Notion line of the checklist, on a Notion store
            print(f'👉 Next step — {doctor.next_step(doctor.run_checks(tracker, stores=stores))}')   # the store's checks too
            return 0

    for record, kit_data in pairs:
        title, company = record.get('title') or '', record.get('company') or ''
        prompt = build_prompt(kit_data, args.cv)
        print(f"--- {title} — {company} ({kit_data['url']}) ---")
        if kit_data.get('check_before_sending'):
            print('⚠️  Check before sending:')
            for item in kit_data['check_before_sending']:
                print(f'   • {item}')
        if args.dry_run:
            print(prompt)
            continue
        with tempfile.NamedTemporaryFile('w', suffix='.txt', delete=False) as handle:
            handle.write(prompt)
            path = handle.name
        cmd = [str(SEND_SCRIPT)] + ([] if args.paste_only else ['--send']) + ['-f', path]
        subprocess.run(cmd, check=True)
        # Mark it out of 'Kit ready'/'Saved' immediately so a second run (or the next auto-kit cycle) never
        # queues the same job into a second chat. Re-queue a job by setting its Stage back to
        # Kit ready in Notion if a paste-only chat was abandoned without sending.
        rules.mark(stores, {'url': kit_data['url']}, 'Applying')
        if not args.paste_only:
            subprocess.run([str(NOTIFY_SCRIPT), kit_data['url'], 'Filling started (ChatGPT)'], check=False)
        # Marks it Applied once its confirmation page shows up in Chrome (3 h cap), detached.
        subprocess.Popen([str(WAIT_SCRIPT), kit_data['url']], stdout=subprocess.DEVNULL,
                         stderr=subprocess.DEVNULL, start_new_session=True)
        time.sleep(args.gap)

    print(f"\nQueued {len(pairs)} chat(s) in the ChatGPT/Codex app. For each: review, attach the "
          "résumé if it didn't, click Submit yourself, then run:\n"
          "  gh workflow run daily.yml -R GarryOne/jobadabra -f mode=apply -f job=<job URL> -f action=applied")
    checks = [(record, kit_data) for record, kit_data in pairs if kit_data.get('check_before_sending')]
    if checks and not args.dry_run:
        print('\nThings to double-check before you submit, one job at a time:')
        for record, kit_data in checks:
            print(f"\n{record.get('title') or ''} ({kit_data['url']}):")
            for item in kit_data['check_before_sending']:
                print(f'  • {item}')
    return 0


if __name__ == '__main__':
    sys.exit(main() or 0)
