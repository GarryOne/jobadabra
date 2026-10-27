// The panel's own styles and markup (drawn inside its shadow root, so the page's styles cannot touch it). Owns only this string; review.js puts it in the root
// and finds its parts by class. Injected before review.js (panel-files.js). Guarded by desktop/test/panel-click-through, extension-panel-version, cost-labels.
(() => {
  window.__jobPilottoPanelMarkup = `<style>
    :host { all: initial; }
    * { box-sizing: border-box; }
    /* Two themes (owner, 19 Oct 2026: "let it support 2 themes dark/light, in sync with the desktop app"): light tokens here; dark under data-theme=dark (the app's setting, review.js) or,
       when the app says nothing, the system's. Every colour below is a token, so a switch is live with no reload. */
    .jp { --card: #fff; --head: #132439; --ink: #182537; --muted: #5b6b80; --line: #e2e8f0; --soft: #f1f5fb; --btn: #fff; --signal: #ffb224; --signal-2: #ffb224; --on-signal: #14110c; --signal-text: #8a5700; --link: #8a5700;
      --good: #1f9d55; --good-soft: #e7f6ee; --warn: #9a6200; --warn-soft: #fdf4e4; --info: #165bba; --info-soft: #eaf1fb; --track: #e7ecf2; --tile: #eef3fb; --shadow: rgba(19,36,57,.3);
      font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; color: var(--ink);
      display: flex; flex-direction: column; align-items: flex-end; gap: 10px; pointer-events: none; } .jp > * { pointer-events: auto; }   /* the box is as wide as the pill: its empty part lets the page's clicks through (owner, 9 Oct 2026) */
    .jp[data-theme=dark] { --card: #111c2b; --head: #0c1522; --ink: #e8eef6; --muted: #94a3b8; --line: #263548; --soft: #172436; --btn: #111c2b; --signal: #ffb224; --signal-text: #ffb224; --link: #ffb224;
      --good: #34c36f; --good-soft: #12301f; --warn: #f1b25a; --warn-soft: #34260f; --info: #8fb8f5; --info-soft: #17304f; --track: #243246; --tile: #142238; --shadow: rgba(0,0,0,.55); }
    @media (prefers-color-scheme: dark) { .jp:not([data-theme=light]):not([data-theme=dark]) { --card: #111c2b; --head: #0c1522; --ink: #e8eef6; --muted: #94a3b8; --line: #263548; --soft: #172436; --btn: #111c2b; --signal: #ffb224; --signal-text: #ffb224; --link: #ffb224;
      --good: #34c36f; --good-soft: #12301f; --warn: #f1b25a; --warn-soft: #34260f; --info: #8fb8f5; --info-soft: #17304f; --track: #243246; --tile: #142238; --shadow: rgba(0,0,0,.55); } }
    button { font: inherit; cursor: pointer; border: 0; }
    /* the pill (collapsed) */
    .pill { display: flex; align-items: center; gap: 10px; padding: 6px 14px 6px 6px; border-radius: 999px; background: var(--card);
      box-shadow: 0 6px 22px var(--shadow), 0 0 0 1px var(--line); color: var(--ink); }
    .pill:hover { box-shadow: 0 8px 26px var(--shadow), 0 0 0 1px var(--muted); }
    .ring { --done: 0; --tone: var(--signal-2); width: 36px; height: 36px; border-radius: 50%; display: grid; place-items: center; flex: none;
      background: conic-gradient(var(--tone) calc(var(--done) * 1%), var(--track) 0); font-weight: 700; font-size: 13px; }
    .ring span { width: 28px; height: 28px; border-radius: 50%; background: var(--card); display: grid; place-items: center; }
    .ready .ring { --tone: var(--good); background: var(--good); color: #fff; }
    .ready .ring span { background: var(--good); }
    .pill b { font-size: 13px; }
    .pill small { display: block; color: var(--muted); font-size: 11px; font-weight: 500; }
    .ready .pill b { color: var(--good); }
    /* the card (open) */
    .card { width: 372px; max-height: min(640px, calc(100vh - 110px)); display: flex; flex-direction: column; background: var(--card);
      border-radius: 16px; overflow: hidden; box-shadow: 0 18px 50px var(--shadow), 0 0 0 1px var(--line); }
    .head { display: flex; align-items: center; gap: 8px; padding: 11px 14px; background: var(--head); color: #fff; }
    .mark { width: 22px; height: 22px; border-radius: 6px; background: #f5c542; display: grid; place-items: center; font: 800 10px/1 system-ui; }
    .head b { font-size: 13px; }
    .head b { flex: 1; font-size: 14px; }
    .head .min { margin-left: auto; background: transparent; color: #b9c8dc; font-size: 16px; line-height: 1; padding: 2px 6px; border-radius: 6px; } .head .min:hover { color: #fff; background: rgba(255,255,255,.1); }
    .head .x { margin-left: auto; background: transparent; color: #b9c8dc; font-size: 18px; line-height: 1; padding: 2px 4px; border-radius: 6px; }
    .head .x:hover { color: #fff; background: rgba(255,255,255,.1); }
    .body { padding: 14px; overflow: auto; display: flex; flex-direction: column; gap: 12px; }
    .job-title { font-weight: 700; font-size: 16px; line-height: 1.3; }
    .job-meta > span:first-child:not(:last-child)::after { content: '\\2022'; margin-left: 8px; }
    .job-meta { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; color: var(--muted); margin-top: 3px; }
    .tag { display: inline-flex; align-items: center; gap: 5px; padding: 1px 10px; border-radius: 999px; font-size: 11.5px; font-weight: 600;
      background: var(--info-soft); color: var(--info); }
    .tag.good { background: var(--good-soft); color: var(--good); } .tag.warn { background: var(--warn-soft); color: var(--warn); }
    .tag.dot::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
    .claude { display: flex; gap: 8px; align-items: flex-start; padding: 9px 10px; border-radius: 10px; background: var(--soft); color: var(--ink); font-size: 12.5px; }
    .claude i { font-style: normal; flex: none; }
    .progress-line { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
    .progress-line b { font-size: 22px; letter-spacing: -.01em; }
    .progress-line span { color: var(--muted); font-size: 12px; }
    .bar { height: 6px; border-radius: 999px; background: var(--track); overflow: hidden; margin-top: 8px; }
    .bar i { display: block; height: 100%; width: 0; background: var(--signal-2); border-radius: 999px; transition: width .3s; }
    .ready .bar i { background: var(--good); }
    .primary { width: 100%; padding: 10px; border-radius: 10px; background: var(--signal); color: var(--on-signal); font-weight: 650;
      display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 40px; }
    .primary:hover { filter: brightness(.92); }
    .primary:disabled { opacity: .6; cursor: default; }
    .primary .label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    /* Working: the button itself says what's happening, at full colour, with a white spinner. */
    .fill-box { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .fill-box:has(.is-busy) { background: var(--soft); border-radius: 12px; padding: 7px 8px 7px 12px; }
    .fill-box:has(.is-busy) .step-hint { margin: 0 0 0 -4px; }
    .primary.is-busy, .primary.is-busy:disabled { opacity: 1; cursor: progress; background: none; padding: 0; min-height: 0; color: var(--ink); font-weight: 650; font-size: 13.5px; justify-content: flex-start; flex: 1; width: auto; min-width: 0; }
    .stop-btn { display: none; padding: 7px 14px; border-radius: 9px; background: var(--btn); color: var(--ink); border: 1px solid var(--line); font-weight: 650; } .primary.is-busy ~ .stop-btn { display: block; }
    .step-hint { display: none; flex-basis: 100%; margin: 0; color: var(--muted); font-size: 12.5px; } .primary.is-busy ~ .step-hint { display: block; }
    .primary .spin { display: none; width: 20px; height: 20px; border-radius: 50%; border: 3px solid color-mix(in srgb, var(--info) 28%, transparent);
      border-top-color: var(--info); animation: spin .8s linear infinite; flex: none; }
    .primary.is-busy .spin { display: block; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .note { padding: 9px 10px; border-radius: 10px; background: var(--warn-soft); color: var(--warn); font-size: 12.5px; }
    .note span { margin-right: .35em; }   /* the note's text and its button read as two words, not "values.Got it" */
    .note button { margin-top: 6px; background: transparent; color: var(--signal-text); font-weight: 650; padding: 0; }
    h4 { margin: 0 0 4px; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
    .item { display: flex; gap: 9px; align-items: flex-start; width: 100%; text-align: left; padding: 7px 8px; border-radius: 8px; background: transparent; color: var(--ink); }
    .item:hover { background: var(--soft); }
    .item i { font-style: normal; flex: none; width: 16px; text-align: center; color: var(--muted); }
    .item .go { margin-left: auto; color: var(--muted); }
    .actions { display: flex; gap: 6px; flex-wrap: wrap; }
    .secondary { padding: 7px 10px; border-radius: 9px; background: var(--btn); color: var(--ink); border: 1px solid var(--line); font-weight: 600; font-size: 12px; }
    .secondary:hover { background: var(--soft); }
    .link { background: none; border: 0; padding: 4px 0; color: var(--link); font-weight: 600; font-size: 13px; text-align: left; } .link::after { content: ' \\2197'; }
    .link:hover { text-decoration: underline; }
    .pill-stop { display: none; padding: 6px 14px; border-radius: 999px; background: var(--btn); color: var(--ink); border: 1px solid var(--line); font-weight: 650; box-shadow: 0 4px 14px var(--shadow); }
    .jp.busy .pill-stop { display: block; } .card:not([hidden]) ~ .pill-stop { display: none; }
    .tailor { display: flex !important; flex-direction: row !important; align-items: center !important; justify-content: space-between; gap: 10px; margin: 0 !important; padding: 10px 0 !important; border: 0 !important; border-top: 1px solid var(--line) !important; border-radius: 0 !important; background: none !important; }
    .tailor .t-btn { background: none; border: 0; padding: 0; color: var(--link); font-weight: 600; } .tailor .t-btn::after { content: ' \\2197'; }
    .tailor .t-text::before, .verify .shield { content: ''; display: inline-block; background: currentColor; -webkit-mask: var(--icon) center / contain no-repeat; mask: var(--icon) center / contain no-repeat; }
    .tailor .t-text::before { --icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 18' fill='none' stroke='black' stroke-width='1.4' stroke-linejoin='round' stroke-linecap='round'%3E%3Cpath d='M3 1.7h6.5L13 5.2v11.1H3z'/%3E%3Cpath d='M9.5 1.7v3.5H13M5.5 9h5M5.5 12h5'/%3E%3C/svg%3E"); width: 16px; height: 18px; margin-right: 10px; vertical-align: -4px; }
    .actions { border-top: 1px solid var(--line); padding-top: 6px; }
    .tip { display: flex; gap: 8px; align-items: baseline; padding: 8px 14px; border-top: 1px solid var(--line); font-size: 12px; line-height: 1.4; color: var(--ink); cursor: pointer; }
    .tip-chip { flex: none; font-size: 10px; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
    /* The footer of every state (owner mockup, 16 Oct 2026): the connection on the left, the one Report entry on the right. */
    .foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 9px 14px; border-top: 1px solid var(--line); color: var(--muted); font-size: 11.5px; }
    .foot .state { display: flex; align-items: center; gap: 6px; min-width: 0; flex-wrap: wrap; }
    .foot .state::before { content: ''; flex: none; width: 7px; height: 7px; border-radius: 50%; background: var(--muted); }
    .foot.on .state::before { background: var(--good); }
    .foot.off .state::before { background: #d92d20; }
    .foot .reload { font: inherit; color: var(--ink); background: none; border: 1px solid var(--line); border-radius: 6px; padding: 2px 8px; cursor: pointer; }
    .foot .report-btn { flex: none; display: inline-flex; align-items: center; gap: 5px; padding: 5px 10px; border-radius: 8px; background: var(--btn); color: var(--ink); border: 1px solid var(--line); font-weight: 600; font-size: 12px; }
    .foot .report-btn:hover { background: var(--soft); }
    .foot .report-btn svg { width: 13px; height: 13px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
    .knock { margin: 0 0 8px; padding: 7px 9px; border-radius: 7px; background: var(--warn-soft); color: var(--warn); font-size: 12px; line-height: 1.4; }
    .stopped { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; align-items: center; padding: 12px; border-radius: 12px; background: var(--tile); }
    .stopped .pause { width: 36px; height: 36px; border-radius: 50%; border: 3px solid var(--info); color: var(--info); display: grid; place-items: center; gap: 4px; grid-auto-flow: column; } .stopped .pause i { width: 4px; height: 14px; border-radius: 2px; background: currentColor; }
    .stopped b, .verify b { display: block; font-size: 14.5px; } .stopped .s-text, .verify .v-text { color: var(--muted); font-size: 12.5px; }
    .recheck { justify-self: start; align-self: flex-start; }
    .left h4 { text-transform: none; letter-spacing: 0; font-size: 12.5px; font-weight: 600; color: var(--ink); }
    .left .item { border: 1px solid var(--line); border-radius: 8px; padding: 9px 10px; }
    .verify:not([hidden]) ~ .left, .verify:not([hidden]) ~ .recheck { display: none; }
    .verify { display: grid; grid-template-columns: auto 1fr; gap: 8px 12px; padding: 12px; border-radius: 12px; background: var(--warn-soft); border: 1px solid var(--line); }
    .verify .shield { --icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 22' fill='none' stroke='black' stroke-width='1.6' stroke-linejoin='round' stroke-linecap='round'%3E%3Cpath d='M10 1.5l7.5 2.8v6.2c0 4.6-3.1 8.3-7.5 10-4.4-1.7-7.5-5.4-7.5-10V4.3z'/%3E%3Cpath d='M7 10.8l2.2 2.2L13.2 9'/%3E%3C/svg%3E"); width: 26px; height: 28px; color: var(--signal); align-self: center; } .verify .v-show, .verify .v-again { grid-column: 1 / -1; text-align: center; } .verify .v-again::after { content: ''; }
    .stopped:not([hidden]) ~ .fill-box, .verify:not([hidden]) ~ .fill-box { display: none; }   /* the state card has its own way on (Check form again / Show on form) */
    /* Working (owner, 19 Oct 2026): centred over the dimmed page, larger; the step row (spinner, step, Stop) stays, the steps done so far are listed above it. */
    .jp.working { align-items: center; } .jp.working .card:not([hidden]) ~ .pill, .jp.working .left, .jp.working .actions, .jp.working .recheck, .jp.working .tip { display: none; }
    /* Centred over the form, the panel must not catch the driver's own clicks aimed at a field under it: it takes no hit-test while working, except Stop (the person's one way out) and the small minimise button. */
    .jp.working > *, .jp.working .card * { pointer-events: none; } .jp.working .stop-btn, .jp.working .pill-stop, .jp.working .min, .jp.working .card[hidden] ~ .pill { pointer-events: auto; }   /* centred, at the corner's own size (owner, 19 Oct 2026: the 1.3 zoom was too big); minimised, the pill opens it again */
    /* So while working, a button that cannot act is not drawn at all (owner, 27 Oct 2026: "let's not display at all the buttons (cross/x and "tailor CV") if they're not available during the
       extension work"; Report too): every button of the card except Stop, minimise and the step row itself. A new button joins this by itself. Guard: desktop/e2e/test/fill-overlay.test.mjs. */
    .jp.working .card button:not(.stop-btn):not(.min):not(.fill), .jp.working .report-pop { display: none !important; }   /* the Report popup comes back at the end */
    .primary.is-busy .label { flex: 1; text-align: left; font-size: 13px; } .primary.is-busy ~ .stop-btn { padding: 6px 12px; }   /* the step on ONE line beside the spinner, left-aligned, cut with … (the whole sentence is its tooltip): never two centred rows (owner, 27 Oct 2026: "this should not be 2 rows") */
    /* The panel breathes an orange glow while it works (owner, 19 Oct 2026); none under reduced motion. */
    @keyframes breathe { 0%, 100% { box-shadow: 0 10px 34px var(--shadow), 0 0 0 1px var(--line), 0 0 0 0 rgba(255,178,36,0); } 50% { box-shadow: 0 10px 34px var(--shadow), 0 0 0 1px var(--signal-2), 0 0 46px 8px rgba(255,178,36,.6); } }
    .jp.working .card:not([hidden]) { animation: breathe 2.6s ease-in-out infinite; } @media (prefers-reduced-motion: reduce) { .jp.working .card { animation: none; } }
    .steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
    .steps li { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--muted); }
    .steps li::before { content: '\\2713'; color: var(--good); font-weight: 700; width: 14px; flex: none; }
    .live:has(.steps:empty) { display: none; }
    [hidden] { display: none !important; }
  </style>
  <div class="jp">
    <div class="card" hidden>
      <div class="head"><span class="mark"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="16" height="16"><path d="M52 96 L36 150 Q100 198 164 150 L148 96 Z" fill="#15171c"/><ellipse cx="100" cy="84" rx="94" ry="19" fill="#15171c"/><ellipse cx="100" cy="82" rx="56" ry="6.5" fill="#f5c542"/><path d="M100 4 Q107 33 133 38 Q107 43 103 66 Q102 76 100 84 Q98 76 97 66 Q93 43 67 38 Q93 33 100 4" fill="#15171c"/><path d="M110 90 L110 124 Q110 154 87 150 Q75 148 77 138" fill="none" stroke="#f5c542" stroke-width="21" stroke-linecap="round" stroke-linejoin="round"/></svg></span><b>Jobadabra</b><button class="min" title="Minimise" aria-label="Minimise">–</button><button class="x" title="Close" aria-label="Close">×</button></div>
      <div class="body">
        <div class="job" hidden><div class="job-title"></div><div class="job-meta"></div></div>
        <div class="claude" hidden><i>🤖</i><span></span></div>
        <div class="progress"><div class="progress-line"><b></b><span></span></div><div class="bar"><i></i></div></div>
        <div class="stopped" hidden><span class="pause"><i></i><i></i></span><div><b>Stopped by you</b><span class="s-text"></span></div></div>
        <div class="verify" hidden><span class="shield"></span><div class="v-body"><b class="v-title"></b><span class="v-text">Finish it on the page, then press Check again.</span></div><button class="primary v-show" type="button">Show on form</button><button class="link v-again" type="button">Check again</button></div>
        <div class="live"><h4>Done so far</h4><ol class="steps"></ol></div>
        <div class="fill-box"><button class="primary fill"><i class="spin"></i><span class="label">Fill this form</span></button><button class="stop-btn" type="button" title="Stops everything Jobadabra does, on every tab, until you press Apply in the app again">Stop</button><p class="step-hint">Counts update as new fields appear.</p></div>
        <div class="note trace-note" hidden><span>Chrome shows a debugging bar while Jobadabra keeps a trace of this fill, so you can report a problem.</span><button class="got-it" type="button">Got it</button></div>
        <div class="note" hidden><span></span><button class="anyway" hidden>Fill anyway</button></div>
        <div class="left" hidden><h4>Left for you</h4><p class="knock" hidden></p><div class="list"></div></div>
        <button class="secondary recheck" type="button" hidden>Check form again</button>
        <div class="tailor" hidden><span class="t-text"></span><button class="t-btn">Tailor CV + letter</button></div>
        <div class="actions">
          <div class="claude-offer" hidden></div>
          <button class="link go-there" hidden>Go there</button>
          <button class="link open-app" hidden>Open in Jobadabra</button>
        </div>
      </div>
      <div class="tip" hidden><b class="tip-chip"></b><span class="tip-text"></span></div>
      <div class="foot"><span class="state">Checking the connection…</span><button class="report-btn" type="button" title="Send this form to be fixed: you read exactly what would be sent first" aria-label="Report this form"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 14V2.5M3.5 3h8l-1.6 2.7L11.5 8.5h-8"/></svg>Report</button></div>
    </div>
    <button class="pill" title="Jobadabra"><span class="ring"><span></span></span><div><b></b><small></small></div></button>
    <button class="pill-stop" type="button" title="Stops everything Jobadabra does, on every tab, until you press Apply in the app again">Stop</button>
  </div>`;
})();
