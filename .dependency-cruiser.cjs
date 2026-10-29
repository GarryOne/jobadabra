// Guard production JavaScript cycles and the existing browser/runtime import boundaries.
// Why (29 Oct 2026, owner): "Let's add/implement this"; keep only boundaries already true on main.
// dependency-cruiser on origin/main (supervisor, 29 Oct 2026): no-circular 388
// (cycle entries, one per module in a cycle), renderer-no-node-layer 0, extension-no-desktop 0.
// Gate: 5.0 s warm cache; 12.7 s first use, including the one-time pinned install (about 7 s).
// Rejected lib -> renderer: 79 imports (about-you -> question-filter/preferences-model,
// answer-home -> question-kind); these are shared pure helpers, not a boundary to impose.
module.exports = {
  forbidden: [
    {name: 'no-circular', severity: 'error', from: {}, to: {circular: true}},
    {
      name: 'renderer-no-node-layer', severity: 'error',
      from: {path: '^desktop/renderer/'},
      to: {path: '^desktop/(lib/|main\\.js$)'},
    },
    {
      name: 'extension-no-desktop', severity: 'error',
      from: {path: '^extension/'},
      to: {path: '^desktop/(?!shared/)'},
    },
  ],
  options: {
    // Invariant: no installed packages, tests, generated shared copies or dev tooling enter the graph.
    exclude: {path: '(^|/)(tests?|e2e|vendor|shared|node_modules|dist|build|demo|scripts|\\.design-system)/|\\.(test|spec)\\.[cm]?js$'},
    includeOnly: {path: '^(desktop|extension)/.*\\.[cm]?js$'},
    doNotFollow: {path: '(^|/)node_modules/'},
    enhancedResolveOptions: {extensions: ['.js', '.mjs', '.cjs', '.json']},
  },
};
