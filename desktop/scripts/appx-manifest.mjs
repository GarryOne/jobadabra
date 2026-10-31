// The Microsoft Store package's manifest: electron-builder's own template with AppData write virtualization turned off, so the Store copy and the downloaded .exe copy share one data folder.
//   node scripts/appx-manifest.mjs     -> writes build/appxmanifest-store.xml; the build then passes -c.appx.customManifestPath=appxmanifest-store.xml
// Why (31 Oct 2026, owner: "Let's handle the case when the desktop app is being installed twice. Side by side." → "Root fix + note"): a packaged app's writes under %APPDATA% go to a private copy in
// %LOCALAPPDATA%\Packages\<family>\LocalCache\Roaming unless the package says otherwise (measured on a Windows 11 runner, spike runs 41225480744 and 41229862282 of the throwaway branch windows-two-installs). A Store copy that made the folder first
// kept the person's data there, and a .exe copy installed later started empty. desktop6:FileSystemWriteVirtualization=disabled needs the restricted capability unvirtualizedResources.
// IgnorableNamespaces: the Store package still installs on a Windows older than the attribute (it keeps the old behaviour there); electron-builder's template does not list desktop6.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath, pathToFileURL} from 'node:url';

/**
 * The manifest text. Takes electron-builder's appxmanifest.xml template (its ${macros} stay for electron-builder to fill). Throws when the template no longer has the parts this edits,
 * so an electron-builder upgrade that moves them fails the build instead of shipping a package that silently keeps virtualizing.
 */
export function storeManifest(template) {
  const edits = [
    [/<Package\b/, '<Package\n   IgnorableNamespaces="desktop6"\n   xmlns:desktop6="http://schemas.microsoft.com/appx/manifest/desktop/windows10/6"'],
    [/<Logo>\$\{logo\}<\/Logo>/, '<Logo>${logo}</Logo>\n    <desktop6:FileSystemWriteVirtualization>disabled</desktop6:FileSystemWriteVirtualization>'],
    [/\$\{capabilities\}/, '<Capabilities>\n    <rescap:Capability Name="runFullTrust" />\n    <rescap:Capability Name="unvirtualizedResources" />\n  </Capabilities>'],
  ];
  return edits.reduce((text, [pattern, replacement]) => {
    if (!pattern.test(text)) throw new Error(`electron-builder's appx template changed: ${pattern} not found (desktop/scripts/appx-manifest.mjs)`);
    return text.replace(pattern, () => replacement);
  }, template);
}

/** Where electron-builder keeps its appx manifest template (inside the installed app-builder-lib package). Takes nothing; throws when the package is not installed. */
export const templatePath = () => path.join(path.dirname(createRequire(import.meta.url).resolve('app-builder-lib/package.json')), 'templates', 'appx', 'appxmanifest.xml');

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'build', 'appxmanifest-store.xml');
  fs.writeFileSync(out, storeManifest(fs.readFileSync(templatePath(), 'utf8')));
  console.log(`wrote ${out}`);
}
