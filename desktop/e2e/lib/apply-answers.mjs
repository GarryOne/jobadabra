// Authored AI answers for the apply fixtures, shared by single forms and multi-page journeys.
// Job: serve stored answers
import {CHAIN, COLLAPSED, FORMS, LATE, MENU_AGAIN, MENU_FIRST, MISLABELLED, ONEPAGE, PROPOSE, REAL_FORMS, REVEAL, SCRIPTED, SIGNIN, SIGNIN_REFUSED, SIGNUP} from './forms.mjs';
import {DIGEST_INSTRUCTIONS} from '../../lib/ladder/rung3-digest.js';
import {INSTRUCTIONS as FORM_RULES, STEP_RULE, SUBMIT_RULE, BLOCKED_RULE, BOT_RULE} from '../../lib/form-judge.js';
import {INSTRUCTIONS as KIND_RULES} from '../../lib/ladder/rung2-sketch.js';
import {BASE_CV, OPEN_ANSWER, contactKeysAnswer, systemOf, tailoredFrom, unmatched} from './apply-fixtures.mjs';

// Known fixture identities are authored test inputs; an unseen page must reach the missing-answer guard.
const fixtures = [...Object.values(FORMS), ...REAL_FORMS, CHAIN, COLLAPSED, LATE, MENU_AGAIN, MENU_FIRST, MISLABELLED, ONEPAGE, PROPOSE, REVEAL, SCRIPTED, SIGNIN, SIGNIN_REFUSED, SIGNUP];
const knownPaths = new Set(fixtures.flatMap(item => [item.path, item.formPath, item.accountPath].filter(Boolean)));

// Only the fixture's declared consent ids receive an explicit AI reading.
function fixtureAnswers(fields) {
  const consent = new Set(Object.values(FORMS).flatMap(form => form.consent || []));
  return fields.flatMap(item => consent.has(item.field) && item.type === 'checkbox'
    ? [{field: item.field, category: 'consent', use: 'fill', value: 'checked', confidence: 'high'}]
    : item.field === 'why' ? [{field: item.field, value: OPEN_ANSWER, confidence: 'medium', note: 'inferred from the profile'}] : []);
}

// Answer the named account fixture phase, including its planted refusal.
function accountAnswer(text) {
  const phase = /^Phase: (\w+)$/m.exec(text)[1], where = (/^Address path: (.*)$/m.exec(text)?.[1] || '').replace(/\/$/, '');
  const ours = [SIGNIN, SIGNIN_REFUSED].some(fixture => [fixture.accountPath, fixture.formPath, `${fixture.accountPath}/new`].includes(where));   // /new: the sign-up page after a refusal
  const answer = !ours ? 'unsure' : phase === 'ready' ? (/· required · empty/.test(text) ? 'needs_person' : 'ready') : /password is wrong/i.test(text) ? 'refused' : 'created';
  return JSON.stringify({answer, needs: answer === 'refused' ? 'Sign in' : '', needs_kind: answer === 'refused' ? 'other' : '', bot_check: false, confidence: 0.9});
}

// Page judges share a sketch shape, but each question owns its own authored reply.
function pageAnswer(ctx, body, system, text, {live, realKind}, fallback) {
  // What kind of page (lib/page-kind.js): the stand-in answers with each fixture's true kind, so every flow row runs on the AI's word, as in use.
  if (system === DIGEST_INSTRUCTIONS && /^Address path: (.*)$/m.exec(text)?.[1]?.replace(/\/$/, '') === LATE.formPath)
    return JSON.stringify({outcome: 'other', verb: 'none', numbers: [], press_kind: '', form_frame: -1, confidence: 1}); // loading fixture: no candidate can fill its not-yet-rendered controls
  if (system === FORM_RULES + STEP_RULE + SUBMIT_RULE + BLOCKED_RULE + BOT_RULE && knownPaths.has(/^Address path: (.*)$/m.exec(text)?.[1]?.replace(/\/$/, '')))
    return JSON.stringify({answer: 'unsure', needs: '', needs_kind: '', step: 'unsure', next_control: '', submit_control: '', bot_check: false, confidence: 1}); // fixture premise: the judge does not veto the structural ready count or press a next/submit control
  if (system === KIND_RULES && /^Address path:/m.test(text) && /^Controls/m.test(text)) {
    ctx.kindAsks = (ctx.kindAsks || 0) + 1;   // counted: the night's page kind is never asked (the Open in Chrome step); the "ready to submit?" judge shares this sketch and still runs
    const where = /^Address path: (.*)$/m.exec(text)?.[1] || '';
    const kinds = {[CHAIN.path]: 'posting', [CHAIN.stepPath]: 'posting', [CHAIN.formPath]: 'form', [SCRIPTED.path]: 'posting', [SCRIPTED.formPath]: 'form', [LATE.path]: 'posting',
      [SIGNUP.path]: 'posting', [SIGNUP.accountPath]: 'account', [SIGNUP.formPath]: 'form', [ONEPAGE.path]: 'account-form',
      [MISLABELLED.path]: 'posting', [SIGNIN.path]: 'posting', [SIGNIN.formPath]: 'form', [SIGNIN_REFUSED.path]: 'posting'};   // MISLABELLED: deliberately wrong, the self-correction row
    if (live) return realKind(body);   // a real site: a real model answers (this Mac's Claude Code, lib/model.mjs), the way the app's own AI would
    // LATE: as the live AI did on SuccessFactors, an empty page still loading reads as a posting whose Apply is its "Postuler" (the form's own submit).
    if (where.replace(/\/$/, '') === LATE.formPath) return JSON.stringify(/Years of experience/.test(text) ? {kind: 'form', confidence: 0.95} : {kind: 'posting', confidence: 0.85, apply_button: 'Postuler'});
    if ([SIGNIN.accountPath, SIGNIN_REFUSED.accountPath].includes(where.replace(/\/$/, ''))) return JSON.stringify({kind: 'account', confidence: 0.95, apply_button: '', account_step: 'sign_in', register_control: 'Create an account', signin_control: '', account_button: 'Sign in'});
    if (where.replace(/\/$/, '') === `${SIGNIN_REFUSED.accountPath}/new`) return JSON.stringify({kind: 'account', confidence: 0.95, apply_button: '', account_step: 'sign_up', register_control: '', signin_control: '', account_button: 'Create account'});   // the sign-up page after the refusal
    if (!knownPaths.has(where.replace(/\/$/, ''))) return unmatched(fallback, body);
    return JSON.stringify({kind: kinds[where.replace(/\/$/, '')] || 'form', confidence: 0.95});
  }
  return null;
}

/** Install answers for fixture questions, delegating unknown questions to the context's answer registry. */
export function installApplyAnswers(ctx, {live = null, realKind} = {}) {
  const {proxy} = ctx;
  const fallback = proxy.canned();
  proxy.setCanned(body => {
    const content = body.messages?.[0]?.content;
    if (Array.isArray(content) && content.some(part => part.type === 'document')) return JSON.stringify(BASE_CV);   // the CV import (lib/cv.js)
    // The tailoring; HELD while a step holds it (ctx.tailorHold): the stand-in answers in milliseconds, faster than a step can look at the task running.
    if (typeof content === 'string' && content.startsWith('<cv>')) return Promise.resolve(ctx.tailorHold).then(() => JSON.stringify(tailoredFrom(JSON.parse(/<cv>\n([\s\S]*?)\n<\/cv>/.exec(content)[1]))));
    // The page after a Submit (lib/confirmation.js): the stand-in answers like a model that reads the words, so the suite proves the chain around it.
    const text = typeof content === 'string' ? content : (content || []).map(part => part.text || '').join('');
    const system = systemOf(body);
    const contact = contactKeysAnswer(system, text);
    if (contact) return contact;
    if (/^URL path:/m.test(text) && /^Page:/m.test(text)) return JSON.stringify({confirmation: /successfully submitted|received your application/i.test(text) && !/must be completed|required/i.test(text)});
    // The menu choice that means the same (lib/option-pick.js: {question, answer, choices} -> {choice}): the stand-in knows what a model would, for the menu
    // fixture only ("+41" is Suisse); each ask is counted, so the remembered choice can be proven to need none (ctx.optionPicks).
    if (typeof content === 'string' && content.startsWith('{"question"')) {
      const ask = JSON.parse(content);
      ctx.optionPicks = [...(ctx.optionPicks || []), {question: ask.question, answer: ask.answer}];
      return JSON.stringify({choice: ask.answer === '+41' && ask.choices.includes('Suisse') ? 'Suisse' : ''});
    }
    if (/^Phase: (ready|result)$/m.test(text)) return accountAnswer(text);
    const pageReply = pageAnswer(ctx, body, system, text, {live, realKind}, fallback);
    if (pageReply !== null) return pageReply;
    const asked = /<form_fields>\n([\s\S]*?)\n<\/form_fields>/.exec(typeof content === 'string' ? content : (content || []).map(part => part.text || '').join(''));
    if (!asked) return unmatched(fallback, body);
    ctx.answerAsks = [...(ctx.answerAsks || []), ...JSON.parse(asked[1]).map(item => item.field)];   // counted: a question the night answered is never asked
    const answers = fixtureAnswers(JSON.parse(asked[1]));
    return JSON.stringify({eligible: true, eligibility_note: '', answers});
  });
}
