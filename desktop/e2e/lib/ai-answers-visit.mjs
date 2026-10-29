// Replay site-relevance judgments per site, preserving roles, places and the uncertainty policy.
// Job: serve stored answers
import {invalid, itemQuestion, json, numbered, requestParts, responseSchema, sameSchema, canonical} from './ai-answers-engine-items.mjs';
/** Explicit per-site booleans compose the engine's keep-number list. */
export const visitKind = {operation: 'app.visit', root: 'keep', mode: 'selection', noun: 'site', valid: answer => typeof answer === 'boolean'};
/** Identify the site SYSTEM and parse each structural name/address/kind/found tuple. */
export function visitQuestion(body, persona) {
  const parts = requestParts(body);
  if (!parts.system.startsWith("You get a job seeker's roles and places, and numbered sites to read jobs from")) return undefined;
  const keep = parts.system.includes('When unsure, keep it.'), leave = parts.system.includes('When unsure, leave it out.');
  const match = /^Their roles: ([\s\S]+)\nTheir places: ([\s\S]+)\nThe sites:\n([\s\S]+)$/.exec(parts.user), roles = match && json(match[1]), places = match && json(match[2]), lines = match && numbered(match[3]);
  if (keep === leave || !Array.isArray(roles) || !roles.every(value => typeof value === 'string') || !Array.isArray(places) || !places.every(value => typeof value === 'string') || !lines || !sameSchema(parts.schema, responseSchema(visitKind))) return invalid(visitKind.operation, 'expected roles, places, site list and keep schema');
  const sites = lines.map(line => {
    const site = /^(.*) \((https?:\/\/\S+)\) \[([^\]\r\n]+)\](?: found in: (.*))?$/.exec(line);
    return site ? {name: site[1], url: site[2], kind: site[3], found: site[4] || ''} : null;
  });
  if (sites.some(site => !site)) return invalid(visitKind.operation, 'ambiguous site line');
  const question = itemQuestion(visitKind.operation, sites.map(canonical), {roles, places, unsure: keep ? 'keep' : 'leave'}, persona);
  question.items.forEach((item, index) => { item.label = `${sites[index].name} (${sites[index].url})`; });
  return question;
}
