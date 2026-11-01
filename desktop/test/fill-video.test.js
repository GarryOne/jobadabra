// The fill video (desktop/ready-fill/fill-video.mjs): it finds Playwright's ffmpeg, writes the page's frames at a fixed rate, stops by itself at its limit
// (never over 3 minutes, the owner's cap), and keeps no file when nothing was recorded. A fake page and a fake ffmpeg; the real encode is the PR's proof.
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {MAX_SECONDS, discard, ffmpegArgs, findFfmpeg, pickEncoder, startFillVideo} from '../../desktop/ready-fill/fill-video.mjs';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64');

function fakePage(data = JPEG) {
  const cdp = new EventEmitter(), calls = [];
  cdp.send = async method => { calls.push(method); return method === 'Page.captureScreenshot' ? {data} : {}; };
  cdp.detach = async () => calls.push('detach');
  return {calls, cdp, page: {viewportSize: () => ({width: 1280, height: 720}), context: () => ({newCDPSession: async () => cdp})}};
}
const VP8 = {ffmpeg: '/ff', encoder: 'libvpx'};

function fakeFfmpeg({code = 0} = {}) {
  const runs = [];
  const spawnImpl = (bin, args) => {
    const proc = new EventEmitter(), written = [];
    proc.stdin = new EventEmitter();
    proc.stdin.write = chunk => { written.push(chunk); return true; };
    proc.stdin.end = () => { const out = args.at(-1); if (written.length) fs.writeFileSync(out, Buffer.concat(written)); setImmediate(() => proc.emit('close', code)); };
    proc.kill = () => {};
    runs.push({bin, args, written});
    return proc;
  };
  return {runs, spawnImpl};
}

const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'jp-fill-video-'));

test('finds Playwright\'s ffmpeg beside its browsers (newest first), FFMPEG first, nothing when there is none', () => {
  const files = new Set([path.join('/pw', 'ffmpeg-1010', 'ffmpeg-linux'), path.join('/pw', 'ffmpeg-1011', 'ffmpeg-linux'), '/opt/ff']);
  const options = {home: '/nohome', exists: file => files.has(file), list: root => (root === '/pw' ? ['chromium-1', 'ffmpeg-1010', 'ffmpeg-1011'] : [])};
  assert.equal(findFfmpeg({...options, env: {PLAYWRIGHT_BROWSERS_PATH: '/pw'}}), path.join('/pw', 'ffmpeg-1011', 'ffmpeg-linux'));
  assert.equal(findFfmpeg({...options, env: {PLAYWRIGHT_BROWSERS_PATH: '/pw', FFMPEG: '/opt/ff'}}), '/opt/ff');
  assert.equal(findFfmpeg({...options, env: {}, list: () => { throw new Error('none'); }}), '');
});

test('the encoder is the one this ffmpeg has: VP8 (the night image\'s), else VP9, else none', () => {
  const list = name => ` V....D mjpeg  MJPEG\n V....D ${name}  libvpx\n`;
  assert.equal(pickEncoder(list('libvpx')), 'libvpx');
  assert.equal(pickEncoder(list('libvpx-vp9')), 'libvpx-vp9');
  assert.equal(pickEncoder(list('libx264')), '');
});

test('the encode is small on purpose: the given size and rate, no sound, a capped bitrate', () => {
  const args = ffmpegArgs({width: 960, height: 540, fps: 10, out: 'x.webm'}).join(' ');
  assert.ok(ffmpegArgs({width: 960, height: 540, fps: 10, out: 'x.webm', encoder: 'libvpx-vp9'}).join(' ').includes('-c:v libvpx-vp9'));
  for (const part of ['-c:v libvpx', '-crf 28', '-b:v 800k', '-framerate 10', '-r 10', '-an', 'scale=960:540', 'pad=960:540']) assert.ok(args.includes(part), part);
  assert.ok(args.endsWith('x.webm'));
});

test('frames go in at the fixed rate and it stops by itself at its limit', async () => {
  const {page, calls} = fakePage(), ffmpeg = fakeFfmpeg(), folder = dir();
  const rec = await startFillVideo(page, {dir: folder, maxSeconds: 0.3, fps: 10, ...VP8, spawnImpl: ffmpeg.spawnImpl});
  await new Promise(resolve => setTimeout(resolve, 700));
  const video = await rec.stop();
  assert.equal(ffmpeg.runs[0].written.length, 3, '0.3 s at 10 fps, then no more');
  assert.equal(video.secs, 1, 'whole seconds, at least 1');
  assert.ok(video.bytes > 0 && fs.existsSync(video.path));
  assert.ok(ffmpeg.runs[0].args.join(' ').includes('scale=1280:720'), '720p, the page\'s own shape');
  assert.ok(calls.includes('Page.startScreencast') && calls.includes('Page.stopScreencast') && calls.includes('detach'));
  assert.equal(await rec.stop(), video, 'a second stop gives the same answer');
  discard(video.path);
  assert.equal(fs.existsSync(video.path), false);
});

test('never over 3 minutes, whatever is asked', async () => {
  const {page} = fakePage();
  const rec = await startFillVideo(page, {dir: dir(), maxSeconds: 3600, ...VP8, spawnImpl: fakeFfmpeg().spawnImpl});
  assert.equal(rec.limit, MAX_SECONDS);
  assert.equal(MAX_SECONDS, 180);
  await rec.stop();
});

test('no ffmpeg, no frame or a failed encode: null, and no file left', async () => {
  const {page} = fakePage();
  assert.equal(await (await startFillVideo(page, {dir: dir(), ffmpeg: ''})).stop(), null);
  assert.equal(await (await startFillVideo(page, {dir: dir(), ffmpeg: '/ff', encoder: ''})).stop(), null, 'an ffmpeg with no WebM encoder');
  const folder = dir(), stopped = await startFillVideo(page, {dir: folder, ...VP8, spawnImpl: fakeFfmpeg().spawnImpl});
  assert.equal(await stopped.stop(), null, 'stopped before the first tick: nothing written');
  const broken = fakeFfmpeg({code: 1}), failing = await startFillVideo(page, {dir: folder, maxSeconds: 0.2, ...VP8, spawnImpl: broken.spawnImpl});
  await new Promise(resolve => setTimeout(resolve, 400));
  assert.equal(await failing.stop(), null);
  assert.deepEqual(fs.readdirSync(folder), [], 'no file left behind');
});

test('a tab that changes (tabOf): the video follows the new tab in the same file, the old tab is let go', async () => {
  const a = fakePage(Buffer.from('A').toString('base64')), b = fakePage(Buffer.from('B').toString('base64')), ffmpeg = fakeFfmpeg();
  let tab = a.page;
  const rec = await startFillVideo(null, {tabOf: () => tab, dir: dir(), maxSeconds: 3, fps: 10, ...VP8, spawnImpl: ffmpeg.spawnImpl});
  await new Promise(resolve => setTimeout(resolve, 400));
  tab = b.page;
  await new Promise(resolve => setTimeout(resolve, 1500));
  const video = await rec.stop(), written = ffmpeg.runs[0].written.map(String);
  assert.equal(ffmpeg.runs.length, 1, 'one encoder, one file');
  assert.ok(written.includes('A') && written.at(-1) === 'B', 'frames of the first tab, then of the new one');
  assert.ok(a.calls.includes('Page.stopScreencast') && a.calls.includes('detach'), 'the old tab let go');
  assert.ok(b.calls.includes('Page.startScreencast'));
  discard(video.path);
});
