// Settings → Diagnostics → Updates: whether this is the latest version, from main's updateStatus.
import {ago} from './jobs-view.js';

export function updateText({offer, checkedAt, fromSource, fromStore} = {}, now = Date.now()) {
  if (fromStore) return {latest: true, text: 'Updated by the Microsoft Store'};
  if (fromSource) return {latest: true, text: 'Running from source: update with git pull'};
  if (offer) return {latest: false, text: `Version ${offer.version} is available: use Update in the sidebar`};
  if (!checkedAt) return {latest: false, text: 'Not checked yet'};
  return {latest: true, text: `Up to date · checked ${ago(checkedAt, now)}`};
}

// Settings → Diagnostics → Test builds, from main's betaState: {test, on, fromSource, fromStore}. Builds made by hand (tools/test-build.sh) with no test run on them.
export function testText({test, fromSource, fromStore} = {}) {
  if (fromStore) return {text: 'Not in the Microsoft Store copy: the Store sends its versions', toggle: ''};
  if (fromSource) return {text: 'Not in a build run from source', toggle: ''};
  return test ? {text: 'On · you are offered every new build, tested or not: it can be broken', toggle: 'Turn off'}
    : {text: 'Off · for testing fixes before the beta: builds can be broken', toggle: 'Get test builds'};
}

// Settings → Diagnostics → Beta, from main's betaState: {on, current, stable, ahead, fromSource, fromStore}.
export function betaText({on, current, stable, ahead, fromSource, fromStore} = {}) {
  if (fromStore) return {text: 'Not in the Microsoft Store copy: the Store sends its versions', toggle: '', back: false};
  if (fromSource) return {text: 'Not in a build run from source', toggle: '', back: false};
  if (ahead) return {text: on ? `On · ahead of stable ${stable}` : `Off · still ahead of stable ${stable}`, toggle: on ? 'Turn off' : 'Join the beta', back: true};
  return {text: on ? 'On · you are offered new versions before everyone else' : 'Off · you get stable versions only', toggle: on ? 'Turn off' : 'Get the beta version', back: false};
}
