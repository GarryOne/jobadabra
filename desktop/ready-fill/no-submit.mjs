// The floor "the server never presses Submit" as a net under the filler (private spec jobadabra-lab:docs/specs/2026-10-17-ready-to-send.md): the extension has no Submit path, and this stops what it would never do anyway.
// Every request the night's browser makes goes through `net`: a form submission (a POST that navigates a page) or a POST/PUT whose address ends in a submit or apply word is refused and counted. A CV upload on choice
// (a multipart POST that is not a navigation) goes through: the fill needs it. A word list is a safety floor here, never a meaning. Guard: desktop/test/ready-fill.test.js.
const SUBMIT_PATH = /\/(submit|apply|applications?)(\.json)?\/?$/i;

// Pure: is this request a submit? `request` is {method, url, navigation}.
export function looksLikeSubmit({method, url, navigation}) {
  if (!['POST', 'PUT', 'PATCH'].includes(String(method).toUpperCase())) return false;
  if (navigation) return true;
  try { return SUBMIT_PATH.test(new URL(url).pathname); } catch { return false; }
}

// Routes a Playwright context: -> {blocked: [{host, method}]} that fills as requests are refused.
export async function net(context) {
  const state = {blocked: []};
  await context.route('**/*', route => {
    const request = route.request();
    const submit = looksLikeSubmit({method: request.method(), url: request.url(), navigation: request.isNavigationRequest()});
    if (submit) { state.blocked.push({host: new URL(request.url()).hostname, method: request.method()}); return route.abort('blockedbyclient'); }
    return route.continue();
  });
  return state;
}
