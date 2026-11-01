"""Crash reports from the engine to Sentry, without Sentry's SDK (see desktop/lib/sentry.js for why): only the exception type, a scrubbed
message, stack frames (file names without folders above the app, function, line), the app version, the platform and the run id.
No local variables, no request data. Off unless the desktop app sets JOBADABRA_SENTRY_DSN (it does only for an installed build with
"Technical reports" on). `python -m src …` installs it as the unhandled-exception hook; it never raises."""
import json
import os
import platform
import re
import secrets
import sys
import tempfile
import time
import traceback
import urllib.request
from urllib.parse import urlparse

_SECRETS = re.compile(r'sk-ant-[\w-]+|\bntn_\w+|\bsecret_\w+|\bgh[pousr]_\w+|github_pat_\w+|GOCSPX-[\w-]+|\b\d{6,12}:AA[\w-]{20,}|Bearer\s+[\w.-]+')
_EMAIL = re.compile(r'[\w.+-]+@[\w-]+\.[\w.-]+')
_HOME = re.compile(r'/(Users|home)/[^/\s"\']+|[A-Z]:\\Users\\[^\\\s"\']+', re.I)


def scrub(text, limit=300):
    text = _HOME.sub(lambda m: m.group(0).split('/')[1].join(['/', '/<user>']) if m.group(0).startswith('/') else 'C:\\Users\\<user>', str(text))
    text = _EMAIL.sub('<email>', _SECRETS.sub('<secret>', text))
    return text[:limit]


def parse_dsn(dsn):
    """https://<key>@<host>/<project> -> (envelope url, auth header), or None."""
    try:
        url = urlparse(str(dsn))
        project = url.path.strip('/')
        if not url.username or not project.isdigit():
            return None
        return (f'{url.scheme}://{url.hostname}{":" + str(url.port) if url.port else ""}/api/{project}/envelope/',
                f'Sentry sentry_version=7, sentry_key={url.username}, sentry_client=jobadabra-engine/1')
    except ValueError:
        return None


def frames(tb):
    """Frames oldest first: the file's last three parts, the function and the line; library frames are marked not in the app."""
    out = []
    for item in traceback.extract_tb(tb)[-40:]:
        parts = re.split(r'[\\/]', item.filename)
        short = '/'.join(parts[-3:])
        out.append({'filename': scrub(short, 120), 'function': scrub(item.name, 80), 'lineno': item.lineno,
                    'in_app': 'site-packages' not in item.filename and 'lib/python' not in item.filename})
    return out


def build_event(exc_type, exc, tb, env=None, now=None):
    env = os.environ if env is None else env
    kind = exc_type.__name__
    message = scrub(str(exc) or kind)
    command = ' '.join(sys.argv[:1])
    return {
        'event_id': secrets.token_hex(16), 'timestamp': now or time.time(), 'platform': 'python', 'level': 'error',
        'release': f"jobadabra@{env.get('JOBADABRA_APP_VERSION', 'dev')}", 'environment': env.get('JOBADABRA_ENV', 'production'),
        'user': {'id': env.get('JOBADABRA_INSTALL_ID', '')}, 'tags': {'where': 'engine', 'os': platform.system(), 'run_id': env.get('JOBADABRA_RUN_ID', ''),
                                                                         'command': scrub(command, 60)},
        'fingerprint': ['engine', kind, re.sub(r'\d+', '#', message)[:120]],
        'exception': {'values': [{'type': kind, 'value': message, 'stacktrace': {'frames': frames(tb)}}]},
    }


def envelope(event, dsn):
    sent = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    return '\n'.join([json.dumps({'event_id': event['event_id'], 'sent_at': sent, 'dsn': dsn}), json.dumps({'type': 'event'}), json.dumps(event)]) + '\n'


def send(event, dsn, urlopen=urllib.request.urlopen):
    """POST the event; True when accepted. Short timeout: a crash must not wait on the network. Never raises."""
    target = parse_dsn(dsn)
    if not target:
        return False
    url, auth = target
    request = urllib.request.Request(url, data=envelope(event, dsn).encode(), method='POST',
                                     headers={'Content-Type': 'application/x-sentry-envelope', 'X-Sentry-Auth': auth})
    try:
        with urlopen(request, timeout=4) as response:
            return 200 <= response.status < 300
    except Exception:  # noqa: BLE001
        return False


def install(env=None, urlopen=urllib.request.urlopen):
    """Report unhandled exceptions (then the normal traceback). A no-op without a DSN."""
    env = os.environ if env is None else env
    dsn = env.get('JOBADABRA_SENTRY_DSN', '').strip()
    if not dsn or not parse_dsn(dsn):
        return False
    previous = sys.excepthook

    def hook(exc_type, exc, tb):
        try:
            if not issubclass(exc_type, (KeyboardInterrupt, SystemExit)):
                send(build_event(exc_type, exc, tb, env), dsn, urlopen)
        except Exception:  # noqa: BLE001
            pass
        previous(exc_type, exc, tb)
    sys.excepthook = hook
    return True


def build_warning(topic, details, env=None, now=None):
    """A warning event for something odd that did not stop the run: `topic` is its group, `details` short text facts (names, types, never values)."""
    env = os.environ if env is None else env
    shown = ', '.join(f'{key}={scrub(value, 80)}' for key, value in details.items())
    return {
        'event_id': secrets.token_hex(16), 'timestamp': now or time.time(), 'platform': 'python', 'level': 'warning',
        'release': f"jobadabra@{env.get('JOBADABRA_APP_VERSION', 'dev')}", 'environment': env.get('JOBADABRA_ENV', 'production'),
        'user': {'id': env.get('JOBADABRA_INSTALL_ID', '')}, 'tags': {'where': 'engine', 'os': platform.system(), 'run_id': env.get('JOBADABRA_RUN_ID', ''),
                                                                         'warning': scrub(topic, 60)},
        'fingerprint': ['engine-warning', scrub(topic, 60)], 'message': f'{scrub(topic, 60)}: {shown}'[:300],
    }


def warn(topic, details, env=None, urlopen=urllib.request.urlopen, marker_dir=None):
    """Report an odd thing once a day on this machine (a marker file per topic and day), so the next event shows its source without a flood.
    Off without a DSN, like every report; never raises. True when sent."""
    env = os.environ if env is None else env
    try:
        dsn = env.get('JOBADABRA_SENTRY_DSN', '').strip()
        if not dsn or not parse_dsn(dsn):
            return False
        marker = os.path.join(marker_dir or tempfile.gettempdir(), f"jp-warned-{re.sub(r'[^a-z0-9]+', '-', topic.lower())}-{time.strftime('%Y%m%d')}")
        if os.path.exists(marker):
            return False
        open(marker, 'w').close()
        return send(build_warning(topic, details, env), dsn, urlopen)
    except Exception:  # noqa: BLE001
        return False
