// Electron entry of the twin's sync: `electron real-notion-token-main.mjs <real folder> -- <command...>` runs the command with the app's own Notion token in its environment (lib/real-notion-token.mjs).
import {app, safeStorage} from 'electron';
import {runWithAppToken} from './real-notion-token.mjs';

app.setName('Jobadabra');   // safeStorage's key is the Keychain item "<app name> Safe Storage": the real app's name, so this process reads the real app's key
app.dock?.hide();
const args = process.argv.slice(process.argv.findIndex(arg => arg.endsWith('real-notion-token-main.mjs')) + 1);
const [folder, , ...command] = args;
app.whenReady().then(() => {
  let status = 1;
  try { status = runWithAppToken({folder, safeStorage, command}); } catch (error) { console.error(`twin: ${error.message}`); }
  app.exit(status);
});
