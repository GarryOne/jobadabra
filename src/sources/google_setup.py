"""Guided setup of your own Google app for Jobadabra (`python -m src.sources.google setup`).

Most people should use the shared Jobadabra app instead (`python -m src.sources.google auth --github`:
one browser consent). This is for developers who want their own Google Cloud project. It does
everything the command line can, and walks you through the three console pages it can't:

1. gcloud (signed in with the Google account whose mail Jobadabra should read) creates the project
   and enables the Gmail and Calendar APIs.
2. Console, Branding: app name, your email, audience External.
3. Optional: a public privacy-policy gist (with gh) so you can publish the app, which removes Google's
   7-day sign-in limit for apps in "Testing". Otherwise you're added as a test user.
4. Console, Clients: create a Desktop app client and click Download JSON. The file is picked up from
   ~/Downloads automatically.
5. Browser sign-in; the token goes to the Keychain and, with gh, to the repository secrets.
"""
import glob
import os
import secrets
import shutil
import string
import subprocess
import time
import webbrowser
from pathlib import Path

from . import google

PRIVACY_TEMPLATE = Path(__file__).resolve().parents[2] / 'docs' / 'google-privacy-policy-template.md'
CONSOLE = 'https://console.cloud.google.com'
DOWNLOAD_WAIT_SECONDS = 600


def say(text=''):
    print(text, flush=True)


def ask(prompt, default=''):
    answer = input(f'{prompt}{f" [{default}]" if default else ""}: ').strip()
    return answer or default


def yes(prompt, default=True):
    answer = input(f"{prompt} [{'Y/n' if default else 'y/N'}]: ").strip().lower()
    return default if not answer else answer.startswith('y')


def pause(url, what):
    say(f'\n→ {what}\n  {url}')
    webbrowser.open(url)
    input('  Press Return when done… ')


def gcloud(*args, account):
    return subprocess.run(['gcloud', *args, f'--account={account}'], capture_output=True, text=True)


def project_id():
    return 'jobadabra-' + ''.join(secrets.choice(string.ascii_lowercase + string.digits) for _ in range(6))


def newest_client_file(since, folder='~/Downloads'):
    """The newest client_secret_*.json downloaded after `since` (a timestamp), or None."""
    files = [f for f in glob.glob(os.path.join(os.path.expanduser(folder), 'client_secret_*.json'))
             if os.path.getmtime(f) >= since]
    return max(files, key=os.path.getmtime) if files else None


def wait_for_client_file(since, timeout=DOWNLOAD_WAIT_SECONDS, poll=2):
    deadline = time.time() + timeout
    while time.time() < deadline:
        found = newest_client_file(since)
        if found:
            return found
        time.sleep(poll)
    return None


def run():
    say('Your own Google app for Jobadabra (read-only Gmail and Calendar).\n'
        'Tip: the shared Jobadabra app needs none of this: python3 -m src.sources.google auth --github\n')
    if not shutil.which('gcloud'):
        say('gcloud is needed for steps 1-2: https://cloud.google.com/sdk/docs/install (or do them in the console; '
            'see README → Gmail and Calendar setup).')
        return 1
    account = ask('Google account whose Gmail Jobadabra should read', os.getenv('JOB_PILOTTO_GOOGLE_ACCOUNT', ''))
    if not account:
        return 1
    known = subprocess.run(['gcloud', 'auth', 'list', '--format=value(account)'], capture_output=True, text=True).stdout
    if account not in known.split():
        say(f'Signing gcloud in as {account} (your default gcloud account stays as it is)…')
        subprocess.run(['gcloud', 'auth', 'login', account], check=False)
    project = ask('Project ID to create', project_id())
    say(f'\n1. Creating project {project} and enabling the Gmail and Calendar APIs…')
    created = gcloud('projects', 'create', project, '--name=Jobadabra', account=account)
    if created.returncode and 'already exists' not in created.stderr:
        say(created.stderr.strip())
        return 1
    enabled = gcloud('services', 'enable', 'gmail.googleapis.com', 'calendar-json.googleapis.com',
                     f'--project={project}', account=account)
    if enabled.returncode:
        say(enabled.stderr.strip())
        return 1
    say('   done.')

    pause(f'{CONSOLE}/auth/overview?project={project}',
          f'2. Consent screen: Get started → App name "Jobadabra", support email {account}, audience External, '
          f'contact email {account}, accept the policy → Create.')

    published = False
    if shutil.which('gh') and PRIVACY_TEMPLATE.exists() and yes(
            '3. Publish the app so the sign-in never expires? This creates a public privacy-policy gist from '
            'docs/google-privacy-policy-template.md (no personal data)'):
        done = subprocess.run(['gh', 'gist', 'create', '--public', '-d', 'Jobadabra — privacy policy',
                               str(PRIVACY_TEMPLATE)], capture_output=True, text=True)
        url = done.stdout.strip().splitlines()[-1] if done.returncode == 0 else ''
        if url:
            say(f'   Privacy policy: {url}')
            pause(f'{CONSOLE}/auth/branding?project={project}',
                  f'   Branding: set Application home page and privacy policy link to {url}, add authorised domain '
                  'github.com → Save.')
            pause(f'{CONSOLE}/auth/audience?project={project}', '   Audience: Publish app → Confirm ("In production").')
            published = True
        else:
            say(f'   Could not create the gist ({done.stderr.strip()[:120]}); falling back to a test user.')
    if not published:
        pause(f'{CONSOLE}/auth/audience?project={project}',
              f'3. Audience → Test users → Add users → {account} → Save. (In "Testing", Google expires the sign-in '
              'after 7 days; the daily health check reminds you.)')

    started = time.time()
    pause(f'{CONSOLE}/auth/clients/create?project={project}',
          '4. Clients → Create client: type "Desktop app", name "Jobadabra" → Create → Download JSON.')
    path = newest_client_file(started) or wait_for_client_file(started, timeout=60)
    if not path:
        path = ask('Could not find the downloaded client_secret_….json; its path')
    client_id, client_secret = google.load_client(path)
    say(f'   Using {path}')

    say('\n5. Signing in: a Google tab opens. On "Google hasn\'t verified this app": Advanced → Go to Jobadabra, '
        'tick both read-only permissions → Continue.')
    sign_in = google.authorize(client_id, client_secret)
    google.store(client_id, client_secret, sign_in.refresh_token, production=published, github=bool(shutil.which('gh')), parts=sign_in.scopes)
    google.report()
    say('\nDone. Keep the client file somewhere safe; to sign in again later: '
        f'python3 -m src.sources.google auth --client-json {path} --github' + (' --production' if published else ''))
    return 0
