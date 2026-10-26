// The app's menu bar: Electron's standard menus, plus "Check for Updates…" where Mac users look for it
// (Jobadabra menu, under About); on Windows it sits in Help. Next to it, Update Channel: Stable / Beta / Test builds (lib/update-channel.js,
// the same switch as Settings → Diagnostics); picking one asks first, then checks at once so the build can be installed from there.
// Help → Send Feedback… on both platforms (lib/app-feedback.js). Edit → Find… (⌘F), Find Next (⌘G), Find Previous
// (⇧⌘G): find(what) tells the window ('open' | 'next' | 'previous'; renderer/pages/find.js).
export const CHANNEL_LABELS = {stable: 'Stable', beta: 'Beta', test: 'Test Builds (unchecked)'};

export function template({name, mac, checkForUpdates, sendFeedback = () => {}, find = () => {}, channel = 'stable', pickChannel = null, zoom = null}) {
  const feedback = {label: 'Send Feedback…', click: sendFeedback};
  const channels = pickChannel ? [{label: 'Update Channel', submenu: Object.entries(CHANNEL_LABELS).map(([id, label]) =>
    ({label, type: 'radio', checked: id === channel, click: () => pickChannel(id)}))}] : [];
  const check = [{label: 'Check for Updates…', click: checkForUpdates}, ...channels];
  return [
    ...(mac ? [{label: name, submenu: [{role: 'about'}, ...check, {type: 'separator'}, {role: 'services'}, {type: 'separator'},
      {role: 'hide'}, {role: 'hideOthers'}, {role: 'unhide'}, {type: 'separator'}, {role: 'quit'}]}] : []),
    {role: 'fileMenu'},
    {label: 'Edit', submenu: [{role: 'undo'}, {role: 'redo'}, {type: 'separator'}, {role: 'cut'}, {role: 'copy'}, {role: 'paste'},
      ...(mac ? [{role: 'pasteAndMatchStyle'}] : []), {role: 'delete'}, {role: 'selectAll'}, {type: 'separator'},
      {label: 'Find…', accelerator: 'CmdOrCtrl+F', click: () => find('open')},
      {label: 'Find Next', accelerator: 'CmdOrCtrl+G', click: () => find('next')},
      {label: 'Find Previous', accelerator: 'Shift+CmdOrCtrl+G', click: () => find('previous')}]},
    zoom ? view(zoom) : {role: 'viewMenu'}, {role: 'windowMenu'},
    {role: 'help', submenu: mac ? [feedback] : [feedback, ...check]},
  ];
}

// View, as Electron's own but with the zoom keys kept in the app's settings (lib/zoom-handlers.js), so the size comes back after a restart.
const view = zoom => ({label: 'View', submenu: [{role: 'reload'}, {role: 'forceReload'}, {role: 'toggleDevTools'}, {type: 'separator'},
  {label: 'Actual Size', accelerator: 'CmdOrCtrl+0', click: () => zoom.reset()},
  {label: 'Zoom In', accelerator: 'CmdOrCtrl+Plus', click: () => zoom.zoomIn()},
  {label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: () => zoom.zoomOut()}, {type: 'separator'}, {role: 'togglefullscreen'}]});

// What "Check for Updates…" answers: {message, detail, buttons, install?}.
export function answer(result, current) {
  if (result?.fromStore) return {type: 'info', message: 'Updated by the Microsoft Store', detail: `Jobadabra ${current} came from the Microsoft Store, which installs new versions by itself.`, buttons: ['OK']};
  if (result?.fromSource) return {type: 'info', message: 'Running from source (npm start)', detail: 'Updates are for the installed app. Here, update with git pull and restart.', buttons: ['OK']};
  if (!result?.ok) return {type: 'warning', message: 'Couldn\'t check for updates', detail: result?.text || 'Try again later.', buttons: ['OK']};
  if (!result.offer) return {type: 'info', message: 'You\'re up to date', buttons: ['OK'],
    detail: `Jobadabra ${current} is the latest version.`};
  return {type: 'info', message: `Jobadabra ${result.offer.version} is available`, install: true,
    detail: `You have ${current}. Updating takes about 30 seconds: the app closes, updates and opens again.`,
    buttons: ['Update now', 'Later']};
}
