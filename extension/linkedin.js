// The extension's own consent page for LinkedIn jobs (extension/linkedin-session.js): Chrome asks for a permission only from an extension page, on a click. The app opens it when the person
// turns the switch on (desktop/lib/linkedin-handlers.js linkedinConnect). Nothing is asked or read before the button.
import {connect} from './linkedin-session.js';

const WORDS = {
  denied: 'Not allowed: LinkedIn jobs stays off. You can turn it on again in Jobadabra → Settings → Connections.',
  'signed-out': 'You are not signed in to LinkedIn in this Chrome. Sign in to LinkedIn there, then press the button again.',
};
document.getElementById('allow').addEventListener('click', async () => {
  const said = document.getElementById('said');
  said.className = '';
  said.textContent = 'Working…';
  const done = await connect().catch(() => ({ok: false, error: 'The Jobadabra app did not answer. Is it open?'}));
  said.className = done.ok ? 'done' : '';
  said.textContent = done.ok ? 'LinkedIn jobs is on. This page closes by itself.' : (WORDS[done.why] || done.error || 'It did not work. Try again from the Jobadabra app.');
  if (done.ok) setTimeout(() => window.close(), 1500);
});
