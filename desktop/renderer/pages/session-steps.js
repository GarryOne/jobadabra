// "What happened" on the session page (owner, 9 Oct 2026: "not sure we want the Claude terminal visible all the time … it confuses non-technical users"): the
// session's steps in plain words, from what the app already knows (the session, the form's report), drawn as Recent activity's step list (.activity-phases:
// ✓ done, ! needs you, ● now). The terminal (#ss-log) is shown instead only for a Claude conversation with Claude help on (claude-help.js); elsewhere it is
// one click away ("Technical log", for support). Guard: test/session-steps.test.js.
import {el} from '../components.js';
import {resumeOffered} from '../claude-help.js';
import {isSubmitted} from '../session-state.js';
import {sessionSteps} from '../session-steps-list.js';
import {clockTime} from './activity.js';
import {$, show} from './core.js';
import {reviewStates} from './session-needs.js';

// The terminal only for a Claude conversation with Claude help on; else the steps, and the terminal when "Technical log" was pressed for this session.
const logAsked = new Set();
export const terminalShown = item => (resumeOffered() && (item.kind || 'claude') === 'claude') || logAsked.has(item.id);
export function renderSteps(item) {
  const steps = !(resumeOffered() && (item.kind || 'claude') === 'claude');
  show($('ss-steps-card'), steps);
  if (steps) $('ss-steps').replaceChildren(...sessionSteps(item, reviewStates.get(item.id), {submitted: isSubmitted(item), time: clockTime}).map(step => el('li', step.tone, step.text)));
  $('ss-steps-log').textContent = logAsked.has(item.id) ? 'Hide technical log' : 'Technical log';
}
export function toggleTechnicalLog(item) { if (logAsked.has(item.id)) logAsked.delete(item.id); else logAsked.add(item.id); }
