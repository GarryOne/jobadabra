// The Store package turns AppData write virtualization off (scripts/appx-manifest.mjs), so the Store copy and the .exe copy share %APPDATA%\Jobadabra.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {storeManifest, templatePath} from '../scripts/appx-manifest.mjs';

const template = fs.readFileSync(templatePath(), 'utf8');
const macros = text => new Set([...text.matchAll(/\$\{([a-zA-Z0-9]+)\}/g)].map(match => match[1]));

test('the manifest turns file write virtualization off and asks for the capability that allows it', () => {
  const manifest = storeManifest(template);
  assert.match(manifest, /<desktop6:FileSystemWriteVirtualization>disabled<\/desktop6:FileSystemWriteVirtualization>/);
  assert.match(manifest, /xmlns:desktop6="http:\/\/schemas\.microsoft\.com\/appx\/manifest\/desktop\/windows10\/6"/);
  assert.match(manifest, /IgnorableNamespaces="desktop6"/);
  assert.match(manifest, /<rescap:Capability Name="unvirtualizedResources" \/>/);
  assert.match(manifest, /<rescap:Capability Name="runFullTrust" \/>/, 'a full-trust desktop app keeps its capability');
});

test('every other macro stays for electron-builder to fill, and the capabilities macro is the only one used up', () => {
  const left = macros(storeManifest(template));
  assert.ok(left.has('identityName') && left.has('publisher') && left.has('displayName') && left.has('executable'));
  assert.ok(!left.has('capabilities'));
  assert.deepEqual([...macros(template)].filter(name => !left.has(name)), ['capabilities']);
});

test('a template that no longer has the parts it edits fails the build instead of shipping a virtualizing package', () => {
  assert.throws(() => storeManifest(template.replace('<Logo>${logo}</Logo>', '')), /template changed/);
  assert.throws(() => storeManifest(template.replace('${capabilities}', '')), /template changed/);
});

test('the workflow that builds the Store package uses this manifest', () => {
  for (const file of ['msix-store.yml']) {
    const text = fs.readFileSync(new URL(`../../.github/workflows/${file}`, import.meta.url), 'utf8');
    assert.match(text, /node scripts\/appx-manifest\.mjs/, file);
    assert.match(text, /customManifestPath=appxmanifest-store\.xml/, file);
  }
});
