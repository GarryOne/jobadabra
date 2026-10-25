"""Before an "AI instead of keyword lists" change ships: the owner's real search and data, AI off, on a baseline commit and on this tree;
any difference is printed (owner, 8 Oct 2026: "I'd like my experience as Swiss/english to not worsen by a bit"). Reads a COPY of the app's
data (never writes to it), no network, no AI.

    python3 tools/meanings_parity.py [baseline-rev]     default baseline: origin/main
Checks: the search's role kinds, tech or not, level skips, Swiss detection, Adzuna countries, pool tags, the employers a run reads, the kind
of every job title in jobs.sqlite (tools/parity/search_answers.py), and every careers/job-site list on the cached pages (page_answers.py)."""
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))
from app_data_dir import app_data_dir  # noqa: E402

APP = app_data_dir()


def run(repo, script, work, out):
    env = {'RD': str(work), 'PATH': '/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin', 'HOME': str(Path.home())}
    done = subprocess.run([sys.executable, '-I', str(ROOT / 'tools' / 'parity' / script), str(repo), str(out)], env=env, capture_output=True, text=True)
    if done.returncode:
        raise SystemExit(f'{script} failed on {repo}:\n{done.stderr[-1500:]}')
    return json.loads(out.read_text())


def main():
    base = sys.argv[1] if len(sys.argv) > 1 else 'origin/main'
    work = Path(tempfile.mkdtemp(prefix='jp-parity-'))
    (work / 'data').mkdir(); (work / 'config').mkdir()
    for name in ('search.json', 'preferences.json', 'sources.json', 'scout_seeds.json'):
        if (APP / 'config' / name).exists():
            shutil.copy(APP / 'config' / name, work / 'config' / name)
    for name in ('jobs.sqlite', 'employer_index.json', 'places.json', 'place_triage.json'):
        if (APP / 'data' / name).exists():
            shutil.copy(APP / 'data' / name, work / 'data' / name)
    old = work / 'baseline'
    subprocess.run(['git', 'worktree', 'add', '-q', '--detach', str(old), base], cwd=ROOT, check=True)
    differences = 0
    try:
        for script in ('search_answers.py', 'page_answers.py'):
            before, after = run(old, script, work, work / f'old-{script}.json'), run(ROOT, script, work, work / f'new-{script}.json')
            for key in sorted(set(before) | set(after)):
                if before.get(key) != after.get(key):
                    differences += 1
                    print(f'DIFF {script} {key}: {json.dumps(before.get(key), ensure_ascii=False)[:200]} -> {json.dumps(after.get(key), ensure_ascii=False)[:200]}')
    finally:
        subprocess.run(['git', 'worktree', 'remove', '--force', str(old)], cwd=ROOT)
        shutil.rmtree(work, ignore_errors=True)
    print('same answers on your real search and pages' if not differences else f'{differences} difference(s)')
    return 1 if differences else 0


if __name__ == '__main__':
    raise SystemExit(main())
