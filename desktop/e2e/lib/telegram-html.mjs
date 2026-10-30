// One formatter for the messages the alert bots send (owner, 16 Oct 2026): Telegram HTML with a bold title, a blank line, "•" bullets, named links, never a bare URL.
// Pure and dependency-free, so a Cloudflare Worker can import it as it is (the Sentry alerts bot does). Guard: e2e/test/telegram-html.test.mjs.
// Job: report health
//   alertHtml({icon, title, verdict, bullets: [{label, parts: [text | {text, url}]}], links: [{text, url}]}) -> {text, parse_mode: 'HTML', link_preview_options}
//   alertHtml({icon, title, verdict, blocks: [[{label?, bullet?, parts}]], links}): paragraphs of plain lines ("•" only where bullet is set); the links close the last one.
// parts: a string is plain text (escaped here); {text, url} is a named link (http/https only, else plain text). Longer than Telegram's 4096: the longest line is shortened.
export const LIMIT = 4096;
export const esc = text => String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const attr = url => esc(url).replace(/"/g, '&quot;');
export const link = (text, url) => (/^https?:\/\/[^\s"<>]+$/.test(String(url || '')) ? `<a href="${attr(url)}">${esc(text)}</a>` : esc(text));
const part = one => (typeof one === 'string' ? esc(one) : link(one.text, one.url));
const shorten = (text, max) => (text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1)).replace(/\s+\S*$/, '')}…`);

const line = (one, max) => `${one.bullet ? '• ' : ''}${one.label ? `${esc(one.label)}: ` : ''}${one.parts.map(item => (typeof item === 'string' ? esc(shorten(item, max)) : part(item))).join('')}`;

/**
 * One alert message: "<icon> <b>title</b> verdict", a blank line, then the bullets (one paragraph, "• label: parts") or the blocks (paragraphs of plain lines), then the links.
 * Pure: the caller sends it. Too long for Telegram: the longest line is shortened at a word until it fits. -> {text, parse_mode: 'HTML', link_preview_options}
 */
export function alertHtml({icon = '', title = '', verdict = '', bullets = [], blocks = null, links = []}) {
  const head = `${icon ? `${icon} ` : ''}<b>${esc(title)}</b>${verdict ? ` ${esc(verdict)}` : ''}`;
  const groups = blocks ? blocks.filter(group => group.length) : bullets.length ? [bullets.map(one => ({...one, bullet: true}))] : [];
  const linked = links.map(one => link(one.text, one.url)).join(' · ');
  const build = lengths => {
    let at = 0;
    const body = groups.map(group => group.map(one => line(one, lengths[at++])).join('\n'));
    // Why (30 Oct 2026, owner picked the short shape): in blocks the links close the last paragraph; bullets keep theirs apart (16 Oct 2026).
    if (linked && blocks && body.length) body[body.length - 1] += `\n${linked}`;
    else if (linked) body.push(linked);
    return [head, ...body].join('\n\n');
  };
  const lengths = groups.flat().map(() => 1500);
  let text = build(lengths);
  for (let guard = 0; text.length > LIMIT && guard < 40; guard++) { const at = lengths.indexOf(Math.max(...lengths)); lengths[at] = Math.max(40, Math.floor(lengths[at] * 0.7)); text = build(lengths); }
  return {text: text.slice(0, LIMIT), parse_mode: 'HTML', link_preview_options: {is_disabled: true}, disable_web_page_preview: true};
}
