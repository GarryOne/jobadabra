// The bottom of a run's one result card in its run panel: its kind's own view (the jobs a search added, a Gmail check's emails, an insight's finding,
// the kits, the sites read, skeleton bars while its page is read, or the box of a run that saved nothing).
// Moved out of pages/activity-render.js as a pure move (25 Oct 2026). Guarded by the tests that read the activity-*.js sources (desktop/test/activity-source.js),
// desktop/test/run-result-card.test.js and the e2e activity suites.
import {parseRunMessage} from '../run-cards.js';
import {parseVisits} from '../visits-card.js';
import {parseInsight} from '../insight-card.js';
import {parseWeekly} from '../weekly-card.js';
import {parseInterviewReview} from '../interview-review.js';
import {kitsOutcome, parseKitsReady} from '../kits-ready.js';
import {noResultHead, unsavedRun} from '../run-status.js';
import {newJobsCard} from '../new-jobs-card.js';
import {$, show} from './core.js';
import {lastAnswered, pendingMailQuestions} from './focus.js';
import {KIND, KITS_CARD, kindOf, mailReportOf, runDetails} from './activity-basics.js';
import {renderVisitsCard} from './activity-visits.js';
import {renderRunCard, renderCardSkeleton, renderNoResult} from './activity-run-card.js';
import {renderMailCard} from './activity-mail.js';
import {renderInsightCard, renderInterviewCard, renderKitsCard, renderWeeklyCard} from './activity-cards.js';

// `lines`: the run's log; `shownText`: its result text (run-cards.js cardText); `tabs`: a live Find jobs using your browser's site rows;
// `readingNow`: its Notion page is being read; `redraw`: draws the panel again (after Read again). Returns which view it drew.
export function drawResultBottom({run, lines, shownText, tabs, readingNow, redraw}) {
  const own = kindOf(run) === 'search' ? newJobsCard(run, lines) : null;
  const card = (own?.items.length ? own : null) || (shownText ? parseRunMessage(shownText) : null) || own;
  // A Gmail check's message has no digest header but plenty of structure (the interview it is about, the topics to
  // strengthen, the recruiter's next step): it gets its own card, not its raw lines in a <pre>.
  const mail = !run?.live && !card ? mailReportOf(run) : null;
  // An insight is written to be sent, not read: its card is the finding, the numbers behind it and the one action
  // (the mockup, 30 Sep). Only what the insight carries is drawn — anything else is absent, never an empty slot.
  const insight = !card && !mail && shownText ? parseInsight(shownText) : null;
  // The week's report: the same card, with what worked and what to change in place of the finding's evidence.
  const weekly = !card && !mail && !insight && shownText ? parseWeekly(shownText) : null;
  // An interview review: the same card shape as the others, from the message src/ai/interviews.py wrote.
  const review = !run?.live && !card && !mail && !insight && !weekly && kindOf(run) === 'interview' && run?.message
    ? parseInterviewReview(run.message) : null;
  const kits = !run?.live && !card && !mail && !insight && !weekly && !review && KITS_CARD.has(kindOf(run)) && run?.message ? parseKitsReady(run.message) : null;
  if (kits) kits.outcome = kitsOutcome(kits, run.log);
  const sites = !run?.live && !card && !mail && !insight && !weekly && !review && !kits && run?.message ? parseVisits(run.message) : null;   // Find jobs using your browser
  const reading = readingNow;
  show($('activity-help'), false);   // only a search card with few new jobs fills it
  let drawnCard = null;   // {empty}: a search that added nothing has no bottom (its top says so)
  if (card) drawnCard = renderRunCard(card, run);
  else if (mail) {
    renderMailCard(mail, pendingMailQuestions(), lastAnswered());
  }
  else if (insight) renderInsightCard(insight);
  else if (weekly) renderWeeklyCard(weekly);
  else if (review) renderInterviewCard(review);
  else if (kits) renderKitsCard(kits);
  else if (sites) renderVisitsCard({...sites, since: run.startedAt}, undefined, {list: !tabs});   // the step card above has the sites (parseSiteRows)
  else if (reading) renderCardSkeleton();
  // Nothing saved: the amber box with Read again and the log (it was the Actions card's; the Actions banner is compact since 25 Oct 2026).
  const unsaved = !card && !mail && !insight && !weekly && !review && !kits && !sites && !reading && unsavedRun(run);
  if (unsaved) renderNoResult(noResultHead({...run, kind: kindOf(run)}, KIND[kindOf(run)] || {name: 'The run'}), {log: () => $('activity-log')?.scrollIntoView({block: 'nearest'}),
    fix: run.pageId ? () => { runDetails.delete(run.pageId); redraw(); } : null});
  if (card || insight || weekly || mail || review || kits || sites) show($('activity-result'), false);  // the card shows the same, laid out
  show($('activity-card'), (!!card && !drawnCard?.empty) || !!mail || !!insight || !!weekly || !!review || !!kits || !!sites || reading || unsaved);
  return {card, mail, insight, weekly, review, kits, sites, reading, unsaved, drawnCard};
}
