// The Notion store, desktop side: the user's text pages (Profile, standard answers, 🧠 Form knowledge) as pages of blocks, through
// today's lib/notion-* calls unchanged. lib/store/index.js opens it; screens and modules never import it. Spec:
// docs/superpowers/specs/2026-10-09-store-adapters.md. Guarded by desktop/test/store-contract.test.js (against test/fake-notion.js).
import * as notion from '../notion.js';
import {CLOUD, FILES, LINKS} from './caps.js';
import * as notionRuns from './notion-runs.js';

export const NAME = 'notion';
export const CAPS = new Set([LINKS, CLOUD, FILES]);
export const LABEL = 'Notion';   // what the window calls this store

// Each text and its page id in settings.notionIds. Form knowledge is made beside the Profile on its first write (nothing writes it since PR B1; the store keeps the text).
const PAGE_IDS = {profile: 'NOTION_PROFILE_PAGE_ID', answers: 'NOTION_ANSWERS_PAGE_ID', knowledge: 'NOTION_KNOWLEDGE_PAGE', portrait: 'NOTION_PORTRAIT_PAGE'};
const MISSING = {
  profile: 'Connect Notion first: your contact details live in your Profile page.',
  answers: 'Connect Notion first: your questions live in the standard answers page.',
  knowledge: 'Connect Notion first: form knowledge lives there.',
  portrait: 'Connect Notion first: your portrait lives there.',
};
const KNOWLEDGE_INTRO = 'What Jobadabra learned from your form fills, used by every later kit and fill. Fix or delete a line to change what it does.';

const plain = rich => (rich || []).map(t => t.plain_text || '').join('');
// A Notion block → the page item every adapter gives: {id, type, text} or a table {id, type: 'table', header, rows: [{id, cells, raw}]}.
function item(block) {
  if (block.type === 'table') {
    return {id: block.id, type: 'table', header: !!block.table?.has_column_header,
      rows: (block.children || []).filter(row => row.type === 'table_row').map(row => ({id: row.id, type: 'table_row', cells: (row.table_row?.cells || []).map(plain), raw: row}))};
  }
  const each = {id: block.id, type: block.type, text: plain(block[block.type]?.rich_text)};
  if (block.children && block.type !== 'table') each.children = block.children.map(item);
  return each;
}

const PORTRAIT_INTRO = 'Written by Jobadabra from everything it knows about you. Read-only: it is rewritten as it learns, so correct a source, not this page.';
const KNOWLEDGE_TITLE = '🧠 Form knowledge';   // the page's name in Notion (the store keeps the text; PR B1 retired its writer and readers)

// The Knowledge page, made beside the Profile and remembered when missing; its id. Also before a move to Notion
// (lib/store-move.js), whose copy writes the page whole.
export async function ensureKnowledgePage(storage, {fetcher} = {}) {
  const ids = storage.settings().notionIds || {};
  if (ids.NOTION_KNOWLEDGE_PAGE) return ids.NOTION_KNOWLEDGE_PAGE;
  const page = await notion.ensurePage(storage.secret('NOTION_TOKEN'), ids.NOTION_PROFILE_PAGE_ID, KNOWLEDGE_TITLE, KNOWLEDGE_INTRO, fetcher);
  storage.saveSettings({notionIds: {...(storage.settings().notionIds || {}), NOTION_KNOWLEDGE_PAGE: page}});
  return page;
}

// The Portrait page (derived text, one copy), made beside the Profile on its first write and remembered; its id.
export async function ensurePortraitPage(storage, {fetcher} = {}) {
  const ids = storage.settings().notionIds || {};
  if (ids.NOTION_PORTRAIT_PAGE) return ids.NOTION_PORTRAIT_PAGE;
  const page = await notion.ensurePage(storage.secret('NOTION_TOKEN'), ids.NOTION_PROFILE_PAGE_ID, '🪞 Your portrait', PORTRAIT_INTRO, fetcher);
  storage.saveSettings({notionIds: {...(storage.settings().notionIds || {}), NOTION_PORTRAIT_PAGE: page}});
  return page;
}

export function open(storage, {fetcher, cache} = {}) {
  const kept = cache === undefined ? undefined : {cache};   // tests turn the kept page trees on for a fake fetcher; the app leaves it to the real fetch
  const token = () => storage.secret('NOTION_TOKEN');
  const ids = () => storage.settings().notionIds || {};
  const target = name => {
    const t = token(), connected = !!ids().NOTION_PROFILE_PAGE_ID;
    if (!t || !connected) throw new Error(MISSING[name] || 'Connect Notion first.');
    return {token: t, page: ids()[PAGE_IDS[name]] || null};
  };
  // The knowledge and portrait pages are made on the first write, beside the Profile, and remembered.
  const made = {knowledge: ensureKnowledgePage, portrait: ensurePortraitPage};
  const writable = async name => {
    const t = target(name);
    if (t.page || !made[name]) {
      if (!t.page) throw new Error(MISSING[name]);
      return t;
    }
    return {token: t.token, page: await made[name](storage, {fetcher})};
  };
  const readable = name => {
    const t = target(name);
    return t.page ? t : null;
  };

  const page = name => ({
    async blocks() {
      const t = readable(name);
      return t ? notion.textBlocks(t.token, t.page, fetcher, kept) : [];
    },
    // Top-level items in order (tables with their rows, toggles with their children). Through the kept page tree, like blocks() and text(): a write drops the
    // page it touched, so the ❓ lists still see an answer at once, while every screen asking at start shares one read (it was a full read each, 17 Oct 2026).
    async outline() {
      const t = readable(name);
      return t ? (await notion.pageTree(t.token, t.page, fetcher, kept)).map(item) : [];
    },
    async text() {
      const t = readable(name);
      return t ? notion.pageText(t.token, t.page, fetcher, kept) : '';
    },
    async write(markdown, onProgress) {
      const t = await writable(name);
      return notion.writePage(t.token, t.page, markdown, fetcher, onProgress);
    },
    async setText(block, value) {
      const t = await writable(name);
      return notion.setBlockText(t.token, block, value, fetcher);
    },
    async remove(block, {ifUnchanged = false} = {}) {
      const t = await writable(name);
      if (!ifUnchanged) return notion.deleteBlock(t.token, block.id, fetcher);
      const route = `blocks/${block.id}`, read = () => notion.call(t.token, 'GET', route, null, fetcher);
      const matches = raw => {
        const current = raw.type === 'table_row' ? (raw.table_row?.cells || []).map(plain) : plain(raw[raw.type]?.rich_text);
        return JSON.stringify(current) === JSON.stringify(block.cells ?? block.text);
      };
      const before = await read();
      if (before.archived || before.in_trash || !matches(before)) return false;
      await notion.deleteBlock(t.token, block.id, fetcher);
      // Notion has no compare-and-delete. Archiving is reversible: detect an edit during the request and restore that same block without rewriting it.
      try {
        if (matches(await read())) return true;
      } catch (error) {
        await notion.call(t.token, 'PATCH', route, {archived: false}, fetcher);
        throw error;
      }
      await notion.call(t.token, 'PATCH', route, {archived: false}, fetcher);
      return false;
    },
    async append(values) {
      const t = await writable(name);
      return notion.appendBullets(t.token, t.page, values, fetcher);
    },
    // parent: the block that holds blockId when it sits in a nested list (default: the page itself).
    async insertAfter(blockId, values, {parent} = {}) {
      const t = await writable(name);
      return notion.insertBulletsAfter(t.token, parent || t.page, blockId, values, fetcher);
    },
    async appendHeading(value) {
      const t = await writable(name);
      return notion.appendHeading(t.token, t.page, value, fetcher);
    },
    async setCell(row, index, value) {
      const t = await writable(name);
      return notion.setRowCell(t.token, row.raw, index, value, fetcher);
    },
  });

  const runs = {
    list: ({size} = {}) => notionRuns.list(storage, {fetcher, size}),
    close: (link, reason) => notionRuns.closeStopped(storage, link, reason, {fetcher}),
    detail: id => notionRuns.detail(storage, id, {fetcher}),
  };

  return {
    name: NAME, label: LABEL, caps: CAPS, page, runs,
    // Where the user can open a record or page in Notion.
    link: id => (id ? notion.pageUrl(id) : null),
    textLink: name => (ids()[PAGE_IDS[name]] ? notion.pageUrl(ids()[PAGE_IDS[name]]) : null),
  };
}
