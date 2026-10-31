// Why connect Notion: the advantages, written once. Shown in the connect dialog, on a locked page, in Settings → Notion
// (all of them). Claims beyond these need the owner's say-so.
export const NOTION_BENEFITS = [
  {icon: 'cloud', lead: 'Safe in your own cloud', text: 'free, and it survives a lost or reset computer.'},
  {icon: 'globe', lead: 'On every device', text: 'check and update your applications from your phone.'},
  {icon: 'eye', lead: 'See everything the app knows', text: 'every job, fit reason, kit and answer, readable and editable. No technical skills needed.'},
  {icon: 'help', lead: 'Easy help', text: 'when something looks wrong, you can see why right in Notion, and share just that page if you want help.'},
  {icon: 'zap', lead: 'Unlocks more', text: 'saving jobs, kits, applying, interviews, Focus, Always on, Telegram buttons, Gmail checks.'},
  {icon: 'shield', lead: 'Yours', text: 'in your own workspace, never on our servers; export it or leave any time.'},
];

export const GATE_TITLE = 'Keep track in your Notion';
export const GATE_FOOTNOTE = "One click with Notion's own sign-in. Your strategy and matches move there too; nothing is kept twice.";
// Under Not now: why not (optional, one tap). Keys = lib/notion-gate.js WHY.
export const WHY_CHOICES = [['no_notion', "I don't use Notion"], ['privacy', 'Privacy'], ['later', 'Later'], ['other', 'Something else']];
// A locked page → the reason it is locked (keys = lib/notion-gate.js REASONS).
export const LOCKED_VIEWS = {focus: 'focus', sessions: 'apply', interviews: 'interviews', calendar: 'interviews', reports: 'focus', employers: 'employers'};
