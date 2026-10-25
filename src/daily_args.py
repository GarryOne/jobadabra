"""The jobs check's command line: every option of `python -m src daily` (src/daily.py parses it and runs the mode).
Tests: tests/test_mode_contract.py, tests/test_daily.py, tests/test_search_budget.py.
"""
import argparse
from pathlib import Path
from .ai import kit
from .paths import JOBS_DB, REPORTS
from .daily_helpers import ACTIONS, MODES


def build_parser(description):
    parser = argparse.ArgumentParser(description=description)
    parser.add_argument('--db', type=Path, default=JOBS_DB)
    parser.add_argument('--company-report', type=Path, default=REPORTS / 'companies.json')
    parser.add_argument('--limit', type=int, default=50, help='jobs in the ranked list, paged 10 at a time')
    parser.add_argument('--page', type=int, default=1)
    # Always on runs the searches on GitHub, but pages read in Chrome stay on this Mac (7 Oct 2026: they were never scored): a run on the Mac
    # that reads only those pages, scores what matches and writes it to Notion; it closes nothing (it saw only a few feeds).
    parser.add_argument('--only-visits', action='store_true', help='read only the pages read in Chrome (visit feeds); use with --mode today')
    parser.add_argument('--seed', type=int, help='ranking seed from a ➕ Next button, so pages continue')
    parser.add_argument('--send', action='store_true', help='send to Telegram; otherwise print preview only')
    parser.add_argument('--mode', choices=MODES, default='scheduled',
                        help='scheduled: send only when new jobs exist; run/today: always send; '
                             'apply: mark --job as applied in Notion; prepare: draft its application kit')
    parser.add_argument('--job', help='job code from /apply_<code>, for --mode apply or prepare; '
                                      'interview mode: the job URL the interview belongs to')
    parser.add_argument('--action', choices=sorted(ACTIONS) + ['talking'], default='applied',
                        help='for --mode apply: applied, saved or dismissed; for a recruiter lead (--mode add, no --job): talking')
    parser.add_argument('--budget', type=int, default=0, help='seconds: AI steps start no new call after this (src/time_budget.py); 0 = none')
    parser.add_argument('--first-jobs', action='store_true', help='read a small slice of fast feeds and score 3 jobs before the full crawl (src/first_jobs.py)')
    parser.add_argument('--score-max', type=int, default=0,
                        help='AI stage 2: score up to N eligible jobs against the Notion Profile (0 = off)')
    parser.add_argument('--enrich-max', type=int, default=0,
                        help='AI stage 1: extract facts for up to N new/changed jobs after import (0 = off)')
    parser.add_argument('--auto-kit-max', type=int, default=0,
                        help='auto-draft application kits for up to N best-scored new jobs per run (0 = off)')
    parser.add_argument('--auto-kit-min-score', type=int, default=kit.DEFAULT_AUTO_MIN_SCORE,
                        help='minimum fit score to qualify for an automatic kit')
    parser.add_argument('--file', help='interview mode: Telegram file id, or a local path, of the recording or transcript')
    parser.add_argument('--interview', help='interview mode: review this 🎤 Interviews row (saved from the app)')
    parser.add_argument('--note', default='', help='interview mode: the caption, or "/interview <label>" plus notes; add mode: the date applied, '
                             'or (without --job) the recruiter\'s message')
    parser.add_argument('--job-title', default='', help='add mode: the job title, when the page can\'t be read (LinkedIn…)')
    parser.add_argument('--job-company', default='', help='add mode: the company, when the page can\'t be read')
    parser.add_argument('--job-text', default='', help='add mode: the job description, pasted (for the AI stages)')
    parser.add_argument('--target', default='', help="add mode without --job: 'new', or the URL of the job it's about "
                                                      '(default: the AI decides)')
    parser.add_argument('--propose', action='store_true',
                        help='add mode without --job: read the message and print the proposal (JSON) to confirm; '
                             'nothing is written to Notion (the app\'s confirmation step)')
    parser.add_argument('--reading', default='', help='add mode: a --propose result (JSON file) to write, without reading again '
                                                      '(with --propose: proposed again for --target, the job you picked)')
    parser.add_argument('--channel', default='', help='add mode: where the conversation is from, as you confirmed it '
                                                      '(LinkedIn, Email, Phone, Other)')
    parser.add_argument('--channel-other', default='', help='add mode: what "Other" was (e.g. WhatsApp)')
    parser.add_argument('--started', default='', help='add mode: when the conversation started, as you confirmed it (YYYY-MM-DD)')
    parser.add_argument('--kind', default='', help='add mode: what it is, as you confirmed it (e.g. "Reply received")')
    parser.add_argument('--last-at', default='', help='add mode: the day of the last message, as you gave it (YYYY-MM-DD)')
    parser.add_argument('--interview-at', default='', help='add mode: the call\'s date and time, as you confirmed it (YYYY-MM-DDTHH:MM)')
    parser.add_argument('--company', default=None, help='add mode, a new job: the hiring company, as you confirmed it ("" = not named)')
    parser.add_argument('--agency', default=None, help='add mode, a new job: the recruiter\'s agency, as you confirmed it ("" = none)')
    parser.add_argument('--from-app', action='store_true', help='add mode: logged in the Desktop App (Source "Jobadabra app", even with --send)')
    parser.add_argument('--first-contact', choices=('yes', 'no'), default=None,
                        help='add mode, a new job: this was the first contact about it (its Source follows the channel)')
    parser.add_argument('--origin', choices=('inbound', 'outbound'), default=None,
                        help='add mode, a tracked job: who reached out first, as you answered it (inbound: they did)')
    parser.add_argument('--agreed', choices=('yes', 'no'), default=None,
                        help='add mode: your answer to "Did you agree to talk to the recruiter?" (yes: Screening)')
    parser.add_argument('--log-run', action='store_true',
                        help='log this run to Notion ⏰ Search runs even without --send (the desktop app always does)')
    parser.add_argument('--insight', action='store_true',
                        help="scheduled mode: send the day's insight if it's due (insight mode always sends one)")
    return parser
