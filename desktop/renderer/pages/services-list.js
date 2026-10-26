// The services Settings lists (Overview's "Your setup", Connections, the alert and the dot): each one's name, icon, words and whether it is required.
// Moved out of pages/settings.js (26 Oct 2026, pure move, the file was past 450 lines). Guards: test/notify-choice.test.js (Telegram's required rule), the settings tests.
import {shared} from './shared.js';
import {offered} from '../key-sources.js';
import {telegramRequired} from '../notify-words.js';

// Connections status, shared by Overview (cards + alert), Connections (Connected / Available + alert) and the
// dot on Connections. required: counted for the alert and the dot (Google Jobs and Always on are optional extras;
// Always on's card opens its setup on the Automation page).
const ALL_SERVICES = [
  {id: 'ai', name: 'AI', icon: 'bot', what: 'Claude or OpenAI: an API key, Claude Code or Codex', required: true,
    why: 'Reading jobs, fit scores and application kits need AI: choose Claude Code, Codex or an API key.'},
  {id: 'notion', name: 'Notion', icon: 'layers', what: 'Job search workspace', required: false,   // about Notion
    why: 'Where your applications, kits and interviews are kept. Needed for Always on, Telegram and Gmail.'},
  {id: 'google', name: 'Gmail & Calendar', icon: 'mail', what: 'Read-only access', required: true,
    why: 'Replies, interviews and recruiter emails are tracked from Gmail.'},
  {id: 'extension', name: 'Chrome extension', icon: 'puzzle', what: 'Application form filling', required: true,
    why: 'It fills application forms with your details and CV.'},
  {id: 'telegram', name: 'Telegram', icon: 'send', what: 'Digests and reminders', required: () => telegramRequired(shared.state.notifyBy, shared.state.settings.notifyBy) || !!shared.state.settings.telegramChatId,   // optional with e-mail unless chosen; listed while connected
    why: 'Digests and reminders need a bot connection, or email: Settings → Automation → Notifications.'},
  {id: 'serpapi', name: 'Google Jobs (SerpApi)', icon: 'search', what: 'Additional job results', connect: 'Add key'},
  {id: 'brave', name: 'Web search (Brave)', icon: 'search', what: 'Finds employers\' own job sites', connect: 'Add key'},
  {id: 'aggregators', name: 'Adzuna & Jooble', icon: 'search', what: 'More job results (free keys)', connect: 'Add keys'},
  {id: 'cloud', name: 'GitHub · Always on', icon: 'cloud', what: 'Runs your searches and checks while your Mac is off', connect: 'Set up'},
  {id: 'tg-cloud', name: 'Cloudflare · Telegram buttons', icon: 'zap', what: 'Your bot answers buttons with the Mac off', connect: 'Set up',
    shown: () => !!shared.state.settings.cloud?.repo},  // it starts runs in the GitHub repository, so only with Always on
];
export const SERVICES = ALL_SERVICES.filter(service => offered(service.id));
export const isRequired = service => (typeof service.required === 'function' ? service.required() : !!service.required);
