// The top of a run's result in its run panel: how it ended when that needs saying (a failure, a stop, warnings), why, and its fix.
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

// `warnings`: the run's warning lines not said elsewhere; `partial`: the sources that did not answer (pages/activity-partial.js); `folded`: its box is folded away.
export function drawResultTop({run, warnings, partial, folded}) {
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
  show($('activity-warnings'), warnings.length > 0 || warnedOnly || !!head?.problem);
  if (warnings.length || warnedOnly || head?.problem) {
    // The headline says what it means for you ("9 jobs still need scoring"), not which card this is.
    $('activity-warnings-title').textContent = limited ? `${plural(limited, 'job')} still ${limited === 1 ? 'needs' : 'need'} scoring`
      : head ? head.title : run?.live ? 'Running with warnings' : `${WARN_NOUN[kindOf(run)] || 'Run'} completed with warnings`;
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
    show($('activity-warnings-log'), !!head?.viewLog || (!head && warnings.length > 0));   // warnings: the exact lines are in the log
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
}
