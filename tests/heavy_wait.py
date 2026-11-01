"""Helper of the heavy-lock tests (not a test module): wait on the lock's OWN state for one run (its pid in a slot or in a queue ticket), never on a count of files or a fixed nap;
on a timeout, fail with the evidence (the lock's status, its books with live/gone pids, each run's exit code and stderr). Guarded by tests/test_heavy_lock_waits.py.
12 Oct 2026: counting files made the required python check red 5+ times ("only 1 of 2 runs are in the lock's books", "nobody waits", a younger run first): a slot without its pid yet,
or a run's slot plus its own ticket, counted as two runs, so a test went on before the next run had queued."""
import os
import subprocess
import time
from pathlib import Path

LOCK = Path(__file__).resolve().parent.parent / 'tools' / 'heavy-lock.sh'


def _lines(path):
    try:
        return Path(path).read_text().split('\n')
    except OSError:
        return None


def _tickets(root):
    queue = Path(root) / 'queue'
    return sorted(queue.glob('*')) if queue.is_dir() else []


def where(heavy_dir, pid):
    """Where the lock's books have run `pid`: 'holds' (a slot names it), 'loadwait' (its ticket says it waits for the machine), 'waits' (its ticket), or None.
    Only whole files count: a slot or ticket still being written names no run yet."""
    pid, root = str(pid), Path(heavy_dir)
    for slot in root.glob('lock*'):
        lines = _lines(slot / 'pid')
        if lines and lines[0].strip() == pid:
            return 'holds'
    for ticket in _tickets(root):
        lines = _lines(ticket)
        if lines and lines[0].split()[:1] == [pid]:
            return 'loadwait' if len(lines) > 1 and lines[1] == 'loadwait' else 'waits'
    return None


def registered(heavy_dir):
    """How many distinct runs the books name (slots and tickets with a pid written); a run that holds and still has its ticket is one run."""
    root = Path(heavy_dir)
    runs = set()
    for path in [p / 'pid' for p in root.glob('lock*')] + _tickets(root):
        lines = _lines(path)
        word = lines[0].split()[:1] if lines else []
        runs |= set(word)
    return len(runs)


def _alive(pid):
    try:
        os.kill(int(pid), 0)
        return 'alive'
    except (OSError, ValueError):
        return 'gone'


def books(heavy_dir):
    """What the lock's folder holds, for a failure message: each slot (pid, what) and ticket (first two lines), with whether its pid still lives."""
    root, out = Path(heavy_dir), []
    for slot in sorted(root.glob('lock*')):
        pid = ((_lines(slot / 'pid') or [''])[0]).strip()
        out.append(f'{slot.name}: pid={pid or "(not written)"} ({_alive(pid) if pid else "-"}) what={((_lines(slot / "what") or ["?"])[0])!r}')
    for ticket in _tickets(root):
        lines = _lines(ticket) or ['']
        pid = (lines[0].split() or [''])[0]
        out.append(f'queue/{ticket.name}: {lines[0]!r} state={(lines[1] if len(lines) > 1 else "")!r} ({_alive(pid) if pid else "being written"})')
    return '; '.join(out) or 'empty'


def status(env):
    """`heavy-lock.sh status` for this test's lock folder (env carries JOBADABRA_HEAVY_DIR), as evidence."""
    try:
        return subprocess.run(['bash', str(LOCK), 'status'], env=env, capture_output=True, text=True, timeout=20).stdout.strip()
    except (OSError, subprocess.SubprocessError) as e:
        return f'(status failed: {e})'


def runs_said(procs):
    """Each run: pid, exit code or 'running', and its stderr once it has ended (a running run's pipe is not read: that would block)."""
    out = []
    for proc in procs:
        code = proc.poll()
        err = ''
        if code is not None and proc.stderr and not proc.stderr.closed:
            try:
                err = proc.communicate(timeout=5)[1] or ''
            except (subprocess.SubprocessError, ValueError):
                err = '(stderr unreadable)'
        err_path = getattr(proc, 'err_path', None)
        if err_path:
            err = (_lines(err_path) and Path(err_path).read_text()) or ''
        out.append(f'pid {proc.pid}: {"running" if code is None else f"exit {code}"}{": " + err.strip()[-800:] if err.strip() else ""}')
    return '\n  '.join(out)


def evidence(heavy_dir, procs=(), env=None):
    text = f'books: {books(heavy_dir)}'
    if env:
        text += f'\nstatus:\n{status(env)}'
    if procs:
        text += f'\nruns:\n  {runs_said(procs)}'
    return text


def wait_in_books(heavy_dir, proc, states=('holds', 'waits', 'loadwait'), timeout=90, procs=(), env=None):
    """Wait until run `proc` (its pid) is in the lock's books in one of `states`; fail at once if it ended first. procs/env: the other runs and the lock's env, for the evidence.
    'waits' means queued: its place in line is fixed, NOT that it has looked at the lock yet. For what a run SAYS ("waits", "got the lock after"), use wait_said."""
    deadline = time.monotonic() + timeout
    while True:
        state = where(heavy_dir, proc.pid)
        if state in states:
            return state
        ended = proc.poll() is not None
        if ended or time.monotonic() >= deadline:
            raise AssertionError(f'run pid {proc.pid} is not {"/".join(states)} in the lock\'s books ({state or "absent"}) '
                                 f'{"and it ended" if ended else f"after {timeout}s"}\n{evidence(heavy_dir, [proc, *[p for p in procs if p is not proc]], env)}')
        time.sleep(0.05)   # clock: a poll of the lock's state


def _ticket_stamp(heavy_dir, pid):
    """(inode, mtime_ns) of run `pid`'s queue ticket, None when it has none: every poll of a waiter rewrites its ticket aside and renames it over, so the stamp changes once per poll."""
    for ticket in _tickets(heavy_dir):
        lines = _lines(ticket)
        if lines and lines[0].split()[:1] == [str(pid)]:
            try:
                st = ticket.stat()
            except OSError:
                return None
            return (st.st_ino, st.st_mtime_ns)
    return None


def wait_read_queue(heavy_dir, procs, timeout=90, env=None):
    """Call it once the LAST waiter is queued and before the holder is released: waits until every queued run has polled again, i.e. its next look at the queue includes every ticket.
    'waits' only says a ticket exists, not that the others have read it: a waiter whose poll began before the last ticket and reached its take after the holder ended took the lock
    ahead of a higher class (CI, 15 Oct 2026: ['holder', 'pool', 'proof', 'explore']; reproduced 4 of 90 under load 400). Each poll marks its ticket (new inode) before it reads the queue."""
    seen = {p.pid: _ticket_stamp(heavy_dir, p.pid) for p in procs}
    deadline = time.monotonic() + timeout
    while True:
        waiting = [pid for pid, stamp in seen.items() if stamp is not None and _ticket_stamp(heavy_dir, pid) == stamp]
        if not waiting:
            return
        if time.monotonic() >= deadline:
            raise AssertionError(f'runs {waiting} did not poll the queue again after {timeout}s\n{evidence(heavy_dir, procs, env)}')
        time.sleep(0.05)   # clock: a poll of the lock's state


def wait_said(err_path, text, proc=None, timeout=90, why=lambda: ''):
    """Wait until a run's stderr file says `text` (the lock's own words: "waits", "runs"); fail at once if the run ended without saying it."""
    deadline = time.monotonic() + timeout
    while True:
        said = (_lines(err_path) and Path(err_path).read_text()) or ''
        if text in said:
            return said
        ended = proc is not None and proc.poll() is not None
        if ended or time.monotonic() >= deadline:
            raise AssertionError(f'{err_path} never said {text!r} ({"the run ended" if ended else f"{timeout}s"}): {said[-800:]!r}\n{why()}')
        time.sleep(0.05)   # clock: a poll of what the run said


def gate_loop(path, nap=0.05, or_path=None, seconds=120):
    """The ONE shell loop of the lock tests that waits for a gate file the test creates; it ends by itself after `seconds` (15 Oct 2026: ~136 bare `while [ ! -f gate ]` loops were orphaned for days
    when runs were cut off, their temp dir gone, and drove the Mac's load to ~400). tests/test_heavy_lock_waits.py fails on a bare one."""
    more = f' && [ ! -f {Path(or_path).as_posix()} ]' if or_path else ''
    return f'e=$((SECONDS+{seconds})); while [ ! -f {Path(path).as_posix()} ]{more} && [ $SECONDS -lt $e ]; do sleep {nap}; done'


def gated(trace, name, gate_dir):
    """A run body that logs "+name", waits until the test releases it (a file gate_dir/<name>, or gate_dir/all), logs "-name": no fixed naps, so the test takes as long as the lock needs."""
    gate = Path(gate_dir).as_posix()
    wait = gate_loop(f'{gate}/{name}', 0.1, f'{gate}/all')
    return f'echo +{name} >> {Path(trace).as_posix()}; {wait}; echo -{name} >> {Path(trace).as_posix()}'


def release(gate_dir, *names):
    Path(gate_dir).mkdir(parents=True, exist_ok=True)
    for name in names or ('all',):
        (Path(gate_dir) / name).write_text('go')


def wait_trace(trace, n, timeout=90, why=lambda: ''):
    """Wait until the trace has n words (starts and ends); why() adds the evidence to a failure."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            if len(Path(trace).read_text().split()) >= n:
                return
        except OSError:
            pass
        time.sleep(0.1)   # clock: a poll of the trace
    raise AssertionError(f'the trace has fewer than {n} words after {timeout}s: {Path(trace).read_text().split() if Path(trace).exists() else None}\n{why()}')
