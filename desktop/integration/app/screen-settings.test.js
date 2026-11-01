/* global document, window, KeyboardEvent, Event */
// Settings, layer 2: the AI engine panel with each engine chosen, and the ⌘K palette (every page listed, every Settings section and Export/Import reachable, a typed command opens its
// page, Esc closes). Moved from the e2e `settings` suite (1 Nov 2026) to the app's demo window. What STAYS in e2e: every section renders (the smoke journey), Back up now, a due
// backup, and the two export/import round trips (data). The crowding of ⌘K rows per card is test/palette-one-row-per-card.test.js.
import assert from 'node:assert/strict';
import {before, test} from 'node:test';
import {needsElectron} from '../../test/needs-electron.js';
import {probeWindow} from './window-probe.js';

const live = {skip: needsElectron.skip};
let seen;

before(() => {
  if (needsElectron.skip) return;
  seen = probeWindow({timeout: 180000, script: async kit => {
    await kit.until(() => document.querySelector('.nav[data-view=focus]:not([hidden])'), 'the menu');
    const out = {};
    const section = async (name, read) => { try { out[name] = await read(); } catch (error) { out[name] = {error: error.message}; } };
    await section('engine', async () => {
      await kit.go('settings');
      document.querySelector('[data-settings-go="connections"]').click();
      const services = () => [...document.querySelectorAll('#conn-on .service-card, #conn-off .service-card')].filter(card => card.textContent.includes('Claude or OpenAI'));
      await kit.until(() => services().length, 'the Claude or OpenAI service card');
      const cards = services().length;
      services()[0].querySelector('button').click();
      const card = id => document.querySelector(`#ai-engine-settings [data-choice="${id}"]`);
      await kit.until(() => card('cli')?.offsetParent, 'the engine cards');
      const engine = async () => (await window.pilot.state()).settings.aiEngine;
      const choose = async id => {
        card(id).click();
        await kit.until(() => card(id).getAttribute('aria-checked') === 'true', `the ${id} card to be selected`);
        await kit.until(async () => (await engine()) === id, `${id} to be saved as the engine`);
        return {checked: ['cli', 'api'].filter(other => card(other).getAttribute('aria-checked') === 'true'), saved: await engine(), severe: kit.severe('settings')};
      };
      const cli = await choose('cli');
      const api = await choose('api');
      return {cards, cli, api};
    });
    // Settings sections: every section the page lists is opened as a person does and checked for the layout problems that fail a step (the J17 check, moved from the e2e `settings` suite, 1 Nov 2026).
    await section('sections', async () => {
      const names = () => [...document.querySelectorAll('.settings-nav [data-settings-go]')].map(button => button.dataset.settingsGo);
      await kit.go('settings');
      const sections = names(), layout = [];
      for (const name of sections) {
        // Profile is its own page and hides Settings' list of sections: the next one is reached through the menu's Settings.
        if (!document.querySelector('.settings-nav')?.offsetParent) await kit.go('settings');
        document.querySelector(`.settings-nav [data-settings-go="${name}"]`).click();
        await kit.until(() => document.querySelector(`[data-settings-page="${name}"]:not([hidden])`), `the ${name} section to show`);
        const problems = kit.severe('settings');
        if (problems.length) layout.push(`${name}: ${problems.join(' | ')}`);
      }
      return {sections, layout};
    });
    await section('palette', async () => {
      const press = init => document.dispatchEvent(new KeyboardEvent('keydown', {bubbles: true, ...init}));
      const pages = [...new Map([...document.querySelectorAll('.nav[data-view]')].map(nav => [nav.dataset.view, (nav.getAttribute('aria-label') || nav.title || nav.textContent).trim()])).entries()];
      await kit.go('focus');
      press({key: 'k', metaKey: true, ctrlKey: true});
      await kit.until(() => document.querySelector('#palette[open]'), '⌘K to open the palette');
      const listed = [...document.querySelectorAll('#palette-list [role="option"]')].map(item => item.innerText.replace(/\s+/g, ' ').trim());
      const name = node => node?.textContent.replace(/\s+/g, ' ').trim().replace(/^\P{L}+/u, '');
      const wanted = [
        ...[...new Map([...document.querySelectorAll('[data-settings-go]')].reverse().map(go => [go.dataset.settingsGo, name(go)])).values()].map(page => `Settings → ${page}`),
        ...[...document.querySelectorAll('[data-settings-page] .setting[id]')].filter(one => !one.closest('[hidden]:not(.view):not([data-settings-page])')).map(one => name(one.querySelector('h3') || one.querySelector('h4, summary'))).filter(Boolean),
        'Move your data → Export data', 'Move your data → Import data'];
      document.querySelector('#palette').close();
      await kit.until(() => !document.querySelector('#palette[open]'), 'the palette to close');
      press({key: 'k', metaKey: true, ctrlKey: true});
      await kit.until(() => document.querySelector('#palette[open] input'), '⌘K to open it again');
      const typed = document.querySelector('#palette[open] input');
      typed.value = 'open interviews';
      typed.dispatchEvent(new Event('input', {bubbles: true}));
      await kit.until(() => document.querySelector('#palette-list [role="option"]'), 'the typed command to be listed');
      typed.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}));
      await kit.until(() => document.querySelector('.view[data-view="interviews"]:not([hidden])'), 'Enter on "open interviews" to open the Interviews page');
      return {pages: pages.length, views: new Set(pages.map(([view]) => view)).size, opens: listed.filter(text => /^Open /.test(text)).length, listed: listed.slice(0, 12), absent: wanted.filter(label => !listed.some(item => item.includes(label))), stayedOpen: !!document.querySelector('#palette[open]')};
    });
    return out;
  }});
});

const facts = name => { const value = seen.result[name]; assert.equal(value?.error, undefined, `${name}: ${value?.error}`); return value; };

test('the AI engine panel is coherent with each engine chosen: one card selected, the choice saved, no layout problems', live, () => {
  const {cards, cli, api} = facts('engine');
  assert.equal(cards, 1, 'expected exactly one Claude or OpenAI service card');
  assert.deepEqual([cli.checked, cli.saved], [['cli'], 'cli']);
  assert.deepEqual([api.checked, api.saved], [['api'], 'api']);
  assert.deepEqual([...cli.severe, ...api.severe], []);
});

test('every Settings section the page lists opens and has no layout problems', live, () => {
  const {sections, layout} = facts('sections');
  assert.ok(sections.length >= 5, `Settings lists ${sections.length} sections: ${sections.join()}`);
  assert.deepEqual(layout, [], 'layout problems');
});

test('⌘K opens the palette: every page is listed, every Settings page and section and Export/Import are reachable, a typed command opens its page', live, () => {
  const {pages, views, opens, listed, absent, stayedOpen} = facts('palette');
  assert.ok(pages >= 5, `only ${pages} pages in the sidebar: this test would test little`);
  assert.ok(opens >= views, `the palette lists ${opens} "Open …" commands for ${views} pages: ${listed.join(' | ')}`);
  assert.deepEqual(absent, [], 'not in ⌘K');
  assert.equal(stayedOpen, false, 'the palette stayed open after running a command');
});
