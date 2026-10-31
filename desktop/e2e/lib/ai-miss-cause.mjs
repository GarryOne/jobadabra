// Put unstored AI asks and their recorded refusal before the symptom in failure and alert messages.
// Job: report health
const PREFIX = 'AI asks with no stored answer: ';
const oneLine = value => String(value || '').replace(/\s+/g, ' ').trim();

/**
 * Name refused AI asks by their stored request keys; without refusal evidence preserve the message. Pure.
 * Why (31 Oct 2026, owner's rule: grey only outside our code; a8 via mac-07, beta 41135642422): an ask with no stored answer is OUR gap and comes first, with its key and suite; the refusal (credit, budget) is only why it showed and comes second. A refusal with no unstored ask on record is the refusal alone, never "no stored answer: 0".
 */
export function nameAiFailure(message, {misses = [], capped = null, log = '', suite = '', step = ''} = {}) {
  message = String(message || '');
  const capLine = String(log).split('\n').find(line => line.includes('ai-capped:'));
  if (!capLine && !capped) return message;
  // Why (#2686 review, 31 Oct 2026): a miss file records no step, so the step printed is the step that FAILED, never claimed as the one that asked.
  const where = suite ? `, suite ${suite}` : '', failed = step ? `; failed step "${oneLine(step)}"` : '';
  // Both recorded broker forms contain nested parentheses in the reason: stop at the outer delimiter, not the first ')'.
  const reason = /the Codex broker said no \((.*?)\);/.exec(capLine || '')?.[1]
    || /\(Codex broker: (.*)\)\s*$/.exec(capLine || '')?.[1]
    || capped?.why || capLine?.split('ai-capped:')[1]?.trim() || 'no refusal reason recorded';
  const refused = `the AI was refused: ${oneLine(reason)}; the step then failed: ${message}`;
  return misses.length ? `${PREFIX}${misses.length} (first: ${misses[0]}${where})${failed}; ${refused}` : `${refused[0].toUpperCase()}${refused.slice(1)}`;
}
