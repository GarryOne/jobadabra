// Names the AI ask a suite could not answer (operation, id, digests of its parts), so a red says which ask and what in it changed.
// Job: report health
// Invariants: only the operation, a caption or id, the model and short digests are ever returned; no prompt text, no applicant value. Pure except the file reads.
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {questionOf, refusedQuestions} from './ai-answers.mjs';

const shorten = text => String(text).replace(/\s+/g, ' ').trim().slice(0, 160);
const digest = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value) ?? '').digest('hex').slice(0, 8);

/** One question as the harness identifies it ({operation, id|items} or {unkeyable}) -> "app.score/42", or '' when it names nothing. */
export function questionName(question) {
  if (!question || typeof question !== 'object') return '';
  if (question.unkeyable) return `unkeyable (${shorten(question.unkeyable)})`;
  if (!question.operation) return '';
  if (question.id !== undefined) return shorten(`${question.operation}/${question.id}`);
  const items = Array.isArray(question.items) ? question.items : Array.isArray(question.keys) ? question.keys.map(key => ({key})) : [];
  return items.length ? `${question.operation} (${items.length} item${items.length === 1 ? '' : 's'}, first key ${shorten(items[0]?.key ?? '')})` : question.operation;
}

/** The request as short digests per part: two reds' lines compare field by field without the prompt. A document block shows its type and size. */
export function askParts(request) {
  if (!request || typeof request !== 'object') return '';
  const parts = [], blockOf = (role, block) => {
    if (typeof block === 'string') return `${role} text ${digest(block)}`;
    if (block?.type === 'document' || block?.type === 'image') return `${role} ${block.type}(${block.source?.media_type || 'unknown'}, ${String(block.source?.data ?? '').length} chars) ${digest(block.source?.data ?? block)}`;
    return `${role} ${block?.type || 'block'} ${digest(block?.text ?? block)}`;
  };
  if (typeof request.model === 'string') parts.push(`model ${request.model}`);
  for (const [field, value] of Object.entries(request)) {
    if (['model', 'max_tokens', 'stream', 'messages', 'input'].includes(field)) continue;
    parts.push(`${field} ${digest(value)}`);
  }
  const messages = Array.isArray(request.messages) ? request.messages : Array.isArray(request.input) ? request.input : [];
  messages.forEach((message, index) => {
    const blocks = Array.isArray(message?.content) ? message.content : [message?.content ?? ''];
    parts.push(...blocks.map(block => `[${index}] ${blockOf(message?.role || 'message', block)}`));
  });
  return parts.join(', ');
}

/** Name one miss file's ask. A stale-prompt marker names its family; a replay miss goes through the same identification the stand-in uses. */
export function missName(miss, env = process.env) {
  if (!miss || typeof miss !== 'object') return 'unreadable miss file';
  if (miss.family && miss.question) return `stale prompt ${shorten(miss.family)}: ${questionName(miss.question) || 'no identity'}`;
  try {
    const headers = miss.action ? {'x-jp-action': String(miss.action)} : {};
    const named = questionName(questionOf({url: miss.url, headers, body: miss.request}, {...env, E2E_AI_ANSWERS: 'backbone'}));
    return named || 'no identity';
  } catch (error) { return `not identified (${shorten(error.message)})`; }
}

/** "first ask: <name>; parts: <digests>" for the miss file `file` of a suite's ai-misses folder; '' when the file cannot be read as a miss. */
export function missLine(file, env = process.env) {
  let miss;
  try { miss = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { return `first ask: unreadable miss file (${shorten(error.message)})`; }
  const parts = askParts(miss?.request);
  return `first ask: ${missName(miss, env)}${parts ? `; parts: ${parts}` : ''}`;
}

/** Sorted names of the real miss JSON files in `artifacts`/ai-misses (a folder named like one is no miss); [] when the folder is missing. The one list the suite verdict and the hang message both count. */
export function missFiles(artifacts) {
  try { return fs.readdirSync(path.join(artifacts, 'ai-misses'), {withFileTypes: true}).filter(file => file.isFile() && file.name.endsWith('.json')).map(file => file.name).sort(); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}

/**
 * What the AI stand-in turned away in this suite, to follow a hang message: its first refusal, else its first replay miss; '' when it turned nothing away.
 * Why (2 Nov 2026, owner: "why beta is red?"; beta 16 wizard, run 41372979302): the step hung and nothing said the AI had refused the ask it waited for.
 */
export function turnedAway(artifacts, env = process.env) {
  const refused = refusedQuestions({...env, E2E_ARTIFACTS: artifacts});
  if (refused.length) return `; the AI stand-in refused: ${questionName(refused[0].question) || shorten(refused[0].message)}${refused.length > 1 ? ` (+${refused.length - 1} more)` : ''}`;
  const names = missFiles(artifacts);
  return names.length ? `; an AI ask had no stored answer (${names.length} so far), ${missLine(path.join(artifacts, 'ai-misses', names[0]), env)}` : '';
}
