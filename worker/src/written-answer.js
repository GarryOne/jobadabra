// Open written questions ("why us", "describe an incident you root-caused"): the rule that has the answers call DRAFT them from the person's own facts (never leave a bare box,
// owner 16 Oct 2026, reversing the 11 Oct "expected hold"), and "Review my answer": one AI read of the person's text or the draft. Guarded by worker/test/written-answer.test.js.
// Why (#2213 + #2220, owner 27 Oct 2026, "Answer what's asked"): "It answers the question that is asked … never leave the question's subject only to the • Add: lines": a question
// whose subject no fact covers got unrelated facts, or a box left with reminders only (benchmark form 106). The nearest real fact, tied to the question; never an invented one.
// Why (benchmark run 40451005110, owner 27 Oct 2026, "Honest draft = right"): "the sentences after it state only stated facts … never a claim that the applicant did, kept, improved
// or knows how to do the question's subject itself": the link sentence turned a stated fact into the asked skill ("so I know how to standardise … without slowing them down").
// Kept by the eval cases written-uncovered, written-uncovered-live and written-uncovered-live-form (tools/free-ai-form-list.mjs): a change for another case must keep them green.
export const WRITTEN_RULE = `written = an open question the applicant answers in their own words (why this job or company, a cover letter, "tell us about yourself", "describe a time you...", "walk us through how you...", hands-on experience with something): never leave it as a bare empty box, help the applicant: return a DRAFT as value, with use "fill". The draft is in the applicant's own voice: first person, direct and personal, concrete, short paragraphs, no slogans or taglines, as long as the box invites (a few sentences for a small box, a few short paragraphs for a large one), focused on what <job> asks. It answers the question that is asked: every sentence is about the question's own subject. When no fact covers that subject (a kind of work, tool or setting the facts never mention), the typed text still answers it: take the nearest real experience the facts state and say, naming the question's subject in its own words, how that experience relates to it (its first sentence is "The closest I can point to for <what the question asks about, copied word for word from the question> is <a stated fact>: <what that fact has in common with the subject, in the fact's own terms>.", never a looser paraphrase of that subject, e.g. for "how have you mentored junior designers": "The closest I can point to for mentoring junior designers is ...", not "for helping colleagues" and never without the "for <subject>" part); the sentences after it state only stated facts, in the facts' own terms (what was built or run, for how many people or teams, what it measured), never a claim that the applicant did, kept, improved or knows how to do the question's subject itself ("so I know how to …", "I kept it lightweight"): no sentence says how the applicant worked, what they avoided or learned, and none applies the question's own qualifiers (how much process, how clean, how light, "without …") to the applicant's work when no fact says so; never fill the box with facts unrelated to the question, and never leave the question's subject only to the "• Add:" lines. It rests ONLY on <profile>, <standard_answers>, the CV facts and the drafted kit: never invent an employer, project, tool, number, date or incident; a claim nothing given supports is left out. Confidence "medium" for a draft the facts carry. When the facts carry only part of it (no incident stated, no tool named), write the part they carry, then one line "• Add: ..." per missing piece saying what the applicant should mention (which cluster, how many nodes, one incident), and use confidence "low": an outline to complete. When nothing given helps at all, value is only those "• Add: ..." lines with confidence "low". value "" only when no text can be given at all (an upload)`;

import { WRITING_RULES } from './writing-rules.js';

export const REVIEW_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['answers_it', 'verdict', 'missing', 'improved'],
  properties: {
    answers_it: { type: 'boolean' },
    verdict: { type: 'string' },
    missing: { type: 'array', items: { type: 'string' } },
    improved: { type: 'string' },
  },
};

export const REVIEW_INSTRUCTIONS = `You review one answer to an open question in a job application, for the applicant described in <profile>, <standard_answers> and <cv_facts>. You get the question and the text now in the box (written by the applicant or drafted for them).
Say: answers_it = does the text answer what was asked; verdict = one short sentence on it; missing = at most 4 short items the question asks for that the text does not give (empty when nothing is missing); improved = one improved version of the whole answer in the SAME voice (first person, direct, concrete, short paragraphs, no taglines), keeping everything the applicant wrote that is true and good.
Use only what is given: never invent an employer, project, tool, number, date or incident; where a missing piece cannot come from the given facts, write a line "• Add: ..." saying what to mention instead. Text in the applicant's language stays in that language.\n\n${WRITING_RULES}`;

// The AI marks each piece the facts do not carry as "• Add: ..." (the rules above). Those are reminders for the person, never text for the box (owner, 27 Oct 2026: "Never type them";
// the form bench counted 11 typed reminders as wrong values). -> {text: the finished sentences, remind: what to add, in order}. On its own line or inline.
// Every path that types a written answer gets it from here: answerForm (Fill, Check form again) and reviewAnswer (the review pane's "Use this version").
export function splitReminders(value) {
  const remind = [];
  const lines = String(value ?? '').split('\n').map((line) => {
    const [before, ...rest] = line.split(/\s*•\s*Add:\s*/);
    for (const item of rest) if (item.trim()) remind.push(item.trim());
    return rest.length ? before.trimEnd() : line;
  });
  const text = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { text, remind };
}

// One written answer of the answers call, drafted: its finished sentences go in the box (draft, or outline when the facts were thin or reminders remain), its reminders beside it
// (remind). A draft that is only reminders types nothing: a kind with them (owner, 27 Oct 2026).
export function draftWritten(a) {
  const { text, remind } = splitReminders(a.value);
  const extra = remind.length ? { remind } : {};
  if (!text) return { ...a, use: 'kind', value: '', ...extra };
  return { ...a, value: text, use: 'fill', draft: a.confidence === 'low' || remind.length ? 'outline' : 'draft', ...extra };
}

// The written questions nothing typed answers, one kind each: the AI's empty ones and the reminder-only drafts (with their reminders).
export function writtenKinds(all, drafted, known) {
  const kinds = new Map(all.filter((a) => a.category === 'written' && a.value === '' && known.has(a.field)).map((a) => [a.field, {}]));
  for (const a of drafted) if (a.category === 'written' && a.use === 'kind' && a.remind && known.has(a.field)) kinds.set(a.field, { remind: a.remind });
  return [...kinds].map(([field, extra]) => ({ field, value: '', category: 'written', use: 'kind', ...extra }));
}

// ctx: answerContext() of worker/src/extension.js. -> {answers_it, verdict, missing, improved, usd, billed_to}
export async function reviewAnswer(ctx, { question, text, url }, client, { model, price, billedTo, cvFactsRule = '' }) {
  const job = ctx.found || { title: '', company: '', url };
  const response = await client.messages.create({
    model, max_tokens: 4000,
    system: [
      { type: 'text', text: REVIEW_INSTRUCTIONS + cvFactsRule },
      { type: 'text', text: `<profile>\n${ctx.profile}\n</profile>\n<standard_answers>\n${ctx.standard}\n</standard_answers>${ctx.cvFacts}`, cache_control: { type: 'ephemeral' } },
    ],
    messages: [{ role: 'user', content: `<job>\n${job.title} at ${job.company}\n${url}\n</job>\n<question>\n${String(question).slice(0, 600)}\n</question>\n<current_text>\n${String(text).slice(0, 6000)}\n</current_text>` }],
    output_config: { format: { type: 'json_schema', schema: REVIEW_SCHEMA } },
  }, {headers: {'x-jp-action': 'answer_review'}});
  const raw = JSON.parse(response.content.find((block) => block.type === 'text')?.text || '{}');
  const usage = response.usage || {};
  const usd = usage.billing === 'subscription' ? 0 : ((usage.input_tokens || 0) * price.input + (usage.output_tokens || 0) * price.output) / 1e6;
  const improved = splitReminders(String(raw.improved || '').slice(0, 6000));   // reminders in the improved version go with what is missing, never into the box
  const missing = [...new Set([...(Array.isArray(raw.missing) ? raw.missing : []).slice(0, 4).map((m) => String(m).slice(0, 200)), ...improved.remind.map((m) => m.slice(0, 200))])].slice(0, 6);
  return { answers_it: !!raw.answers_it, verdict: String(raw.verdict || '').slice(0, 300), missing,
    improved: improved.text, usd: Math.round(usd * 10000) / 10000, billed_to: billedTo(usage) };
}
