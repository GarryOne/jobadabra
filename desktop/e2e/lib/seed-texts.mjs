// The person's texts (the Profile, src/stores/base.py TEXTS) and everything the store holds, read and changed through the store the app uses (ctx.data,
// lib/store-call.mjs), so a suite works the same on this Mac's store (profile.md) and on Notion (the Profile page, read and written whole: its child pages
// and files are kept, src/stores/notion_texts.py). P7 step 4. Guarded by test/seed-texts.test.mjs.

// Every line of a text matching `pattern` replaced by `line`, keeping its indent and list marker ("- "), so a bullet stays a bullet. -> how many lines changed
// (the caller says how many it expects).
export async function rewriteTextLines(ctx, name, pattern, line) {
  const text = (await ctx.data('texts', 'get', {name})) || '';
  if (!text.trim()) throw new Error(`the store holds no ${name} text`);
  let changed = 0;
  const next = text.split('\n').map(current => (pattern.test(current) ? (changed++, `${current.match(/^\s*(?:[-*+]\s+)?/)[0]}${line}`) : current)).join('\n');
  if (changed) await ctx.data('texts', 'set', {name, markdown: next});
  return changed;
}

export const textOf = (ctx, name) => ctx.data('texts', 'get', {name});

// The text as the engine's AI reads it (texts.plain: Notion's page text, this Mac's file), for a judge that must see what the scoring saw.
export const plainTextOf = (ctx, name) => ctx.data('texts', 'plain', {name});

// All the person's data as one text, for a check that greps what features stored (no field may carry another user's words). Read-only.
const ENTITIES = [['matches', {}], ['applications', {}], ['employers', {active: null}], ['cron_runs', {}], ['events', {}], ['interviews', {}]];
export async function storeText(ctx) {
  const parts = [];
  for (const [entity, kwargs] of ENTITIES) for (const record of (await ctx.data(entity, 'list', kwargs)) || []) parts.push(`${entity}: ${JSON.stringify(record)}`);
  parts.push(`profile: ${await textOf(ctx, 'profile')}`);
  return parts.join('\n');
}
