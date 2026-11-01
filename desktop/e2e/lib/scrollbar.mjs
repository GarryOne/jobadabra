// A replay draws the scrollbar the live run's page had (capture-journey.mjs records view.scrollbar: Linux Chrome 15 px, a Mac's overlay 0), so the page has the
// same width on either system. Guard: e2e/test/scrollbar.test.mjs (forced 15 and 0 measured on a real page).
/* global document */

// The page's style for a scrollbar `width` px wide (0: none). -> CSS text.
export const scrollbarCss = width => `::-webkit-scrollbar{width:${width}px;height:${width}px}${width > 0 ? '::-webkit-scrollbar-thumb{background:#c1c1c1}::-webkit-scrollbar-track{background:#f1f1f1}' : ''}`;

// Forces it in every page `target` (a browser context or one tab) opens from now on; a capture with no recorded width changes nothing. -> true when forced.
export async function forceScrollbar(target, width) {
  if (!Number.isFinite(width) || width < 0) return false;
  await target.addInitScript(css => {
    const add = () => { const style = document.createElement('style'); style.dataset.jpScrollbar = ''; style.textContent = css; (document.head || document.documentElement).appendChild(style); };
    if (document.documentElement) add(); else document.addEventListener('DOMContentLoaded', add);
  }, scrollbarCss(width));
  return true;
}
