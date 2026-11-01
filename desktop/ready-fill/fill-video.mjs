// A short video of one page while it is filled (Ready to send's "Watch the fill", reused by the Form Lab): a CDP screencast of the page, encoded by Playwright's own ffmpeg
// to a small .webm (VP8, or VP9 where only that is built in). The page stays open (Ready holds its tabs for the morning), so this is not Playwright's recordVideo, which writes only when a page closes.
// Owner, 18 Oct 2026: a few minutes at most, a hard 3-minute stop, 10 fps; 720p (owner, same day: "Let's make it 720p"), the night browser's own 1280x720, so nothing is scaled. No network, no storage, no page content in a log.
// Guard: desktop/test/fill-video.test.js.
import {spawn, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const MAX_SECONDS = 180;
const BINARIES = ['ffmpeg-linux', 'ffmpeg-mac', 'ffmpeg-win64.exe'];
const even = n => Math.max(2, Math.round(n / 2) * 2);

// Pure: Playwright's ffmpeg (installed beside its browsers, also in the Playwright image), else FFMPEG; '' when there is none.
export function findFfmpeg({env = process.env, home = os.homedir(), exists = fs.existsSync, list = fs.readdirSync} = {}) {
  if (env.FFMPEG && exists(env.FFMPEG)) return env.FFMPEG;
  const roots = [env.PLAYWRIGHT_BROWSERS_PATH, '/ms-playwright', path.join(home, 'Library', 'Caches', 'ms-playwright'), path.join(home, '.cache', 'ms-playwright'), env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'ms-playwright')].filter(Boolean);
  for (const root of roots) {
    let dirs = []; try { dirs = list(root).filter(name => name.startsWith('ffmpeg-')).sort().reverse(); } catch { continue; }
    for (const dir of dirs) for (const name of BINARIES) if (exists(path.join(root, dir, name))) return path.join(root, dir, name);
  }
  return '';
}

// Pure: which WebM encoder an ffmpeg has, from its `-encoders` list (Playwright's own builds: VP8 up to ffmpeg-1011, the one the night image ships; VP9 only from 1013). '' = none.
export function pickEncoder(list) {
  if (/^\s*V\S*\s+libvpx\s/m.test(list)) return 'libvpx';
  if (/^\s*V\S*\s+libvpx-vp9\s/m.test(list)) return 'libvpx-vp9';
  return '';
}
const encoders = new Map();
export function encoderOf(ffmpeg, run = spawnSync) {
  if (!encoders.has(ffmpeg)) encoders.set(ffmpeg, pickEncoder(String(run(ffmpeg, ['-hide_banner', '-encoders'], {encoding: 'utf8', timeout: 10000})?.stdout || '')));
  return encoders.get(ffmpeg);
}

// Pure: JPEG frames on stdin at a fixed rate -> a small .webm. Any frame size is scaled into width x height and padded, so a tab of another size fits the same video.
export function ffmpegArgs({width, height, fps, out, encoder = 'libvpx'}) {
  const codec = encoder === 'libvpx-vp9' ? ['-c:v', 'libvpx-vp9', '-row-mt', '1', '-crf', '34', '-b:v', '800k'] : ['-c:v', 'libvpx', '-crf', '28', '-b:v', '800k', '-qmin', '4', '-qmax', '42'];
  return ['-hide_banner', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', 'pipe:0', '-an',
    '-vf', `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:white`,
    ...codec, '-deadline', 'realtime', '-cpu-used', '8', '-threads', '1', '-r', String(fps), '-y', out];
}

// page: a Playwright page; or null with `tabOf: () => page`, read again every second, when the tab being filled changes (the Form Lab's runs open new tabs at account steps):
// the video then follows the new tab in the same file. Starts at once; the last frame is written every 1/fps second, so the video's time is real time.
// It stops by itself at maxSeconds (never over 180). -> {stop(): Promise<{path, bytes, secs (whole, >= 1)} | null>, limit}. null: no frame, no ffmpeg or no encoder; the file is then removed.
export async function startFillVideo(page, {tabOf = () => page, dir = os.tmpdir(), maxSeconds = MAX_SECONDS, width = 1280, fps = 10, ffmpeg = findFfmpeg(), encoder, spawnImpl = spawn} = {}) {
  const limit = Math.min(MAX_SECONDS, Math.max(0, Number(maxSeconds) || 0)), first = safe(tabOf);
  const viewport = first?.viewportSize?.() || {width: 1280, height: 720}, codec = ffmpeg ? encoder ?? encoderOf(ffmpeg) : '';
  const size = {width: even(width), height: even(width * viewport.height / viewport.width)};
  const out = path.join(dir, `fill-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.webm`);
  if (!ffmpeg || !codec || !limit || !first) return {limit, stop: async () => null};
  fs.mkdirSync(dir, {recursive: true});
  const proc = spawnImpl(ffmpeg, ffmpegArgs({...size, fps, out, encoder: codec}), {stdio: ['pipe', 'ignore', 'ignore']});
  const ended = new Promise(resolve => { proc.on('error', () => resolve(-1)); proc.on('close', code => resolve(code)); });
  proc.stdin.on('error', () => {});
  let last = null, frames = 0, busy = false, stopping = null, cdp = null, current = null, queue = Promise.resolve();
  const release = async session => { await session?.send('Page.stopScreencast').catch(() => {}); await session?.detach().catch(() => {}); };
  async function watch(tab) {   // the screencast moves to this tab; the old one is released first
    if (!tab || tab === current || stopping) return;
    const old = cdp; current = tab; cdp = null; await release(old);
    const session = await tab.context().newCDPSession(tab).catch(() => null);
    if (!session) return;
    cdp = session;
    session.on('Page.screencastFrame', frame => { if (session === cdp) last = Buffer.from(frame.data, 'base64'); session.send('Page.screencastFrameAck', {sessionId: frame.sessionId}).catch(() => {}); });
    const shot = await session.send('Page.captureScreenshot', {format: 'jpeg', quality: 50}).catch(() => null);   // the tab's first frame at once
    if (shot?.data && session === cdp) last = Buffer.from(shot.data, 'base64');
    await session.send('Page.startScreencast', {format: 'jpeg', quality: 50, maxWidth: size.width, maxHeight: size.height, everyNthFrame: 1}).catch(() => {});
  }
  const tick = setInterval(() => {
    if (frames >= limit * fps) { stop(); return; }
    if (!last || busy || stopping) return;
    frames++;
    if (!proc.stdin.write(last)) { busy = true; proc.stdin.once('drain', () => { busy = false; }); }   // a slow encoder drops frames, never holds them
  }, 1000 / fps);
  const follow = setInterval(() => { const tab = safe(tabOf); if (tab && !tab.isClosed?.()) queue = queue.then(() => watch(tab)).catch(() => {}); }, 1000);
  queue = queue.then(() => watch(first)).catch(() => {}); await queue;   // a tab that cannot be watched leaves no frame: stop() then answers null and ends the encoder
  function stop() {
    stopping ||= (async () => {
      clearInterval(tick); clearInterval(follow);
      await queue.catch(() => {}); await release(cdp);
      proc.stdin.end();
      const killer = setTimeout(() => proc.kill('SIGKILL'), 30000);
      const code = await ended; clearTimeout(killer);
      const bytes = fs.existsSync(out) ? fs.statSync(out).size : 0;
      if (code !== 0 || !frames || !bytes) { discard(out); return null; }
      return {path: out, bytes, secs: Math.max(1, Math.round(frames / fps))};
    })();
    return stopping;
  }
  return {limit, stop};
}

function safe(tabOf) { try { return tabOf() || null; } catch { return null; } }

export function discard(file) { try { if (file) fs.rmSync(file, {force: true}); } catch { /* already gone */ } }
