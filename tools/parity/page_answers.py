"""Each careers/job-site list's answers on the cached real pages (tools/meanings_parity.py runs it)."""
import json, os, sys
repo, out = sys.argv[1], sys.argv[2]
sys.path.insert(0, repo)
os.environ.update({'JOB_PILOTTO_DATA_DIR': os.environ['RD'] + '/data', 'JOB_PILOTTO_CONFIG_DIR': os.environ['RD'] + '/config', 'JOB_PILOTTO_FOLLOW_APP': '0'})
from src.sources import boards, careers, visits
lists = {n: getattr(careers, n) for n in ('CAREER_WORDS', 'JOB_PATH', 'NO_JOBS', 'STRONG_WORDS', 'JOB_HOST', 'NOT_JOBS', 'TITLE_LIKE', 'NOT_A_JOB')}
lists.update({'CAREER': boards.CAREER, 'JOBLIST': visits.JOBLIST, 'NOT_A_LIST': visits.NOT_A_LIST})
sys.path.insert(0, os.path.join(repo, 'tools'))
from app_data_dir import app_data_dir
cache = str(app_data_dir() / 'data' / 'discovery-cache')
res = {}
for name in sorted(os.listdir(cache)):
    try:
        text = open(os.path.join(cache, name), errors='ignore').read()[:200000]
    except (IsADirectoryError, OSError):
        continue
    res[name] = {n: [bool(rx.search(text)), len(rx.findall(text))] for n, rx in lists.items()}
json.dump(res, open(out, 'w'))
print(len(res), 'pages')
