// The window's only bridge to the app: named actions, no Node access, no secret values.
const {contextBridge, ipcRenderer} = require('electron');

// A window newer than the app behind it (code updated while the app ran, then the window reloaded) calls
// actions the running app doesn't have yet: the window is told once, so it can offer a restart.
// Notion later: an action that needs Notion answers {needsNotion, reason} (lib/notion-gate.js). The window is told once
// (pilot-needs-notion), opens the connect prompt, and after a connect runs the same action again (retryNotionNeed).
let need = null;
const call = name => (...args) => ipcRenderer.invoke(name, ...args).then(result => {
  if (result && result.needsNotion) { need = {name, args, reason: result.reason}; window.dispatchEvent(new Event('pilot-needs-notion')); }
  // The data is on this Mac and the action runs off it (Always on): the window offers the move (Connect and move), then runs the same action again.
  if (result && result.needsMove) { need = {name, args, reason: result.reason}; window.dispatchEvent(new CustomEvent('pilot-needs-move', {detail: {reason: result.reason, text: result.text}})); }
  // Apply with no Chrome extension to fill the form (lib/extension-gate.js): the window explains why and guides the install.
  if (result && result.needsExtension) window.dispatchEvent(new CustomEvent('pilot-needs-extension', {detail: {state: result.state, text: result.text}}));
  // First Apply (lib/apply-choice-gate.js): the pressed action waits while the window asks how to apply (renderer/pages/apply-choice.js), then runs
  // again; Not now answers {cancelled}. Plain events both ways: nothing crosses the bridge but the event's name.
  if (result && result.needsApplyChoice) return new Promise(resolve => {
    const done = again => { window.removeEventListener('pilot-apply-chosen', yes); window.removeEventListener('pilot-apply-not-chosen', no); resolve(again ? call(name)(...args) : {ok: false, cancelled: true, error: ''}); };
    const yes = () => done(true), no = () => done(false);
    window.addEventListener('pilot-apply-chosen', yes);
    window.addEventListener('pilot-apply-not-chosen', no);
    window.dispatchEvent(new Event('pilot-needs-apply-choice'));
  });
  return result;
}, error => {
  if (/No handler registered/.test(String(error?.message))) {
    window.dispatchEvent(new Event('pilot-outdated'));
    // Every screen that prints error.message prints this plain line, never "Error invoking remote method 'x': No handler registered" (renderer/errors.js has the same words).
    throw new Error('Jobadabra was updated while it was open. Restart it to use this.');
  }
  throw error;
});
contextBridge.exposeInMainWorld('pilot', {
  platform: process.platform,
  takeNotionNeed: () => (need ? {name: need.name, reason: need.reason} : null),
  retryNotionNeed: () => (need ? ipcRenderer.invoke(need.name, ...need.args) : Promise.resolve(null)),
  state: call('state'), notifyState: call('notifyState'), notifySave: call('notifySave'), saveSettings: call('saveSettings'), saveSecret: call('saveSecret'),
  lookAround: call('lookAround'), leaveDemo: call('leaveDemo'),
  checkAnthropic: call('checkAnthropic'), chooseCv: call('chooseCv'), buildCvDraft: call('buildCvDraft'), buildCvSave: call('buildCvSave'), buildCvDownload: call('buildCvDownload'),
  draftStrategy: call('draftStrategy'), cachedDraft: call('cachedDraft'), cacheDraftEdits: call('cacheDraftEdits'), draftEditLists: call('draftEditLists'), draftTextOutline: call('draftTextOutline'), draftTextEdit: call('draftTextEdit'), saveStrategy: call('saveStrategy'),
  logs: {days: call('logsDays'), tail: call('logsTail'), search: call('logsSearch'), show: call('logsShow')},
  exportJobs: call('exportJobs'), jobs: call('jobs'), usage: call('usage'), visitsHide: call('visitsHide'), uiLog: call('uiLog'), calendarJobs: call('calendarJobs'), calendarRecordings: call('calendarRecordings'), audience: call('audience'), runs: call('runs'), runDetail: call('runDetail'), notionOAuth: call('notionOAuth'), notionOAuthCancel: call('notionOAuthCancel'), cvChange: call('cvChange'), cvReview: call('cvReview'), cvApply: call('cvApply'), cvChangeDone: call('cvChangeDone'), backupNow: call('backupNow'), showBackups: call('showBackups'), backupStatus: call('backupStatus'), resetProfile: call('resetProfile'), exportProfile: call('exportProfile'), importProfile: call('importProfile'), lastReset: call('lastReset'), contact: call('contact'), saveContact: call('saveContact'), detailsFacts: call('detailsFacts'), detailsFactsNow: call('detailsFactsNow'), saveDetailsFacts: call('saveDetailsFacts'), resolveDetailsConflict: call('resolveDetailsConflict'), undoDetailsTidy: call('undoDetailsTidy'), moveCvGaps: call('moveCvGaps'), undoCvGaps: call('undoCvGaps'), locationsWhich: call('locationsWhich'), listMeanings: call('listMeanings'), keepTypo: call('keepTypo'), resolveLocationConflict: call('resolveLocationConflict'), undoSetAside: call('undoSetAside'), contactProposals: call('contactProposals'), checkMail: call('checkMail'), refresh: call('refresh'), setStatus: call('setStatus'), setStage: call('setStage'), deleteJob: call('deleteJob'), clearJobsPlan: call('clearJobsPlan'), clearJobs: call('clearJobs'), focus: call('focus'), sessions: call('sessions'), sessionOutput: call('sessionOutput'), sessionSnapshot: call('sessionSnapshot'), sessionTranscript: call('sessionTranscript'), sessionWrite: call('sessionWrite'), sessionResize: call('sessionResize'), sessionStop: call('sessionStop'), sessionResume: call('sessionResume'), sessionRemove: call('sessionRemove'), sessionSubmitted: call('sessionSubmitted'), sessionFinish: call('sessionFinish'), sessionRestart: call('sessionRestart'), sessionReopen: call('sessionReopen'), sessionsStopExtension: call('sessionsStopExtension'), sessionFillField: call('sessionFillField'), sessionProposalUse: call('sessionProposalUse'), saveContactField: call('saveContactField'), contactKeysFor: call('contactKeysFor'), formChoiceFor: call('formChoiceFor'), sessionCancel: call('sessionCancel'), sessionSkip: call('sessionSkip'), sessionsLeftOpen: call('sessionsLeftOpen'), unapplyJob: call('unapplyJob'), notSubmitted: call('notSubmitted'), focusDone: call('focusDone'), interviewHappened: call('interviewHappened'), focusHistory: call('focusHistory'), reassignEmail: call('reassignEmail'), interviewPrep: call('interviewPrep'), describeJob: call('describeJob'), feedbackAction: call('feedbackAction'), dailyTarget: call('dailyTarget'), setDailyTarget: call('setDailyTarget'), reviewRejection: call('reviewRejection'), apply: call('apply'), applyOne: call('applyOne'), applyWithClaude: call('applyWithClaude'), takeOverClaude: call('takeOverClaude'), sitePassword: call('sitePassword'), credentials: call('credentials'), credentialReveal: call('credentialReveal'), credentialDelete: call('credentialDelete'), credentialAssign: call('credentialAssign'), claudeReady: call('claudeReady'), pageView: call('pageView'), claudePrereqs: call('claudePrereqs'), googleStatus: call('googleStatus'), googleConnect: call('googleConnect'), googleConnectCancel: call('googleConnectCancel'), googleDisconnect: call('googleDisconnect'), openTabs: call('openTabs'), formsOpen: call('formsOpen'), extensionSeen: call('extensionSeen'), extensionInstall: call('extensionInstall'), extensionPage: call('extensionPage'), extensionStore: call('extensionStore'), strayChrome: call('strayChrome'), quitStrayChrome: call('quitStrayChrome'), extensionShow: call('extensionShow'), extensionOptions: call('extensionOptions'), openQuestions: call('openQuestions'), learnedLabels: call('learnedLabels'), jobQuestions: call('jobQuestions'), jobQuestionOnly: call('jobQuestionOnly'), addApplied: call('addApplied'), importJob: call('importJob'), addLead: call('addLead'), proposeLead: call('proposeLead'), clipboardImage: call('clipboardImage'), standardAnswers: call('standardAnswers'), rebuildImpact: call('rebuildImpact'), rescoreOutdated: call('rescoreOutdated'), refreshLocations: call('refreshLocations'), cached: call('cached'), strategyData: call('strategyData'), answerQuestion: call('answerQuestion'), rememberAnswer: call('rememberAnswer'), secretHints: call('secretHints'), prepareKit: call('prepareKit'), preferencesParse: call('preferencesParse'),
  tailorCv: call('tailorCv'), tailorTop: call('tailorTop'), readyState: call('readyState'), readyTonight: call('readyTonight'), readySend: call('readySend'), readyRun: call('readyRun'), readyTop: call('readyTop'), readyCodes: call('readyCodes'), readyAgain: call('readyAgain'), readyStop: call('readyStop'), readyOpen: call('readyOpen'), readyLive: call('readyLive'), readyVideo: call('readyVideo'), readyDone: call('readyDone'), readyDeleteAll: call('readyDeleteAll'), readySettings: call('readySettings'), openTailoredCv: call('openTailoredCv'), cvStatus: call('cvStatus'), cvOf: call('cvOf'), matchCheck: call('matchCheck'), tuneProposals: call('tuneProposals'), tuneApply: call('tuneApply'), matchSaved: call('matchSaved'), cvCheckStatus: call('cvCheckStatus'), cvCheckRun: call('cvCheckRun'), cvCheckAi: call('cvCheckAi'), importCv: call('importCv'), experienceGet: call('experienceGet'), linkedinStatus: call('linkedinStatus'), linkedinConnect: call('linkedinConnect'), linkedinDisconnect: call('linkedinDisconnect'), experienceAddCv: call('experienceAddCv'), experienceAddLinkedin: call('experienceAddLinkedin'), experienceRemove: call('experienceRemove'), experienceRematch: call('experienceRematch'), viewBaseCv: call('viewBaseCv'), showCvFolder: call('showCvFolder'),
  coverLetter: call('coverLetter'), coverLetterDraft: call('coverLetterDraft'), coverLetterSave: call('coverLetterSave'), coverLetterApprove: call('coverLetterApprove'), coverLetterOpen: call('coverLetterOpen'), letterStyle: call('letterStyle'), letterStyleSave: call('letterStyleSave'), jobLetter: call('jobLetter'), jobLetterOpen: call('jobLetterOpen'), jobLetterSave: call('jobLetterSave'), jobLetterAgain: call('jobLetterAgain'),
  ivRecord: call('ivRecord'),
  jobPage: call('jobPage'), jobPageCore: call('jobPageCore'), jobPageRest: call('jobPageRest'), jobPageFiles: call('jobPageFiles'), jobPosting: call('jobPosting'), jobFileSave: call('jobFileSave'), textOutline: call('textOutline'), textEdit: call('textEdit'), reportsInsights: call('reportsInsights'), insightFeedback: call('insightFeedback'), suggestionAnswer: call('suggestionAnswer'),
  employers: call('employers'),
  employerActive: call('employerActive'),
  employersFromPage: call('employersFromPage'),
  formFills: call('formFills'), reportsSearches: call('reportsSearches'), reportsSearch: call('reportsSearch'),
  formFill: call('formFill'),
  storeState: call('storeState'), keepOnThisMac: call('keepOnThisMac'), moveToNotion: call('moveToNotion'),
  textSize: call('textSize'), setTextSize: call('setTextSize'), onZoomChanged: callback => ipcRenderer.on('zoomChanged', (_, value) => callback(value)),
  notionConnect: call('notionConnect'), telegramConnect: call('telegramConnect'), telegramDisconnect: call('telegramDisconnect'), setAutomation: call('setAutomation'), setTheme: call('setTheme'),
  onExperienceStep: callback => ipcRenderer.on('experienceStep', (_, step) => callback(step)),
  onCloudStep: callback => ipcRenderer.on('cloudStep', (_, step) => callback(step)),
  officeState: call('officeState'), officeStart: call('officeStart'), officeCancel: call('officeCancel'), onOfficeProgress: callback => ipcRenderer.on('officeProgress', (_, step) => callback(step)),
  liveOpen: call('liveOpen'), liveInput: call('liveInput'), liveClose: call('liveClose'), onLiveEvent: callback => ipcRenderer.on('liveEvent', (_, event) => callback(event)),
  backgroundBrowserState: call('backgroundBrowserState'), backgroundBrowserStart: call('backgroundBrowserStart'), backgroundBrowserCancel: call('backgroundBrowserCancel'), onBackgroundBrowserProgress: callback => ipcRenderer.on('backgroundBrowserProgress', (_, step) => callback(step)),
  dataCancel: call('dataCancel'), showFile: call('showFile'), onDataProgress: callback => ipcRenderer.on('dataProgress', (_, progress) => callback(progress)),
  onStoreMoveProgress: callback => ipcRenderer.on('storeMoveProgress', (_, progress) => callback(progress)),
  onLeadStep: callback => ipcRenderer.on('leadStep', (_, step) => callback(step)),
  onPrepStep: callback => ipcRenderer.on('prepStep', (_, step) => callback(step)),
  markOutcome: call('markOutcome'),
  searchCoverage: call('searchCoverage'), roleIdeas: call('roleIdeas'), addRoles: call('addRoles'), editTargets: call('editTargets'), editGoal: call('editGoal'), stopTask: call('stopTask'), unqueueTask: call('unqueueTask'), loosenSearch: call('loosenSearch'), explainCoverage: call('explainCoverage'), addPlaces: call('addPlaces'),
  dismissReason: call('dismissReason'), intelSnapshot: call('intelSnapshot'), benchmarkLines: call('benchmarkLines'),
  license: call('license'), licenseSet: call('licenseSet'), licenseRemove: call('licenseRemove'), planState: call('planState'), planCheckout: call('planCheckout'), planSignin: call('planSignin'), planRedeem: call('planRedeem'), proWaitlistJoin: call('proWaitlistJoin'),
  onAllowance: callback => ipcRenderer.on('allowance', (_, state) => callback(state)),
  onAiCap: callback => ipcRenderer.on('aiCap', (_, cap) => callback(cap)),   // a Free AI line reached (lib/ai-caps.js): the top-up dialog
  onFewJobs: callback => ipcRenderer.on('few-jobs', (_, info) => callback(info)),
  onVisitRead: callback => ipcRenderer.on('visit-read', (_, answer) => callback(answer)),
  onVisitClaudeDone: callback => ipcRenderer.on('visit-claude-done', (_, result) => callback(result)),
  telemetryRecord: call('telemetryRecord'), telemetryShown: call('telemetryShown'), telemetrySet: call('telemetrySet'), testerLogsSet: call('testerLogsSet'),
  reportFormGet: call('reportFormGet'), reportFormSet: call('reportFormSet'), reportFormSent: call('reportFormSent'), reportFormDeleteAll: call('reportFormDeleteAll'),
  poolShareGet: call('poolShareGet'), poolShareSet: call('poolShareSet'), poolShareShown: call('poolShareShown'),
  updateState: call('updateState'), updateStatus: call('updateStatus'), updateCheck: call('updateCheck'), updateInstall: call('updateInstall'), betaState: call('betaState'), betaSet: call('betaSet'), testSet: call('testSet'), betaRollback: call('betaRollback'),
  buildState: call('buildState'), restartApp: call('restartApp'),
  onUpdate: callback => ipcRenderer.on('update', (_, offer) => callback(offer)),
  onUpdateChannel: callback => ipcRenderer.on('updateChannel', (_, channel) => callback(channel)),   // the menu's Update Channel changed it
  sendFeedback: call('sendFeedback'), leaveReason: call('leaveReason'),
  onAskWhyLeaving: callback => ipcRenderer.on('askWhyLeaving', () => callback()),
  startFreeAi: call('startFreeAi'),
  claudeCodeStatus: call('claudeCodeStatus'), verifyClaudeCode: call('verifyClaudeCode'), setAiEngine: call('setAiEngine'),
  codexStatus: call('codexStatus'), verifyCodex: call('verifyCodex'), checkOpenAI: call('checkOpenAI'),
  setAiFallback: call('setAiFallback'), dismissEngineOffer: call('dismissEngineOffer'),
  onOpenFeedback: callback => ipcRenderer.on('openFeedback', () => callback()),
  onFind: callback => ipcRenderer.on('find', (_, what) => callback(what)),
  onOpenInterviews: callback => ipcRenderer.on('openInterviews', () => callback()),
  onUpdateStep: callback => ipcRenderer.on('updateStep', (_, step) => callback(step)),
  onNotionProgress: callback => ipcRenderer.on('notionProgress', (_, progress) => callback(progress)),
  onDraftProgress: callback => ipcRenderer.on('draftProgress', (_, progress) => callback(progress)),
  onSaveProgress: callback => ipcRenderer.on('saveProgress', (_, progress) => callback(progress)),
  onSettingsProgress: callback => ipcRenderer.on('settingsProgress', (_, progress) => callback(progress)),   // a Search settings save, as it goes (renderer/save-progress.js)
  onApplyProgress: callback => ipcRenderer.on('applyProgress', (_, text) => callback(text)),
  onToast: callback => ipcRenderer.on('toast', (_, toast) => callback(toast)),
  onOpenTarget: callback => ipcRenderer.on('openTarget', (_, target) => callback(target)),   // a clicked notification (lib/targets.js)
  onReview: callback => ipcRenderer.on('review', (_, state) => callback(state)),
  reviewWatch: call('reviewWatch'), reviewStates: call('reviewStates'), reviewFocus: call('reviewFocus'), reviewReload: call('reviewReload'),
  onSession: callback => ipcRenderer.on('session', (_, event, payload) => callback(event, payload)),
  onTelegramWaiting: callback => ipcRenderer.on('telegramWaiting', (_, username) => callback(username)),
  command: call('command'),
  interviews: {drafts: call('ivDrafts'), transcript: call('ivTranscript'), add: call('ivAdd'), recordStart: call('ivRecordStart'),
    recordChunk: call('ivRecordChunk'), recordStop: call('ivRecordStop'), transcribe: call('ivTranscribe'), prefetch: call('ivPrefetch'), saveDraft: call('ivSaveDraft'),
    discard: call('ivDiscard'), save: call('ivSave'), saved: call('ivSaved'), link: call('ivLink'), review: call('ivReview'), insights: call('ivInsights'), insightStep: call('ivInsightStep'), remove: call('ivDelete'),
    remindGet: call('ivRemindGet'), remindSet: call('ivRemindSet'), recordings: call('ivRecordings'), access: call('mediaAccess'), tapAvailable: call('ivTapAvailable'), tapStart: call('ivTapStart'), openPrivacy: call('openPrivacy'), relaunch: call('relaunch')},
  onInterviewProgress: callback => ipcRenderer.on('ivProgress', (_, step) => callback(step)),
  onCallLevel: callback => ipcRenderer.on('ivLevel', (_, level) => callback(level)),
  hostedState: call('hostedState'), hostedOn: call('hostedOn'), hostedOff: call('hostedOff'), hostedDelete: call('hostedDelete'), hostedPush: call('hostedPush'), hostedExport: call('hostedExport'),
  onHostedArrived: callback => ipcRenderer.on('hostedArrived', (_, arrived) => callback(arrived)),
  cloudConnect: call('cloudConnect'), cloudOff: call('cloudOff'), cloudTurnOffConfirmed: call('cloudTurnOffConfirmed'), telegramCloudOn: call('telegramCloudOn'), telegramCloudOff: call('telegramCloudOff'),
  openExternal: call('openExternal'), openVisit: call('openVisit'), visitsList: call('visitsList'), visitsStuck: call('visitsStuck'), visitsDismiss: call('visitsDismiss'), visitsRun: call('visitsRun'), refusedReadStart: call('refusedReadStart'), visitWithClaude: call('visitWithClaude'), visitsWithClaude: call('visitsWithClaude'), focusBrowser: call('focusBrowser'), visitShowTab: call('visitShowTab'), visitAgain: call('visitAgain'), showBrowser: call('showBrowser'), openNotion: call('openNotion'), showFolder: call('showFolder'), extensionInfo: call('extensionInfo'),
  onLog: callback => ipcRenderer.on('log', (_, line) => callback(line)),
  onMoved: callback => ipcRenderer.on('moved', (_, steps) => callback(steps)),
});
