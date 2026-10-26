"""Where a message goes besides Telegram: e-mail, through our site (POST /api/notify/email, site/src/account-email.js).

The app (or the Always on repo) says which channels the person chose in JOB_PILOTTO_NOTIFY, a comma list of email, telegram, app. Unset = the old behaviour (Telegram only).
Every message src/telegram.py sends goes through here too, so each Telegram message has its e-mail form with the same layout (src/tgcard.py's Telegram HTML; the site keeps a safe subset).
Cadence (owner, 17 Oct 2026): new matches (kind 'matches') go as ONE e-mail per run, sent when the process ends or at flush(); an urgent message (an interview) goes at once, alone;
everything else (kind 'activity': mail-check results, insights, finished jobs) is handed to the site as ONE message per run, which holds it for the person's daily or weekly digest (site/src/mail-held.js).
The run The run identifies as the install (JOB_PILOTTO_TRIAL_KEY,
or the Free AI key JPF1.<install>.<token>), never an SMTP secret. Guarded by tests/test_notify.py.
"""
import atexit
import json
import os
import re
import sys
import urllib.request

SITE = 'https://www.jobpilotto.top'
MAX_HTML = 18000   # the site keeps 20000 characters
SEPARATOR = '\n\n———\n\n'
_QUEUE = {'matches': [], 'activity': []}
KINDS = tuple(_QUEUE)
_registered = []


def channels(env=None):
    """The chosen channels as a set, or None when nothing was chosen (the old behaviour: Telegram only)."""
    raw = (os.environ if env is None else env).get('JOB_PILOTTO_NOTIFY')
    if raw is None or not raw.strip():
        return None
    return {part.strip().lower() for part in raw.split(',') if part.strip()}


def wants_email(env=None):
    return 'email' in (channels(env) or ())


def wants_telegram(env=None):
    chosen = channels(env)
    return chosen is None or 'telegram' in chosen


def _key(env):
    key = (env.get('JOB_PILOTTO_TRIAL_KEY') or '').strip()
    if not key and (env.get('ANTHROPIC_API_KEY') or '').startswith('JPF1.'):
        key = env['ANTHROPIC_API_KEY']
    return key


def _plain(html):
    return re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', '', html or '')).strip()


def _subject(items):
    first = re.search(r'<b>(.*?)</b>', items[0][0], re.S)
    title = _plain(first.group(1) if first else items[0][0])[:100] or 'Jobadabra'
    return title if len(items) == 1 else f'{title} and {len(items) - 1} more'


def _buttons(markup):
    """The inline keyboard's link buttons (an e-mail cannot press a callback button)."""
    found = []
    for row in (markup or {}).get('inline_keyboard', []):
        for button in row:
            if button.get('url') and button.get('text'):
                found.append({'text': _plain(button['text']), 'url': button['url']})
    return found


def queue(text, markup=None, urgent=False, kind='activity'):
    """Hold a message for this run's e-mail. urgent=True sends it at once, alone (an interview notice). kind: 'matches' = the run's one new-matches mail; 'activity' = held by the site for the digest."""
    if not wants_email():
        return True
    if urgent:
        return _post([(text, markup)])
    _QUEUE[kind if kind in KINDS else 'activity'].append((text, markup))
    if not _registered:
        _registered.append(True)
        atexit.register(flush)
    return True


def flush(kind=None):
    """Send what is held (one kind, or all) as ONE e-mail per kind. True when nothing was held or the site took it; False (and a printed warning) when it did not."""
    ok = True
    for name in ([kind] if kind else KINDS):
        items, _QUEUE[name][:] = list(_QUEUE[name]), []
        if items and not _post(items, kind=name):
            ok = False
    return ok


def _post(items, urlopen=None, env=None, kind='matches'):
    env = os.environ if env is None else env
    urlopen = urlopen or urllib.request.urlopen
    key = _key(env)
    base = env.get('JOB_PILOTTO_SITE_URL', SITE).rstrip('/')
    if env.get('JOB_PILOTTO_E2E') and not env.get('JOB_PILOTTO_SITE_URL'):
        return True   # the end-to-end journey never reaches the real site
    if not key:
        print('Warning: no e-mail sent: this run has no install key.', file=sys.stderr)
        return False
    html = SEPARATOR.join(item[0] for item in items)[:MAX_HTML]
    buttons = [b for item in items for b in _buttons(item[1])][:6]
    body = json.dumps({'subject': _subject(items), 'html': html, 'buttons': buttons, **({'kind': 'activity'} if kind == 'activity' else {})}).encode()
    request = urllib.request.Request(f'{base}/api/notify/email', data=body, method='POST', headers={'x-api-key': key, 'content-type': 'application/json'})
    try:
        with urlopen(request, timeout=20) as response:
            answer = json.load(response)
    except Exception as error:  # noqa: BLE001 - a site outage must not stop a person's search
        print(f'Warning: the e-mail was not sent ({type(error).__name__}).', file=sys.stderr)
        return False
    if not answer.get('ok'):
        print(f"Warning: the e-mail was not sent ({answer.get('reason') or answer.get('error') or 'refused'}).", file=sys.stderr)
        return False
    return True


def failure_words():
    """What to tell the person when the e-mail did not go (the digest keeps its jobs unshown, like a refused Telegram message)."""
    return 'The e-mail could not be sent, so the digest was not delivered. It is listed again next time.'


def main(argv=None):
    """python -m src.notify "text": a plain line to the person's chosen e-mail (the workflows' own notices: a failed run, Gmail not connected). Telegram stays their curl."""
    import html
    import sys
    text = ' '.join(sys.argv[1:] if argv is None else argv).strip()
    if not text or not wants_email():
        return 0
    queue(html.escape(text), urgent=True)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
