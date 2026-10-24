"""This computer's own secret store: the macOS Keychain (the `security` tool) or, on Windows, the
Credential Manager (through `keyring`, bundled with the Windows app). Elsewhere (CI, Linux) there is none:
reads return None and writes raise, so callers fall back to the environment.

A test run (JOB_PILOTTO_E2E) or a live-test twin (JOB_PILOTTO_TWIN) never reads or writes the real store: what it saves goes to the
run's own file (JOB_PILOTTO_ISOLATED_SECRETS, set by the app: desktop/lib/keychain.js), and reads see only that file. 8 Oct 2026: reads
were isolated but writes were not, so a local e2e run made a "new" job-site password and overwrote the owner's real one."""
import getpass
import json
import os
import subprocess
import sys

_REAL_RUN = subprocess.run   # a test that replaces these has a fake store; only the genuine ones can reach the owner's Keychain


def under_test():
    """True while a test suite runs this code (unittest, pytest, or the flag a harness sets)."""
    argv0 = (sys.argv[0] if sys.argv else '').replace(os.sep, '/')   # unittest's own runner renames it "python3.x -m unittest"
    return bool(os.getenv('JOB_PILOTTO_UNDER_TEST') or os.getenv('PYTEST_CURRENT_TEST')
                or ' -m unittest' in argv0 or argv0.endswith('unittest/__main__.py'))


def _reaches_real_store():
    """True when a write here would reach a real Keychain / Credential Manager (not a faked tool, and not a platform with no store)."""
    return subprocess.run is _REAL_RUN if sys.platform == 'darwin' else sys.platform == 'win32' and _keyring is _REAL_KEYRING


def _refuse_real_write(real):
    """24 Oct 2026: a test's refused-scope check wrote job-pilotto.google.scopes into the owner's real Keychain. A test never writes or
    deletes in the real store: it patches secret_store.put/delete, replaces subprocess.run / _keyring, or runs isolated (JOB_PILOTTO_E2E)."""
    if real and under_test():
        raise RuntimeError('A test tried to change the real secret store (Keychain / Credential Manager). Patch secret_store.put/delete or run isolated.')


def account():
    """The account name secrets are stored under: the login name, as the Keychain items always had."""
    return os.getenv('USER') or getpass.getuser()


def _keyring():
    if sys.platform != 'win32':
        return None
    try:
        import keyring
    except ImportError:
        return None
    return keyring


_REAL_KEYRING = _keyring


def isolated():
    """True in the end-to-end journey (the app sets JOB_PILOTTO_E2E) and in a live-test twin (JOB_PILOTTO_TWIN, desktop/lib/twin.js): both run on
    the owner's own Mac, whose store holds their real Google sign-in and Telegram bot, so they see none."""
    return bool(os.getenv('JOB_PILOTTO_E2E') or os.getenv('JOB_PILOTTO_TWIN'))


def _isolated_items():
    path = os.getenv('JOB_PILOTTO_ISOLATED_SECRETS')
    if not path:
        return path, {}
    try:
        with open(path, encoding='utf-8') as handle:
            return path, json.load(handle) or {}
    except (OSError, ValueError):
        return path, {}


def _isolated_save(path, items):
    if not path:
        return  # an isolated run without its own file keeps nothing, and never the real store
    os.makedirs(os.path.dirname(path) or '.', exist_ok=True)
    # Private to this user (13 Oct 2026: the file holds job-site passwords and was written 0644, readable by every account on the computer).
    with open(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), 'w', encoding='utf-8') as handle:
        json.dump(items, handle)
    os.chmod(path, 0o600)  # a file made earlier keeps its old mode otherwise


# What a live-test twin may READ from the owner's real store (owner, 10 Oct 2026: "let the twin use the original app Gmail connection"): the Google
# sign-in (read-only Gmail and Calendar), so the sign-up's confirmation mail can be found. Nothing else, and never a write (put/delete stay in the twin's file).
TWIN_MAY_READ = ('job-pilotto.google.client-id', 'job-pilotto.google.client-secret', 'job-pilotto.google.refresh-token')


def _twin_may_read(service):
    return bool(os.getenv('JOB_PILOTTO_TWIN')) and not os.getenv('JOB_PILOTTO_E2E') and service in TWIN_MAY_READ


def get(service, user=None):
    if isolated():
        own = (_isolated_items()[1].get(service) or {}).get('value') or None
        if own or not _twin_may_read(service):
            return own
    user = account() if user is None else user
    if sys.platform == 'darwin':
        result = subprocess.run(['security', 'find-generic-password', '-a', user, '-s', service, '-w'],
                                capture_output=True, text=True)
        return (result.stdout.strip() or None) if result.returncode == 0 else None
    store = _keyring()
    return (store.get_password(service, user) or None) if store else None


def put(service, value, user=None, label=None, comment=None):
    """comment: what the item is for, kept beside it (Keychain only; never a secret)."""
    user = account() if user is None else user
    if isolated():
        from datetime import datetime, timezone
        path, items = _isolated_items()
        items[service] = {'value': value, 'account': user, 'comment': comment or '', 'created': datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}
        _isolated_save(path, items)
        return
    _refuse_real_write(_reaches_real_store())
    if sys.platform == 'darwin':
        subprocess.run(['security', 'add-generic-password', '-U', '-a', user, '-s', service,
                        *(['-l', label] if label else []), *(['-j', comment] if comment else []), '-w', value], check=True)
        return
    store = _keyring()
    if not store:
        raise SystemExit('No secret store on this computer (macOS Keychain or Windows Credential Manager).')
    store.set_password(service, user, value)


def delete(service, user=None):
    user = account() if user is None else user
    if isolated():
        path, items = _isolated_items()
        if items.pop(service, None) is not None:
            _isolated_save(path, items)
        return
    _refuse_real_write(_reaches_real_store())
    if sys.platform == 'darwin':
        subprocess.run(['security', 'delete-generic-password', '-a', user, '-s', service], capture_output=True)
        return
    store = _keyring()
    if store:
        try:
            store.delete_password(service, user)
        except Exception:  # keyring.errors.PasswordDeleteError: nothing stored
            pass
