// The traced app and browsers inherit only named runtime settings; CI credentials stay in the harness.
// Job: run the backbone
const RUNTIME = new Set(['PATH', 'Path', 'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP', 'TMPDIR', 'LOCALAPPDATA', 'APPDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'PROGRAMDATA', 'DISPLAY', 'WAYLAND_DISPLAY', 'XAUTHORITY', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS', 'LANG', 'LC_ALL', 'TZ', 'CI', 'PYTHONPATH', 'PYTHONUTF8', 'NODE_V8_COVERAGE', 'COVERAGE_PROCESS_START', 'COVERAGE_FILE', 'E2E_PY_COVERAGE_DIR'].map(name => name.toUpperCase()));

/** Build launch options without inherited CI secrets; explicit product hooks remain, credential overrides do not. */
export function appLaunchEnv(base, overrides = {}) {
  const result = Object.fromEntries(Object.entries(base).filter(([name]) => RUNTIME.has(name.toUpperCase())));
  for (const [name, value] of Object.entries(overrides)) {
    if (RUNTIME.has(name.toUpperCase()) || name.startsWith('JOBADABRA_') || ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN'].includes(name)) result[name] = value;
  }
  // withoutWrappers reads a plain object's PATH; Windows commonly supplies Path instead.
  result.PATH ??= Object.entries(result).find(([name]) => name.toUpperCase() === 'PATH')?.[1];
  if (result.PATH === undefined) delete result.PATH;
  // Invariant: CI credential names cannot be smuggled back through suite overrides.
  for (const name of Object.keys(result)) if (/^(?:E2E_.*(?:KEY|TOKEN)|ACTIONS_|CI_.*(?:TOKEN|KEY))/.test(name)) delete result[name];
  // Invariant: a suite cannot copy an inherited CI secret into a differently named product hook.
  for (const [name, value] of Object.entries(base)) {
    if (value?.length >= 8 && /(?:^|_)(?:KEY|TOKEN|SECRET|PASSWORD)(?:_|$)/.test(name) && Object.values(result).some(setting => String(setting).includes(value))) throw new Error(`CI credential override refused: ${name}`);
  }
  return result;
}
