// The Technical log in plain words (owner, 7 Oct 2026: "readable by a non-technical person: what it is doing, if it added a job, closed a
// job, is waiting for Claude, is struggling, is scoring, is handling the locations with AI"). The engine's raw lines stay in logs/engine.log
// for debugging; this turns them into one line per thing that happened: noise dropped (Claude timings, pool sharing, Notion links), counters
// collapsed to their latest value, the rest reworded. A line it does not know is kept as it is.
import {aiName} from './ai-name.js';
const SLOW_S = 20, WAITED_S = 30;   // a Claude answer this slow, or a wait for a free slot this long, is worth a line

const host = url => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };
const plural = (n, word) => `${n} ${word}${Number(n) === 1 ? '' : 's'}`;

// "job(s)" as the number before it says ("1 job", "3 jobs"); with no number before it, the plural. Every line passes through here, known or not.
const COUNTED = /\((s|es)\)/g;
export function realPlural(line) {
  return String(line).replace(COUNTED, (found, ending, at, whole) => {
    const clause = whole.slice(0, at).split(/[;:]/).pop();
    const number = /(\d[\d,]*)\D*$/.exec(clause);
    return number && Number(number[1].replace(/,/g, '')) === 1 ? '' : ending;
  });
}

// [pattern, line -> text | null (dropped) | {key, text} (replaces the earlier line with the same key)]
const RULES = [
  // Runs before 18 Oct 2026 also said which place word made the search Swiss (a regex): the boards by name, as the engine says them now.
  [/^Job boards: .+? \(Swiss place word: .*$/, m => m.input.replace(/ \(Swiss place word: .*?\)*(; developer boards left out.*)?$/, '$1')],
  [/^Claude Code (\w+): answered in (\d+) s.*?(?:waited (\d+) s for a free slot)?;/, (m) => {
    const took = Number(m[2]), waited = Number(m[3] || 0);
    if (waited >= WAITED_S) return `⏳ Waited ${waited} s for ${aiName()}: it answers two things at a time`;
    if (took >= SLOW_S) return `🐢 ${aiName()} was slow: ${took} s for one answer`;
    return null;
  }],
  [/^Run counts: /, () => null],   // the Find jobs card's numbers (find-card-model.js runCounts), not a line to read
  [/^(Pool labels|Shared \d+ employer feeds|Pool catch-up|Cronjob run logged|AI: )/, () => null],
  [/^Job Matches: .*\(so far\)$/, () => null],
  [/^Job Matches: (\d+) created, (\d+) updated/, m => (Number(m[1]) + Number(m[2]) ? `📒 Notion Job Matches: ${m[1]} added, ${m[2]} updated` : null)],   // about Notion
  [/^Time budget: this search stops its AI steps at (.+?);/, m => `⏱ ${aiName()} gets up to ${m[1]} this refresh; what is left waits for the next one`],
  // One line per employer the role leaves out (src/sources/feeds.py): counted, one line per reason (the Find card's Live updates show it).
  [/^Employers: (\S+) left out: (.+)$/, (m, state) => ({key: `left-out:${m[2]}`, text: `🏢 ${plural(state.count(`left-out:${m[2]}`), 'employer')} left out: ${m[2]}`})],
  [/^Checked: (.+)$/, (m, state) => ({key: 'checked', text: `🏢 Looked up ${plural(state.count('checked'), 'employer')} from the job boards`})],
  [/^Job board: (\S+) · (.+?) · (.+?)(?: · page \d+)? · (.+)$/, (m, state) => ({key: 'board', text: `🔎 Searched ${m[1]}: ${plural(state.count('board'), 'page')} read`})],
  [/^⏱ This refresh places (\d+) of (\d+) job locations.*?; (\d+) wait/, m => `📍 Asking ${aiName()} where ${m[1]} of ${m[2]} job locations are (${m[3]} next time)`],
  [/^Places: asking \S+ where/, () => null],   // the engine's name (src/ai/providers engine_name): Claude, OpenAI or Codex
  [/^Places: \S+ placed (\d+) location\(s\); (\d+) are in your places/, m => `📍 ${aiName()} placed ${plural(m[1], 'location')}: ${m[2]} in your places`],
  [/^⏱ This refresh sorts (\d+) of (\d+) job titles/, m => `🏷️ Asking ${aiName()} about ${m[1]} of ${m[2]} job titles your role words miss`],
  [/^Titles: asking \S+/, () => null],
  [/^Titles: \S+ sorted (\d+) new title\(s\) in your places; (\d+) could fit/, m => `🏷️ ${aiName()} checked ${plural(m[1], 'job title')}: ${m[2]} could fit you`],
  [/^First jobs: reading (\d+) of (\d+)/, m => `⚡ Reading ${m[1]} of ${plural(m[2], 'employer site')} first`],
  [/^First jobs: (\d+) found$/, m => `⚡ ${plural(m[1], 'job')} found in the first sites`],
  [/^First jobs: (\d+) found, none to score/, () => null],
  [/^First jobs: (\d+) scored in (\d+) s/, m => `🎉 ${plural(m[1], 'first job')} scored in ${m[2]} s; the full search goes on`],
  [/^Jobs so far: (\d+) new from (.+)$/, m => `➕ ${plural(m[1], 'new job')} from ${m[2]}, in your list now`],
  [/^Added (\d+) new job\(s\): (.+)$/, m => `➕ Added ${plural(m[1], 'new job')}: ${m[2]}`],
  [/^New job: (.+?) \| (.*?) \| \S*$/, m => `➕ ${m[1]}${m[2] ? ` · ${m[2]}` : ''}`],
  [/^(Closed|Expired|Unmatched|Removed) 0 job\(s\)/, () => null],
  // Since 10 Oct 2026 the engine says what happened to a job: expired (the posting is gone) or unmatched (outside your search); older runs said Closed.
  [/^Expired (\d+) job\(s\) not seen for (\d+) days/, m => `🗓️ ${plural(m[1], 'job')} expired: no longer listed for ${m[2]} days`],
  [/^Expired (\d+) job\(s\) from employers your search no longer reads/, m => `🗓️ ${plural(m[1], 'job')} expired: from employers you no longer search`],
  [/^Unmatched (\d+) job\(s\) outside your places: (.+)$/, m => `↪️ ${plural(m[1], 'job')} set aside outside your places: ${m[2]}`],
  [/^Removed (\d+) old unmatched or expired job\(s\)/, m => `🧹 Removed ${plural(m[1], 'old job')} from this computer's cache`],
  [/^Closed (\d+) job\(s\) not seen for (\d+) days/, m => `🗑️ Closed ${plural(m[1], 'job')} no longer listed for ${m[2]} days`],
  [/^Closed (\d+) job\(s\) outside your places: (.+)$/, m => `🗑️ Closed ${plural(m[1], 'job')} outside your places: ${m[2]}`],
  [/^Closed (\d+) job\(s\) from employers your search no longer reads/, m => `🗑️ Closed ${plural(m[1], 'job')} from employers you no longer search`],
  [/^Descriptions: read (\d+) of (\d+) missing job texts(.*)$/, m => `📄 Read ${m[1]} of ${m[2]} missing job texts${m[3].replace(/\(tried again next time\)/, '(next refresh tries again)')}`],
  [/^Descriptions: (\d+) of (\d+) missing fetched, (\d+) can't be read from (.+)$/, m =>
    `📄 Fetched ${m[1]} of ${m[2]} missing job texts; ${m[3]} sites don't let us read them (${m[4]})`],   // a run from before 7 Oct 2026
  [/^⏱ This refresh scores (\d+) of (\d+) jobs.*?; (\d+) wait/, m => `🎯 Scoring ${m[1]} of ${m[2]} jobs against your Profile (${m[3]} next time)`],
  [/^Scored (\d+) of (\d+) job\(s\)$/, m => ({key: 'scored', text: `🎯 Scored ${m[1]} of ${plural(m[2], 'job')}`})],
  [/^Scored (\d+) of (\d+) job\(s\) with [^;]+; (\d+) failed/, m => ({key: 'scored', text: `🎯 Scored ${m[1]} of ${plural(m[2], 'job')}` + (Number(m[3]) ? `, ${m[3]} failed` : '')})],
  [/^\d+ job\(s\) to score with/, () => null],
  [/^⏱ (\d+) found job\(s\) wait for the next refresh/, m => `⏱ ${plural(m[1], 'found job')} wait for the next refresh to be scored`],
  [/^Enriched (\d+) of (\d+) job\(s\)/, m => (Number(m[1]) ? `🔍 ${aiName()} read ${plural(m[1], 'job')} for facts (languages, level, pay)` : null)],
  [/^⏱ Time is up for this refresh: (\d+) (.+?) left/, m => `⏱ Time is up: ${m[1]} ${m[2]} wait for the next refresh`],
  [/^Digest ready: (\d+) jobs?, (\d+) new/, m => `📨 Digest ready: ${plural(m[1], 'job')}, ${m[2]} new`],
  [/^Warning: (.+)$/, m => `⚠️ ${m[1]}`],
  // Reading job sites in your Chrome (the Read sites task: tabs the app opened to read)
  [/^Visit: read (\d+) jobs on (.+?) \((.+?)\) from a page you opened; (\d+) new in this visit, \d+ in all, (\d+) matching/, m =>
    `🌐 Read ${plural(m[1], 'job')} on ${m[2]}: ${m[4]} new, ${m[5]} match your search`],
  [/^Visit: the job list of (\S+) is /, m => `🌐 Found the job list of ${m[1]}`],
  [/^Visit filters: 0 steps/, () => null],
  [/^Visit filters: (\d+) steps for (\S+?):? (.+)$/, m => `🎛️ Set ${plural(m[1], 'filter')} on ${host(m[2])}: ${m[3]}`],
  [/^Visit unblock: 0 steps/, () => null],
  [/^Visit unblock: (\d+) steps for (\S+?):? /, m => `🎛️ Tried ${plural(m[1], 'step')} to show the jobs on ${host(m[2])}`],
  [/^Visit: no job list on (\S+?),/, m => `⚠️ Couldn't find a job list on ${host(m[1])}`],
  [/^Visit: the recipe for (\S+) found no jobs/, m => `🔁 ${m[1]} changed: learning how to read it again`],
  [/^Visit: job page of (.+?): not found/, m => `⚠️ No jobs page found for ${m[1]}`],
];

// Progress lines ("⏳ Scoring jobs…: 3 of 29") keep only their latest value, per kind of progress.
const PROGRESS = /^⏳ ([^:·]+?)(?::| ·)/;

export function readableLog(lines = []) {
  const out = [], at = new Map(), counts = new Map();
  let inMessage = false;
  const state = {count: key => { counts.set(key, (counts.get(key) || 0) + 1); return counts.get(key); }};
  const put = (key, text) => {
    if (key && at.has(key)) { out[at.get(key)] = text; return; }
    if (key) at.set(key, out.length);
    out.push(text);
  };
  for (const raw of lines) {
    const line = String(raw ?? '').trimEnd();
    if (line === '<<<message') { inMessage = true; continue; }   // the digest itself: the run's card shows it
    if (line === 'message>>>') { inMessage = false; continue; }
    if (inMessage || !line.trim() || /^[{[]/.test(line)) continue;   // data lines for the app
    const progress = PROGRESS.exec(line);
    if (progress) { put(`progress:${progress[1]}`, realPlural(line)); continue; }
    const rule = RULES.find(([pattern]) => pattern.test(line));
    if (!rule) { put('', realPlural(line)); continue; }
    const result = rule[1](rule[0].exec(line), state);
    if (result == null) continue;
    if (typeof result === 'string') put('', realPlural(result));
    else put(result.key, realPlural(result.text));
  }
  return out;
}
