// Counts the Notion stand-in's HTTP traffic as elapsed times and anonymous route shapes.
// Job: report health
import fs from 'node:fs';
import path from 'node:path';

/** Count arrivals only: snapshots contain no bodies, headers, query values or UUIDs. */
export function createNotionRequestCount({clock = () => performance.now()} = {}) {
  const started = clock(), byRoute = new Map();
  let total = 0, firstMs = null, lastMs = null;
  return {
    record({method, url}) {
      const route = new URL(url, 'http://standin').pathname.split('/').map(part => /^[0-9a-f]{32}$|^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(part) ? ':id' : part).join('/');
      const key = `${method} ${route}`;
      const ms = clock() - started;
      firstMs ??= ms;
      lastMs = ms;
      total++;
      byRoute.set(key, (byRoute.get(key) || 0) + 1);
    },
    snapshot: () => ({v: 1, total, firstMs, lastMs, byRoute: Object.fromEntries(byRoute)}),
  };
}

/** Annotate the existing step results, including failed steps; filtered steps create no result. */
export function countNotionRequestsByStep(runner, standIn) {
  const requests = standIn?.requests;
  if (!requests) return;
  const run = runner.run;
  runner.run = async (...args) => {
    const before = requests.snapshot().total, at = runner.results.length;
    try { return await run(...args); }
    finally {
      for (const result of runner.results.slice(at)) result.notionRequests = requests.snapshot().total - before;
    }
  };
}

/** Write notion-requests.json beside notion-standin.json; a failed write never fails the suite. */
export function writeNotionRequests(dir, requests) {
  try { fs.writeFileSync(path.join(dir, 'notion-requests.json'), JSON.stringify(requests.snapshot(), null, 1)); } catch { /* the run's verdict does not depend on this file */ }
}
