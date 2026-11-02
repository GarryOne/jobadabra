// The "magic" behind the panel (owner, 19 Oct 2026: all three, more intense): on the dimmed page, an aurora (three colour clouds drifting), sparkles (stars twinkling in turn) and a shimmer (a light band sweeping).
// Drawn INSIDE the overlay layer (so the layer's removal, Stop, the backstop and the AI's picture rule all take it away with the dim), with the Web Animations API on transform and opacity only:
// no style element a page CSP could refuse, no timers, no layout or repaint of the page. Under prefers-reduced-motion nothing is added. Used by panel-overlay.js. Guard: desktop/test/fill-overlay.test.js.
(() => {
  const CLOUDS = [   // colour, size (% of the layer), start spot, drift (% of the cloud), seconds
    ['255,138,61', 80, -20, -25, 38, 26, 11], ['111,134,255', 85, 45, 40, -42, -30, 14], ['190,110,255', 60, 20, 35, 30, -38, 17],
  ];
  const STARS = [[12, 18], [78, 12], [30, 70], [88, 60], [52, 88], [8, 52], [64, 30], [22, 40], [92, 86], [45, 10], [70, 78], [36, 92], [16, 84], [58, 56], [84, 36], [4, 28], [96, 14], [40, 30], [74, 52], [26, 14], [60, 8], [90, 72], [10, 70], [50, 68]];
  const box = (parent, css) => parent.appendChild(Object.assign(document.createElement('div'), {style: css}));
  const loop = (node, frames, options) => node.animate(frames, {iterations: Infinity, easing: 'ease-in-out', ...options});
  window.__jobadabraOverlayFx = layer => {
    if (!layer?.animate || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const fx = box(layer, 'position:absolute;inset:0;overflow:hidden;pointer-events:none;');
    for (const [rgb, size, left, top, dx, dy, secs] of CLOUDS) {
      const cloud = box(fx, `position:absolute;width:${size}%;height:${size}%;left:${left}%;top:${top}%;border-radius:50%;opacity:.8;will-change:transform;background:radial-gradient(circle,rgba(${rgb},.95) 0%,rgba(${rgb},0) 68%);`);
      loop(cloud, [{transform: 'translate(0,0) scale(1)'}, {transform: `translate(${dx}%,${dy}%) scale(1.25)`}], {duration: secs * 1000, direction: 'alternate'});
    }
    STARS.forEach(([x, y], i) => {
      const size = 12 + (i % 3) * 4;
      const star = box(fx, `position:absolute;left:${x}%;top:${y}%;width:${size}px;height:${size}px;opacity:0;will-change:transform,opacity;background:radial-gradient(circle,#fff 0 22%,rgba(255,255,255,0) 24%),linear-gradient(#fff,#fff) center/100% 2px no-repeat,linear-gradient(#fff,#fff) center/2px 100% no-repeat;filter:drop-shadow(0 0 4px #ffd9a8);`);
      loop(star, [{opacity: 0, transform: 'scale(.3) rotate(0)'}, {opacity: 1, transform: 'scale(1.15) rotate(45deg)', offset: .4}, {opacity: 0, transform: 'scale(.5) rotate(90deg)'}], {duration: 2600 + (i % 4) * 300, delay: -(i * 370)});
    });
    const band = box(fx, 'position:absolute;top:-50%;bottom:-50%;left:0;width:34%;will-change:transform;background:linear-gradient(100deg,rgba(255,255,255,0),rgba(255,255,255,.34),rgba(255,255,255,0));');
    loop(band, [{transform: 'translateX(-120%) skewX(-18deg)'}, {transform: 'translateX(380%) skewX(-18deg)', offset: .6}, {transform: 'translateX(380%) skewX(-18deg)'}], {duration: 4200, easing: 'ease-in-out'});
  };
})();
