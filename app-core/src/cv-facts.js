// The CV's employers, roles, what each role did, the skills and schools as plain lines for the form-answering AI (<cv_facts>), read from the imported cv/cv.json (desktop/lib/cv.js):
// the words as the CV wrote them, so a form's School, Degree, years, Current company or Job title is matched by the AI in any language. Guarded by test/extension.test.js.
const line = parts => parts.map(part => String(part || '').trim()).filter(Boolean).join(' | ');

// cv.json → text; '' when the CV is not imported or states no jobs, schools or skills.
export function cvFactsText(cv) {
  const jobs = (cv?.jobs || []).flatMap(job => (job.roles?.length ? job.roles : [{}]).map(role => line([`employer: ${job.company || ''}`, role.title && `title: ${role.title}`, role.period && `period: ${role.period}`, role.place && `place: ${role.place}`])));
  const schools = (cv?.education || []).map(item => line([`school: ${item.school || ''}`, item.degree && `degree: ${item.degree}`, item.period && `period: ${item.period}`]));
  // what the CV says it did and knows: a yes/no "hands-on X?" or "which tools?" is answered from these words (bake-off 15 Oct 2026: Python/Go and CI/CD tools were proposed because only jobs and schools were sent)
  const skills = [cv?.skills, cv?.extraSkills, ...(cv?.jobs || []).flatMap(job => (job.roles || []).map(role => role.skills))].map(item => String(item || '').trim()).filter(Boolean);
  const did = (cv?.jobs || []).flatMap(job => (job.roles || []).flatMap(role => (role.bullets || []).map(bullet => `done at ${job.company || ''}: ${String(bullet).trim().slice(0, 300)}`)));
  const rows = [...(jobs.length ? ['Jobs, most recent first:', ...jobs] : []), ...(schools.length ? ['Education:', ...schools] : []),
    ...(skills.length ? ['Skills:', ...skills] : []), ...(did.length ? ['What the CV says was done:', ...did] : [])];
  return rows.join('\n').slice(0, 6000);
}

// The system-prompt part: the block and how to read it ('' when there is none).
export const cvFactsBlock = text => (String(text || '').trim()
  ? `\n<cv_facts>\n${String(text).trim()}\n</cv_facts>` : '');
export const CV_FACTS_RULE = '<cv_facts> lists the CV\'s jobs (most recent first; a period ending "Present" or in the current year is the current job) and schools. Use it for the current employer, current job title, school, degree, field and start or end year, matching the form\'s wording in any language; confidence high. It also lists the CV\'s skills and what it says was done: a skill, tool or technology listed there is one the applicant has used. "Years with <tool>" is counted from those roles: the years from the start of the earliest role whose skills or what-was-done name the tool to today (a period ending "Present" runs to the current year), as a number, fact "years_experience"; it is never the whole career\'s years unless every role names the tool, and never "several years".';
