// The page panel as the tests load it: its scripts in injection order (extension/panel-files.js), as one source text or evaluated in a page.
import fs from 'node:fs';
import { PANEL_FILES } from '../../../extension/panel-files.js';

export const readPanel = () => PANEL_FILES.map((name) => fs.readFileSync(new URL(`../../../extension/${name}`, import.meta.url), 'utf8')).join('\n');
export const evalPanel = (window) => { for (const name of PANEL_FILES) window.eval(fs.readFileSync(new URL(`../../../extension/${name}`, import.meta.url), 'utf8')); };
