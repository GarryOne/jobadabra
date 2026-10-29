// The port a test app listens on: never the production one, so a test app can't take it from the owner's Jobadabra (owner, 29 Oct 2026).
// Job: wait on state
import net from 'node:net';

export const DEFAULT_APP_PORT = 47111;   // the extension's built-in address for the app (extension/flow.js APP)

// A port nothing listens on. The test app and its extension use it, so the suite runs next to the user's own Jobadabra, which keeps 47111: the extension
// under test can never pair with a live app.
export async function freePort() {
  for (;;) {
    const port = await new Promise((resolve, reject) => {
      const server = net.createServer();
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => { const {port: got} = server.address(); server.close(() => resolve(got)); });
    });
    if (port !== DEFAULT_APP_PORT) return port;
  }
}

/** -> the env entry that gives a launched test app its own port: the suite's, else a free one. */
export async function ownPortEnv(env = {}) {
  return {JOB_PILOTTO_PORT: env.JOB_PILOTTO_PORT || String(await freePort())};
}
