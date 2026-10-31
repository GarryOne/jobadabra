"""The test builds the release pruning keeps: the ones the gate approved for each platform's beta testers (moved out of tools/canary_promote.py to stay under 500 lines, 31 Oct 2026)."""
import re


def approved_tags(api_releases):
    """Tags whose release notes carry the gate's `Beta-approved:` line (tools/beta-approve.sh), from GET /repos/{repo}/releases."""
    return {r['tag_name'] for r in api_releases if re.search(r'^Beta-approved:', r.get('body') or '', re.M)}


# The lines the gate writes and each platform's app reads (desktop/lib/updater.js BETA_MARK, BETA_MARK_WINDOWS).
BETA_MARKS = (re.compile(r'^Beta-approved:', re.M), re.compile(r'^Beta-approved \(Windows\):', re.M))


def beta_kept(api_releases):
    """The test builds tools/prune-releases.sh must keep: per platform, the newest release approved for its beta testers, when that is a
    pre-release (stable ones are never pruned). From GET /repos/{repo}/releases. 7 Oct 2026: keeping only the newest 3 test builds deleted
    desktop-v0.5.16, the one build approved for Windows, after four builds failed their gate."""
    live = sorted((r for r in api_releases if not r.get('draft')), key=lambda r: r.get('created_at') or '', reverse=True)
    kept = set()
    for mark in BETA_MARKS:
        newest = next((r for r in live if mark.search(r.get('body') or '')), None)
        if newest and newest.get('prerelease'):
            kept.add(newest['tag_name'])
    return kept
