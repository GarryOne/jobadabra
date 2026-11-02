"""`python -m src.stores call <entity> <method> '<json kwargs>'`: one store method, JSON out on stdout.

How the desktop reaches the active store without a second copy of any adapter (desktop/lib/store/*): the store is
the one `open_stores()` picks from the environment (JOBADABRA_STORE). Only data methods: the move (`put`) and
writing raw bytes are refused; `applications attach` takes a `path` instead (attach_file: a file inside the app's own folder). `applications files` reads a job's files as base64 ({name, content_type, size,
data}); a file over FILE_CAP (or past TOTAL_CAP for the job) comes with data null and too_large true, so a screen can
say it is there. Exit 2 on a refused or unknown call, 1 when the method raised (its error as {"error": ...}).
Guarded by tests/test_store_cli.py.
"""
import base64
import json
import os
import stat
import sys
from pathlib import Path

from . import base, job_page, open_stores

ENTITIES = ('applications', 'events', 'matches', 'interviews', 'insights', 'employers', 'agent_runs', 'cron_runs',
            'texts')
REFUSED = {'put', 'attach'}
FILE_CAP = 8 * 1024 * 1024     # one file, before base64
TOTAL_CAP = 24 * 1024 * 1024   # one job's files together


def encoded_files(files):
    """[(name, bytes, content_type)] → JSON-able dicts, the bytes as base64 while they fit the caps."""
    found, total = [], 0
    for name, data, content_type in files:
        size = len(data)
        fits = size <= FILE_CAP and total + size <= TOTAL_CAP
        total += size if fits else 0
        found.append({'name': name, 'content_type': content_type or 'application/octet-stream', 'size': size,
                      'data': base64.b64encode(data).decode('ascii') if fits else None, 'too_large': not fits})
    return found


def attach_file(stores, kwargs, env=None):
    """`applications attach` {app_id, name, content_type, path}: the bytes are read from `path`, which must be a file inside the app's
    folder (the parent of JOBADABRA_DATA_DIR, where the app keeps its tailored CVs), at most FILE_CAP. The desktop's way to keep a
    file it made (lib/store/files.js attachToJob); no other path and no raw bytes."""
    env = os.environ if env is None else env
    data_dir = env.get('JOBADABRA_DATA_DIR')
    if not data_dir:
        raise PermissionError('attach needs the app folder (JOBADABRA_DATA_DIR)')
    # Both resolved first (os.path.realpath: symlinks and ../ followed), then the file must still be inside the folder and a regular file.
    root = Path(os.path.realpath(data_dir)).parent
    path = Path(os.path.realpath(str(kwargs.get('path') or '')))
    if root not in path.parents or not stat.S_ISREG(os.stat(path).st_mode if path.exists() else 0):
        raise PermissionError('attach reads only a file inside the app folder')
    if path.stat().st_size > FILE_CAP:
        raise PermissionError(f'file too large to attach ({path.stat().st_size} bytes)')
    return stores.applications.attach(str(kwargs['app_id']), str(kwargs.get('name') or path.name), path.read_bytes(),
                                      str(kwargs.get('content_type') or 'application/octet-stream'))


def call(stores, entity, method, kwargs):
    if (entity, method) == ('applications', 'attach') and 'path' in kwargs and set(kwargs) <= {'app_id', 'name', 'content_type', 'path'}:
        return attach_file(stores, kwargs)
    if (entity, method) == ('job_page', 'read') and set(kwargs) == {'app_id'}:
        return job_page.read(stores, kwargs['app_id'])
    if entity not in ENTITIES or method.startswith('_') or method in REFUSED:
        raise PermissionError(f'not callable: {entity}.{method}')
    protocol = getattr(base, ''.join(part.title() for part in entity.split('_')))
    if not hasattr(protocol, method):
        raise PermissionError(f'not callable: {entity}.{method}')
    result = getattr(getattr(stores, entity), method)(**kwargs)
    if (entity, method) == ('applications', 'files'):
        return encoded_files(result)
    return list(result) if isinstance(result, tuple) else result


def main(argv=None, out=sys.stdout):
    argv = sys.argv[1:] if argv is None else argv
    if len(argv) not in (3, 4) or argv[0] != 'call':
        print(__doc__.splitlines()[0], file=sys.stderr)
        return 2
    _, entity, method, *rest = argv
    try:
        kwargs = json.loads(rest[0]) if rest else {}
        stores = open_stores()
        try:
            result = call(stores, entity, method, kwargs)
        except PermissionError as refused:
            print(json.dumps({'error': str(refused)}), file=out)
            return 2
    except Exception as error:  # the caller shows it; nothing is swallowed
        print(json.dumps({'error': f'{type(error).__name__}: {error}'}), file=out)
        return 1
    print(json.dumps({'result': result}, default=str), file=out)
    return 0


if __name__ == '__main__':
    sys.exit(main())
