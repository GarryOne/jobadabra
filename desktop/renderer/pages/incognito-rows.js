// What the Focus "Allow in Incognito" line says and when (pure, no page: its test runs without a DOM). Used by pages/focus-incognito.js; guard: test/focus-incognito.test.js.
export const waitingOf = settings => settings?.refusedNeedsIncognito === true ? (settings.refusedIncognitoWaiting || []).length : 0;
export const lineOf = count => `${count} site${count === 1 ? ' needs' : 's need'} one Chrome switch to be read`;
