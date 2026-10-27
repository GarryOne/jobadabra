// A tiny in-memory Notion page for tests: its blocks (bullets, headings and tables) and a fetcher for notion.js calls
// (list children — a table's rows too —, append — optionally after a block —, update a block's text or a row's cells, delete a block).
// A line is a bullet, "# / ## / ### heading", or {table: [[cell, …], …], header: true} (16 Oct 2026: tables, for the Profile tabs' cell edits).
// prefix: block ids start with it, so two fakes (a Profile and an answers page) can sit behind one fetcher without their ids meeting.
export function fakeNotion(lines = [], {prefix = ''} = {}) {
  const archived = new Map();
  let next = 1;
  const make = (type, text) => ({id: `${prefix}b${next++}`, type, text});
  const table = ({table: rows, header = true}) => ({id: `${prefix}t${next++}`, type: 'table', header, rows: rows.map(cells => ({id: `${prefix}r${next++}`, cells: [...cells]}))});
  const heading = line => line.match(/^(#{1,3}) (.*)$/);   // "# ", "## ", "### ": heading_1..3 (18 Oct 2026: an old Profile's "# Contact" over "## …" sections)
  const blocks = lines.map(line => (typeof line === 'object' ? table(line) : heading(line) ? make(`heading_${heading(line)[1].length}`, heading(line)[2]) : make('bulleted_list_item', line)));
  const rich = text => ({rich_text: [{plain_text: text, text: {content: text}}]});
  const cellsOf = row => row.cells.map(text => [{plain_text: text, text: {content: text}}]);
  const asBlock = b => (b.type === 'table' ? {id: b.id, type: 'table', table: {has_column_header: b.header, table_width: b.rows[0]?.cells.length || 2}, has_children: true}
    : {id: b.id, type: b.type, [b.type]: rich(b.text), has_children: false});
  const rowById = id => blocks.filter(b => b.type === 'table').flatMap(b => b.rows).find(row => row.id === id);
  const fetcher = async (url, init = {}) => {
    const route = url.replace('https://api.notion.com/v1/', '').split('?')[0];
    const body = init.body ? JSON.parse(init.body) : {};
    let data = {};
    const tableRows = blocks.find(b => b.type === 'table' && route === `blocks/${b.id}/children`);
    if (init.method === 'GET' && tableRows) {
      data = {results: tableRows.rows.map(row => ({id: row.id, type: 'table_row', table_row: {cells: cellsOf(row)}, has_children: false})), has_more: false};
    } else if (init.method === 'GET' && route.endsWith('/children')) {
      data = {results: blocks.map(asBlock), has_more: false};
    } else if (init.method === 'PATCH' && route.endsWith('/children')) {
      const added = body.children.map(child => make(child.type, child[child.type].rich_text[0].text.content));
      const at = body.after ? blocks.findIndex(b => b.id === body.after) + 1 : blocks.length;
      blocks.splice(at, 0, ...added);
      data = {results: added.map(b => ({id: b.id}))};
    } else if (init.method === 'GET' && route.startsWith('blocks/')) {
      const id = route.replace('blocks/', ''), block = blocks.find(b => b.id === id) || archived.get(id)?.block;
      const row = rowById(id) || archived.get(id)?.block;
      if (block?.type) data = {...asBlock(block), archived: archived.has(id)};
      else if (row) data = {id, type: 'table_row', table_row: {cells: cellsOf(row)}, archived: archived.has(id)};
      else throw new Error(`fake Notion: no block ${route}`);
    } else if (init.method === 'PATCH' && body.archived === false) {
      const id = route.replace('blocks/', ''), kept = archived.get(id);
      if (kept) { kept.holder.splice(kept.at, 0, kept.block); archived.delete(id); }
    } else if (init.method === 'PATCH' && body.table_row) {
      rowById(route.replace('blocks/', '')).cells = body.table_row.cells.map(cell => cell.map(item => item.text?.content ?? item.plain_text ?? '').join(''));
    } else if (init.method === 'PATCH') {
      const block = blocks.find(b => `blocks/${b.id}` === route);
      block.text = body[block.type].rich_text[0].text.content;
    } else if (init.method === 'DELETE') {
      const row = rowById(route.replace('blocks/', ''));
      const holder = row && blocks.find(b => b.type === 'table' && b.rows.includes(row));
      const list = holder ? holder.rows : blocks, at = holder ? list.indexOf(row) : list.findIndex(b => `blocks/${b.id}` === route);
      if (at >= 0) { archived.set(list[at].id, {block: list[at], holder: list, at}); list.splice(at, 1); }
      else throw new Error(`fake Notion: no block ${route}`);
    } else if (init.method === 'GET' && route.startsWith('pages/')) {
      data = {parent: {page_id: 'parent'}};
    } else if (init.method === 'POST' && route === 'pages') {
      data = {id: 'knowledge-page'};
    }
    return {ok: true, json: async () => data};
  };
  const textOf = b => (b.type === 'heading_2' ? `## ${b.text}` : b.type === 'table' ? b.rows.map(row => `| ${row.cells.join(' | ')} |`).join('\n') : b.text);
  return {blocks, fetcher, texts: () => blocks.map(textOf)};
}
