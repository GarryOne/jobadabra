// Credential aliases keep real CI keys exclusively in the harness proxy, outside Playwright options, actions and snapshots.
export const APP_AI_ALIAS = 'sk-ant-api03-e2e-proxy-not-a-real-key-0000000000000000000000000000000000000000000000';
export const FREE_AI_ALIAS = 'JPF1.e2e.proxy-not-a-real-token';
export const NOTION_ALIAS = 'ntn_e2e_proxy_not_a_real_token_000000000000000000000';

/** Replace only an exact test alias on the upstream hop; invalid keys remain invalid. Never return credentials to the app. */
export function upstreamCredentials(headers, aliases = {}) {
  const result = {...headers};
  for (const [alias, credential] of Object.entries(aliases)) {
    if (!credential) continue;
    if (result['x-api-key'] === alias) result['x-api-key'] = credential;
    if (result.authorization === `Bearer ${alias}`) result.authorization = `Bearer ${credential}`;
  }
  return result;
}
