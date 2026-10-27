// Which writing cases a run uses (tools/free-ai-writing-eval.mjs and -pairwise.mjs): the 25 standard ones; --more-letters adds 10 letters; --new-steps adds the interview review and patterns; --form-steps adds the textarea answers and CV tailoring (5 each).
import {allCases} from './free-ai-writing-cases.mjs';
import {answersCases, tailorCases} from './free-ai-writing-cases-forms.mjs';
import {interviewCases, patternsCases} from './free-ai-writing-cases-interview.mjs';

/** @param {string[]} argv process arguments. @returns {Promise<object[]>} cases, each {feature, id, trap, params} */
export async function loadCases(argv) {
  return [...allCases({more: argv.includes('--more-letters')}),
    ...(argv.includes('--new-steps') ? [...interviewCases(), ...patternsCases()] : []),
    ...(argv.includes('--form-steps') ? [...await answersCases(), ...await tailorCases()] : [])];
}
