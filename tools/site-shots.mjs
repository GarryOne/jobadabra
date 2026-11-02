// The website as visitors see it, for the product brain (jobadabra-lab's .github/workflows/product-brain.yml): a desktop and a
// phone screenshot of the landing page (in slices), with the scroll-in animations shown, into .brain/. Needs `playwright`.
import {chromium} from 'playwright';
import {mkdirSync} from 'node:fs';

const url = process.argv[2] || 'https://www.jobadabra.top/';
const out = process.argv[3] || '.brain';
const MAX_SLICES = 6;  // per device: the page's top matters most, and each image costs tokens
mkdirSync(out, {recursive: true});
const browser = await chromium.launch();
for (const [name, viewport] of [['site-desktop', {width: 1440, height: 900}], ['site-mobile', {width: 390, height: 844}]]) {
  const page = await browser.newPage({viewport, deviceScaleFactor: 1});
  await page.goto(url, {waitUntil: 'networkidle'});
  // Sections fade in on scroll: show them all, as a visitor who scrolls would see them.
  await page.addStyleTag({content: '*{animation:none!important;transition:none!important}.reveal{opacity:1!important;transform:none!important}'});
  await page.evaluate(() => document.querySelectorAll('.reveal').forEach(el => el.classList.add('is-visible', 'visible', 'in')));
  // Screen-sized slices, top first (a 13,000 px page scaled down is unreadable): what a visitor sees scrolling.
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  const step = viewport.height * 2;
  for (let y = 0, n = 1; y < height && n <= MAX_SLICES; y += step, n++) {
    const file = `${out}/${name}-${n}.png`;
    await page.screenshot({path: file, fullPage: true, clip: {x: 0, y, width: viewport.width, height: Math.min(step, height - y)}});
    console.log(file);
  }
}
await browser.close();
