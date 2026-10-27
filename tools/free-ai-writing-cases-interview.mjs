// Free AI writing cases for the two interview steps (tools/free-ai-writing-pairwise.mjs): the call review (src/ai/interviews_ai.py) and the interview patterns (src/ai/interview_insights.py), 5 invented cases each.
// Fictional only (the demo profile): the cases go to a third party. Each case is the app's own request (its real system prompt and schema) + `trap`, what a careless model gets wrong here.
// Why (27 Oct 2026, owner): "interview insights or interview review, or interview patterns insights" were never measured; the app's prompts are dumped by tools/free-ai-writing-prompts.py, never copied here.
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {PROFILE} from './free-ai-writing-cases.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const prompts = () => JSON.parse(execFileSync(process.platform === 'win32' ? 'python' : 'python3', [path.join(here, 'free-ai-writing-prompts.py')], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}));
const ask = (feature, id, system, user, schema, trap, maxTokens) => ({feature, id, trap, params: {max_tokens: maxTokens, system: [{type: 'text', text: system}], messages: [{role: 'user', content: user}], output_config: {format: {type: 'json_schema', schema}}}});

/** The five call-review cases: the app's request over an invented transcript. @returns {object[]} cases with feature 'interview' */
export function interviewCases(writing = prompts()) {
  const system = writing.interview.system + PROFILE;
  const make = (id, apps, caption, transcript, trap) => ask('interview', `interview-${id}`, system,
    `Applications:\n${apps}\n\nCaption: ${caption}\n\nTranscript or notes:\n${transcript}`, writing.interview.schema, trap, 8000);
  const northwind = '0. Northwind Labs — Senior Site Reliability Engineer (stage Interview, applied 2026-10-12)\n1. Helvetia Cloudworks — Platform Engineer (Senior) (stage Applied, applied 2026-10-14)';
  return [
    make('clean', northwind, 'Northwind second call', `Interviewer: Thanks for coming back. Tell me about the worst incident you ran.\nCandidate: In 2023 a bad deploy took our checkout down for forty minutes. I led the call, we rolled back, and the postmortem cut the alert noise that had hidden it, by 60 percent after the migration.\nInterviewer: Good. How do you debug pod-to-pod networking in Kubernetes?\nCandidate: Um, I would check the logs and, yeah, restart things and see. Usually the network team handles that part.\nInterviewer: Okay. We are a team of six on call, one week in six. Questions for me?\nCandidate: What does the on-call handover look like?\nInterviewer: A written note and a thirty minute call. We will come back to you by Friday.`,
      'The networking answer was vague and handed off: it must be marked weak with what a stronger answer adds, using real profile experience only (no invented CNI or tooling). The incident answer is strong. Interviewers by role, no names. Team of six and the Friday next step are facts said in the call; no salary was said, so no salary fact.'),
    make('unnamed', northwind, 'recruiter call this morning', `Recruiter: I am calling about a role at our client, a fintech in Zurich. I cannot name them yet.\nCandidate: Understood. It is a platform role?\nRecruiter: Senior SRE, hybrid, two days in the office. Are you looking?\nCandidate: Yes, I am, and I have eight years on Kubernetes and AWS.\nRecruiter: Notice period?\nCandidate: Two months.\nRecruiter: Fine. I will send you the details tomorrow.`,
      'The employer is not named: company must be an empty string, never "a fintech" or a guess from the listed applications, and the application must be -1. Facts only as said (hybrid, two days in the office; the notice period is the candidate\'s, not a job fact).'),
    make('notes', northwind, 'Northwind', 'my notes: went ok. they asked about on-call and monitoring. said I led the migration. no idea about next steps.',
      'Thin input: the candidate\'s own recollection. The review must say less: no invented questions, quotes, quality grades beyond what the notes support, no salary or team facts, next step "not stated".'),
    make('salary', northwind, 'Northwind hiring manager', `Manager: The range for this role is 150 to 170 thousand francs a year gross, plus bonus.\nCandidate: That fits. My target is 165 thousand.\nManager: It is an employee contract, hybrid, two days in Zurich. We could start in January.\nCandidate: Two months notice, so January works.\nManager: Great, the team lead will call you next week.`,
      'Facts must quote the call and use the fixed formats: salary "150-170k/year gross" (CHF as said), salary_ask 165k/year, contract exactly "Employee", work_mode exactly "Hybrid", start_date January. Never a fact that was not said (no team size, no visa).'),
    make('twoapps', '0. Alpine Payments — Staff SRE (stage Applied, applied 2026-10-02)\n1. Alpine Payments — Senior Site Reliability Engineer (stage Interview, applied 2026-10-09)\n2. Matterhorn Data — Senior DevOps Engineer (stage Applied, applied 2026-10-10)', 'Alpine, second call', `Interviewer: This is the reliability team of Alpine. Last time we covered incidents; today, capacity.\nCandidate: Happy to. I plan capacity from request curves and keep thirty percent headroom on the payment path.\nInterviewer: How do you test that?\nCandidate: Load tests before each peak, and I keep a runbook for scaling up fast.\nInterviewer: Good. Final round is with the director.`,
      'Two applications at the same company: it must pick the one in an interview stage (index 1), not the staff role applied earlier and not Matterhorn. Company "Alpine Payments" is named by the caption.'),
  ];
}

// One reviewed interview as the insights call sees it (src/ai/interview_insights.py prompt_input).
const view = (label, round, company, job, over) => ({label, date: '2026-10-1' + label.slice(1), round, company, job, outcome: 'Pending', topics: [], weak_topics: [], next_step: 'not stated', summary: '', strengths: [], weak_spots: [], practice: [], signals: [], weak_answers: [], mixed_answers: [], could_count_against: [], ...over});

/** The five patterns cases: the app's request over invented reviewed interviews. @returns {object[]} cases with feature 'patterns' */
export function patternsCases(writing = prompts()) {
  const system = writing.patterns.system;
  const make = (id, groups, trap) => {
    const count = Object.values(groups).flat().length;
    return ask('patterns', `patterns-${id}`, system, 'Reviewed interviews (JSON):\n' + JSON.stringify({interviews_reviewed: count, by_round_type: groups}), writing.patterns.schema, trap, 8000);
  };
  return [
    make('one', {Technical: [view('I1', 'Technical 1', 'Northwind Labs', 'Senior SRE', {summary: 'Strong incident story, vague on Kubernetes networking.', strengths: ['Led the 2023 checkout incident call and cut alert noise by 60%'], weak_spots: ['Handed pod-to-pod networking to the network team'], weak_answers: ['How do you debug pod-to-pod networking? Answer: restart things, the network team handles it'], practice: ['Practise a networking debug walk-through']})]},
      'One interview only: nothing may be stated as a recurring pattern; everything is an observation from I1 ("In I1, ..."), confidence low, every quote copied word for word from I1\'s review.'),
    make('recurring', {Technical: [
      view('I1', 'Technical 1', 'Northwind Labs', 'Senior SRE', {weak_spots: ['Answers to design questions ran past three minutes without naming an outcome'], weak_answers: ['Design the on-call rotation: a long story, no decision stated'], strengths: ['Clear postmortem structure']}),
      view('I2', 'Technical 2', 'Helvetia Cloudworks', 'Platform Engineer', {weak_spots: ['The capacity answer wandered through three past jobs before reaching the number'], weak_answers: ['How do you plan capacity? Long answer, the 30% headroom came last'], strengths: ['Clear postmortem structure when asked about incidents']}),
      view('I3', 'Technical 1', 'Alpine Payments', 'Senior SRE', {weak_spots: ['Rambled on the alerting question and never gave the rule of thumb'], weak_answers: ['How do you cut alert noise? Long, the 60% figure came at the end'], strengths: ['Postmortem answer was crisp']})]},
      'A real recurring delivery problem (long answers, the point comes last) across three interviews, plus a strength (crisp postmortems). Must name instances from at least two interviews, quote each interview\'s own review words, keep delivery separate from knowledge, and address the person as "you".'),
    make('gaps', {Technical: [
      view('I1', 'Technical 1', 'Matterhorn Data', 'Senior DevOps', {weak_spots: ['Could not name any IoT protocol when asked directly'], weak_answers: ['Which IoT protocols do you know? No answer given']}),
      view('I2', 'Technical 1', 'Rhein Robotics', 'Principal Platform', {weak_spots: ['Volunteered that golden paths are new to them before being asked', 'No AWS professional certification'], weak_answers: ['Tell us about golden paths: offered that it is not something they have done']})]},
      'Mixed weak moments of different kinds: a knowledge gap asked directly (IoT protocols), a volunteered gap (golden paths) and a missing certification. They must NOT be merged into one "gaps in specifics" pattern; with 2 interviews a pattern needs the same behaviour in both, otherwise observations.'),
    make('thin', {'Recruiter screen': [view('I1', 'Recruiter screen', 'Seine Systems', 'Senior SRE', {summary: 'Short call.'}), view('I2', 'Recruiter screen', 'Tiber Tech', 'Platform Engineer', {summary: 'Went ok.'}), view('I3', 'Recruiter screen', 'Jura Streaming', 'Reliability Engineer', {summary: 'Standard questions.'})]},
      'The reviews hold nothing useful: nothing_useful must be true, the headline says so, the lists stay empty; no invented patterns, strengths or practice steps.'),
    make('rounds', {'Recruiter screen': [view('I1', 'Recruiter screen', 'Alpine Payments', 'Staff SRE', {weak_spots: ['Gave a salary number before asking the range'], signals: ['They need on-call leadership']})], Technical: [view('I2', 'Technical 1', 'Alpine Payments', 'Staff SRE', {weak_spots: ['Vague on capacity planning numbers'], weak_answers: ['Capacity: no numbers given']}), view('I3', 'Technical 2', 'Aare Analytics', 'Infrastructure', {weak_spots: ['Vague on capacity planning numbers', 'No example of Terraform module testing'], weak_answers: ['Capacity: said it depends, gave no numbers']})]},
      'Round types must stay apart: the salary slip belongs to the recruiter screen alone (an observation), the capacity-numbers pattern to the two technical rounds (I2, I3) only; "All" only if the same thing shows in both groups, which it does not.'),
  ];
}
