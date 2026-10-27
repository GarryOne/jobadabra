// An in-memory Notion for the e2e suites (6 Oct 2026, the hybrid plan): fresh, private and instant for every suite run, so no token, no shared page, no leftovers
// and no lag. It answers exactly the requests the app and the engine make (docs/notion-surface.md), in Notion's own response shapes, at the URL the app already
// honours in a test run (JOB_PILOTTO_E2E_NOTION_BASE_URL). Real Notion behaviour the app must handle is kept where it is cheap (editing an archived page fails);
// lag is off unless a suite turns it on (`setLag(ms)`, 27 Oct 2026: focusdismiss, which is about Notion listing a write late): then a database query answers
// each row as it stood `ms` ago, as Notion's query does, while a page read by its id is fresh. `seed(snapshot)` loads a scenario as plain data.
import crypto from 'node:crypto';
import http from 'node:http';

const uuid = () => crypto.randomUUID();
// Notion answers every id with dashes, whatever the request sent (6 Oct 2026: the stand-in echoed a dashless parent as sent, and the app's discover(), which groups a
// workspace's items by their parent id, split one workspace in two and never found the Profile page).
const dashed = id => { const hex = String(id || '').replace(/-/g, ''); return /^[0-9a-f]{32}$/i.test(hex) ? `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}` : id; };
const parentOut = parent => (parent ? Object.fromEntries(Object.entries(parent).map(([k, v]) => [k, /_id$/.test(k) ? dashed(v) : v])) : parent);
const now = () => new Date().toISOString();
const plain = rich => (rich || []).map(part => part.plain_text ?? part.text?.content ?? '').join('');
const richOut = rich => (rich || []).map(part => {
  const content = part.text?.content ?? part.plain_text ?? '';
  return {type: 'text', text: {content, link: part.text?.link || null}, annotations: {bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default', ...(part.annotations || {})},
    plain_text: content, href: part.text?.link?.url || null};
});
const error = (status, code, message) => ({status, body: {object: 'error', status, code, message}});

// A property value as Notion returns it, from the value a request wrote (`type` from the database's column, or the key the request used).
function valueOut(type, written) {
  switch (type) {
    case 'title': case 'rich_text': return richOut(written);
    case 'select': return written ? {name: written.name, color: 'default', id: written.id || written.name} : null;
    case 'multi_select': return (written || []).map(option => ({name: option.name, color: 'default', id: option.id || option.name}));
    case 'date': return written ? {start: written.start, end: written.end || null, time_zone: null} : null;
    case 'relation': return (written || []).map(item => ({id: dashed(item.id)}));
    case 'files': return written || [];
    case 'people': return written || [];
    default: return written ?? null;   // url, number, checkbox, email, phone_number
  }
}
const typeOfWritten = value => Object.keys(value || {}).find(key => !['id', 'type', 'name'].includes(key));

export function createNotionFake({clock = () => Date.now()} = {}) {
  // Notion takes an id with or without dashes: so does the stand-in (the app sends both).
  const key = id => String(id).replace(/-/g, '');
  const store = new Map(), lists = new Map();
  const objects = {get: id => store.get(key(id)), set: (id, value) => store.set(key(id), value), has: id => store.has(key(id)), values: () => store.values()};
  const children = {has: id => lists.has(key(id)), get: id => lists.get(key(id)), set: (id, value) => lists.set(key(id), value)};
  const uploads = new Map();
  // The listing lag: each database row's states while it is on ({at, json}); a row with none is listed as it is (it predates the lag).
  let lagMs = 0;
  const past = new Map();
  const dbRows = () => [...store.values()].filter(item => item.object === 'page' && item.parent?.type === 'database_id');
  const remember = at => { for (const item of dbRows()) { const list = past.get(item.id) || [], json = JSON.stringify(item); if (list.at(-1)?.json !== json) { list.push({at, json}); past.set(item.id, list); } } };
  const asListed = item => { if (!lagMs || !past.has(item.id)) return item; const seen = past.get(item.id).filter(state => state.at <= clock() - lagMs).at(-1); return seen ? JSON.parse(seen.json) : null; };
  const setLag = ms => { lagMs = Math.max(0, Number(ms) || 0); past.clear(); if (lagMs) remember(-Infinity); };
  let base = '';   // the server's own URL (startNotionFake sets it): an uploaded file is served from there, as Notion serves it from its storage
  const stats = {calls: 0, writes: 0, unknown: []};   // unknown: what the stand-in could not answer as Notion would (a gap to add, never the app's fault)
  const gap = (status, code, message) => { if (!stats.unknown.includes(message)) stats.unknown.push(message); return error(status, code, message); };
  const kids = id => { if (!children.has(id)) children.set(id, []); return children.get(id); };
  // A two-way relation (type dual_property) gets its other side on the target database, as Notion does: "Related to <title> (<column>)" until the
  // app renames it (lib/schema.js). Without it a second install's connect found the synced columns missing (9 Oct 2026, calendar's second app).
  const pairOf = (db, name) => {
    const column = db.properties[name], relation = column?.relation, target = objects.get(relation?.database_id || '');
    if (column?.type !== 'relation' || relation.type !== 'dual_property' || relation.dual_property?.synced_property_id || target?.object !== 'database') return;
    const other = `Related to ${plain(db.title)} (${name})`, id = uuid().slice(0, 4);
    target.properties[other] = {id, name: other, type: 'relation', relation: {database_id: dashed(db.id), type: 'dual_property', dual_property: {synced_property_name: name, synced_property_id: column.id}}};
    relation.database_id = dashed(target.id);
    relation.dual_property = {synced_property_name: other, synced_property_id: id};
    target.last_edited_time = now();
  };
  const root = {object: 'page', id: uuid(), created_time: now(), last_edited_time: now(), archived: false, in_trash: false, parent: {type: 'workspace', workspace: true},
    properties: {title: {id: 'title', type: 'title', title: richOut([{text: {content: 'Job Pilotto E2E'}}])}}, url: ''};
  objects.set(root.id, root);

  const columnsOf = db => db.properties;
  // What Notion refuses before writing anything (400 validation_error, naming the property): a date that is not ISO 8601, a number that is not a number.
  // 9 Oct 2026: the stand-in stored any date, and a later read of the run history failed on it ("Invalid time value"), far from the write that caused it.
  const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/;
  function invalid(written, db) {
    for (const [name, value] of Object.entries(written || {})) {
      const type = (db ? columnsOf(db)[name]?.type : null) || typeOfWritten(value), v = value && typeof value === 'object' && type in value ? value[type] : value;
      if (type === 'date' && v !== null && !ISO_DATE.test(String(v?.start))) return `body failed validation: body.properties.${name}.date.start should be a valid ISO 8601 date string, instead was \`${JSON.stringify(v?.start)}\`.`;
      if (type === 'number' && v !== null && !(typeof v === 'number' && Number.isFinite(v))) return `body failed validation: body.properties.${name}.number should be a number or \`null\`, instead was \`${JSON.stringify(v)}\`.`;
    }
    return '';
  }
  function setProperties(page, written, db) {
    for (const [name, value] of Object.entries(written || {})) {
      const column = db ? columnsOf(db)[name] : {id: 'title', type: 'title'};
      const type = column?.type || typeOfWritten(value);
      page.properties[name] = {id: column?.id || name, type, [type]: valueOut(type, value[type] ?? value)};
    }
    if (db) for (const [name, column] of Object.entries(columnsOf(db))) if (!page.properties[name]) page.properties[name] = {id: column.id, type: column.type, [column.type]: valueOut(column.type, undefined)};
  }
  function makeBlocks(parentId, list, after) {
    const made = (list || []).map(block => {
      const type = block.type || typeOfWritten(block);
      const content = {...(block[type] || {})};
      if (content.rich_text) content.rich_text = richOut(content.rich_text);
      const inner = content.children; delete content.children;
      // A file block that names an upload reads back as Notion's own: a hosted file with a URL and the upload's name.
      if (content.type === 'file_upload' && uploads.has(content.file_upload?.id)) {
        const upload = uploads.get(content.file_upload.id);
        Object.assign(content, {type: 'file', file: {url: `${base}/files/${upload.id}`, expiry_time: now()}, name: upload.filename, caption: content.caption || []});
        delete content.file_upload;
      }
      const item = {object: 'block', id: uuid(), parent: {type: 'block_id', block_id: dashed(parentId)}, type, [type]: content, has_children: false, archived: false, in_trash: false,
        created_time: now(), last_edited_time: now()};
      objects.set(item.id, item);
      if (inner?.length) { makeBlocks(item.id, inner); item.has_children = true; }
      return item.id;
    });
    const list2 = kids(parentId), at = after ? list2.indexOf(after) + 1 : list2.length;
    list2.splice(at > 0 ? at : list2.length, 0, ...made);
    const parent = objects.get(parentId); if (parent?.object === 'block') parent.has_children = true;
    return made.map(id => objects.get(id));
  }
  // Notion: a change to any block in a page is a change to the page (its last_edited_time), which the engine's kept page copies rely on (src/notion/client.py
  // _kept_page_text). 9 Oct 2026: without it the engine kept reading its old Search settings after the page was edited.
  const touch = id => {
    for (let item = objects.get(id), hops = 0; item && hops < 20; hops++) {
      item.last_edited_time = now();
      if (item.object === 'page' || item.object === 'database') return;
      item = objects.get(item.parent?.block_id || item.parent?.page_id || '');
    }
  };
  const live = item => item && !item.archived;
  const page = (items, cursor, size = 100) => {
    const start = Number(cursor || 0), slice = items.slice(start, start + Math.min(Number(size) || 100, 100));
    const more = start + slice.length < items.length;
    return {object: 'list', results: slice, has_more: more, next_cursor: more ? String(start + slice.length) : null, type: 'page_or_database'};
  };

  // Filters: exactly the operators the app uses (docs/notion-surface.md), on `and` / `or` trees.
  function matches(item, filter) {
    if (!filter) return true;
    if (filter.and) return filter.and.every(part => matches(item, part));
    if (filter.or) return filter.or.some(part => matches(item, part));
    const property = item.properties[filter.property];
    const type = Object.keys(filter).find(key => key !== 'property');
    const [op, wanted] = Object.entries(filter[type])[0];
    const value = property?.[property?.type];
    const text = Array.isArray(value) && property?.type !== 'relation' && property?.type !== 'multi_select' ? plain(value) : value;
    switch (`${type}.${op}`) {
      case 'select.equals': case 'status.equals': return value?.name === wanted;
      case 'select.is_not_empty': return !!value?.name;
      case 'select.is_empty': return !value?.name;
      case 'multi_select.contains': return (value || []).some(option => option.name === wanted);
      case 'url.equals': return value === wanted;
      case 'url.does_not_equal': return value !== wanted;
      case 'url.contains': return String(value || '').toLowerCase().includes(String(wanted).toLowerCase());
      case 'url.does_not_contain': return !String(value || '').toLowerCase().includes(String(wanted).toLowerCase());
      case 'url.starts_with': return String(value || '').toLowerCase().startsWith(String(wanted).toLowerCase());
      case 'url.ends_with': return String(value || '').toLowerCase().endsWith(String(wanted).toLowerCase());
      case 'url.is_empty': return !value;
      case 'url.is_not_empty': return !!value;
      case 'relation.is_empty': return !(value || []).length;
      case 'relation.contains': return (value || []).some(link => link.id.replace(/-/g, '') === String(wanted).replace(/-/g, ''));
      case 'rich_text.equals': case 'title.equals': return text === wanted;
      case 'rich_text.contains': case 'title.contains': return String(text || '').toLowerCase().includes(String(wanted).toLowerCase());
      case 'rich_text.is_not_empty': case 'title.is_not_empty': return !!text;
      case 'rich_text.is_empty': case 'title.is_empty': return !text;
      case 'date.on_or_after': return !!value?.start && value.start.slice(0, 10) >= String(wanted).slice(0, 10);
      case 'date.on_or_before': return !!value?.start && value.start.slice(0, 10) <= String(wanted).slice(0, 10);
      case 'date.equals': return !!value?.start && value.start.slice(0, 10) === String(wanted).slice(0, 10);
      case 'date.is_not_empty': return !!value?.start;
      case 'checkbox.equals': return !!value === !!wanted;
      case 'number.greater_than': return typeof value === 'number' && value > wanted;
      case 'number.equals': return value === wanted;
      default: throw Object.assign(new Error(`the Notion stand-in does not know the filter ${type}.${op}: add it (docs/notion-surface.md)`), {unknown: true});
    }
  }
  function sortKey(item, sort) {
    if (sort.timestamp) return item[sort.timestamp];
    const property = item.properties[sort.property], value = property?.[property?.type];
    if (value == null) return '';
    if (property.type === 'date') return value.start || '';
    if (property.type === 'select') return value.name || '';
    if (Array.isArray(value)) return plain(value);
    return value;
  }

  function handle(method, path, body, query, raw) {
    const out = respond(method, path, body, query, raw);
    if (lagMs && method !== 'GET' && !path.endsWith('/query')) remember(clock());
    return out;
  }
  function respond(method, path, body, query, raw) {
    stats.calls++;
    if (method !== 'GET') stats.writes++;
    let m;
    if (method === 'GET' && path === 'users/me') return {status: 200, body: {object: 'user', id: uuid(), type: 'bot', name: 'Job Pilotto E2E', bot: {workspace_name: 'Job Pilotto 2 (stand-in)'}}};
    if (method === 'POST' && path === 'search') {
      const words = String(body.query || '').toLowerCase(), kind = body.filter?.value;
      const found = [...objects.values()].filter(item => live(item) && (item.object === 'page' || item.object === 'database') && (!kind || item.object === kind)
        && (item.object === 'database' ? plain(item.title) : plain(Object.values(item.properties).find(p => p.type === 'title')?.title)).toLowerCase().includes(words));
      return {status: 200, body: page(found, body.start_cursor, body.page_size)};
    }
    if (method === 'POST' && path === 'databases') {
      const id = uuid(), properties = {};
      for (const [name, column] of Object.entries(body.properties || {})) { const type = typeOfWritten(column); properties[name] = {id: name === 'title' ? 'title' : uuid().slice(0, 4), name, type, [type]: column[type] || {}}; }
      const db = {object: 'database', id, title: richOut(body.title), description: [], properties, parent: parentOut(body.parent), created_time: now(), last_edited_time: now(),
        archived: false, in_trash: false, is_inline: !!body.is_inline, url: `https://www.notion.so/${id.replace(/-/g, '')}`};
      objects.set(id, db);
      for (const name of Object.keys(properties)) pairOf(db, name);
      const parentId = body.parent?.page_id;
      if (parentId) { const block = {object: 'block', id, parent: {type: 'page_id', page_id: dashed(parentId)}, type: 'child_database', child_database: {title: plain(db.title)}, has_children: false, archived: false}; kids(parentId).push(id); objects.set(`${id}#block`, block); }
      return {status: 200, body: db};
    }
    if ((m = /^databases\/([^/]+)\/query$/.exec(path)) && method === 'POST') {
      const db = objects.get(m[1]); if (!live(db) || db.object !== 'database') return error(404, 'object_not_found', `Could not find database with ID: ${m[1]}.`);
      let rows = [...objects.values()].filter(item => item.object === 'page').map(asListed).filter(item => live(item) && key(item.parent?.database_id || '') === key(db.id));
      try { rows = rows.filter(row => matches(row, body.filter)); } catch (problem) { return (problem.unknown ? gap : error)(400, 'validation_error', problem.message); }
      for (const sort of [...(body.sorts || [])].reverse()) rows.sort((a, b) => { const x = sortKey(a, sort), y = sortKey(b, sort); return (x < y ? -1 : x > y ? 1 : 0) * (sort.direction === 'descending' ? -1 : 1); });
      if (!body.sorts?.length) rows.sort((a, b) => (a.created_time < b.created_time ? 1 : -1));   // Notion: newest first by default
      return {status: 200, body: page(rows, body.start_cursor, body.page_size)};
    }
    if ((m = /^databases\/([^/]+)$/.exec(path))) {
      const db = objects.get(m[1]); if (!live(db) || db.object !== 'database') return error(404, 'object_not_found', `Could not find database with ID: ${m[1]}.`);
      if (method === 'GET') return {status: 200, body: db};
      if (method === 'PATCH') {
        if (body.title) db.title = richOut(body.title);
        for (const [name, column] of Object.entries(body.properties || {})) {
          if (column === null) { delete db.properties[name]; continue; }
          if (column.name && column.name !== name && db.properties[name]) {
            const renamed = db.properties[column.name] = {...db.properties[name], name: column.name}; delete db.properties[name];
            const partner = renamed.relation?.dual_property && objects.get(renamed.relation.database_id || '')?.properties;   // the other side follows the new name
            for (const other of Object.values(partner || {})) if (other.relation?.dual_property?.synced_property_id === renamed.id) other.relation.dual_property.synced_property_name = column.name;
            continue;
          }
          const type = typeOfWritten(column) || db.properties[name]?.type;
          db.properties[name] = {...(db.properties[name] || {id: uuid().slice(0, 4), name}), type, [type]: {...(db.properties[name]?.[type] || {}), ...(column[type] || {})}};
          pairOf(db, name);
        }
        db.last_edited_time = now();
        return {status: 200, body: db};
      }
    }
    if (method === 'POST' && path === 'pages') {
      const dbId = body.parent?.database_id, db = dbId ? objects.get(dbId) : null;
      if (dbId && !live(db)) return error(404, 'object_not_found', `Could not find database with ID: ${dbId}.`);
      const bad = invalid(body.properties, db); if (bad) return error(400, 'validation_error', bad);
      const id = uuid(), item = {object: 'page', id, created_time: now(), last_edited_time: now(), archived: false, in_trash: false,
        parent: dbId ? {type: 'database_id', database_id: dashed(dbId)} : {type: 'page_id', page_id: dashed(body.parent?.page_id)}, properties: {}, icon: body.icon || null, url: `https://www.notion.so/${id.replace(/-/g, '')}`};
      setProperties(item, body.properties, db);
      objects.set(id, item);
      if (!dbId && body.parent?.page_id) { kids(body.parent.page_id).push(id); objects.set(`${id}#block`, {object: 'block', id, type: 'child_page', child_page: {title: plain(item.properties.title?.title)}, has_children: true, archived: false}); }
      if (body.children?.length) makeBlocks(id, body.children);
      return {status: 200, body: item};
    }
    if ((m = /^pages\/([^/]+)$/.exec(path))) {
      const item = objects.get(m[1]); if (!item || item.object !== 'page') return error(404, 'object_not_found', `Could not find page with ID: ${m[1]}.`);
      if (method === 'GET') return {status: 200, body: item};
      if (method === 'PATCH') {
        // Real Notion: an archived page cannot be edited, not even archived again (the e2e met that on 6 Oct 2026; lib/notion.mjs trashPage handles it).
        if (item.archived && body.archived !== false) return error(400, 'validation_error', "Can't edit block that is archived. You must unarchive the block before editing.");
        const bad = invalid(body.properties, item.parent?.database_id ? objects.get(item.parent.database_id) : null); if (bad) return error(400, 'validation_error', bad);
        if ('archived' in body || 'in_trash' in body) item.archived = item.in_trash = !!(body.archived ?? body.in_trash);
        if (body.icon !== undefined) item.icon = body.icon;
        setProperties(item, body.properties, item.parent?.database_id ? objects.get(item.parent.database_id) : null);
        item.last_edited_time = now();
        return {status: 200, body: item};
      }
    }
    if ((m = /^blocks\/([^/]+)\/children$/.exec(path))) {
      const parentId = m[1];
      if (!objects.has(parentId)) return error(404, 'object_not_found', `Could not find block with ID: ${parentId}.`);
      if (method === 'GET') return {status: 200, body: {...page(kids(parentId).map(id => objects.get(`${id}#block`) || objects.get(id)).filter(live), query.get('start_cursor'), query.get('page_size')), type: 'block', block: {}}};
      if (method === 'PATCH') { const made = makeBlocks(parentId, body.children, body.after); touch(parentId); return {status: 200, body: {object: 'list', results: made, has_more: false, next_cursor: null, type: 'block', block: {}}}; }
    }
    if ((m = /^blocks\/([^/]+)$/.exec(path))) {
      const item = objects.get(`${m[1]}#block`) || objects.get(m[1]);
      if (!live(item)) return error(404, 'object_not_found', `Could not find block with ID: ${m[1]}.`);
      if (method === 'GET') return {status: 200, body: item};
      if (method === 'DELETE') { item.archived = true; touch(item.id); return {status: 200, body: item}; }
      if (method === 'PATCH') { const type = item.type; if (body[type]) { item[type] = {...item[type], ...body[type], ...(body[type].rich_text ? {rich_text: richOut(body[type].rich_text)} : {})}; } touch(item.id); return {status: 200, body: item}; }
    }
    if (method === 'POST' && path === 'file_uploads') { const id = uuid(); uploads.set(id, {id, filename: body.filename, status: 'pending'}); return {status: 200, body: {object: 'file_upload', id, status: 'pending', filename: body.filename, upload_url: `/v1/file_uploads/${id}/send`}}; }
    if ((m = /^files\/([^/]+)$/.exec(path)) && method === 'GET' && uploads.get(m[1])?.data) { const item = uploads.get(m[1]); return {status: 200, body: item.data, type: item.content_type}; }
    if ((m = /^file_uploads\/([^/]+)\/send$/.exec(path)) && method === 'POST') { const item = uploads.get(m[1]); if (!item) return error(404, 'object_not_found', 'no such upload'); item.status = 'uploaded'; Object.assign(item, fileOf(raw)); return {status: 200, body: {object: 'file_upload', ...item}}; }
    return gap(400, 'invalid_request_url', `the Notion stand-in does not know ${method} ${path.replace(/[0-9a-f-]{32,36}/gi, '<id>')}: add it (docs/notion-surface.md)`);
  }

  // A scenario as plain data: {databases: [{title, properties: {name: {type: {...}}}, rows: [{name: value-as-written}]}], pages: [{title, children: [blocks]}]}.
  function seed(snapshot = {}) {
    const ids = {};
    for (const spec of snapshot.databases || []) {
      const db = handle('POST', 'databases', {parent: {page_id: root.id}, title: [{text: {content: spec.title}}], properties: spec.properties}, new URLSearchParams()).body;
      ids[spec.title] = db.id;
      for (const row of spec.rows || []) handle('POST', 'pages', {parent: {database_id: db.id}, properties: row}, new URLSearchParams());
    }
    for (const spec of snapshot.pages || []) ids[spec.title] = handle('POST', 'pages', {parent: {page_id: root.id}, properties: {title: {title: [{text: {content: spec.title}}]}}, children: spec.children}, new URLSearchParams()).body.id;
    return ids;
  }
  // Evidence: what the stand-in held, written beside a suite's artifacts when it closes (a page or database missing or misnamed shows here at once).
  const dump = () => [...store.values()].filter(item => item.object !== 'block' || item.type === 'child_page' || item.type === 'child_database').map(item => ({object: item.object, id: item.id,
    parent: item.parent, archived: !!item.archived, title: item.object === 'database' ? plain(item.title) : plain(Object.values(item.properties || {}).find(p => p.type === 'title')?.title),
    ...(item.object === 'database' ? {rows: [...store.values()].filter(row => row.object === 'page' && key(row.parent?.database_id || '') === key(item.id)).length} : {})})).filter(item => item.object !== 'page' || item.parent?.type !== 'database_id');
  return {root, objects, stats, handle, seed, dump, setLag, setBase: url => { base = url; }};
}

// The file part of a multipart upload body: its bytes and type (Buffer in, Buffer out; no parser for one part).
function fileOf(raw) {
  if (!Buffer.isBuffer(raw)) return {};
  const start = raw.indexOf('\r\n\r\n'), boundary = raw.subarray(2, raw.indexOf('\r\n'));
  const end = raw.lastIndexOf(Buffer.concat([Buffer.from('\r\n--'), boundary]));
  if (start < 0 || end < start) return {};
  const head = raw.subarray(0, start).toString(), type = /Content-Type:\s*([^\r\n]+)/i.exec(head)?.[1] || 'application/octet-stream';
  return {data: raw.subarray(start + 4, end), content_type: type};
}

// Its own token per run, shaped like Notion's: a leak check that looks for the token in the logs (quality, activity) works as on real Notion, and a request
// with any other token gets Notion's 401. Files are served without one (Notion's file links are plain signed URLs).
export async function startNotionFake() {
  const fake = createNotionFake();
  const token = `ntn_e2e_${crypto.randomBytes(18).toString('hex')}`;
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks), multipart = String(req.headers['content-type'] || '').startsWith('multipart/');
    const url = new URL(req.url, 'http://fake');
    const path = url.pathname.replace(/^\/(v1\/)?/, '');
    let body = {}; try { body = raw.length && !multipart ? JSON.parse(raw.toString()) : {}; } catch { body = {}; }
    if (!path.startsWith('files/') && req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(401, {'content-type': 'application/json'});
      res.end(JSON.stringify({object: 'error', status: 401, code: 'unauthorized', message: 'API token is invalid.'}));
      return;
    }
    const {status, body: out, type} = fake.handle(req.method, path, body, url.searchParams, multipart ? raw : undefined);
    res.writeHead(status, {'content-type': type || 'application/json'});
    res.end(type ? out : JSON.stringify(out));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  fake.setBase(`http://127.0.0.1:${server.address().port}`);
  return {...fake, token, url: `http://127.0.0.1:${server.address().port}`, close: () => { server.closeAllConnections?.(); return new Promise(resolve => server.close(resolve)); }};
}

// The workspace built once in a fresh stand-in, by the app's own code (desktop/lib/notion-workspace.js), as the real test page already holds it: a suite then
// seeds in seconds (lib/seed.mjs fastSeed) instead of the wizard's 2-3 minutes. Every request goes to the stand-in; anything else fails. -> the app's ids.
export async function buildStandIn(standIn) {
  const {connectWorkspace} = await import('../../lib/notion-workspace.js');
  const fetcher = (url, options) => {
    const local = String(url).replace(/^https:\/\/api\.notion\.com/, standIn.url);
    if (!local.startsWith(standIn.url)) throw new Error(`the stand-in's build reached ${url}`);
    return fetch(local, options);
  };
  const built = await connectWorkspace(standIn.token, {sleep: async () => {}, fetcher});
  if (!built.ok) throw new Error(`the stand-in's workspace was not built: ${built.error || JSON.stringify({missing: built.missing, problems: built.problems})}`);
  return built.ids;
}
