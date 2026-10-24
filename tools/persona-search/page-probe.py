"""Offline probe of one saved job-list page, no AI and no network: what the free readers find on it (JSON-LD jobs, job-page links, the next pages).
Usage: python3 tools/persona-search/page-probe.py <saved page.html> <the page's address>
24 Oct 2026: the Zagreb and Tallinn gaps (cards read by link, ?offset= and /stranica/N paging) were found by running these on saved pages in seconds, not by 20-minute checks."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from src.sources import careers, careers_parse  # noqa: E402


def probe(markup, url):
    return {'jsonld_jobs': len(careers.jsonld_jobs(markup, url) or []), 'has_job_ids': careers_parse.has_job_ids(markup, url),
            'job_links': careers.job_links(markup, url)[:5], 'job_links_n': len(careers.job_links(markup, url)), 'next_pages': careers_parse.page_links(url, markup)}


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    for key, value in probe(Path(sys.argv[1]).read_text(encoding='utf-8', errors='ignore'), sys.argv[2]).items():
        print(f'{key}: {value}')
