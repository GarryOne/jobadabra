// Is this report caused by a failure planted on purpose? (16 Oct 2026.) Only the end-to-end journey on CI has a planted file (desktop/e2e/lib/planted.mjs writes one JSON line
// per planted failure served: the report kinds it causes and the text they carry); the Sentry reporter asks before it sends. A report is dropped only when a recent plant names
// its kind (and its text, when the plant has one): a real error of another kind, or with other words, is sent even in the same minute. A user's install has no such file.
import fs from 'node:fs';

export const PLANT_WINDOW_MS = 120_000;   // what a planted failure causes (a run's warning, a stopped task) is reported within this long after it was served

// report: {kind, message, source?, stack?}; extension plants name their own frame because arbitrary error messages are deliberately dropped.
export function causedByPlant(report, env = process.env, now = Date.now(), read = file => fs.readFileSync(file, 'utf8')) {
  const file = env.JOB_PILOTTO_E2E_PLANTED_FILE;
  if (!file || !env.JOB_PILOTTO_E2E) return false;
  try {
    const message = String(report?.message ?? '').toLowerCase();
    return read(file).split('\n').some(line => {
      try {
        const plant = JSON.parse(line);
        return plant.at > 0 && now - plant.at <= PLANT_WINDOW_MS && plant.kinds?.includes(report?.kind)
          && (!plant.source || plant.source === report?.source)
          && (!plant.frame || String(report?.stack || '').split('\n').some(frame => frame.startsWith(`at ${plant.frame}`)))
          && (!plant.text || message.includes(String(plant.text).toLowerCase()));
      } catch { return false; }
    });
  } catch { return false; }
}
