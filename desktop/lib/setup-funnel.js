// Setup funnel: each install reports, once per step, the furthest setup step it reached (and when setup finished),
// as a technical report of kind "setup" (lib/telemetry.js; off when reports are off). The owner's /telemetry page
// shows where people stop. Anonymous: the step, its number, minutes since the first start, which AI path was taken.
import {isOn as freeOn} from './ai-free.js';

export const STEPS = ['welcome', 'ai', 'cv', 'draft'];  // = renderer/pages/core.js STEPS (older apps also reported 'notion': the website still counts it)

// The report for this settings change, or null: a step further than before, or setup finished for the first time.
export function track(patch, before, now = Date.now()) {
  const furthest = STEPS.indexOf(before.setupFurthest);
  const minutes = before.firstRunAt ? Math.max(0, Math.round((now - Date.parse(before.firstRunAt)) / 60000)) : null;
  const ai = freeOn(before) || freeOn(patch) ? 'free' : 'own';
  if (patch.setupDone === true && !before.setupDone) return {step: 'done', index: STEPS.length, minutes, ai};
  const index = STEPS.indexOf(patch.wizardStep);
  if (index > furthest) return {step: patch.wizardStep, index, minutes, ai};
  return null;
}

// Why people stop (the "Leaving setup?" question when quitting mid-setup, and "Stuck? Tell us" on every step):
// one of these reasons, the step they were on, and optional words. Sent as a "setup" report with step "stopped".
export const REASONS = {
  notion: "I don't use Notion", ai: 'The AI key or its cost', time: 'Setup takes too long', privacy: 'Privacy concerns',   // about Notion
  looking: "Just looking, I'll come back", broke: 'Something broke', other: 'Other',
};

export function stopped({reason, text = '', mode = 'quit'}, settings) {
  if (!REASONS[reason]) return null;
  return {step: 'stopped', where: settings.wizardStep || settings.setupFurthest || 'welcome', reason, mode,
    ...(text.trim() ? {said: text.trim().slice(0, 500)} : {})};
}

// Ask when quitting only while setup isn't done, once per install, and only if reports are on.
export const shouldAskOnQuit = (settings, reportsOn) => reportsOn && !settings.setupDone && !settings.leaveAsked;
// "Look around first" (lib/demo.js) from a setup step: a "setup" report the funnel doesn't count as a step
// (the website ignores unknown steps), so the owner sees how many looked at the demo before setting up.
export function lookAround(from, before, now = Date.now()) {
  const minutes = before.firstRunAt ? Math.max(0, Math.round((now - Date.parse(before.firstRunAt)) / 60000)) : null;
  return {step: 'look_around', from: STEPS.includes(from) ? from : 'other', minutes};
}
