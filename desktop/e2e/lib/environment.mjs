// A step that failed because the TEST environment answered badly (Notion or a proxy sent an HTML error page, a connection dropped, a service was busy), not
// because the app did something wrong: #266 (Notion answered "<!DOCTYPE" during the focus suite's own setup). Such a step is retried once; if it fails again it is
// listed in the run's log as an environment failure and not filed as an issue. AI refusals are not here: the activityfailures suite injects them on purpose.
export const ENVIRONMENT = /Unexpected token '<'|<!DOCTYPE|is not valid JSON|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|socket hang up|fetch failed|network (?:error|timeout)|\bNotion\b[^\n]{0,80}\b(?:429|50[0-4]|rate.?limited|service_unavailable|internal_server_error|gateway)/i;
export const isEnvironment = message => ENVIRONMENT.test(String(message || ''));
export const RETRY_WAIT_MS = Number(process.env.E2E_RETRY_WAIT_MS || 5000);
