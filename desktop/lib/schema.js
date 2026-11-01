// The user's Notion workspace, checked against config/notion_schema.json (the workspace as code, from
// tools/notion_schema.py): a missing column is added, a missing database or page is created next to the
// Profile page, so a workspace can always be rebuilt from scratch and never drifts from what the code needs.
// Runs when Notion is connected and at start-up. The only rename is a database still called by one of its schema
// "former_titles" (e.g. "Applications — Job Tracker" → "Job Tracker"): it gets the schema's title and description, once;
// a title the user chose is left alone. The only deletions are columns the schema lists as "retired" (a column the
// code stopped writing, e.g. Cronjob Runs' per-step costs), so every workspace follows. Views aren't in the API.
import fs from 'node:fs';
import path from 'node:path';
import {call, normalise} from './notion.js';   // Notion-only: the Notion workspace checked and repaired against config/notion_schema.json
// The repo's folder only (lib/root.js, a leaf): pipeline.js would pull the whole engine runner and the AI client into anything that checks the
// schema, the e2e harness's Notion stand-in included (it has only desktop/e2e's packages: '@anthropic-ai/sdk' not found on CI, 9 Oct 2026).
import {ROOT as REPO} from './root.js';

/** The one paragraph a page the app builds starts with; a page holding only this has nothing of the person's yet (lib/migrate.js 'strategy from this Mac' treats it as blank, #2759). */
export const PLACEHOLDER = 'Filled in by Jobadabra.';

export function load(file = path.join(REPO, 'config', 'notion_schema.json')) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

// A schema column -> the Notion API definition (relations need their target database's id).
export function apiProperty(column, targetId) {
  const {type} = column;
  if (type === 'select' || type === 'multi_select') return {[type]: {options: column.options || []}};
  if (type === 'number') return {number: {format: column.format || 'number'}};
  if (type === 'unique_id') return {unique_id: {prefix: null}};
  if (type === 'relation') return {relation: {database_id: targetId, ...(column.synced_property !== undefined
    ? {type: 'dual_property', dual_property: {}} : {type: 'single_property', single_property: {}})}};
  if (type === 'rollup') return {rollup: {relation_property_name: column.relation, rollup_property_name: column.property, function: column.function}};
  if (type === 'formula') return {formula: {expression: column.expression}};
  return {[type]: {}};
}
const PASSES = [type => !['relation', 'rollup', 'formula'].includes(type), type => type === 'relation', type => type === 'rollup', type => type === 'formula'];

// A database still called by a former title: the schema's title and description (null when nothing to do).
export function renameFor(db, liveTitle) {
  const former = new Set((db.former_titles || []).map(normalise));
  if (!liveTitle || !former.has(normalise(liveTitle)) || normalise(liveTitle) === normalise(db.title)) return null;
  return {title: [{text: {content: db.title}}], ...(db.description ? {description: [{text: {content: db.description}}]} : {})};
}

// -> {ids (with anything created), created: [titles], columns: ["Database: Column"], renamed: ["Old → New"],
//     manual: [steps Notion refused, for the user to do by hand]}
// root: the page to build in when the workspace is new (an empty page shared with the connection); else the
// parent of the Profile page.
export async function repair(token, ids, schema = load(), fetcher, root = null) {
  if (!schema || (!ids.NOTION_PROFILE_PAGE_ID && !root)) return {ids, created: [], columns: [], renamed: [], manual: []};
  const api = (method, route, body) => call(token, method, route, body, fetcher);
  const out = {ids: {...ids}, created: [], columns: [], renamed: [], manual: []};
  const parent = async () => {
    root ||= (await api('GET', `pages/${ids.NOTION_PROFILE_PAGE_ID}`)).parent?.page_id;
    if (!root) throw new Error('The Profile page has no parent page to create the missing parts in');
    return root;
  };

  // Databases the workspace lacks: created with their plain columns (the rest follow in the passes below).
  const have = {}, existing = {};
  for (const [env, db] of Object.entries(schema.databases)) {
    if (out.ids[env]) {
      const live = await api('GET', `databases/${out.ids[env]}`);
      existing[env] = live.properties || {};
      have[env] = new Set(Object.keys(existing[env]));
      const liveTitle = (live.title || []).map(t => t.plain_text ?? t.text?.content ?? '').join('');
      const rename = renameFor(db, liveTitle);
      if (rename) {
        await api('PATCH', `databases/${out.ids[env]}`, rename);
        out.renamed.push(`${liveTitle} → ${db.title}`);
      }
      continue;
    }
    const properties = Object.fromEntries(Object.entries(db.columns).filter(([, c]) => PASSES[0](c.type)).map(([name, c]) => [name, apiProperty(c)]));
    const made = await api('POST', 'databases', {parent: {page_id: await parent()}, title: [{text: {content: db.title}}],
      ...(db.icon ? {icon: {type: 'emoji', emoji: db.icon}} : {}), ...(db.description ? {description: [{text: {content: db.description}}]} : {}),
      properties});
    out.ids[env] = made.id.replace(/-/g, '');
    have[env] = new Set(Object.keys(properties));
    out.created.push(db.title);
  }

  // One-way relations the schema now wants two-way (e.g. Cronjob Runs → Application, whose other side "Runs" lists a
  // job's runs on its page): the existing column is switched to a synced (dual_property) relation in place, so its
  // links stay and show on the other side at once; Notion then names that side itself and it gets the schema's name.
  // Left alone: a relation already two-way, one pointing at another database, or a target that already has the
  // schema's name (the user's own column). API limits: the PATCH /databases relation update accepts type
  // "dual_property" on an existing relation, but Notion doesn't document converting one in place (it may refuse,
  // e.g. on an older workspace or without edit access to the target); then nothing changes, the rest of the repair
  // goes on, `manual` says what to do by hand (the column's menu → "Show on <target>"), and no second relation is
  // created (a new one would stay empty: the code writes the existing column).
  for (const [env, db] of Object.entries(schema.databases)) {
    for (const [name, column] of Object.entries(db.columns)) {
      const live = existing[env]?.[name]?.relation;
      const target = out.ids[column.database];
      if (column.type !== 'relation' || !column.synced_property || !live || !target || !have[column.database]) continue;
      const bare = id => String(id || '').replace(/-/g, '').toLowerCase();
      if (live.database_id && bare(live.database_id) !== bare(target)) continue;
      if (live.type === 'dual_property' || have[column.database].has(column.synced_property)) {
        have[column.database].add(column.synced_property);  // its other side exists, maybe under another name: never a second one
        continue;
      }
      have[column.database].add(column.synced_property);
      try {
        const before = new Set(Object.keys((await api('GET', `databases/${target}`)).properties || {}));
        await api('PATCH', `databases/${out.ids[env]}`, {properties: {[name]: apiProperty(column, target)}});
        const synced = Object.keys((await api('GET', `databases/${target}`)).properties || {}).find(n => !before.has(n));
        if (!synced) throw new Error('Notion kept it one-way');
        if (synced !== column.synced_property) await api('PATCH', `databases/${target}`, {properties: {[synced]: {name: column.synced_property}}});
        out.columns.push(`${db.title}: ${name} (two-way, "${column.synced_property}" on ${schema.databases[column.database].title})`);
      } catch (error) {
        out.manual.push(`${db.title}: open the "${name}" column's menu → Relation → turn on "Show on ${schema.databases[column.database].title}", `
          + `named "${column.synced_property}" (Notion refused to do it: ${error.message})`);
      }
    }
  }

  // Missing columns, in dependency order: plain, relations, rollups, formulas.
  for (const pass of PASSES) {
    for (const [env, db] of Object.entries(schema.databases)) {
      for (const [name, column] of Object.entries(db.columns)) {
        if (!pass(column.type) || have[env].has(name) || column.type === 'title') continue;
        if (column.type === 'relation') {
          const target = out.ids[column.database];
          if (!target) continue;
          const before = column.synced_property ? new Set(Object.keys((await api('GET', `databases/${target}`)).properties || {})) : null;
          await api('PATCH', `databases/${out.ids[env]}`, {properties: {[name]: apiProperty(column, target)}});
          if (before) {  // two-way: Notion names the other side itself; give it the schema's name
            const after = Object.keys((await api('GET', `databases/${target}`)).properties || {});
            const synced = after.find(n => !before.has(n));
            if (synced && synced !== column.synced_property && !before.has(column.synced_property)) {
              await api('PATCH', `databases/${target}`, {properties: {[synced]: {name: column.synced_property}}});
            }
            have[column.database]?.add(column.synced_property);
          }
        } else {
          await api('PATCH', `databases/${out.ids[env]}`, {properties: {[name]: apiProperty(column)}});
        }
        have[env].add(name);
        out.columns.push(`${db.title}: ${name}`);
      }
    }
  }

  // Missing choices in existing select columns (e.g. a new Stage): Notion refuses a filter on a choice it
  // doesn't have. The column's current choices are sent back as they are, so none is lost or recoloured.
  for (const [env, db] of Object.entries(schema.databases)) {
    for (const [name, column] of Object.entries(db.columns)) {
      const current = existing[env]?.[name]?.[column.type]?.options;
      if (!['select', 'multi_select'].includes(column.type) || !current) continue;
      const missing = (column.options || []).filter(option => !current.some(o => o.name === option.name));
      if (!missing.length) continue;
      await api('PATCH', `databases/${out.ids[env]}`, {properties: {[name]: {[column.type]: {options: [
        ...current.map(({id, name: label}) => ({id, name: label})), ...missing.map(({name: label, color}) => ({name: label, color}))]}}}});
      out.columns.push(...missing.map(option => `${db.title}: ${name} → ${option.name}`));
    }
  }

  // Retired columns (the schema's "retired" list): removed where they still exist, in every workspace.
  for (const [env, db] of Object.entries(schema.databases)) {
    const gone = (db.retired || []).filter(name => existing[env]?.[name] && !db.columns[name]);
    if (!gone.length) continue;
    await api('PATCH', `databases/${out.ids[env]}`, {properties: Object.fromEntries(gone.map(name => [name, null]))});
    out.columns.push(...gone.map(name => `${db.title}: ${name} (removed)`));
  }

  // Pages the code reads (the app's own pages, like Search settings, are made by their modules).
  for (const [env, page] of Object.entries(schema.pages)) {
    if (out.ids[env] || page.made_by) continue;
    const made = await api('POST', 'pages', {parent: {page_id: await parent()}, icon: {type: 'emoji', emoji: page.emoji},
      properties: {title: {title: [{text: {content: page.title}}]}},
      children: [{object: 'block', type: 'paragraph', paragraph: {rich_text: [{type: 'text', text: {content: PLACEHOLDER}}]}}]});
    out.ids[env] = made.id.replace(/-/g, '');
    out.created.push(page.title);
  }
  return out;
}
