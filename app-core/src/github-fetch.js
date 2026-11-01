// One fetch for every call to api.github.com that follows a repo move: a POST is re-sent as a POST.

const API = 'https://api.github.com/';
const MOVED = new Set([301, 302, 307, 308]);
const MAX_HOPS = 3;

/**
 * fetch() for api.github.com that follows a redirect by re-sending the SAME method, headers and body.
 * Invariants: the body must be a string (re-sendable); a Location outside https://api.github.com is not followed
 * (the Authorization header never leaves GitHub); at most 3 hops; the final response is returned unchanged.
 *
 * Why (1 Nov 2026, owner: the repos move to the `jobadabra` org): after a transfer GitHub answers the old
 * `repos/<old>/...` path with a 301, and fetch turns a redirected POST into a GET, which GitHub answers 404:
 * every workflow dispatch (night passes, the :47 e2e) would fail until each caller's repo variable is flipped.
 */
export async function githubFetch(url, init = {}, fetcher = fetch) {
  let target = url;
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    const response = await fetcher(target, {...init, redirect: 'manual'});
    if (!MOVED.has(response.status)) return response;
    const location = response.headers?.get?.('location');
    if (!location) return response;
    const next = new URL(location, target).href;
    if (!next.startsWith(API)) return response;
    target = next;
  }
  throw new Error(`GitHub redirected more than ${MAX_HOPS} times: ${url}`);
}
