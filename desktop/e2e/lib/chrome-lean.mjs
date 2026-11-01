// Flags that make the test Chrome lighter, opt-in (E2E_CHROME_LEAN=1) until a measured run shows they change nothing the pool sees (11 Oct 2026: one pool run's Chrome is 1.5-1.9 GB;
// ~200 MB of it is the GPU and audio processes, which a held headless run never uses). Never touches what a page does: no blocking of images, scripts or frames.
// Guard: test/chrome-lean.test.mjs.
export const LEAN_FLAGS = ['--disable-gpu', '--mute-audio', '--disable-features=AudioServiceOutOfProcess,Translate,MediaRouter', '--disable-background-networking', '--disable-component-update'];
export const leanChrome = (env = process.env) => (env.E2E_CHROME_LEAN === '1' && !env.E2E_HEADED ? LEAN_FLAGS : []);
