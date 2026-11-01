// Archiving pool rows (owner, 17 Oct 2026, life cycle: site/src/applying-stage.js): the lab page names the rows that may be archived and why (`archivable`: fixed and frozen as a page case,
// a posting gone twice, a clean working row); this writes `stage: "archived"` and `stageWhy` into the pool list (smoke-sites.json), for a PR. Nothing is deleted: the row stays, uploads with
// its stage, and the recorder skips it unless --only names it. A row on the daily watch list is never archived. Pure. Guard: e2e/test/pool-archive.test.mjs.
export const WHY = ['fixed', 'working', 'posting-gone'];

// pool: the pool file's {shapes}; items: the lab page's pool rows ({shape, archivable}); only: limit to these whys. -> [{shape, why}] archived (the pool is changed in place).
export function archiveRows(pool, items, {only = WHY, day = ''} = {}) {
  const done = [];
  for (const item of items) {
    if (!WHY.includes(item.archivable) || !only.includes(item.archivable)) continue;
    const row = pool.shapes.find(candidate => candidate.shape === item.shape);
    if (!row || row.stage === 'archived' || row.stage === 'watch') continue;
    row.stage = 'archived'; row.stageWhy = item.archivable; if (day) row.archivedAt = day;
    done.push({shape: row.shape, why: item.archivable});
  }
  return done;
}
