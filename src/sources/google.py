#!/usr/bin/env python3
"""Read-only Google access for Jobadabra: Gmail (job-related emails) and Calendar (interviews).

Scopes are gmail.readonly and calendar.readonly: nothing is ever sent, changed or deleted. `auth` runs the
one-time browser sign-in on this Mac (loopback redirect + PKCE), stores the refresh token in the Keychain,
and with --github also sets the GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN
repository secrets for CI.

Two ways to connect:
- The shared Jobadabra app (default): the "Jobadabra" Google app. Its client file,
  config/google_oauth_client.json, is not in git: the Mac app build adds it from the
  GOOGLE_SHARED_CLIENT_JSON secret. One command, one browser consent, no Google Cloud setup.
- Your own Google app: `setup` walks you through creating one (src/sources/google_setup.py), or pass a
  client you made with --client-json.

Usage:
  python -m src.sources.google auth --github                  # shared app
  python -m src.sources.google setup                          # guided: your own Google app
  python -m src.sources.google auth --client-json ~/Downloads/client_secret_….json --github [--production]
  python -m src.sources.google check
"""
import argparse
import base64
import contextlib
import hashlib
import html
import http.server
import json
import os
import re
import secrets
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from datetime import datetime, timedelta, timezone
from pathlib import Path
from email.utils import parsedate_to_datetime

from .. import secret_store
from . import google_scopes
from .google_auth import SignIn, TOKEN_URL, authorize  # noqa: F401 — authorize is re-exported: callers and tests use `google.authorize`
from .google_scopes import MissingScope  # noqa: F401

SCOPES = tuple(google_scopes.SCOPE_URLS.values())
SHARED_CLIENT = Path(__file__).resolve().parents[2] / 'config' / 'google_oauth_client.json'
KEYCHAIN = {'GOOGLE_CLIENT_ID': 'job-pilotto.google.client-id', 'GOOGLE_CLIENT_SECRET': 'job-pilotto.google.client-secret',
            'GOOGLE_REFRESH_TOKEN': 'job-pilotto.google.refresh-token'}
AUTH_AT = 'job-pilotto.google.auth-at'   # an app in Testing: when it signed in (Google's 7-day limit)


def _keychain(service):
    return secret_store.get(service)


def e2e_url(url):
    """In a test run, Google's hosts become the end-to-end tests' fake (desktop/e2e/lib/google-fake.mjs): <base>/<host>/<path>."""
    base = os.environ.get('JOB_PILOTTO_E2E_GOOGLE_BASE_URL', '')
    if not (os.environ.get('JOB_PILOTTO_E2E') and base):
        return url
    parts = urllib.parse.urlsplit(url)
    return f"{base.rstrip('/')}/{parts.netloc}{parts.path}{'?' + parts.query if parts.query else ''}"


def credentials():
    """(client id, client secret, refresh token) from the environment (CI) or the Keychain, or None."""
    values = [os.getenv(name) or _keychain(service) for name, service in KEYCHAIN.items()]
    return tuple(values) if all(values) else None


class Google:
    scopes = None   # the parts the user allowed; None = unknown, all assumed (an object made without __init__, as some tests do)

    def __init__(self, client_id, client_secret, refresh_token, opener=urllib.request.urlopen, scopes=None):
        self.client_id, self.client_secret, self.refresh_token, self.opener, self._token = client_id, client_secret, refresh_token, opener, None
        self.scopes = scopes   # the parts the user allowed (google_scopes.GMAIL, CALENDAR); None = unknown, all assumed

    def need(self, part):
        """Raise the named MissingScope before any request when the user left this part unticked."""
        if self.scopes is not None and part not in self.scopes:
            raise MissingScope(part)

    def learn_missing(self, part):
        """Google refused this part: remember it (here and in the secret store) so the next check skips it before any request."""
        left = google_scopes.without(self.scopes, part)
        if left is None:
            return
        self.scopes = left
        if not os.getenv('GOOGLE_SCOPES'):   # CI keeps its own secret; this computer's store is the one to update
            with contextlib.suppress(Exception, SystemExit):   # a convenience (SystemExit: no secret store here): the refusal is reported either way
                secret_store.put(google_scopes.SCOPES_SERVICE, ' '.join(left))

    @classmethod
    def from_env(cls):
        from ..features import disabled
        if disabled('mail'):  # JOB_PILOTTO_DISABLE=mail
            return None
        found = credentials()
        return cls(*found, scopes=google_scopes.from_env(_keychain)) if found else None

    def _access_token(self):
        if not self._token:
            body = urllib.parse.urlencode({'client_id': self.client_id, 'client_secret': self.client_secret,
                                           'refresh_token': self.refresh_token, 'grant_type': 'refresh_token'}).encode()
            try:
                with self.opener(urllib.request.Request(e2e_url(TOKEN_URL), data=body), timeout=20) as response:
                    self._token = json.load(response)['access_token']
            except urllib.error.HTTPError as error:
                raise RuntimeError(f'Google token refresh failed ({error.code}): {error.read().decode(errors="replace")[:200]}') from error
        return self._token

    def get(self, url, params=None):
        if params:
            url += '?' + urllib.parse.urlencode(params, doseq=True)
        request = urllib.request.Request(e2e_url(url), headers={'Authorization': f'Bearer {self._access_token()}'})
        try:
            with self.opener(request, timeout=30) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            part = google_scopes.part_of_refusal(url, error.code, error.read().decode(errors='replace'))
            if part:   # a sign-in saved before the granted parts were kept: Google's own "insufficient scope" says which part is missing
                self.learn_missing(part)
                raise MissingScope(part) from error
            raise

    def account_email(self):
        """The signed-in address: Gmail's profile, or the calendar's own id when only Calendar was allowed."""
        if self.scopes is None or google_scopes.GMAIL in self.scopes:
            try:
                return self.profile()['emailAddress']
            except MissingScope:   # an older sign-in without Gmail: learned just now, Calendar names the account
                pass
        self.need(google_scopes.CALENDAR)
        return self.get('https://www.googleapis.com/calendar/v3/calendars/primary').get('id', '')

    # ---------- Gmail ----------

    def search(self, query, limit=50):
        """Message ids matching a Gmail search, newest first."""
        self.need(google_scopes.GMAIL)
        ids, token = [], None
        while len(ids) < limit:
            params = {'q': query, 'maxResults': min(100, limit - len(ids))}
            if token:
                params['pageToken'] = token
            page = self.get('https://gmail.googleapis.com/gmail/v1/users/me/messages', params)
            ids += [m['id'] for m in page.get('messages', [])]
            token = page.get('nextPageToken')
            if not token:
                break
        return ids

    def snippet(self, message_id):
        """{id, from, subject, snippet} of one email, without its body: what the inbox triage reads (src/ai/mail_triage.py)."""
        self.need(google_scopes.GMAIL)
        data = self.get(f'https://gmail.googleapis.com/gmail/v1/users/me/messages/{message_id}',
                        {'format': 'metadata', 'metadataHeaders': ['From', 'Subject']})
        headers = {h['name'].lower(): h['value'] for h in (data.get('payload') or {}).get('headers', [])}
        return {'id': data['id'], 'from': headers.get('from', ''), 'subject': headers.get('subject', ''), 'snippet': data.get('snippet', '')}

    def message(self, message_id):
        """{id, from, to, subject, date (ISO), body} of one email; the body is plain text, capped."""
        self.need(google_scopes.GMAIL)
        data = self.get(f'https://gmail.googleapis.com/gmail/v1/users/me/messages/{message_id}', {'format': 'full'})
        headers = {h['name'].lower(): h['value'] for h in data['payload'].get('headers', [])}
        try:
            sent = parsedate_to_datetime(headers.get('date', '')).isoformat()
        except (TypeError, ValueError):
            sent = datetime.fromtimestamp(int(data.get('internalDate', 0)) / 1000, timezone.utc).isoformat()
        email = {'id': data['id'], 'from': headers.get('from', ''), 'to': headers.get('to', ''), 'cc': headers.get('cc', ''),
                 'subject': headers.get('subject', ''), 'date': sent, 'body': body_text(data['payload'])[:4000],
                 'labels': data.get('labelIds') or []}
        # An emailed calendar invitation: its start comes from the invitation itself, never from the email's text
        # (Outlook's text often has no date at all, only the meeting link).
        ics = calendar_text(data['payload'], lambda attachment: self.get(
            f'https://gmail.googleapis.com/gmail/v1/users/me/messages/{message_id}/attachments/{attachment}'))
        start = invite_start(ics) if ics else None
        if start:
            email['invite_at'] = start
        return email

    def profile(self):
        self.need(google_scopes.GMAIL)
        return self.get('https://gmail.googleapis.com/gmail/v1/users/me/profile')

    # ---------- Calendar ----------

    def events(self, start, end, calendar='primary'):
        """Single events (recurring ones expanded) between two datetimes, by start time."""
        self.need(google_scopes.CALENDAR)
        page = self.get(f'https://www.googleapis.com/calendar/v3/calendars/{urllib.parse.quote(calendar)}/events', {
            'timeMin': start.isoformat(), 'timeMax': end.isoformat(), 'singleEvents': 'true',
            'orderBy': 'startTime', 'maxResults': 250})
        return page.get('items', [])


def _decode(data):
    return base64.urlsafe_b64decode(data + '=' * (-len(data) % 4)).decode('utf-8', errors='replace')


PLACEHOLDER_MAX = 60  # a plain part shorter than this, next to an HTML part, is a placeholder


def calendar_text(payload, fetch_attachment=None):
    """The text/calendar part (or the .ics attachment) of an email, else ''."""
    found = []

    def walk(part):
        body = part.get('body') or {}
        if part.get('mimeType', '').startswith('text/calendar') or part.get('filename', '').lower().endswith('.ics'):
            if body.get('data'):
                found.append(_decode(body['data']))
            elif body.get('attachmentId') and fetch_attachment:
                try:
                    found.append(_decode(fetch_attachment(body['attachmentId']).get('data', '')))
                except Exception:  # noqa: BLE001 — the email is still read without it
                    pass
        for child in part.get('parts', []) or []:
            walk(child)
    walk(payload)
    return found[0] if found else ''


# Outlook writes Windows time zone names in invitations.
WINDOWS_ZONES = {'W. Europe Standard Time': 'Europe/Zurich', 'Romance Standard Time': 'Europe/Paris',
                 'Central Europe Standard Time': 'Europe/Budapest', 'Central European Standard Time': 'Europe/Warsaw',
                 'GMT Standard Time': 'Europe/London', 'Greenwich Standard Time': 'UTC', 'UTC': 'UTC',
                 'E. Europe Standard Time': 'Europe/Chisinau', 'FLE Standard Time': 'Europe/Kiev',
                 'Eastern Standard Time': 'America/New_York', 'Pacific Standard Time': 'America/Los_Angeles',
                 'Arabian Standard Time': 'Asia/Dubai', 'India Standard Time': 'Asia/Kolkata'}


def invite_start(ics, default_zone=None):
    """The invitation's start as ISO 8601 with offset, from its DTSTART (UTC "Z", a TZID, or floating), else None."""
    from zoneinfo import ZoneInfo
    unfolded = re.sub(r'\r?\n[ \t]', '', ics)
    event = unfolded.split('BEGIN:VEVENT', 1)[-1]
    if re.search(r'^METHOD:CANCEL', unfolded, re.M | re.I) or re.search(r'^STATUS:CANCELLED', event, re.M | re.I):
        return None  # a cancellation carries the old start too: no interview at that time
    match = re.search(r'^DTSTART(?:;([^:\r\n]*))?:(\d{8}T\d{6})(Z?)', event, re.M)
    if not match:
        return None
    params, stamp, utc = match.groups()
    moment = datetime.strptime(stamp, '%Y%m%dT%H%M%S')
    if utc:
        return moment.replace(tzinfo=timezone.utc).isoformat()
    from ..tz import zone_name
    default_zone = default_zone or zone_name()
    zone = (re.search(r'TZID="?([^";]+)"?', params or '') or [None, ''])[1]
    try:
        tz = ZoneInfo(WINDOWS_ZONES.get(zone, zone) or default_zone)
    except Exception:  # noqa: BLE001 — an unknown zone name: the owner's own zone
        from ..tz import local_zone
        try:
            tz = ZoneInfo(default_zone)
        except Exception:  # noqa: BLE001 — no time-zone database (Windows without tzdata)
            tz = local_zone()
    return moment.replace(tzinfo=tz).isoformat()


def body_text(payload):
    """The text/plain part, else (none, or a placeholder) the text/html part with tags removed."""
    plain_parts, html_parts = [], []

    def walk(part):
        mime, data = part.get('mimeType', ''), (part.get('body') or {}).get('data')
        if data and mime == 'text/plain':
            plain_parts.append(_decode(data))
        elif data and mime == 'text/html':
            html_parts.append(_decode(data))
        for child in part.get('parts', []) or []:
            walk(child)
    walk(payload)
    plain_text = '\n'.join(plain_parts).strip()
    text = re.sub(r'(?is)<(script|style).*?</\1>', ' ', '\n'.join(html_parts))
    text = re.sub(r'(?i)<br\s*/?>|</p>|</div>|</li>', '\n', text)
    html_text = re.sub(r'[ \t\xa0]+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', text))).strip()
    # Some senders put only a placeholder in the plain part ("No Text Available"): then the HTML is the email.
    placeholder = re.fullmatch(r'no (text|plain text)( available| version)?\.?', plain_text, re.I) or (
        len(plain_text) < PLACEHOLDER_MAX and len(html_text) > 2 * len(plain_text) + 20)
    if plain_text and not (placeholder and html_text):
        return plain_text
    return html_text


# ---------- sign-up confirmation (Apply with Claude) ----------

CODE = re.compile(r'(?<![\w/#-])(?=[A-Z0-9]*\d)[A-Z0-9]{4,8}(?![\w/-])')
CONFIRM_LINK = re.compile(r'https?://[^\s<>"\')\]]+', re.I)
CONFIRM_WORDS = re.compile(r'verif|confirm|activat|validat|register|token|code|otp', re.I)


def _ai_code(text):
    """The sign-up code among the email's code-like tokens, in any language ("Ihr Bestätigungscode", "認証コード"): AI picks one of the
    email's own tokens, so it can never invent a code. '' when none is a code, None without AI."""
    candidates = list(dict.fromkeys(CODE.findall(text)))[:10]
    if not candidates:
        return ''
    from ..ai import decide
    lines = {c: next((line for line in text.splitlines() if c in line), c)[:200] for c in candidates}
    found = decide.decide('signup-code', {c: f'{c}  (in: {lines[c]})' for c in candidates}, ('code', 'other'),
                          'A token from a sign-up email. code: the verification or confirmation code to type; other: an order number, a date, a reference.')
    return None if found is None else next((c for c in candidates if found.get(c) == 'code'), '')


def _ai_links(links):
    """The links that confirm or activate the new account, among an email's own links, in any language; None without AI."""
    links = [link.rstrip('.,;') for link in links][:15]
    if not links:
        return []
    from ..ai import decide
    found = decide.decide('signup-link', {link: link for link in links}, ('confirms_signup', 'other'),
                          'A link from an email a site sent after sign-up. confirms_signup: opening it verifies the email or activates the account; '
                          'other: anything else (privacy, unsubscribe, help, the home page).')
    return None if found is None else [link for link in links if found.get(link) == 'confirms_signup']


def confirmation(email):
    """The verification code and confirm links in one email: only what finishing a sign-up needs."""
    text = f"{email['subject']}\n{email['body']}"
    found = [link.rstrip('.,;') for link in CONFIRM_LINK.findall(email['body'])]
    code, links = _ai_code(text), _ai_links(found)   # AI decides, in any language
    if code is None:   # no AI: the English words, so a sign-up in progress is not left stuck (the only fallback kept here)
        near = (CODE.search(m.group(0)) for m in re.finditer(r'(?i)(code|pin|otp|password)[^\n]{0,60}', text))
        code = next((c.group(0) for c in near if c), '') or (lambda m: m.group(0) if m else '')(CODE.search(email['subject']))
    if links is None:
        links = [link for link in found if CONFIRM_WORDS.search(link)]
    return {'from': email['from'], 'subject': email['subject'], 'date': email['date'],
            'code': code or '', 'links': list(dict.fromkeys(links))[:3]}


def wait_for_confirmation(google, sender='', minutes=15, wait=180, every=10, sleep=time.sleep, to=''):
    """Newest email from the last `minutes` (from `sender`, a domain or address, if given) that has a
    code or a confirm link; polls for up to `wait` seconds while the site sends it. None if none came."""
    # `to`: the address the account was made with (a plus alias reaches only this site's mail): the exact way to find its confirmation.
    query = f'newer_than:1d{f" from:{sender}" if sender else ""}{f" to:{to}" if to else ""}'
    since = datetime.now(timezone.utc) - timedelta(minutes=minutes)
    for attempt in range(max(1, wait // every + 1)):
        for message_id in google.search(query, limit=10):
            email = google.message(message_id)
            try:
                recent = datetime.fromisoformat(email['date']) >= since
            except ValueError:
                recent = True
            found = confirmation(email) if recent else None
            if found and (found['code'] or found['links']):
                return found
        if attempt * every < wait:
            sleep(every)
    return None


# ---------- one-time sign-in ----------

def load_client(path):
    """(client id, client secret) from a Desktop-app client JSON (as downloaded, or the shared one)."""
    with open(os.path.expanduser(str(path))) as handle:
        client = json.load(handle).get('installed') or {}
    if not (client.get('client_id') and client.get('client_secret')):
        raise SystemExit(f'{path} is not a Desktop app client (no "installed" section)')
    return client['client_id'], client['client_secret']


def store(client_id, client_secret, refresh_token, production, github, parts=None):
    """Keychain entries (and, with github, the repository secrets) for a completed sign-in.
    A published app's sign-in doesn't expire; an app in "Testing" gets a sign-in date so the health
    check can warn before Google's 7-day limit."""
    values = {'GOOGLE_CLIENT_ID': client_id, 'GOOGLE_CLIENT_SECRET': client_secret, 'GOOGLE_REFRESH_TOKEN': refresh_token}
    for name, service in KEYCHAIN.items():
        secret_store.put(service, values[name])
    if parts is not None:   # what the user allowed; kept next to the token so every reader names a missing part (google_scopes.py)
        secret_store.put(google_scopes.SCOPES_SERVICE, ' '.join(parts))
        values['GOOGLE_SCOPES'] = ' '.join(parts)
    signed_in = '' if production else datetime.now(timezone.utc).isoformat(timespec='seconds')
    if signed_in:
        secret_store.put(AUTH_AT, signed_in)
    else:
        secret_store.delete(AUTH_AT)
    print('Stored in this computer\'s secret store:', ', '.join(KEYCHAIN.values()))
    if github:
        for name, value in values.items():
            subprocess.run(['gh', 'secret', 'set', name], input=value, text=True, check=True)
        if signed_in:
            subprocess.run(['gh', 'variable', 'set', 'JOB_PILOTTO_GOOGLE_AUTH_AT', '--body', signed_in], check=True)
        else:
            subprocess.run(['gh', 'variable', 'delete', 'JOB_PILOTTO_GOOGLE_AUTH_AT'], capture_output=True)
        print('Set GitHub secrets:', ', '.join(values))


REVOKE_URL = 'https://oauth2.googleapis.com/revoke'


def disconnect(opener=urllib.request.urlopen):
    """Sign out of Gmail and Calendar (owner, 7 Oct 2026: "there is no way for me to disconnect from Gmail"): Google is asked to revoke
    the sign-in (so it also leaves the Google account's "Third-party access"), then this computer's secret store forgets it. A revoke
    that fails (offline, already revoked) still forgets it here. Returns {'ok', 'revoked'}; never prints the token."""
    found = credentials()
    revoked = False
    if found:
        try:
            body = urllib.parse.urlencode({'token': found[2]}).encode()
            with opener(urllib.request.Request(e2e_url(REVOKE_URL), data=body, method='POST',
                                               headers={'Content-Type': 'application/x-www-form-urlencoded'}), timeout=20):
                revoked = True
        except Exception:  # noqa: BLE001 — forgotten here all the same; the Google account page can remove it by hand
            revoked = False
    for service in [*KEYCHAIN.values(), AUTH_AT, google_scopes.SCOPES_SERVICE]:
        secret_store.delete(service)
    return {'ok': True, 'revoked': revoked, 'was_connected': bool(found)}


def report():
    google = Google.from_env()
    if not google:
        raise SystemExit('Not connected: run `python3 -m src.sources.google auth --github`')
    now = datetime.now(timezone.utc)
    from datetime import timedelta
    if google_scopes.GMAIL in (google.scopes or google_scopes.SCOPE_URLS):
        print(f"Connected Gmail: {google.profile()['emailAddress']}")
        print(f"Job-related emails in the last 7 days: {len(google.search('newer_than:7d subject:(application OR applying OR interview)', 100))}")
    if google_scopes.CALENDAR in (google.scopes or google_scopes.SCOPE_URLS):
        print(f"Calendar events in the next 14 days: {len(google.events(now, now + timedelta(days=14)))}")
    if google_scopes.say(google.scopes):
        print(google_scopes.say(google.scopes))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest='command', required=True)
    auth = sub.add_parser('auth', help='one-time browser sign-in (the shared Jobadabra app unless you give your own)')
    auth.add_argument('--client-json', help='your own Desktop app client, as downloaded from Google Cloud')
    auth.add_argument('--client-id')
    auth.add_argument('--client-secret')
    auth.add_argument('--only', choices=list(google_scopes.SCOPE_URLS), help='reconnect asking only for this part (the earlier grant is kept)')
    auth.add_argument('--theme', choices=['light', 'dark'], default='', help="the app's theme, for the page the browser lands on")
    auth.add_argument('--github', action='store_true', help='also set the three GOOGLE_* repository secrets with gh')
    auth.add_argument('--production', action='store_true',
                      help="your own app is published ('In production'): the sign-in doesn't expire after 7 days")
    sub.add_parser('setup', help='guided: create your own Google app (project, APIs, consent screen, client) and sign in')
    sub.add_parser('check', help='show which account is connected and what it can see')
    sub.add_parser('status', help='one JSON line for the Mac app: connected, and which Gmail')
    sub.add_parser('disconnect', help='revoke the sign-in at Google and forget it on this computer (one JSON line)')
    verify = sub.add_parser('verify', help="wait for a sign-up's confirmation email; print its code and confirm link")
    verify.add_argument('--from', dest='sender', default='', help="sender domain or address, e.g. the employer's careers host")
    verify.add_argument('--to', default='', help='the address the account was made with (the mail was sent to it)')
    verify.add_argument('--minutes', type=int, default=15, help='only emails from the last N minutes (default 15)')
    verify.add_argument('--wait', type=int, default=180, help='keep checking for up to N seconds (default 180)')
    args = parser.parse_args(argv)
    if args.command == 'status':
        google = Google.from_env()
        try:
            print(json.dumps({'connected': True, 'email': google.account_email(), 'scopes': google_scopes.status(google.scopes)}
                             if google else {'connected': False}))
        except Exception as error:  # expired or revoked sign-in: the app offers Connect again
            print(json.dumps({'connected': False, 'error': str(error)[:200]}))
        return 0
    if args.command == 'disconnect':
        print(json.dumps(disconnect()))
        return 0
    if args.command == 'verify':
        google = Google.from_env()
        if not google:
            print('Gmail is not connected (python -m src.sources.google auth).', file=sys.stderr)
            return 2
        found = wait_for_confirmation(google, args.sender, args.minutes, args.wait, to=args.to)
        print(json.dumps(found or {'error': 'no confirmation email yet'}))
        return 0 if found else 1
    if args.command == 'setup':
        from . import google_setup
        return google_setup.run()
    if args.command == 'auth':
        production = args.production
        if args.client_json:
            args.client_id, args.client_secret = load_client(args.client_json)
        elif not (args.client_id or args.client_secret):
            if not SHARED_CLIENT.is_file():
                parser.error('the shared Jobadabra Google app is only bundled with the Mac app; '
                             'run `python -m src.sources.google setup` to use your own Google app instead')
            args.client_id, args.client_secret = load_client(SHARED_CLIENT)
            production = True  # the shared app is published: no 7-day expiry
            print('Using the shared Jobadabra Google app (read-only Gmail and Calendar). '
                  'Google may say it is unverified: Advanced → Go to Jobadabra.')
        if not (args.client_id and args.client_secret):
            parser.error('give --client-json, or both --client-id and --client-secret, or nothing for the shared app')
        only = (args.only,) if args.only else None
        sign_in = authorize(args.client_id, args.client_secret, only=only, theme=args.theme) if (only or args.theme) \
            else authorize(args.client_id, args.client_secret)
        # A reconnect for one part keeps the part allowed earlier (Google's include_granted_scopes keeps its grant too).
        parts = tuple(dict.fromkeys([*(google_scopes.from_env(_keychain) or ()), *sign_in.scopes])) if only else sign_in.scopes
        store(args.client_id, args.client_secret, sign_in.refresh_token, production, args.github, parts)
    report()
    return 0


if __name__ == '__main__':
    sys.exit(main())
