# What Jobadabra does

Jobadabra looks for new jobs every few hours, reads each one, scores how well it fits you, drafts your answers and fills the application form. **You decide what to apply to, review everything, and click Submit yourself.** It never submits for you.

The Jobadabra app on your Mac does the work. This Notion workspace is where you see and track everything.

# Your pages

| Page | What it's for | Who fills it |
|---|---|---|
| **Job Matches — AI Scored** | Every job that fits your search, with a fit score out of 100 and the reason. Start with the **🎯 Best matches** view | The app |
| **Job Tracker** | One row per opportunity: saved, prepared, applied to, or one that found you (a recruiter), and what happened next. **✅ Active** shows what's in progress | The app, and you (edit the Stage when something changes) |
| **Profile — CV and Preferences** | What jobs are scored against: your experience, places, languages, salary, deal-breakers | Drafted from your CV; **you correct it** |
| **Application Answers — Standard Form Fields** | Your standard answers to common form questions, and how your cover letters should sound | Drafted; **you correct it** |
| **📈 Application Events** | The history of every application: applied, confirmation, screening, interview, rejection | The app (and Gmail, if connected) |
| **🎤 Interviews** | A question-by-question review of each interview you send in | The app |
| **💡 Insights** | One finding a day about your search, and a weekly report on Mondays | The app |
| **Pipeline — Application Funnel** | How many of the jobs you went after (outbound) got replies, screenings and interviews, and the step to improve. Recruiters who found you (inbound) are counted apart | The app |
| **Employers & Sources** | The company career pages being checked | The app; untick **Active** to stop checking one |
| **Job Apply — Agent Runs** | Details of each form an AI agent filled | The app |
| **Cronjob Runs** | Each search: how many new jobs, what the AI cost, and **Billed to** (Claude subscription or API credits) | The app |

# Your AI: Claude Code or an API key

- **You choose** (setup, or Settings → Connections → AI). Switch any time.
- **Claude Code:** your own signed-in `claude` on this Mac; bills your Claude plan, $0 API. Runs show "Claude Code · your plan".
- **API key:** pay per use; runs show the dollar cost.
- **Always on (GitHub) needs an API key**, whichever you pick for the Mac.
- Plan limit reached: the step pauses and retries later (or uses your key, if you ticked that).
- Jobadabra never touches your Claude login: not signed in → run `claude` in Terminal and sign in yourself.

# A normal week

1. **Look at new matches** in Job Matches or in Telegram (a few minutes a day). ⭐ Save the ones you like, dismiss the rest.
2. **Apply** from the app: **Apply to jobs…**, pick how many. Each form is filled for you; check every field, then click Submit yourself.
3. **Record what happens:** confirmations and replies are logged automatically if Gmail is connected; otherwise change the **Stage** in Applications.
   - Log a chat screenshot in the app: it notes **who wrote last**. Your message unanswered 24 hours → Focus says **Follow up**.
4. **After an interview,** send the transcript or your notes; you get a review of each answer.
5. **On Mondays,** read the weekly report in Insights.

# What to edit, and what not to

- **Edit freely:** your Profile, your Application Answers, the Stage and Notes of any application. The next search uses your changes.
- **Please don't rename or delete columns or databases.** The app finds them by name; if something goes missing it tells you what to restore.
- **Add your own views, filters and pages** as you like; they don't affect the app.

# Good to know

- **Your data** is in this Notion workspace and on your Mac. Nothing is stored by Jobadabra on a server.
- **AI costs** go to your own Anthropic account, usually a few dollars a month. Each search's cost is in Cronjob Runs.
- **Jobs page, Show menu:** *New matches* = jobs found for you, not reviewed yet. *Inbound* = recruiters and contacts who found you (never mixed into matches).
- **Fit scores** are a guide, not a verdict: a 65 with a great team can beat an 80.
- **Anything marked ❓** in your Profile or answers is a fact the app doesn't know yet. Fill it in so drafts don't have to guess.
