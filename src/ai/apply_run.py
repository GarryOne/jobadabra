"""Run one observable Codex browser fill and record its review handoff.

The trace and result may contain applicant data. They are stored only in a private directory
outside the repository. This runner audits Codex's report; it is not a browser security boundary.
"""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import subprocess
import sys
from urllib.parse import urlparse

from . import apply_record
from ..notion.client import job_code
from ..notion import runs
from ..stores import base, rules
from .. import secret_store, service

ROOT = Path(__file__).resolve().parents[2]
SCHEMA = ROOT / 'tools' / 'apply-run-result.schema.json'
GUARD = ROOT / 'tools' / 'browser-submit-guard.js'
FASTPATH = ROOT / 'tools' / 'browser-form-fastpath.js'
# The one control reader the fastpath's audit asks (extension/page/read-back.js and the typed-box rule it uses) and the attempt log its retypes ask: loaded first, as the extension loads them.
READER = [ROOT / 'extension' / 'page' / 'typed-check.js', ROOT / 'extension' / 'page' / 'read-back.js', ROOT / 'extension' / 'page' / 'attempts.js']
STATE_DIR = Path(os.getenv('JOBADABRA_APPLY_RUN_DIR',
                           str(Path.home() / 'Library' / 'Application Support' / 'JobPilotto' / 'apply-runs')))
TIMEOUT = 45 * 60


def _private_dir(path):
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    path.chmod(0o700)


def _write_json(path, data):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, 'w') as stream:
        json.dump(data, stream, indent=2)
        stream.write('\n')


def _read_json(path):
    return json.loads(path.read_text()) if path.exists() else None


def _duration(intervals, started, ended):
    spans = []
    for interval in intervals:
        a = datetime.fromisoformat(interval['start'].replace('Z', '+00:00'))
        b = datetime.fromisoformat(interval['end'].replace('Z', '+00:00'))
        if a.tzinfo is None or b.tzinfo is None or not started <= a <= b <= ended:
            raise ValueError('invalid active fill interval')
        spans.append((a, b))
    spans.sort()
    if not spans or any(spans[i][0] < spans[i - 1][1] for i in range(1, len(spans))):
        raise ValueError('missing or overlapping active fill intervals')
    return round(sum((b - a).total_seconds() for a, b in spans) / 60, 2)


def audit(result, url, started, ended):
    """Accept only an explicit, complete, browser-checked handoff."""
    if result.get('status') != 'ready':
        unanswered = result.get('unanswered') or []
        if unanswered:
            return 'needs_user', None, 'owner input needed: ' + '; '.join(unanswered)[:300]
        return result.get('status', 'failed'), None, 'agent did not report a review-ready form'
    actual = urlparse(result.get('page_url', ''))
    if actual.scheme != 'https' or not actual.hostname:
        return 'needs_user', None, 'missing HTTPS browser form URL'
    checks = result.get('checks') or {}
    if not all(checks.get(k) is True for k in ('submit_untouched',
               'legal_acknowledgments_untouched', 'browser_form_inspected', 'guard_active')):
        return 'needs_user', None, 'submission, legal, or browser check missing'
    fields = result.get('fields') or []
    if not fields or result.get('form_field_count') != len(fields) or any(
                         not f.get('observed') or not f.get('matches_source') or not f.get('source')
                         for f in fields):
        return 'needs_user', None, 'field audit incomplete or mismatched'
    attachments = result.get('attachments') or []
    if not attachments or not any('resume' in a.get('label', '').lower() and a.get('present')
                                  for a in attachments):
        return 'needs_user', None, 'resume attachment was not verified'
    if result.get('unanswered') or any(not a.get('present') for a in attachments):
        return 'needs_user', None, 'unanswered fields or missing attachments'
    try:
        minutes = _duration(result.get('fill_intervals', []), started, ended)
    except (ValueError, TypeError, KeyError):
        return 'needs_user', None, 'active fill intervals invalid'
    return 'ready', minutes, ''


def record_from_page(url, page, started, ended, agent='claude'):
    """Run record for a form filled by an interactive agent (Claude, or a person), in the same
    format as a Codex run so --status/--report/the benchmark cover it too.

    page = {"page_url", "guard_active", "fields": window.__jobPilottoAuditVisibleFields()} —
    labels and filled flags only, never values. The verdict comes from that page state, not from
    the agent's own summary: ready only if the guard is on, every required non-legal field is
    filled, no legal box is ticked and a resume is attached. Field values are NOT compared to their
    sources (matches_source mirrors "filled"); that still needs the owner's review."""
    rows = [f for f in page.get('fields') or [] if isinstance(f, dict)]
    fields = [{'label': f.get('label') or f.get('field') or '?', 'source': 'page audit',
               'required': bool(f.get('required')), 'observed': bool(f.get('filled')),
               'matches_source': bool(f.get('filled'))}
              for f in rows if not f.get('legal') and f.get('type') != 'file']
    attachments = [{'label': f.get('label') or f.get('field') or 'file', 'present': bool(f.get('filled'))}
                   for f in rows if f.get('type') == 'file']
    unanswered = [f['label'] for f in fields if f['required'] and not f['observed']]
    legal_ticked = [f.get('label') for f in rows if f.get('legal') and f.get('filled')
                    and f.get('type') in ('checkbox', 'radio')]
    resume = any('resume' in a['label'].lower() or 'cv' in a['label'].lower() for a in attachments
                 if a['present'])
    guard = page.get('guard_active') is True
    result = {'status': 'ready', 'page_url': page.get('page_url', ''), 'form_field_count': len(fields),
              'fields': fields, 'attachments': attachments, 'unanswered': unanswered,
              'checks': {'submit_untouched': guard, 'legal_acknowledgments_untouched': not legal_ticked,
                         'browser_form_inspected': bool(rows), 'guard_active': guard},
              'fill_intervals': [{'start': started.isoformat(), 'end': ended.isoformat()}],
              'summary': f'{agent} run, recorded from the page audit'}
    minutes = round((ended - started).total_seconds() / 60, 2)
    reasons = ([] if guard else ['submit guard not active'])
    reasons += [f'legal box ticked: {label}' for label in legal_ticked]
    reasons += [] if resume else ['resume not attached']
    reasons += [f'empty required: {label}' for label in unanswered]
    if not rows:
        reasons = ['no fields in the page audit']
    status = 'needs_user' if reasons else 'ready'
    result['status'] = status
    state = {'url': url, 'status': status, 'agent': agent, 'started_at': started.isoformat(),
             'updated_at': ended.isoformat(), 'minutes': minutes, 'reason': '; '.join(reasons)[:500],
             'field_count': len(fields), 'unanswered': unanswered, 'summary': result['summary'],
             'steps': [s for s in page.get('steps') or [] if isinstance(s, dict)]}
    return state, result


def _prompt(url, learnings=''):
    return (learnings + f'Read AGENTS.md and .claude/skills/apply-to-job/SKILL.md. Fill the application at {url} '
            'using its Notion kit, saved Profile/Application Answers, and CV. Use the Playwright MCP '
            'Chrome extension. Open a NEW browser tab for the job so the init-script guard loads. '
            'Before filling, verify window.__jobPilottoGuardActive is true; if not, stop and report '
            'failed. For plain text and static select fields, call window.__jobPilottoFillKnownFields '
            'with exact field IDs/names and sourced values in one browser evaluation, then use '
            'window.__jobPilottoAuditVisibleFields to identify gaps. Use your judgment only for '
            'skipped or unfamiliar widgets and questions. Never click Submit/Apply/Send, never '
            'unlock the guard, never check legal acknowledgments, '
            'never create an account, and leave unknown facts blank. '
            'Use only the applicant details given here; never a name, e-mail address, phone number, country, city, street address or other location from any other context (such as an account you are signed in with): when a detail is not given, leave it empty. '
            'Stop before submission. '
            'Inspect the actual rendered browser form after filling. Count every visible non-legal '
            'input as form_field_count and include each in fields. Compare every populated field '
            'against its source, check attachments, and list unanswered fields. Report only field '
            'labels and source names, not applicant values, in the structured result. The page_url '
            'must be the actual browser form URL. Record ISO-8601 intervals of your active form work '
            'only; exclude waiting for the user, setup, and any review pause. If any necessary fact '
            'or attestation is missing, status must be needs_user. Keep the browser tab open for '
            'the owner. Your final response must conform to the supplied output schema.')


def _mark(stores, url, next_step, minutes=None):
    row = stores.applications.get(url)
    if not row:
        raise RuntimeError(f'No Applications row for {url}')
    stores.applications.update(row['id'], {'next_step': next_step[:2000], **({'fill_minutes': minutes} if minutes is not None else {})})


def _essential_checks(kit):
    """Checks that need a personal eligibility answer before browser work starts."""
    words = ('eligib', 'sponsor', 'authoriz', 'work permit', 'visa', 'relocat',
             'required language', 'right to work')
    return [item for item in kit.get('check_before_sending', [])
            if any(word in item.casefold() for word in words)]


def claude_usage(url, started, projects=None):
    """(total tokens, output tokens) the Claude Code session filling `url` has used since `started`,
    read from its own transcript; None if no transcript mentions the job."""
    folder = Path(projects or Path.home() / '.claude' / 'projects') / str(ROOT).replace('/', '-')
    files = sorted(folder.glob('*.jsonl'), key=lambda f: f.stat().st_mtime, reverse=True)[:15]
    for path in files:
        if path.stat().st_mtime < started.timestamp():
            break
        text = path.read_text(errors='ignore')
        if url not in text:
            continue
        total = output = 0
        for line in text.splitlines():
            try:
                entry = json.loads(line)
                at = datetime.fromisoformat(str(entry.get('timestamp', '')).replace('Z', '+00:00'))
            except (ValueError, TypeError):
                continue
            usage = (entry.get('message') or {}).get('usage') if isinstance(entry, dict) else None
            if not isinstance(usage, dict) or at < started:
                continue
            output += usage.get('output_tokens', 0) or 0
            total += sum(usage.get(k, 0) or 0 for k in ('input_tokens', 'cache_creation_input_tokens',
                                                         'cache_read_input_tokens', 'output_tokens'))
        return total, output
    return None


def codex_usage(trace_path):
    """(total tokens, output tokens) from a Codex --json trace (turn.completed events)."""
    total = output = 0
    try:
        lines = Path(trace_path).read_text(errors='ignore').splitlines()
    except OSError:
        return None
    for line in lines:
        try:
            usage = (json.loads(line).get('usage') or {})
        except (ValueError, AttributeError):
            continue
        output += usage.get('output_tokens', 0) or 0
        total += (usage.get('input_tokens', 0) or 0) + (usage.get('output_tokens', 0) or 0)
    return (total, output) if total else None


def _notify(url, message):
    """macOS notification about this job (no-op elsewhere); never fails the run."""
    try:
        subprocess.Popen([str(ROOT / 'tools' / 'notify.sh'), url, message],
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except OSError:
        pass


def _log_run(stores, state, result, learning=''):
    """The fill's Agent Runs record in the store (src/ai/apply_record.py); never fails the run."""
    return apply_record.log(stores, state, result, learning) if stores else None


def _learnings_text(stores, url):
    """Recent learnings for this job board, as a prompt preface ('' if none)."""
    try:
        items = apply_record.learnings(stores, runs.ats_name(url), limit=8)
    except Exception:  # noqa: BLE001 — the store unavailable: fill without them
        return ''
    if not items:
        return ''
    lines = '\n'.join(f'- {day} {company}: {text}' for day, _, company, _, text in items)
    return f'Learnings from earlier runs on this job board (apply them):\n{lines}\n\n'


def _kit(stores, row):
    return base.kit_from(stores.applications.section(row['id'], base.KIT_SECTION)) if row else None


def _stores():
    """The active store: Notion with this Mac's Notion token when there is one (the Keychain too), else this Mac's."""
    from ..stores import open_stores
    token = '' if os.getenv('NOTION_TOKEN') else _keychain_token()
    return open_stores({**os.environ, 'NOTION_TOKEN': token}) if token else open_stores()


def _keychain_token():
    """The Notion token kept in the Keychain (the app's), for a run started without one in its environment."""
    if sys.platform != 'darwin' or secret_store.isolated():  # the end-to-end journey never reaches the owner's own Notion
        return ''
    return secret_store.get('jobadabra.notion.token') or ''   # the store also finds the item an older install made under the pre-rename name


def run(url, stores, *, codex=None, timeout=TIMEOUT):
    if urlparse(url).scheme != 'https':
        raise ValueError('An HTTPS job URL is required')
    _private_dir(STATE_DIR)
    state_path = STATE_DIR / f'{job_code(url)}.json'
    prior = _read_json(state_path)
    if prior and prior.get('status') == 'running':
        age = datetime.now(timezone.utc) - datetime.fromisoformat(prior['updated_at'])
        if age.total_seconds() >= 2 * 3600:
            prior['status'] = 'stale'
            prior['reason'] = 'run stopped reporting; inspect browser and trace before retrying'
            _write_json(state_path, prior)
    if prior and prior.get('status') in ('running', 'ready'):
        raise RuntimeError(f"Existing {prior['status']} run for this URL; inspect {state_path} first")
    row = stores.applications.get(url)
    if not row:
        raise RuntimeError('Prepare and save an application kit before starting a browser run')
    stage = row['stage'] or None
    if stage not in ('Saved', 'Kit ready', 'Applying'):
        raise RuntimeError(f'Cannot start a browser run for Stage {stage}')
    kit = _kit(stores, row)
    if not kit:
        raise RuntimeError('No application kit found for this job')
    rules.mark(stores, {'url': url}, 'Applying')
    started = datetime.now(timezone.utc)
    state = {'url': url, 'status': 'running', 'started_at': started.isoformat(), 'updated_at': started.isoformat()}
    _write_json(state_path, state)
    checks = _essential_checks(kit)
    if checks:
        reason = 'owner input needed: ' + '; '.join(checks)[:300]
        state.update(status='needs_user', reason=reason)
        _write_json(state_path, state)
        _mark(stores, url, reason)
        return state
    # Closest observable point to "first field filled": Codex's field writes aren't visible here.
    _notify(url, 'Filling started')
    trace_path = STATE_DIR / f'{job_code(url)}.jsonl'
    result_path = STATE_DIR / f'{job_code(url)}.result.json'
    result_path.unlink(missing_ok=True)
    codex = codex or os.getenv('JOBADABRA_CODEX_BIN', 'codex')
    npx = os.getenv('JOBADABRA_NPX_BIN', 'npx')
    command = [codex, 'exec', '--json', '--output-schema', str(SCHEMA),
               '--output-last-message', str(result_path), '-C', str(ROOT),
               '-c', f'mcp_servers.playwright.command={json.dumps(npx)}',
               '-c', f'mcp_servers.playwright.args={json.dumps(["-y", "@playwright/mcp@0.0.82", "--extension", "--init-script", str(GUARD), *[part for script in READER for part in ("--init-script", str(script))], "--init-script", str(FASTPATH)])}',
               _prompt(url, _learnings_text(stores, url))]
    try:
        agent_env = os.environ.copy()
        agent_env.pop('NOTION_TOKEN', None)
        with open(trace_path, 'w', opener=lambda p, f: os.open(p, f, 0o600)) as trace:
            completed = subprocess.run(command, cwd=ROOT, stdout=trace, stderr=subprocess.PIPE,
                                       text=True, timeout=timeout, check=False, env=agent_env)
        ended = datetime.now(timezone.utc)
        if completed.returncode:
            raise RuntimeError(f'Codex exited {completed.returncode}: {completed.stderr[-500:]}')
        result = _read_json(result_path)
        if not isinstance(result, dict):
            raise RuntimeError('Codex returned no structured result')
        status, minutes, reason = audit(result, url, started, ended)
        state.update(status=status, updated_at=ended.isoformat(), minutes=minutes,
                     reason=reason, field_count=len(result.get('fields', [])),
                     unanswered=result.get('unanswered', []), summary=result.get('summary', ''))
        _write_json(state_path, state)
        if status == 'ready':
            _mark(stores, url, 'Ready for review — inspect the browser form and submit yourself', minutes)
        else:
            _mark(stores, url, f'Form needs review: {reason or status}')
        used = codex_usage(trace_path)
        _log_run(stores, dict(state, agent='codex', billed_to='ChatGPT plan',
                               tokens_total=used[0] if used else None, tokens_output=used[1] if used else None), result)
        return state
    except Exception as error:
        state.update(status='failed', updated_at=datetime.now(timezone.utc).isoformat(),
                     reason=str(error)[:500])
        _write_json(state_path, state)
        _mark(stores, url, 'Browser run failed — inspect local run log before retrying')
        _log_run(stores, dict(state, agent='codex', billed_to='ChatGPT plan'), None)
        raise


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('url', nargs='?')
    parser.add_argument('--status', action='store_true', help='show saved run states')
    parser.add_argument('--report', metavar='URL', help='show field and attachment audit for one job')
    parser.add_argument('--reconcile', metavar='URL',
                        help='re-audit a completed local result and update its Notion Next step')
    parser.add_argument('--record', metavar='URL',
                        help='record a form filled by an interactive agent (Claude) from its page '
                             'audit: needs --audit; writes the run record, updates Notion, notifies')
    parser.add_argument('--audit', metavar='FILE',
                        help='for --record: JSON {"page_url", "guard_active", "fields": '
                             '__jobPilottoAuditVisibleFields()}')
    parser.add_argument('--started', metavar='ISO',
                        help='for --record: when filling started (UTC ISO-8601); fill time = now - started')
    parser.add_argument('--agent', default='claude', help='for --record: who filled it (default claude)')
    parser.add_argument('--learning', default='',
                        help='for --record: one-line finding for the next run (site behaviour, what worked)')
    parser.add_argument('--context', metavar='URL',
                        help='print everything a form-filling session needs in one go: the kit (JSON), '
                             'Profile, Application Answers, and recent learnings for this job board')
    parser.add_argument('--learnings', nargs='?', const='', metavar='ATS',
                        help='print recent learnings from Agent Runs (optionally one job board, e.g. Greenhouse)')
    parser.add_argument('--expire-hours', type=float, default=2,
                        help='mark running records older than this as stale when listing status')
    args = parser.parse_args(argv)
    if args.context:
        stores = _stores()
        row = stores.applications.get(args.context)
        kit = _kit(stores, row)
        board = runs.ats_name(args.context)
        print(f'# Job: {args.context} (board: {board})')
        print('\n## Kit (JSON)\n' + (json.dumps(kit, ensure_ascii=False, indent=1) if kit else
              'No kit on this job yet: draft one first (tools/prepare-top.sh or 📝 Prepare).'))
        print('\n## Profile — CV and Preferences\n' + stores.texts.plain('profile'))
        print('\n## Application Answers\n' + stores.texts.get('answers'))
        items = apply_record.learnings(stores, board)
        print(f'\n## Learnings from earlier runs on {board}')
        print('\n'.join(f'- {day} {company}: {text}' for day, _, company, _, text in items) or '- none yet')
        notes = service.playbook(board) if not os.getenv('JOBADABRA_NO_SERVICE') else ''
        print(f'\n## Platform notes for {board} (private playbook)')
        print(notes or '- none available (offline, or nothing recorded for this board yet): use the generic rules in the skill')
        return 0
    if args.learnings is not None:
        items = apply_record.learnings(_stores(), args.learnings or None)
        for day, board, company, agent, text in items:
            print(f'- {day} · {board} · {company or "?"} · {agent}: {text}')
        if not items:
            print('No learnings recorded yet.')
        return 0
    if args.record:
        if not args.audit:
            parser.error('--record needs --audit FILE')
        ended = datetime.now(timezone.utc)
        started = (datetime.fromisoformat(args.started.replace('Z', '+00:00')) if args.started else ended)
        state, result = record_from_page(args.record, json.loads(Path(args.audit).read_text()),
                                         started, ended, args.agent)
        used = claude_usage(args.record, started) if args.agent == 'claude' else None
        state.update(billed_to={'claude': 'Claude subscription', 'codex': 'ChatGPT plan'}.get(args.agent, 'Unknown'),
                     tokens_total=used[0] if used else None, tokens_output=used[1] if used else None)
        _private_dir(STATE_DIR)
        _write_json(STATE_DIR / f'{job_code(args.record)}.json', state)
        _write_json(STATE_DIR / f'{job_code(args.record)}.result.json', result)
        stores = _stores()
        try:
            if state['status'] == 'ready':
                _mark(stores, args.record, 'Ready for review — inspect the browser form and submit yourself',
                      state['minutes'])
            else:
                _mark(stores, args.record, f"Form needs review: {state['reason']}", state['minutes'])
        except RuntimeError as error:  # not tracked in the store: the local record still counts
            print(f'Warning: the job was not updated: {error}')
        page_url = _log_run(stores, state, result, args.learning)
        if page_url:
            print(f'Agent Runs: {page_url}')
        _notify(args.record, 'Form filled — review and Submit' if state['status'] == 'ready'
                else 'Needs your input — see Terminal')
        print(f"{state['status']}: {args.record} ({state['minutes']} min, {state['field_count']} fields)"
              + (f" — {state['reason']}" if state['reason'] else ''))
        return 0
    if args.report:
        state = _read_json(STATE_DIR / f'{job_code(args.report)}.json')
        result = _read_json(STATE_DIR / f'{job_code(args.report)}.result.json')
        if not state or not result or state.get('url') != args.report:
            parser.error('no completed report for that job URL')
        print(f"{state['status']}: {args.report} ({state.get('minutes')} active minutes)")
        for field in result.get('fields', []):
            mark = '✓' if field.get('observed') and field.get('matches_source') else 'CHECK'
            print(f"  {mark} {field.get('label', '?')} — source: {field.get('source', '?')}")
        for item in result.get('attachments', []):
            print(f"  {'✓' if item.get('present') else 'CHECK'} attachment: {item.get('label', '?')}")
        for item in result.get('unanswered', []):
            print(f'  CHECK unanswered: {item}')
        return 0
    if args.reconcile:
        url = args.reconcile
        state_path = STATE_DIR / f'{job_code(url)}.json'
        state = _read_json(state_path)
        result = _read_json(STATE_DIR / f'{job_code(url)}.result.json')
        if not state or not result or state.get('url') != url:
            parser.error('no completed run for that URL')
        started = datetime.fromisoformat(state['started_at'])
        ended = datetime.fromisoformat(state['updated_at'])
        status, minutes, reason = audit(result, url, started, ended)
        state.update(status=status, minutes=minutes, reason=reason)
        stores = _stores()
        if status == 'ready':
            _mark(stores, url, 'Ready for review — inspect the browser form and submit yourself', minutes)
        else:
            _mark(stores, url, f'Form needs review: {reason or status}')
        _write_json(state_path, state)
        print(f'{status}: {url} — {reason}')
        return 0
    if args.status:
        _private_dir(STATE_DIR)
        now = datetime.now(timezone.utc)
        for path in sorted(STATE_DIR.glob('*.json')):
            if path.name.endswith('.result.json'):
                continue
            state = _read_json(path)
            if state.get('status') == 'running':
                age = (now - datetime.fromisoformat(state['updated_at'])).total_seconds() / 3600
                if age >= args.expire_hours:
                    state['status'] = 'stale'
                    state['reason'] = 'run stopped reporting; inspect trace and browser before retrying'
                    _write_json(path, state)
            print(f"{state['status']}: {state['url']} — {state.get('reason', '')}")
        return 0
    if not args.url:
        parser.error('provide a job URL or --status')
    state = run(args.url, _stores())
    print(f"{state['status']}: {args.url} — {state.get('reason') or state.get('summary', '')}")
    message = {'ready': 'Form filled — review and Submit',
               'needs_user': 'Needs your input — see Terminal'}.get(state['status'], 'Run failed — see Terminal')
    _notify(args.url, message)
    return 0 if state['status'] == 'ready' else 1


if __name__ == '__main__':
    sys.exit(main())
