// "Send feedback…" (sidebar and Help menu): the user's own words to the owner, through the website
// (site/src/feedback.js → the owner's Jobadabra Brain bot). Stage 1's exit criterion is feedback from real users.
// Sends: the text, an optional contact the user typed, the app version and platform, the random install id.
export const ENDPOINT = 'https://www.jobadabra.top/api/feedback';

export function installId(storage) {
  let id = storage.settings().telemetryId;  // the same random id as technical reports
  if (!id) { id = crypto.randomUUID(); storage.saveSettings({telemetryId: id}); }
  return id;
}

export async function send({text, contact = ''}, {storage, version, platform = process.platform, fetcher = globalThis.fetch, endpoint = ENDPOINT}) {
  const words = String(text || '').trim();
  if (!words) return {ok: false, error: 'Write a few words first.'};
  if (words.length > 2000) return {ok: false, error: 'Please keep it under 2000 characters.'};
  try {
    const response = await fetcher(endpoint, {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({text: words, contact: String(contact || '').trim().slice(0, 200), install: installId(storage), version, platform})});
    if (response.status === 429) return {ok: false, error: 'That\'s a lot of feedback today: thank you! Try again tomorrow.'};
    if (!response.ok) return {ok: false, error: `Couldn't send it (${response.status}). Try again in a moment.`};
    return {ok: true};
  } catch (error) {
    return {ok: false, error: `Couldn't send it: ${error.message}. Check your connection.`};
  }
}
