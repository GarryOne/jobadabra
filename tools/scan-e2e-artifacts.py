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


def secret_values(env):
    """Read named credentials in memory; unresolved names fail, short values are named and skipped."""
    if 'E2E_ARTIFACT_SECRET_NAMES' not in env:
        raise ValueError()
    names = {name.strip() for name in env['E2E_ARTIFACT_SECRET_NAMES'].splitlines() if name.strip()}
    if any(not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', name) for name in names):
        raise ValueError()
    # Why (31 Oct 2026, owner): a partial credential scan must never permit an upload.
    missing = sorted(name for name in names if not env.get(name))
    for name in missing:
        print(name)
    if missing:
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

    def report(self, name, location):
        """Never let a credential in a filename or exception escape through the diagnostic itself."""
        for value in self.values.values():
            location = location.replace(value, '[redacted]')
        print(f'{name}: {json.dumps(location, ensure_ascii=True)}')
        self.failed = True

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
            self.report('SCAN_ERROR', location)
            return
        stream.seek(0)
        with zipfile.ZipFile(stream) as archive:
            for entry in archive.infolist():
                if entry.is_dir():
                    continue
                member = f'{location}!/{entry.filename}'
                self.scan(io.BytesIO(entry.filename.encode()), member)
                with archive.open(entry) as contents:
                    # ZipExtFile is seekable; nested ZIPs stay in memory, never extracted to disk.
                    self.scan(contents, member, entry.filename.lower().endswith('.zip'), depth + 1)

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
                        self.report('SCAN_ERROR', str(file))
                    elif file.is_file():
                        self.files += 1
                        try:
                            with file.open('rb') as stream:
                                self.scan(stream, str(file), file.suffix.lower() == '.zip')
                        except Exception:
                            self.report('SCAN_ERROR', str(file))


def main():
    """Exit nonzero on any hit or inspection failure, with no exception payload or credential output."""
    try:
        values = secret_values(os.environ)
        if values is None:
            return 1
        scanner = Scanner(values)
        patterns = sys.argv[1:] or os.environ.get('E2E_ARTIFACT_PATHS', '').splitlines()
        if not patterns:
            raise ValueError()
        scanner.paths(patterns)
        if scanner.failed:
            return 1
        print(f'Artifact secret scan clean: {scanner.files} file(s)')
        return 0
    except Exception:
        print('SCAN_ERROR: artifact inspection failed; upload blocked')
        return 1


if __name__ == '__main__':
    sys.exit(main())
