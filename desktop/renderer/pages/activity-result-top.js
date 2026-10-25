// The top of a run's one result card in its run panel: how it ended (a failure, a stop, warnings, or a clean end for the kinds in run-result-card.js CLEAN_TOP),
// the one number, why, and its fix or next step.
// Moved out of pages/activity-render.js as a pure move (25 Oct 2026). Guarded by the tests that read the activity-*.js sources (desktop/test/activity-source.js),
// desktop/test/run-status.test.js and the e2e activity suites.
import {groupWarnings, limitedJobs, newDetails} from '../run-warnings.js';
import {aiLimitHead, failureHead, stoppedHead, deliveryHead, notConnectedHead, waitedHead} from '../run-status.js';
import {el} from '../components.js';
import {icon} from '../icons.js';
import {rerunSites} from '../visits-card.js';
import {$, show} from './core.js';
import {KIND, kindOf, warningSummary, WARN_NOUN, plural, signedInSince, gmailConnected, runButton} from './activity-basics.js';
import {showPartial} from './activity-partial.js';
import {cleanTop, titleWithNumber, topTone, TOP_TONES} from '../run-result-card.js';

// `warnings`: the run's warning lines not said elsewhere; `partial`: the sources that did not answer (pages/activity-partial.js); `folded`: its box is folded away;
// `added`: the jobs the run added (its one number). Returns {next}: true when the top offers the run's next step (the header then does not repeat it).
export function drawResultTop({run, warnings, partial, folded, added = 0}) {
  // Warnings (Notion busy, a step skipped…) shown plainly above the log, not buried in it. A run whose row says
  // Warnings — its own verdict — still says so when neither its log nor its report has a line about it: the list's
  // pill and this card never contradict each other.
  // A failed run says so in its box, with its reason and the fix the app can open (#290); one the AI provider stopped
  // says that in plain words, with the way to raise the limit (the owner's mockup, 6 Oct 2026).
  const head = (run && (aiLimitHead({...run, kind: kindOf(run)}, KIND[kindOf(run)]?.name) || stoppedHead({...run, kind: kindOf(run)})
    || deliveryHead({...run, kind: kindOf(run)}) || notConnectedHead(run, gmailConnected()) || waitedHead({...run, kind: kindOf(run)})))
    || signedInSince(failureHead(run && {...run, kind: kindOf(run)}, KIND[kindOf(run)]?.name));
  // A message not delivered comes after the run's results; every other box comes first. Its icon says what it is about.
  if (head?.delivery) $('activity-phases').after($('activity-warnings')); else $('activity-phases').before($('activity-warnings'));
  $('activity-warnings').querySelector('.ap-warn-icon').replaceChildren(icon(head?.icon || 'alert'));
  const warnedOnly = !warnings.length && !partial && !run?.live && !!run?.warned && !head;
  showPartial(partial?.partial);
  const limited = limitedJobs(warnings);
  const problem = warnings.length > 0 || warnedOnly || !!head?.problem;
  const clean = !problem ? cleanTop(run, {kind: kindOf(run), added}) : null;
  // The top's tone is the pill's (run-result-card.js topTone): a warning amber, a failure red, a clean end green; a live run with warnings stays amber.
  const tone = run?.live ? 'warn' : clean?.tone || (head?.problem || warnings.length || warnedOnly ? topTone(run, kindOf(run)) : 'warn');
  for (const each of TOP_TONES) $('activity-warnings').classList.toggle(`tone-${each}`, each === (tone === 'good' && !clean ? 'warn' : tone));
  show($('activity-warnings-fold'), !clean);   // a clean end has nothing to fold
  show($('activity-warnings-again'), false);
  show($('activity-warnings'), problem || !!clean);
  $('activity-warnings-fix').dataset.go = '';
  if (clean) {
    $('activity-warnings').querySelector('.ap-warn-icon').replaceChildren(icon(clean.icon));
    $('activity-warnings-title').textContent = clean.title;
    $('activity-warnings-summary').textContent = '';
    for (const id of ['activity-warnings-hint', 'activity-warnings-external', 'activity-warnings-limit', 'activity-warnings-more', 'activity-warnings-list']) show($(id), false);
    // Its next step opens the run's new jobs, newest first, as the header's link did (pages/activity.js #activity-go).
    show($('activity-warnings-fix'), !!clean.next);
    $('activity-warnings-fix').textContent = clean.next?.label || '';
    Object.assign($('activity-warnings-fix').dataset, {view: clean.next?.view || '', rerun: '', sites: '', go: clean.next ? '1' : ''});
    show($('activity-warnings-log'), true);
    $('activity-warnings').classList.remove('is-folded');
    return {next: !!clean.next};
  }
  if (problem) {
    // The headline says what it means for you ("9 jobs still need scoring"), not which card this is.
    $('activity-warnings-title').textContent = limited ? `${plural(limited, 'job')} still ${limited === 1 ? 'needs' : 'need'} scoring`
      : head ? (run?.live ? head.title : titleWithNumber(head.title, kindOf(run), added)) : run?.live ? 'Running with warnings' : `${WARN_NOUN[kindOf(run)] || 'Run'} completed with warnings`;
    const summary = head?.problem ? head.summary : warnings.length ? warningSummary(warnings) : 'The run recorded warnings, with no line about them in its log or report.';
    $('activity-warnings-summary').textContent = summary;
    show($('activity-warnings-hint'), !!head?.hint);
    $('activity-warnings-hint').textContent = head?.hint || '';
    const external = $('activity-warnings-external');
    show(external, !!head?.fix?.url);
    external.dataset.url = head?.fix?.url || '';
    external.replaceChildren(...(head?.fix?.url ? [`${head.fix.label} `, icon('external')] : []));
    show($('activity-warnings-fix'), !!head?.fix && !head.fix.url);
    $('activity-warnings-fix').textContent = head?.fix ? head.fix.label : '';
    $('activity-warnings-fix').dataset.view = head?.fix?.view || '';
    // Run again: the task's own Run button on the Actions page, so it queues, joins and reports like any other run.
    const again = head?.fix?.rerun ? runButton(kindOf(run)) : null;
    $('activity-warnings-fix').dataset.rerun = again ? kindOf(run) : '';
    $('activity-warnings-fix').dataset.sites = again && kindOf(run) === 'visits' ? JSON.stringify(rerunSites(run.log || [])) : '';
    if (head?.fix?.rerun && !again) show($('activity-warnings-fix'), false);
    // Run again beside a fix that is not itself Run again (owner, 25 Oct 2026: "If an action failed we should have run again"), as the Actions banner has it.
    const alsoAgain = !run?.live && !!head?.problem && !head?.fix?.rerun && !!runButton(kindOf(run));
    show($('activity-warnings-again'), alsoAgain);
    $('activity-warnings-again').dataset.rerun = alsoAgain ? kindOf(run) : '';
    show($('activity-warnings-log'), !run?.live || !!head?.viewLog || warnings.length > 0);   // every ended run's top offers its log (owner, 25 Oct 2026: "here is the log")
    show($('activity-warnings-limit'), limited > 0);
    const grouped = newDetails(groupWarnings(head?.delivery ? warnings.filter(line => !head.lines.includes(line)) : warnings), head?.delivery ? head.hint : summary);
    // One line needs no toggle: it is shown. Two or more fold behind "View N details".
    const single = grouped.length === 1;
    const listShown = single || (grouped.length > 0 && !$('activity-warnings-list').hidden && $('activity-warnings-list').dataset.for === String(run?.id));
    $('activity-warnings-list').dataset.for = String(run?.id);
    show($('activity-warnings-list'), listShown);
    show($('activity-warnings-more'), grouped.length > 1);
    $('activity-warnings-more').textContent = listShown ? 'Hide details' : `View ${grouped.length} detail${grouped.length === 1 ? '' : 's'}`;
    $('activity-warnings-list').replaceChildren(...grouped.map(text => el('li', '', text)));
    // Folded away: the headline stays, the rest hides (the chevron turns).
    $('activity-warnings').classList.toggle('is-folded', folded);
    $('activity-warnings-fold').setAttribute('aria-expanded', String(!folded));
    $('activity-warnings-fold').title = folded ? 'Show' : 'Hide';
  }
  return {next: false};
}
