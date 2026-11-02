#!/usr/bin/env python3
"""Fail closed before artifact upload on CI credential values, including nested ZIP members; never emit values."""
import glob
import io
import json
import os
from pathlib import Path
import re
import sys
import zipfile


def annotation(why):
    """The one line GitHub shows on the job for a blocked upload: names and file names only, never a value; % and line breaks escaped so it stays one line.
    Why (2 Nov 2026, owner on beta 18: "why the errors are not more descriptive, but saying only: "Process completed with exit code 1." ?" → "Keep failing, say why")."""
    return '::error title=Artifact upload blocked::' + why.replace('%', '%25').replace('\r', '%0D').replace('\n', '%0A')


def secret_values(env):
    """Read named credentials in memory; unresolved names fail, short values are named and skipped."""
    if 'E2E_ARTIFACT_SECRET_NAMES' not in env:
        print(annotation('E2E_ARTIFACT_SECRET_NAMES is not set in this step, so the credentials to look for are unknown: nothing is uploaded'))
        return None
    names = {name.strip() for name in env['E2E_ARTIFACT_SECRET_NAMES'].splitlines() if name.strip()}
    if any(not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', name) for name in names):
        print(annotation('E2E_ARTIFACT_SECRET_NAMES holds a line that is not a variable name: nothing is uploaded'))
        return None
    # Why (31 Oct 2026, owner): a partial credential scan must never permit an upload.
    missing = sorted(name for name in names if not env.get(name))
    if missing:
        print(annotation(f'{", ".join(missing)} had no value in this job (the step that sets it failed or did not run), so a scan would be partial: nothing is uploaded'))
        return None
    for name in sorted(names):
        if len(env[name]) < 8:
            print(f'SKIPPED_SHORT: {name}')
    return {name: env[name] for name in names if len(env[name]) >= 8}


class Scanner:
    """Scan bytes and compressed members without extraction; diagnostics contain only names and redacted paths."""
    def __init__(self, values):
        self.values = values
        self.needles = [(name, needle) for name, value in values.items() for needle in
                        {value.encode(), json.dumps(value)[1:-1].encode(), value.encode('utf-16-le')}]
        self.overlap = max((len(needle) for _, needle in self.needles), default=1) - 1
        self.failed = False
        self.files = 0
        self.blocking = []   # 'NAME in file' for each fatal finding, for the annotation

    def report(self, name, location, *, fatal=True):
        """Never let a credential in a filename or exception escape through the diagnostic itself."""
        for value in self.values.values():
            location = location.replace(value, '[redacted]')
        separator = ': ' if fatal else ', '
        print(f'{name}{separator}{json.dumps(location, ensure_ascii=True)}')
        if fatal:
            self.failed = True
            self.blocking.append(f'{name} in {location}')

    def scan(self, stream, location, zipped=False, depth=0):
        """Read complete streams in bounded chunks and recursively inspect every ZIP entry."""
        tail = b''
        found = set()
        while chunk := stream.read(1024 * 1024):
            data = tail + chunk
            for name, needle in self.needles:
                if name not in found and needle in data:
                    self.report(name, location)
                    found.add(name)
            tail = data[-self.overlap:] if self.overlap else b''
        stream.seek(0)
        if not zipped and stream.read(4) not in (b'PK\x03\x04', b'PK\x05\x06'):
            return
        if depth >= 8:
            raise ValueError('ZIP nesting limit')
        stream.seek(0)
        if isinstance(stream, zipfile.ZipExtFile):
            # Why (31 Oct 2026, personas blob-report scans hung 17+ min): every backward seek on a ZipExtFile decompresses from
            # its start, and ZipFile seeks once per member; one read into memory makes it linear (still never written to disk).
            stream = io.BytesIO(stream.read())
        with zipfile.ZipFile(stream) as archive:
            for entry in archive.infolist():
                if entry.is_dir():
                    continue
                member = f'{location}!/{entry.filename}'
                self.scan(io.BytesIO(entry.filename.encode()), member)
                with archive.open(entry) as contents:
                    # Nested ZIPs stay in memory (buffered once above), never extracted to disk.
                    self.scan(contents, member, entry.filename.lower().endswith('.zip'), depth + 1)

    def drop_unreadable(self, file):
        """Exclude an unscannable upload file; inability to remove it still blocks the upload."""
        try:
            file.unlink()
        except OSError:
            self.report('SCAN_ERROR', str(file))
            return
        self.report('not uploaded: unreadable', str(file), fatal=False)

    def paths(self, patterns):
        """Scan upload paths (including globs); missing paths have nothing to upload."""
        for pattern in patterns:
            if not pattern.strip():
                continue
            for match in glob.glob(os.path.expanduser(pattern.strip()), recursive=True):
                root = Path(match)
                paths = root.rglob('*') if root.is_dir() else [root]
                for file in paths:
                    if file.is_symlink():
                        self.drop_unreadable(file)
                    elif file.is_file():
                        try:
                            with file.open('rb') as stream:
                                self.scan(stream, str(file), file.suffix.lower() == '.zip')
                            self.files += 1
                        except Exception:
                            self.drop_unreadable(file)


def main():
    """Block credential hits or incomplete scans; unreadable files must be removed before upload."""
    try:
        values = secret_values(os.environ)
        if values is None:
            return 1
        scanner = Scanner(values)
        patterns = sys.argv[1:] or os.environ.get('E2E_ARTIFACT_PATHS', '').splitlines()
        if not patterns:
            print(annotation('no artifact paths to scan were given (E2E_ARTIFACT_PATHS is empty): nothing is uploaded'))
            return 1
        scanner.paths(patterns)
        if scanner.failed:
            shown = scanner.blocking[:3] + ([f'{len(scanner.blocking) - 3} more in the step log'] if len(scanner.blocking) > 3 else [])
            print(annotation(f'a credential value, or a file that could not be read or removed: {"; ".join(shown)}. Nothing is uploaded'))
            return 1
        print(f'Artifact secret scan clean: {scanner.files} file(s)')
        return 0
    except Exception as error:
        print('SCAN_ERROR: artifact inspection failed; upload blocked')
        print(annotation(f'artifact inspection failed ({type(error).__name__}): nothing is uploaded'))   # the type only: a message may quote file content
        return 1


if __name__ == '__main__':
    sys.exit(main())
