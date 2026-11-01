// One plain-text Telegram message from CI through the Build Log bot (its own bot and chat: BUILDLOG_TELEGRAM_TOKEN / BUILDLOG_TELEGRAM_CHAT, as the daily digest). Missing keys: skipped with a line,
// never a failure. The token is only in the URL of the one request and never printed. Guard: e2e/test/discovery-cli.test.mjs.
export async function postTelegram(text, {env = process.env, fetcher = fetch} = {}) {
  const token = env.BUILDLOG_TELEGRAM_TOKEN, chat = env.BUILDLOG_TELEGRAM_CHAT;
  if (!text) return 'telegram: nothing to say';
  if (!token || !chat) return 'telegram: not sent (BUILDLOG_TELEGRAM_TOKEN / BUILDLOG_TELEGRAM_CHAT are not set)';
  const answer = await fetcher(`https://api.telegram.org/bot${token}/sendMessage`, {method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({chat_id: chat, text: String(text).slice(0, 3900), disable_web_page_preview: true}), signal: AbortSignal.timeout(20000)});
  return answer.ok ? 'telegram: sent' : `telegram: refused (${answer.status})`;
}
