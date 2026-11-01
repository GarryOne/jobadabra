// Job: report health
// A live row's fill video for the Lab's "▶ Watch" (owner, 18 Oct 2026): on CI's pool run (JP_FILL_VIDEO_DIR set by record-sites.mjs) a short video of whichever tab is being filled, from
// desktop/ready-fill/fill-video.mjs (follows the tab, 3 minutes at most). finish() says `live: fill video: <path>|<bytes>|<secs>`, which lib/record-sites.mjs parseLive reads and pool-ci-rows.mjs uploads;
// a privacy-tripwire hit or no video discards the file. Without the folder it does nothing. Guard: e2e/test/live-video.test.mjs.
import {discard, startFillVideo} from '../../../desktop/ready-fill/fill-video.mjs';

const http = page => /^https?:/.test(page.url());

export async function liveVideo({context, page, dir = process.env.JP_FILL_VIDEO_DIR, start = startFillVideo}) {
  const recorder = dir ? await start(null, {dir, tabOf: () => context.pages().filter(http).at(-1) || page}).catch(() => null) : null;
  return {async finish({tripped = false, say = () => {}} = {}) {
    const video = await recorder?.stop().catch(() => null);
    if (!video) return;
    if (tripped) { discard(video.path); say('live: fill video: discarded (the privacy tripwire hit)'); return; }
    say(`live: fill video: ${video.path}|${video.bytes}|${video.secs}`);
  }};
}
