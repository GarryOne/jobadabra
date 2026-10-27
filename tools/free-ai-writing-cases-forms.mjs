// Free AI writing cases for the form textareas (worker/src/extension.js answerForm, action 'answer') and the CV tailoring (desktop/lib/cv.js tailor, action 'tailor'), 5 invented cases each, for tools/free-ai-writing-pairwise.mjs.
// The app's own request is captured through a stub client that records the call and throws, so the prompts are never copied here. Fictional only (the demo profile): the cases go to a third party.
// Why (27 Oct 2026, owner): "for CV tailoring, or form answers... especially those textarea forms" were never measured. Not covered: the other 'tailor' calls (CV transcription and the CV-change review read, they do not write).
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {tailor} from '../desktop/lib/cv.js';
import {answerForm} from '../worker/src/extension.js';
import {PROFILE, ANSWERS} from './free-ai-writing-cases.mjs';

const jobs = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'free-ai-eval-jobs.json'), 'utf8'));
const job = id => jobs.find(each => each.id === id);

// The request the app would send: the stub client records it and throws, so nothing is answered.
async function capture(run) {
  let seen;
  await run({messages: {create: async params => { seen = params; throw new Error('captured'); }}}).catch(() => {});
  if (!seen) throw new Error('the app made no request to capture');
  const {model, ...params} = seen;   // the model is the eval's to choose
  return {...params, system: typeof params.system === 'string' ? [{type: 'text', text: params.system}] : params.system};   // the judge reads the system prompt as a list of text parts
}

const text = (field, label, required = true) => ({field, label, type: 'text', required});
const area = (field, label, required = true) => ({field, label, type: 'textarea', required});

/** The five textarea-form cases: the app's answerForm request over invented forms. @returns {Promise<object[]>} cases with feature 'answers' */
export async function answersCases() {
  const env = {PROFILE_TEXT: PROFILE, ANSWERS_TEXT: ANSWERS, KNOWLEDGE_TEXT: '', SEARCH_TEXT: '', CV_FACTS_TEXT: ''};
  const make = async (id, posting, fields, trap) => ({feature: 'answers', id: `answers-${id}`, trap,
    params: await capture(client => answerForm(env, {url: `https://example.com/jobs/${posting.id}`, fields, page_text: `${posting.title} at ${posting.company}, ${posting.location}. ${posting.description}`}, client))});
  return [
    await make('why', job('fx-01'), [text('name', 'Full name'), area('why', 'Why do you want to work at Northwind Labs?'), area('incident', 'Describe an incident you led and what changed afterwards')],
      'Written answers must be first person, specific to THIS posting (Kubernetes on AWS, SLOs, on-call), and use only profile facts: 8 years, the 60% alert-noise cut, 40 services, on-call leadership. No invented numbers, no salary, no cliches ("passionate").'),
    await make('level', job('fx-03'), [area('reliability', 'What does reliability mean for a payments company?'), area('else', 'Anything else we should know?', false)],
      'A staff-level role for a senior profile: the answers must not claim a staff title, team size or payments experience the profile lacks; the optional free text may be left short or empty rather than padded.'),
    await make('platform', job('fx-02'), [area('built', 'Tell us about an internal platform you built')],
      'The profile moved 40 services to Kubernetes but built no internal developer platform for 40 teams: the answer must be honest about the gap and bridge with real experience, never claim platform-team ownership.'),
    await make('french', job('fx-13'), [area('fit', 'Why are you a good fit for this role?'), area('french', 'Describe your French level and how you would handle customer calls')],
      'Fluent French is required; the profile shows English, German B1 and Spanish only: no claim of French, no stretched answer; the honest answer states the gap (and may flag the person is not eligible).'),
    await make('cicd', job('fx-04'), [area('cicd', 'What is your experience with CI/CD and monitoring migrations?'), text('german', 'German level (A1-C2)')],
      'Real matches (Argo CD, Terraform, the monitoring migration with the 60% cut) are specific; German is B1 only, never higher. No invented tools, no figure outside the profile.'),
  ];
}

// A base CV from the demo profile (every bullet is a profile fact), in the app's cv.json shape.
const BASE_CV = {name: 'Alex Morgan', location: 'Zurich', summary: 'Site Reliability Engineer with 8 years running Kubernetes on AWS; led the monitoring migration that cut alert noise by 60%.', links: [],
  jobs: [{company: 'Northwind Cloud', href: '', roles: [{title: 'Senior SRE', period: '2022 - Present', place: 'Zurich', intro: '', skills: 'Kubernetes, AWS, Terraform, Prometheus',
    bullets: ['Led the monitoring migration that cut alert noise by **60%**', 'Ran on-call leadership and blameless postmortems for the platform', 'Operated Kubernetes on AWS (EKS) with Terraform and Argo CD']}]},
  {company: 'Contoso Data', href: '', roles: [{title: 'SRE', period: '2018 - 2022', place: 'Remote', intro: '', skills: 'Kubernetes, Helm, Grafana',
    bullets: ['Moved **40 services** to Kubernetes', 'Built dashboards in Grafana and alerts in Prometheus']}]}],
  education: [{school: 'Example Technical University', degree: 'MSc Computer Science', period: '2014 - 2016'}], skills: 'AWS, Kubernetes, Terraform, Argo CD, Helm, Prometheus, Grafana, OpenTelemetry', languages: 'English, German B1, Spanish'};

/** The five CV-tailoring cases: the app's tailor request over the demo CV and an invented posting. @returns {Promise<object[]>} cases with feature 'tailor' */
export async function tailorCases() {
  const make = async (id, posting, trap) => ({feature: 'tailor', id: `tailor-${id}`, trap,
    params: await capture(client => tailor(null, posting, 'unused', {client, base: structuredClone(BASE_CV), profile: PROFILE}))});
  return [
    await make('sre', job('fx-01'), 'A clean fit: reorder and reword toward SLOs, Prometheus and on-call, with the same facts. No new tools, numbers, employers or titles; every figure stays as in the CV.'),
    await make('platform', job('fx-02'), 'A platform role: the CV has no internal platform for teams. The tailored CV must not claim platform ownership, golden paths or a developer portal; it may emphasise the 40 services and Terraform honestly.'),
    await make('lead', job('fx-09'), 'A lead role: the CV shows on-call leadership but no people management. Must not claim managing a team, headcount or hiring.'),
    await make('stream', job('fx-07'), 'A streaming company: no streaming experience in the CV (alert-noise reduction is a real match). Must not invent streaming or video-delivery work.'),
    await make('backend', job('fx-15'), 'A Go backend role: no Go in the CV. Must not add Go or backend product work; skills must not gain a language the CV lacks.'),
  ];
}
