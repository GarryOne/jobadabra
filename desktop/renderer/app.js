// The window: setup wizard on first run, then Focus, Jobs, Strategy, sessions and Settings, one module per page
// (pages/). It only talks to the app through window.pilot (preload.cjs); it never sees a key's value.
// Each page's start-up code runs here in the order it always has.
import {init as core} from './pages/core.js';
import {shared} from './pages/shared.js';
import {sessionList} from './pages/sessions.js';
import {init as wizard} from './pages/wizard.js';
import {init as cvBuild} from './pages/cv-build.js';
import {init as demo} from './pages/demo.js';
import {init as activity} from './pages/activity.js';
import {init as strategyReview} from './pages/strategy-review.js';
import {init as settings} from './pages/settings.js';
import {init as theme} from './pages/theme.js';
import {init as textSize} from './pages/text-size.js';
import {init as nav, paletteCommands} from './pages/nav.js';
import {init as sidebarRail} from './sidebar-rail.js';
import {init as jobs} from './pages/jobs.js';
import {init as strategy} from './pages/strategy.js';
import {init as profile} from './pages/profile.js';
import {init as connections} from './pages/connections.js';
import {init as actions} from './pages/actions.js';
import {init as runsTab} from './pages/runs-tab.js';
import {init as cvChange} from './pages/cv-change.js';
import {init as data} from './pages/data.js';
import {init as startup} from './pages/startup.js';
import {init as calendar} from './pages/calendar.js';
import {init as interviews} from './pages/interviews.js';
import {init as reports} from './pages/reports.js';
import {init as matchCheck} from './pages/match-check.js';
import {init as tune} from './pages/tune.js';
import {mountStageTips} from './tips.js';
import {init as focus} from './pages/focus.js';
import {init as feedback} from './pages/feedback.js';
import {init as logs} from './pages/logs.js';
import {init as happened} from './pages/happened.js';
import {init as sessions} from './pages/sessions.js';
import {init as sessionNeeds} from './pages/session-needs.js';
import {init as sessionStop} from './pages/session-stop.js';
import {init as sessionLog} from './pages/session-log.js';
import {init as runsPage} from './pages/runs-page.js';
import {init as reassign} from './pages/reassign.js';
import {init as prep} from './pages/prep.js';
import {init as update} from './pages/update.js';
import {init as build} from './pages/build.js';
import {init as telemetry} from './pages/telemetry.js';
import {init as consentSetting} from './pages/consent-setting.js';
import {init as applySettings} from './pages/apply-settings.js';   // Settings → Apply
import {init as applyChoice} from './pages/apply-choice.js';   // the first-Apply dialog
import {init as find} from './pages/find.js';
import {init as poolShare} from './pages/pool.js';
import {init as reportForm} from './pages/report-form.js';
import {init as license} from './pages/license.js';
import {init as appFeedback} from './pages/app-feedback.js';
import {init as whyStop} from './pages/why-stop.js';
import {init as notionConnect} from './pages/notion-connect.js';
import {init as extensionNeeded} from './pages/extension-needed.js';
import {init as employers} from './pages/employers.js';
import {startListening as saveProgress} from './save-progress.js';
import {openJobPanel} from './pages/job-panel.js';
import {renderFindCard} from './pages/jobs-find.js';

await core();
notionConnect();
extensionNeeded();
saveProgress();   // Search settings saves say how far they are (save-progress.js)
await wizard();
cvBuild();   // Build a CV with the AI: its dialog and buttons (pages/cv-build.js)
await demo();
await activity();
await strategyReview();
await settings();
await theme();
await textSize();
sidebarRail();
await nav();
await jobs();
await strategy();
await profile();
await connections();
await actions();
runsTab();
await reassign();
await prep();
await update();
await build();
await telemetry();
consentSetting();
applySettings(); applyChoice();
await find();
await poolShare();
await reportForm();
await license();
await appFeedback();
await whyStop();
await cvChange();
await data();
await startup();
await interviews();
matchCheck();
tune();
// Tips on the other stops (the Application sessions page has its own): the topics of that stop, one slim bar, hidden everywhere with one ×.
mountStageTips('tips-jobs', ['cv', 'tailor', 'ats', 'knockout', 'timing']);
mountStageTips('tips-focus', ['follow-up', 'mindset', 'timing']);
mountStageTips('tips-interviews', ['interview', 'mindset']);
await calendar();
reports();
await focus();
await feedback();
await logs();
await happened();
await sessions();
await sessionNeeds();
sessionStop();
await sessionLog();
await runsPage();
employers();

// For checks and debugging (npm run shot -- --eval, the DevTools console): the window's state, read-only by convention.
window.__jp = {findCard: renderFindCard, paletteCommands, shared, openJob: (url, tab) => { const job = shared.allJobs.find(each => each.url === url); return job ? openJobPanel(job, tab) : null; }, get sessions() { return sessionList; }, get openSession() { return sessionList.find(item => item.id === shared.openSessionId) || null; },
  terminal: () => { const term = shared.xterm; if (!term) return null; const buffer = term.buffer.active;
    return {rows: term.rows, cols: term.cols, screen: buffer.type, mouse: term.modes.mouseTrackingMode, viewportY: buffer.viewportY,
      lines: Array.from({length: term.rows}, (_, i) => buffer.getLine(buffer.viewportY + i)?.translateToString(true) || '')}; }};
