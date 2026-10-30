// Put unstored AI asks and their recorded refusal before the symptom in failure and alert messages.
// Job: report health
const PREFIX = 'AI asks with no stored answer: ';
const oneLine = value => String(value || '').replace(/\s+/g, ' ').trim();

/** Name refused AI asks by their stored request keys; without refusal evidence preserve the message. Pure. */
export function nameAiFailure(message, {misses = [], capped = null, log = ''} = {}) {
  message = String(message || '');
  const capLine = String(log).split('\n').find(line => line.includes('ai-capped:'));
  if (!capLine && !capped) return message;
  const key = misses[0] || 'unavailable';
  // Both recorded broker forms contain nested parentheses in the reason: stop at the outer delimiter, not the first ')'.
  const reason = /the Codex broker said no \((.*?)\);/.exec(capLine || '')?.[1]
    || /\(Codex broker: (.*)\)\s*$/.exec(capLine || '')?.[1]
    || capped?.why || capLine?.split('ai-capped:')[1]?.trim() || 'no refusal reason recorded';
  return `${PREFIX}${misses.length} (first: ${key}); the AI was refused: ${oneLine(reason)}; the step then failed: ${message}`;
}
