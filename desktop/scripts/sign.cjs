// electron-builder afterPack hook: sign the whole app bundle.
// With the release certificate (MAC_SIGN_P12 = base64 .p12, MAC_SIGN_PASSWORD; set in CI) every build carries
// the same signature, so macOS treats an update as the same app: the keychain's "Always Allow" for the saved
// keys survives updates. The certificate is self-made, not Apple's: first open still asks "Open Anyway" until
// the app is signed with a Developer ID and notarised.
// Without it (local builds) the bundle is signed ad-hoc: a complete ad-hoc seal still turns "damaged" into the
// usual "unverified developer" prompt, but each build is a new app to the keychain.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// The certificate's own name: kept on purpose, a new certificate would make every Mac ask for Keychain access again (guarded by tests/test_desktop_workflow.py).
const NAME = 'Job Pilotto Self-Signed';

// A throwaway keychain holding only the certificate, so codesign can use it without touching the login keychain.
function withCertificate(p12Base64, password, sign) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-sign-'));
  const keychain = path.join(dir, 'sign.keychain-db');
  const p12 = path.join(dir, 'sign.p12');
  const pass = require('node:crypto').randomBytes(16).toString('hex');
  const run = (...args) => execFileSync('security', args, { stdio: ['ignore', 'pipe', 'inherit'] }).toString();
  const searched = run('list-keychains', '-d', 'user').split('\n').map(line => line.trim().replace(/^"|"$/g, '')).filter(Boolean);
  try {
    fs.writeFileSync(p12, Buffer.from(p12Base64, 'base64'), { mode: 0o600 });
    run('create-keychain', '-p', pass, keychain);
    run('set-keychain-settings', keychain);  // no auto-lock during a long build
    run('unlock-keychain', '-p', pass, keychain);
    run('import', p12, '-k', keychain, '-P', password, '-T', '/usr/bin/codesign');
    run('set-key-partition-list', '-S', 'apple-tool:,apple:,codesign:', '-s', '-k', pass, keychain);
    run('list-keychains', '-d', 'user', '-s', keychain, ...searched);
    // The certificate isn't trusted by macOS (self-made), so it's picked by its SHA-1, not by name.
    const hash = run('find-identity', '-p', 'codesigning', keychain).match(/\b([0-9A-F]{40})\b/)?.[1];
    if (!hash) throw new Error('the signing certificate has no code-signing identity');
    sign(hash, keychain);
  } finally {
    try { run('list-keychains', '-d', 'user', '-s', ...searched); } catch {}
    try { run('delete-keychain', keychain); } catch {}
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

exports.default = async function signApp(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const codesign = (...args) => execFileSync('codesign', args, { stdio: 'inherit' });
  const { MAC_SIGN_P12: p12, MAC_SIGN_PASSWORD: password } = process.env;
  if (p12) {
    withCertificate(p12, password || '', (hash, keychain) => codesign('--force', '--deep', '--keychain', keychain, '--sign', hash, app));
    console.log(`  • signed with ${NAME}`);
  } else {
    codesign('--force', '--deep', '--sign', '-', app);
    console.log('  • signed ad-hoc (no MAC_SIGN_P12)');
  }
  codesign('--verify', '--deep', '--strict', app);
};
