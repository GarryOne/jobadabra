// Structural destinations for saved-line organization: existing store headings and the sections already owned by Profile's screens.
import {SECTIONS} from './profile-sections.js';
import {PARTS, splitNote} from '../renderer/experience-profile-model.js';
import {STYLE_HEADING, isStyle} from '../renderer/writing-preferences-model.js';

const bare = text => String(text || '').replace(/^[^\p{L}\p{N}]+/u, '').trim().toLowerCase();
/** Outline IDs to section paths, including table rows; paths survive Markdown line-number changes. */
export function contexts(outline) {
  const result = new Map(), stack = [];
  for (const entry of outline) {
    if (entry.type?.startsWith('heading_')) {
      const depth = Number(entry.type.slice(-1));
      while (stack.length && stack.at(-1).depth >= depth) stack.pop();
      stack.push({depth, text: entry.text});
    }
    const path = stack.map(each => each.text);
    result.set(entry.id, path);
    for (const row of entry.rows || []) result.set(row.id, path);
  }
  return result;
}
/** Catalogue actual headings and missing canonical UI sections; AI picks only an ID from this catalogue. */
export function destinations(outlines) {
  const canonical = [
    ...Object.entries(SECTIONS).map(([id, heading]) => ({id, page: 'profile', heading, matches: title => bare(title) === bare(heading)})),
    {id: 'writing', page: 'answers', heading: STYLE_HEADING, matches: isStyle},
    ...Object.entries(PARTS).map(([key, part]) => ({id: `part:${key}`, page: 'profile', heading: part.heading, matches: title => part.match.test(splitNote(title).title)})),
  ];
  const result = [];
  for (const [page, outline] of Object.entries(outlines)) {
    const paths = contexts(outline);
    for (const entry of outline.filter(each => each.type?.startsWith('heading_'))) {
      const own = canonical.find(each => each.page === page && each.matches(entry.text));
      if (own && result.some(each => each.id === own.id)) continue;   // the same heading the existing editor owns
      result.push({id: own?.id || `section:${page}:${entry.id}`, page, heading: entry.text, path: paths.get(entry.id), canonical: Boolean(own)});
    }
  }
  for (const each of canonical) if (!result.some(dest => dest.id === each.id)) result.push({id: each.id, page: each.page, heading: each.heading, path: [each.heading], canonical: true});
  return result;
}
/** Locate a destination by its path, never by a stale Markdown block ID. */
export function headingIn(outline, destination) {
  const paths = contexts(outline), identity = JSON.stringify(destination.path);
  return outline.find(each => each.type?.startsWith('heading_') && JSON.stringify(paths.get(each.id)) === identity);
}
