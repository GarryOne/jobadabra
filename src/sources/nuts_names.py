"""The name of a NUTS area for its code (BG411 -> "Sofia (stolitsa)"), from Eurostat's official table: a public fact, fetched once, kept in
data/nuts_names.json and checked before it is used (owner/6e, 27 Oct 2026: code fetches and validates; no AI names a code). Read by src/sources/eures.py,
whose jobs carry only a NUTS code. Without the table, or for a code it lacks, the name is "" and the caller says the country only. Tests: tests/test_nuts_names.py."""
import csv
import io
import json
import re
import threading
import urllib.request

from ..paths import DATA

URL = 'https://gisco-services.ec.europa.eu/distribution/v2/nuts/csv/NUTS_AT_2021.csv'   # every country's NUTS 2021 codes in one file (~90 KB)
STORE = DATA / 'nuts_names.json'
CODE = re.compile(r'[A-Z]{2}[0-9A-Z]{1,3}')
MIN_ROWS = 1000   # fewer: a page that is not the table (an error page, a cut file) is never kept
LOCK = threading.Lock()
_loaded = {}


def parse(text):
    """{code: Latin name} from the table's CSV; {} when it is not the table (no NUTS_ID/NAME_LATN columns, or fewer than MIN_ROWS valid rows)."""
    rows = csv.DictReader(io.StringIO(text))
    table = {row['NUTS_ID'].strip().upper(): row['NAME_LATN'].strip() for row in rows
             if row.get('NUTS_ID') and row.get('NAME_LATN') and CODE.fullmatch(row['NUTS_ID'].strip().upper()) and row['NAME_LATN'].strip()}
    return table if len(table) >= MIN_ROWS else {}


def _fetch():
    from . import ats, host_pace
    request = urllib.request.Request(URL, headers={'User-Agent': ats.USER_AGENT, 'Accept': 'text/csv'})
    with host_pace.open(request, 20) as response:
        return parse(response.read().decode('utf-8-sig'))


def names(fetch=None):
    """{code: name}: the kept table, else one fetch kept for next time; {} when neither works (a failed fetch is tried again by the next search)."""
    with LOCK:
        if _loaded.get('table') is not None and _loaded.get('store') == str(STORE):
            return _loaded['table']
        table = {}
        try:
            kept = json.loads(STORE.read_text())
            table = kept if isinstance(kept, dict) and len(kept) >= MIN_ROWS else {}
        except (OSError, ValueError):
            pass
        if not table:
            try:
                table = (fetch or _fetch)()
            except Exception:  # noqa: BLE001 — no table is "country only", not a failed search
                table = {}
            if table:
                try:
                    STORE.parent.mkdir(parents=True, exist_ok=True)
                    STORE.write_text(json.dumps(table, ensure_ascii=False, sort_keys=True))
                except OSError:  # optional cache: fetched names still belong to this search
                    pass
        # Why (#2293): cache an empty result for this process too; every job otherwise repeats a failed 20-second fetch.
        _loaded.update(table=table, store=str(STORE))
        return table
