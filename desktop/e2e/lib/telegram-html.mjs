// One formatter for the messages the alert bots send (owner, 16 Oct 2026): Telegram HTML with a bold title, a blank line, "•" bullets, named links, never a bare URL.
// Pure and dependency-free, so a Cloudflare Worker can import it as it is (the Sentry alerts bot does). Guard: e2e/test/telegram-html.test.mjs.
// Job: report health
//   alertHtml({icon, title, verdict, bullets: [{label, parts: [text | {text, url}]}], links: [{text, url}]}) -> {text, parse_mode: 'HTML', link_preview_options}
//   alertHtml({icon, title, verdict, blocks: [[{label?, bullet?, parts}]], links}): paragraphs of plain lines ("•" only where bullet is set); the links close the last one.
// parts: plain strings or {text, url} links (http/https only). sections: one alert per suite; expandable rows share a folded quote.
// Longer than Telegram's 4096: count omitted quote rows, then shorten prose without breaking markup.
export const LIMIT = 4096;
export const esc = text => String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const attr = url => esc(url).replace(/"/g, '&quot;');
export const link = (text, url) => (/^https?:\/\/[^\s"<>]+$/.test(String(url || '')) ? `<a href="${attr(url)}">${esc(text)}</a>` : esc(text));
const shorten = (text, max) => (text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1)).replace(/\s+\S*$/, '')}…`);
const part = (one, max) => typeof one === 'string' ? esc(shorten(one, max)) : link(shorten(one.text, max), one.url);
const line = (one, max) => `${one.bullet ? '• ' : ''}${one.label ? `${esc(one.label)}: ` : ''}${one.parts.map(item => part(item, max)).join('')}`;

// Adjacent expandable lines share one quote. Hidden rows are counted inside it, never cut through HTML.
function paragraph(group, max) {
  const rows = [], quote = [];
  const flush = () => { if (quote.length) rows.push(`<blockquote expandable>${quote.splice(0).join('\n')}</blockquote>`); };
  for (const one of group.lines) {
    if (one.expandable) quote.push(line(one, max));
    else { flush(); rows.push(line(one, max)); }
  }
  if (group.omitted) quote.push(`+${group.omitted} more`);
  flush();
  return rows.join('\n');
}

function sectionOf({icon = '', title = '', verdict = '', subtitle = '', bullets = [], blocks = null, links = []}) {
  const groups = blocks ? blocks.filter(group => group.length) : bullets.length ? [bullets.map(one => ({...one, bullet: true}))] : [];
  return {icon, title, verdict, subtitle, groups: groups.map(lines => ({lines: [...lines], omitted: 0})), links, blocks};
}

function sectionText(section, max) {
  const {icon, title, verdict, subtitle, groups, links, blocks} = section;
  const head = `${icon ? `${icon} ` : ''}<b>${esc(shorten(title, max))}</b>${verdict ? ` ${esc(shorten(verdict, max))}` : ''}`
    + (subtitle ? `\n     <i>${esc(shorten(subtitle, max))}</i>` : '');
  const body = groups.map(group => paragraph(group, max)).filter(Boolean);
  const linked = links.map(one => part(one, max)).join(' · ');
  // Why (30 Oct 2026, owner picked the short shape): in blocks the links close the last paragraph; bullets keep theirs apart (16 Oct 2026).
  if (linked && blocks && body.length) body[body.length - 1] += `\n${linked}`;
  else if (linked) body.push(linked);
  return [head, ...body].join('\n\n');
}

// Drop whole overflow steps before shortening prose. The footer and visible first two steps survive.
function dropOverflow(sections) {
  for (const section of [...sections].reverse()) for (const group of [...section.groups].reverse()) {
    const at = group.lines.findLastIndex(one => one.expandable);
    if (at < 0) continue;
    const [removed] = group.lines.splice(at, 1); group.omitted += removed.count || 1;
    return true;
  }
  return false;
}

// Extremely many causes/suites can exceed the limit even after prose is shortened; count whole omitted groups.
function dropGroup(sections) {
  for (const section of [...sections].reverse()) {
    if (section.groups.length <= 1) continue;
    const removed = section.groups.splice(section.groups.length - 2, 1)[0];
    section.omitted = (section.omitted || 0) + Math.max(1, removed.lines.reduce((count, one) => count + (one.count || Number(Boolean(one.step))), 0) + removed.omitted);
    return true;
  }
  if (sections.length <= 1) return false;
  sections.pop(); sections[0].omitted = (sections[0].omitted || 0) + 1;
  return true;
}

/**
 * Pure Telegram HTML payload. Sections separate suite alerts with a thin line; subtitles are muted with italics.
 * Expandable rows fold into quotes; overflow removes whole rows with a count. Escaping and closed tags survive the 4096-character cap.
 * The original bullets/blocks API remains available for other alert bots.
 */
export function alertHtml({sections = null, ...single}) {
  const state = (sections || [single]).map(sectionOf);
  let max = 1500;
  const build = () => state.map(section => sectionText(section, max)
    + (section.omitted ? `\n<blockquote expandable>+${section.omitted} more</blockquote>` : '')).join('\n\n─ ─ ─\n\n');
  let text = build();
  while (text.length > LIMIT) {
    if (!dropOverflow(state)) {
      if (max > 40) max = Math.max(40, Math.floor(max * 0.7));
      else if (!dropGroup(state)) {
        // A pathological URL/metadata line alone can exceed the cap; never return partial markup.
        text = `<b>${esc(shorten(state[0]?.title || 'Alert', 80))}</b>\n<blockquote expandable>+1 more</blockquote>`;
        break;
      }
    }
    text = build();
  }
  return {text, parse_mode: 'HTML', link_preview_options: {is_disabled: true}, disable_web_page_preview: true};
}
