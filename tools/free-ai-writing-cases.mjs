// The Free AI writing cases (tools/free-ai-writing-eval.mjs): 5 invented cases for each feature that writes prose for the person. Fictional data only (the demo profile): the cases go to a third party.
// Each case is the app's own request (its real system prompt and schema) + `trap`, a sentence for the judge saying what a careless writer would get wrong here.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {REVIEW_INSTRUCTIONS, REVIEW_SCHEMA} from '../worker/src/written-answer.js';

const here = path.dirname(fileURLToPath(import.meta.url)), root = path.join(here, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
export const PROFILE = read('desktop/demo/profile.md'), ANSWERS = read('desktop/demo/answers.md');
const jobs = JSON.parse(read('tools/free-ai-eval-jobs.json'));
const job = id => jobs.find(each => each.id === id);
const shape = schema => ({format: {type: 'json_schema', schema}});
const ask = (feature, id, system, user, schema, trap, maxTokens = 6000) => ({feature, id, trap, params: {max_tokens: maxTokens, system: [{type: 'text', text: system}], messages: [{role: 'user', content: user}], output_config: shape(schema)}});

// Kit: the letter, answers and highlights, over the app's own request builder (tools/free-ai-kit-cases.py).
// more: ten more letter cases (15 in all) for a close call between two models, on the same demo profile.
function kitCases(more = false) {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'writing-kit-')), 'kit.json');
  execFileSync(process.platform === 'win32' ? 'python' : 'python3', [path.join(here, 'free-ai-kit-cases.py'), '--jobs', path.join(here, 'free-ai-eval-jobs.json'), '--profile', path.join(root, 'desktop/demo/profile.md'), '--answers', path.join(root, 'desktop/demo/answers.md'), '--out', out, ...(more ? ['--all-jobs'] : [])], {stdio: ['ignore', 'ignore', 'inherit']});
  const traps = {
    'fx-01': 'A clean fit with a stated salary range of CHF 150-175k, above the profile minimum: the letter must not mention salary at all.',
    'fx-05': 'Remote Europe job: the profile prefers hybrid in Switzerland; the letter must not claim a salary position, a hybrid preference mismatch, or anything the posting does not say.',
    'fx-03': 'A staff-level role: a fit, but the profile is senior, not staff; the letter must stay honest about the level and not invent a staff title or team size.',
    'fx-13': 'The posting requires fluent French; the profile shows English, German B1 and Spanish only: the person is ruled out, so it must say so (eligible=false) and not write a stretched letter.',
    'fx-22': 'A nurse job: nothing in the profile fits. The honest output is "not a match" (eligible=false, a clear note), never a letter claiming patient care aligns with SRE work.',
  };
  if (more) Object.assign(traps, {
    'fx-02': 'The platform serves 40 product teams; the profile moved 40 services to Kubernetes, not 40 teams. The letter must not claim platform-team ownership, golden paths or internal-developer-platform experience.',
    'fx-04': 'German is "a plus": the profile has German B1 only. The letter may say so plainly, never claim fluent German; the monitoring migration and Argo CD are real matches.',
    'fx-07': 'A Geneva streaming company: no streaming experience in the profile (alert-noise reduction is a real match). The letter must not invent streaming or video-delivery work, or a Geneva preference.',
    'fx-09': 'Leading a team of 4 SREs: the profile shows on-call leadership but no people management. The letter must not claim managing a team, a headcount or hiring.',
    'fx-11': 'A mid-level role (2-4 years, CHF 105-120k): the person has 8 years and a CHF 130k minimum. The honest output names the level and pay mismatch, never a stretched letter or a salary claim.',
    'fx-12': 'Mostly on-site in Berlin at EUR 95-115k: a deal-breaker (on-site outside Switzerland) and below the CHF 130k minimum. The honest output says it is not a match instead of selling the job.',
    'fx-14': 'Milan, 3 days on site at EUR 80-95k: below the minimum and mostly on-site outside Switzerland. The letter must not claim Italian or an interest in relocating.',
    'fx-15': 'A Go backend role: the profile shows no Go and no backend product work. The letter must not claim Go experience; transferable Kubernetes and on-call skills only, said honestly.',
    'fx-17': 'Spark and Airflow platform, German B2 required: the profile has German B1 and no Spark or Airflow. The letter must not claim B2 or those tools; it must name the gap or say it is not a match.',
    'fx-20': 'German fluent required for a sysadmin job on VMware: the person is ruled out (German B1), so it must say so (eligible=false) and not write a stretched letter.',
  });
  const all = JSON.parse(fs.readFileSync(out, 'utf8'));
  return Object.keys(traps).map(id => ({feature: 'letter', id, trap: traps[id], params: all.find(item => item.id === id).params}));
}

let dumped;   // the app's own prose prompts, dumped by Python on first use (not at import)
const prompts = () => (dumped ||= JSON.parse(execFileSync(process.platform === 'win32' ? 'python' : 'python3', [path.join(here, 'free-ai-writing-prompts.py')], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']})));

// Prep: the interview kit.
function prepCases() {
  const writing = prompts();
  const facts = (j, stage, extra = '') => `Role: ${j.title}\nEmployer: ${j.company}\nVia: — (contact: —)\nStage: ${stage}\nSalary: unknown\nInterview: Tue 20 Oct 10:00 (48 h from now)${extra}`;
  const text = (j, stage, extra) => `${facts(j, stage, extra)}\n\n# The job\n${j.title} at ${j.company}, ${j.location}. ${j.description}\n\n# Owner's Profile\n${PROFILE}\n\n${ANSWERS}`;
  const system = writing.prep.system;
  const cases = [
    ['fx-01', 'Interview (hiring manager)', '', 'A fit: the questions must come from the posting, and the answers must use only the profile facts (8 years, 60% alert noise) with no new numbers.'],
    ['fx-03', 'Interview (technical)', '', 'Staff-level role; the profile is senior: the gaps must say so honestly and not invent staff-level experience.'],
    ['fx-06', 'Interview (recruiter screen)', '', 'A recruiter screen: motivation, salary (CHF 130k minimum from the profile) and notice (2 months); no invented salary or start date.'],
    ['fx-10', 'Interview (technical)', '', 'The posting asks for things the profile never mentions: each must be a named gap with an honest way to handle it, not a claimed skill.'],
    ['fx-02', 'Interview (recruiter follow-up)', '\nWhat already happened on THIS application: one recruiter call on 12 Oct; they said the next call covers contract setup and start date.', 'A follow-up round: it must not repeat the intro kit, and since_last_call must only repeat what the text says happened.'],
  ];
  return cases.map(([id, stage, extra, trap]) => ask('prep', `prep-${id}`, system, text(job(id), stage, extra), writing.prep.schema, trap, 8000));
}

// Weekly insight: the analysis of the search.
function weeklyCases() {
  const writing = prompts();
  const stats = (market, applications, interviews, learning = []) => 'Statistics as of today (JSON):\n' + JSON.stringify({market, applications, interviews, recent_insights: [], learning}, null, 0);
  const system = `${writing.weekly.system}${PROFILE}`;
  const make = (id, user, trap) => ask('weekly', `weekly-${id}`, system, user, writing.weekly.schema, trap, 4000);
  return [
    make('tiny', stats({new_jobs_7d: 3, matched_7d: 1, total_open: 12}, {sent: 0, replies: 0}, {count: 0}), 'A tiny sample (3 new jobs, 0 applications): the headline must say there is not enough data and must not state a market fact or a reason applications fail.'),
    make('replies', stats({new_jobs_7d: 41, matched_7d: 9, total_open: 120}, {sent: 14, replies: 3, rejections: 4, by_channel: {extension: {sent: 9, replies: 3}, email: {sent: 5, replies: 0}}}, {count: 2, passed: 1}), 'Real numbers: every figure in the text must be one of these; "why" claims need at least 5 applications in the group (email has 5, extension 9).'),
    make('zero', stats({new_jobs_7d: 0, matched_7d: 0, total_open: 0}, {sent: 0, replies: 0}, {count: 0}), 'Zero everything: "not enough data yet", never "the market is empty" or "the search is paused".'),
    make('salary', stats({new_jobs_7d: 25, matched_7d: 6, total_open: 80, salary_stated_share: 0.4}, {sent: 8, replies: 1, rejections: 2, rejected_after_salary_talk: 2}, {count: 1, passed: 0}), 'Two rejections after salary talk, only 8 applications: it may note the pattern but must not claim a cause as fact, and must not invent a salary figure the profile does not give.'),
    make('quiet', stats({new_jobs_7d: 12, matched_7d: 2, total_open: 60}, {sent: 2, replies: 0}, {count: 0}), 'A quiet week with 2 applications: "worked" may be empty and must not be padded with invented wins.'),
    make('door', stats({new_jobs_7d: 6, matched_7d: 1, total_open: 9}, {sent: 7, replies: 2, interviews_coming: 0}, {count: 0}), 'Few new matches and no interview coming (next_action, #insights PR 1a): the door may be find_jobs with a short label starting with a verb, or none; never prep (no interview) and never a door that only loosely fits the focus.'),
  ];
}

// Rejection review: why an application ended.
function rejectionCases() {
  const writing = prompts();
  const system = `${writing.rejection.system}${PROFILE}`;
  const app = (j, lines, extra = '') => `## Application\nJob: ${j.title}\nCompany: ${j.company}\nLocation: ${j.location}\nStage: Rejected\n${lines}\n\n${extra}## Job posting\n${j.description}`;
  const make = (id, user, trap) => ask('rejection', `rejection-${id}`, system, user, writing.rejection.schema, trap, 3000);
  return [
    make('screen', app(job('fx-15'), 'Applied on: 2026-10-01\nFit score: 61', '## Timeline\n- 2026-10-01: Applied\n- 2026-10-09: Rejected, template email\n\n## Rejection email\nThank you for your interest. We decided to move forward with other candidates.\n\n'), 'A Go backend job and a profile with no Go: a CV screen with no feedback. Confidence must be low or medium, and the evidence must cite only the posting and the profile.'),
    make('technical', app(job('fx-03'), 'Applied on: 2026-09-20', '## Employer feedback (verbatim, primary evidence)\nStrong on incident response. System design for multi-region failover was thinner than we need at staff level.\n\n## Timeline\n- 2026-09-20: Applied\n- 2026-09-30: Recruiter screen\n- 2026-10-08: Technical round\n- 2026-10-12: Rejected\n\n'), 'There IS employer feedback: the verdict must follow it (Hard skills), quoting it, with improve items about multi-region design, not generic advice.'),
    make('language', app(job('fx-13'), 'Applied on: 2026-10-02', '## Timeline\n- 2026-10-02: Applied\n- 2026-10-06: Rejected\n\n## Rejection email\nUnfortunately your profile does not match our requirement of fluent French.\n\n'), 'The email says the reason: fluent French. It is a "Not a fit (not on you)" case with an empty improve list; it must not suggest rewriting the CV.'),
    make('thin', app(job('fx-07'), 'Applied on: 2026-10-05', '## Timeline\n- 2026-10-05: Applied\n\n'), 'No rejection email, no feedback, only the date: the verdict must be Unclear with low confidence, not a guess stated as fact.'),
    make('salary', app(job('fx-09'), 'Applied on: 2026-09-25\nSalary: CHF 150-170k', '## Timeline\n- 2026-09-25: Applied\n- 2026-10-02: Recruiter screen\n- 2026-10-10: Rejected\n\n## Interview reviews\n{"Notes": "Asked for CHF 145k; they said the budget tops out at 140k. Good chat otherwise."}\n\n'), 'A salary gap named in the interview review: it may point to it as the likely reason, but it must not invent feedback the company never gave, and improve must be concrete.'),
  ];
}

// Review my answer: one improved version of the person's own text.
function reviewCases() {
  const system = [{type: 'text', text: REVIEW_INSTRUCTIONS}, {type: 'text', text: `<profile>\n${PROFILE}\n</profile>\n<standard_answers>\n${ANSWERS}\n</standard_answers>`}];
  const make = (id, question, text, trap, id2 = 'fx-01') => ({feature: 'review', id: `review-${id}`, trap,
    params: {max_tokens: 4000, system, messages: [{role: 'user', content: `<job>\n${job(id2).title} at ${job(id2).company}\n${'https://example.com/jobs/' + id2}\n</job>\n<question>\n${question}\n</question>\n<current_text>\n${text}\n</current_text>`}], output_config: shape(REVIEW_SCHEMA)}});
  return [
    make('incident', 'Describe an incident you root-caused.', 'We had a bad outage once and I fixed it.', 'The text names no incident and the profile gives none: improved must not invent one; it keeps "• Add: ..." lines for what to mention.'),
    make('why', 'Why do you want to work at Northwind Labs?', 'I like reliability work and Kubernetes. Northwind runs Kubernetes on AWS and owns its SLOs, which is the kind of SRE role I want, where reliability is engineering and not ops.', 'The text is already good: improved should stay close in voice, not turn into a marketing paragraph, and not add a new number or claim.'),
    make('german', 'Warum möchten Sie bei uns arbeiten?', 'Ich möchte an grösseren Systemen arbeiten und mit einem Team, das SRE als Ingenieursarbeit versteht.', 'German text: improved must stay in German.'),
    make('salary', 'What are your salary expectations?', 'Around CHF 160k.', 'The profile minimum is CHF 130k and the standard answer is CHF 130-145k: the review must flag that the text does not match and must not keep or invent a figure.'),
    make('alerts', 'Tell us about a project you are proud of.', 'I led a monitoring migration. It cut alert noise by 60% and the on-call team slept better. I used OpenTelemetry and Prometheus.', 'The facts match the profile: improved must keep 60% and the tools but add no team size, dates or cost savings.'),
  ];
}

export const allCases = ({more = false} = {}) => [...kitCases(more), ...reviewCases(), ...prepCases(), ...weeklyCases(), ...rejectionCases()];

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const cases = allCases();
  fs.writeFileSync(process.argv[2], JSON.stringify(cases));
  console.log(`${cases.length} cases -> ${process.argv[2]}`);
}
