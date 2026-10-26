// What the window says about "Tell me by" (Settings → Automation → Notifications, the Actions header, Connections): why a switch does nothing (no address, no bot, our sender
// switched off, the person unsubscribed), and whether Telegram is still required. Pure (no DOM), so test/notify-choice.test.js runs it in Node.

const NAMES = {email: 'Email', telegram: 'Telegram'};

// The notes under the Email and Telegram switches and the card's message line. `error` is the last save's refusal: it stays until the next save (it was wiped by the refresh).
export function notes(state, error = '') {
  const email = !state.email ? 'New matches, reminders and answers in your inbox. Add your address below.'
    : state.sending === false ? `To ${state.email}. Email is not switched on on our side yet: your choice is kept and mail starts when it is.`
      : state.serviceOff ? `You stopped these emails with the link in one of them. Turn them on again with "Email settings" at the bottom of any of our emails.`
        : state.confirmed ? `To ${state.email} (confirmed).` : `To ${state.email}. Confirm it with the link in your first email.`;
  const telegram = state.telegram ? 'Your own bot: digests and reminders, with buttons.' : 'Your own bot. Connect it first:';
  const lostBot = (state.chosen || []).includes('telegram') && !state.telegram;   // chosen, then the bot was lost: said, never dropped in silence
  const message = error || (lostBot ? 'Telegram is chosen but not connected, so nothing goes there. Connect it, or turn it off.' : '')
    || (state.reached ? '' : 'Offline: your address is saved when the website is reachable.');
  return {email, telegram, message};
}

// Telegram is one way to be told; with e-mail chosen it is optional (Connections' alert and dot), unless the person chose it (`chosen`: settings.notifyBy, before unset-up channels are dropped).
export const telegramRequired = (by = [], chosen = null) => (Array.isArray(chosen) && chosen.includes('telegram')) || !by.includes('email');

// The Actions header: Telegram's delivery state when it is the only channel (a refused message is worth saying), else the chosen channels.
export function channelLine({by = [], chosen: picked = null, connected = false, blocked = false}) {
  const chosen = by.filter(name => NAMES[name]);
  if (chosen.includes('telegram') && blocked) return {text: 'Telegram not delivering', dot: 'is-warn'};
  if (Array.isArray(picked) && picked.includes('telegram') && !connected) return {text: 'Telegram not connected', dot: 'is-warn'};
  if (!chosen.length) return {text: connected ? 'Telegram connected, not chosen' : 'Tell me by: app notifications only', dot: ''};
  return {text: `Tell me by: ${chosen.map(name => NAMES[name]).join(', ')}`, dot: 'is-on'};
}
