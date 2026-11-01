// A pool row's fill video for the Lab's "▶ Watch" (owner, 18 Oct 2026): one PUT to /applying/video with CI's narrow REPLAYS_PUBLISH_KEY, a run on main only, as lib/pool-ci-rows.mjs does for the row's result.
// The row's name and the video's length go in the address, never the page's address; the file is removed after a send. JP_CI_ROWS_DRY=1|true: say it, send nothing. Guard: e2e/test/lab-video-upload.test.mjs.
import fs from 'node:fs';

export const LAB_VIDEO_SITE = 'https://www.jobpilotto.top/applying/video';

// video: {path, bytes, secs} from lib/fill-video (hosted/ready-fill), or null. ctx: {branch}. -> one line for the run's output; never throws.
export async function uploadFillVideo(name, video, ctx = {}, {env = process.env, fetcher = fetch} = {}) {
  const why = env.REAL_EXTENSION_DIR ? 'a control run on another build' : !env.CI ? 'a local run: the video stays on the Mac' : ctx.branch !== 'main' ? `branch ${ctx.branch || '(none)'}: only a run on main reaches the page` : !env.REPLAYS_PUBLISH_KEY ? 'no REPLAYS_PUBLISH_KEY in this run' : '';
  if (why) return `fill video: not sent (${why})`;
  if (!video?.path || !fs.existsSync(video.path)) return 'fill video: nothing to send (no video)';
  if (['1', 'true'].includes(String(env.JP_CI_ROWS_DRY || '').toLowerCase())) return `fill video: dry run: would send ${video.bytes} bytes for one row`;
  try {
    const answer = await fetcher(`${LAB_VIDEO_SITE}?name=${encodeURIComponent(name)}&secs=${Math.max(1, Math.round(video.secs))}`, {method: 'PUT',
      headers: {Authorization: `Bearer ${env.REPLAYS_PUBLISH_KEY}`, 'Content-Type': 'video/webm', 'X-Caller': 'fill-video-upload'}, body: fs.readFileSync(video.path), signal: AbortSignal.timeout(60000)});
    const body = await answer.json().catch(() => ({}));
    if (answer.ok) fs.rmSync(video.path, {force: true});
    return answer.ok ? `fill video: sent to /admin/form-filling/lab (${Math.round(video.bytes / 1024)} KB)` : `fill video: refused (${answer.status} ${body.error || ''})`;
  } catch (error) { return `fill video: not sent (${String(error?.message || error).slice(0, 80)})`; }
}
