// Waits until a folder is no longer held by a process that outlived the app (Windows: a child's working directory or open handle keeps the folder, not its files, from being renamed
// or removed). The reset and the import of the next start need exactly that; a relaunch before it failed them (17 Oct 2026, Windows settings). Guarded by test/folder-free.test.mjs.
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';

const LOCKED = new Set(['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY']);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

// -> the milliseconds waited; throws after `timeout` with the last error, so a holder that never leaves is said, not hidden by a later vague failure.
// The processes that could be the holder, named when the wait gives up (Windows): every python / pip / node / chrome / electron process with its parent and command line, so the failure says
// which child outlived the app instead of "held by a process" (18 Oct 2026: the add-on setup's pip). -> one line per process, or ''.
export function holders({run = spawnSync, platform = process.platform, dir = ''} = {}) {
  if (platform !== 'win32') return '';
  // Also any process whose command line names the folder (beta run 7, 22 Oct: the holder was none of the listed names, and the 8 s shell may have timed out).
  const named = dir ? ` -or $_.CommandLine -like '*${String(dir).split(/[\\/]/).pop().replace(/'/g, "''")}*'` : '';
  const script = `Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'python|pip|node|chrome|electron|tar|conhost|powershell|cmd|explorer'${named} } | ForEach-Object { "$($_.ProcessId) <- $($_.ParentProcessId) $($_.Name) $($_.CommandLine)" }`;
  try { return String(run('powershell', ['-NoProfile', '-Command', script], {encoding: 'utf8', timeout: 15000, windowsHide: true}).stdout || '').trim().split(/\r?\n/).filter(Boolean).map(line => line.slice(0, 220)).slice(0, 25).join(' | '); } catch { return ''; }
}

// Windows: the processes that hold a FILE inside the folder open, asked of the Restart Manager (the same list Explorer shows for "file in use"), because the name filter of `holders` cannot
// see a holder whose command line does not mention the folder (beta 3, 25 Oct: the leftovers were ended and the folder stayed held). -> "pid name | ...", '' off Windows, or "could not ask: why".
const RM_SCRIPT = dir => `$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System; using System.Text; using System.Runtime.InteropServices;
public static class JpRm {
  [StructLayout(LayoutKind.Sequential)] public struct UP { public int pid; public System.Runtime.InteropServices.ComTypes.FILETIME started; }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct PI { public UP p; [MarshalAs(UnmanagedType.ByValTStr, SizeConst=256)] public string app; [MarshalAs(UnmanagedType.ByValTStr, SizeConst=64)] public string svc; public int type; public uint status; public uint session; [MarshalAs(UnmanagedType.Bool)] public bool restartable; }
  [DllImport("rstrtmgr.dll", CharSet=CharSet.Unicode)] public static extern int RmStartSession(out uint h, int flags, StringBuilder key);
  [DllImport("rstrtmgr.dll", CharSet=CharSet.Unicode)] public static extern int RmRegisterResources(uint h, uint nf, string[] files, uint na, IntPtr apps, uint ns, IntPtr svcs);
  [DllImport("rstrtmgr.dll")] public static extern int RmGetList(uint h, out uint need, ref uint n, [In, Out] PI[] info, out uint reasons);
  [DllImport("rstrtmgr.dll")] public static extern int RmEndSession(uint h);
}
"@
$files = @(Get-ChildItem -LiteralPath '${String(dir).replace(/'/g, "''")}' -File -Recurse -Force -ErrorAction SilentlyContinue | Select-Object -First 300 -ExpandProperty FullName)
if (-not $files) { return }
$h = 0; $key = New-Object System.Text.StringBuilder 33
[void][JpRm]::RmStartSession([ref]$h, 0, $key)
[void][JpRm]::RmRegisterResources($h, [uint32]$files.Count, [string[]]$files, 0, [IntPtr]::Zero, 0, [IntPtr]::Zero)
$need = 0; $n = 0; $why = 0
[void][JpRm]::RmGetList($h, [ref]$need, [ref]$n, $null, [ref]$why)
if ($need -gt 0) { $n = $need; $info = New-Object 'JpRm+PI[]' $n; [void][JpRm]::RmGetList($h, [ref]$need, [ref]$n, $info, [ref]$why); $info | Select-Object -First $n | ForEach-Object { "$($_.p.pid) $($_.app)" } }
[void][JpRm]::RmEndSession($h)`;

export function fileHolders({run = spawnSync, platform = process.platform, dir = ''} = {}) {
  if (platform !== 'win32') return '';
  try {
    const encoded = Buffer.from(RM_SCRIPT(dir), 'utf16le').toString('base64');
    const done = run('powershell', ['-NoProfile', '-EncodedCommand', encoded], {encoding: 'utf8', timeout: 20000, windowsHide: true});
    const lines = String(done.stdout || '').trim().split(/\r?\n/).filter(Boolean);
    if (!lines.length && done.stderr) return `could not ask: ${String(done.stderr).trim().slice(0, 200)}`;
    return lines.map(line => line.slice(0, 220)).slice(0, 25).join(' | ');
  } catch (error) { return `could not ask: ${error.message}`.slice(0, 220); }
}

// Windows: end the leftovers of THIS run's app (its processes carry the run's own throwaway folder name in their command line: --user-data-dir=...\\jp-e2e-xxxx) once the wait
// has run `endAfter` ms (beta 17, 24 Oct: the app's main, gpu and crashpad-handler processes outlived the exit and held the folder 20 s). -> the process ids ended, or [].
export function endLeftovers({run = spawnSync, platform = process.platform, dir = ''} = {}) {
  const name = String(dir).split(/[\\/]/).pop();
  if (platform !== 'win32' || !/^jp-e2e-/.test(name)) return [];
  const script = `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${name.replace(/'/g, "''")}*' -and $_.ProcessId -ne $PID -and $_.Name -match 'electron|python|node|crashpad' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; $_.ProcessId }`;
  try { return String(run('powershell', ['-NoProfile', '-Command', script], {encoding: 'utf8', timeout: 15000, windowsHide: true}).stdout || '').trim().split(/\r?\n/).filter(Boolean); } catch { return []; }
}

export async function waitForFolderFree(dir, {timeout = 20000, every = 250, endAfter = 8000, rename = fs.renameSync, exists = fs.existsSync, who = () => holders({dir}), whoHasFiles = () => fileHolders({dir}), end = () => endLeftovers({dir})} = {}) {
  const aside = `${dir}.probe`;
  let waited = 0;
  let ended = false;
  while (exists(dir)) {
    try { rename(dir, aside); rename(aside, dir); return waited; } catch (error) {
      if (!LOCKED.has(error.code)) throw error;
      if (waited >= timeout) { const files = whoHasFiles(); throw new Error(`the data folder stayed held by a process after the app exited (${waited / 1000} s): ${error.message}${files ? `; files in it are open in: ${files}` : ''}${who() ? `; processes still running: ${who()}` : ''}`); }
      if (!ended && waited >= endAfter) { ended = true; const gone = end(); if (gone.length) console.log(`  the data folder was still held after ${waited / 1000} s: ended its leftover processes ${gone.join(', ')}`); }
      await pause(every); waited += every;
    }
  }
  return waited;
}
