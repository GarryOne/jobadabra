// Reads the Codex plan's rate limits (weekly used_percent, reset) through the app-server's account/rateLimits/read; prints only those numbers, never a credential.
import {spawn} from 'node:child_process';
import readline from 'node:readline';

const child = spawn('codex', ['app-server'], {stdio: ['pipe', 'pipe', 'ignore']});
const lines = readline.createInterface({input: child.stdout});
const send = message => child.stdin.write(`${JSON.stringify(message)}\n`);
const timer = setTimeout(() => { console.error('limits: no answer in 20 s'); child.kill(); process.exit(2); }, 20000);
lines.on('line', line => {
  let message; try { message = JSON.parse(line); } catch { return; }
  if (message.id === 1) { send({method: 'initialized'}); send({id: 2, method: 'account/rateLimits/read'}); }
  if (message.id === 2) { clearTimeout(timer); console.log(JSON.stringify(message.result ?? message.error)); child.kill(); process.exit(0); }
});
send({id: 1, method: 'initialize', params: {clientInfo: {name: 'ci-limits', title: 'ci-limits', version: '0.0.1'}}});
