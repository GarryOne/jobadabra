"""Independent AI lookups run side by side, in the caller's order of results (#2913, 2 Nov 2026): the pool labels the employer pick waits for were
about 7 calls one after another (role kind, pool role, region, country, two metros, family; 4-30 s each on the Codex relay), so a Find jobs
named its employers after 45-150 s. Each call keeps its own cache, topic and answer; only the waiting overlaps. Tests: tests/test_together.py."""
from concurrent.futures import ThreadPoolExecutor


def together(*calls):
    """[result of each no-argument call], the calls run at once, each at the caller's AI slot level (src/ai/slots.py carry); the first
    failure is raised after the others ended, as when they ran one by one."""
    from .ai import slots
    if len(calls) < 2:
        return [call() for call in calls]
    with ThreadPoolExecutor(max_workers=len(calls), thread_name_prefix='together') as pool:
        futures = [pool.submit(slots.carry(call)) for call in calls]
    return [future.result() for future in futures]   # the pool has ended: every call finished, the first failure (in order) is raised
