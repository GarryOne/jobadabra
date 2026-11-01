// The picture of the app's window that every e2e shot and failure picture uses: what the window paints, at rest, nothing around it.
// Job: report health
/* global requestAnimationFrame */
// Why (1 Nov 2026, owner via mac-07 "Fix the capture canvas"; #2749, #2742, #2806): on a display up to 1512 wide the app draws at 80% (desktop/lib/zoom.js), and CI's xvfb
// screen is 1440 wide; Playwright's page.screenshot then sized the picture in CSS pixels (1280/0.8 x 793/0.8 = 1600 x 991) around the 1280 x 793 the window paints,
// so the AI review read the blank canvas as "unused area below the status bar". The window's own capture (webContents.capturePage) is its painted surface at any zoom.
// Motion: the shot is taken with prefers-reduced-motion, so moving parts show the still look the app itself defines for it (the tip ticker, style.css .ss-tip-text),
// never a frame mid-scroll that reads as cut-off text (#2806).

/** Two painted frames: the state after a style change (the reduced-motion look) has reached the screen. */
const painted = page => page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(() => done(true)))));

/**
 * The window's PNG (a Buffer), as it is painted, with motion stilled. Throws when the window cannot be captured (the caller decides whether a shot may fail).
 * The reduced-motion emulation is always given back, so the next step sees the app as before.
 * @param {import('playwright-core').ElectronApplication} app
 * @param {import('playwright-core').Page} page the window's page
 */
export async function windowShot(app, page) {
  await page.emulateMedia({reducedMotion: 'reduce'});
  try {
    await painted(page);
    const window = await app.browserWindow(page);
    const base64 = await window.evaluate(async win => (await win.webContents.capturePage()).toPNG().toString('base64'));
    if (!base64) throw new Error('the window painted nothing to capture');
    return Buffer.from(base64, 'base64');
  } finally {
    await page.emulateMedia({reducedMotion: null});
  }
}

/**
 * The picture every shot and failure picture takes: windowShot, and when the window gives nothing (hidden, minimised, never painted) Playwright's CSS-pixel
 * screenshot instead, with one logged line. Why (1 Nov 2026, a8): a failure must never lose its picture.
 * @param {import('playwright-core').ElectronApplication} app
 * @param {import('playwright-core').Page} page
 * @param {(line: string) => void} [log]
 */
export async function appPicture(app, page, log = console.log) {
  try {
    return await windowShot(app, page);
  } catch (error) {
    log(`  window capture empty (${error.message}): CSS-px screenshot instead`);
    return page.screenshot();
  }
}
