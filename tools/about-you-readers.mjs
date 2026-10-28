#!/usr/bin/env node
// Writes docs/about-you-readers.json, the readers table (which AI step gets which part of About you) that the website's readers page reads (owner via the coordinator,
// 28 Oct 2026: "publish on the website … this table", live only). Generated from desktop/lib/about-you.js, never edited by hand; desktop/test/about-you-readers.test.js fails when it is stale.
// Usage: node tools/about-you-readers.mjs            writes the file.
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {readersTable} from '../desktop/lib/about-you.js';

export const FILE = fileURLToPath(new URL('../docs/about-you-readers.json', import.meta.url));
/** The file's exact text: the readers table from desktop/lib/about-you.js (readersTable), pretty-printed with a final newline. Throws if that module cannot load. */
export const text = () => `${JSON.stringify(readersTable(), null, 2)}\n`;

if (process.argv[1] === fileURLToPath(import.meta.url)) { fs.writeFileSync(FILE, text()); console.log(`wrote ${FILE}`); }
