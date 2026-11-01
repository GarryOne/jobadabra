// Catch undeclared names and flag unused code across the desktop app and Chrome extension.
import {createRequire} from 'node:module';
const globals = createRequire(new URL('./desktop/package.json', import.meta.url))('globals');

export default [
  {ignores: ['**/node_modules/**', 'desktop/dist/**', 'desktop/build/**', 'desktop/.design-system/**', 'desktop/shared/**', 'desktop/renderer/vendor/**', 'desktop/e2e/vendor/**',
  // What a local e2e run leaves behind (git-ignored): a Playwright HTML report and trace viewer under artifacts/, a blob report from the e2e unit run.
  'desktop/e2e/artifacts/**', 'desktop/e2e/blob-report/**']},
  {
    files: ['desktop/**/*.js', 'desktop/**/*.mjs', 'desktop/**/*.cjs', 'extension/**/*.js'],
    languageOptions: {globals: globals.node},
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['warn', {args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_'}],
    },
  },
  {files: ['desktop/renderer/**/*.js', 'desktop/demo/**/*.js', 'desktop/preload.cjs'], languageOptions: {globals: globals.browser}},
  {files: ['extension/**/*.js'], languageOptions: {globals: {...globals.browser, chrome: 'readonly'}}},
  // Why (1 Nov 2026, rs 5a/6): the night's fill job runs these callbacks inside the page (page.evaluate); the file moved from hosted/ (never linted) into desktop/.
  {files: ['desktop/ready-fill/fill-job.mjs'], languageOptions: {globals: globals.browser}},
];
