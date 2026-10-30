// Replay the engine's map-coordinate asks per location, independently of persona or neighbours.
// Job: serve stored answers
import {S, invalid, itemQuestion, numbered, requestParts, responseSchema, sameSchema, valid} from './ai-answers-engine-items.mjs';
const row = S.object({kind: S.enum(['city', 'area', 'country', 'remote', 'unknown']), cc: S.string, lat: S.number, lon: S.number, r_km: S.integer});
/** Stored geographic answer contract; coordinates retain the engine's finite range constraints. */
export const geoKind = {operation: 'app.geo', root: 'places', row, noun: 'location', valid: answer => {
  if (!valid(row, answer)) return false;
  if (['remote', 'unknown'].includes(answer.kind)) return true;
  if (!/^[A-Z]{2}$/.test(answer.cc.toUpperCase()) || ['XX', 'ZZ'].includes(answer.cc.toUpperCase())) return false;
  return answer.kind === 'country' || answer.lat >= -90 && answer.lat <= 90 && answer.lon >= -180 && answer.lon <= 180 && (answer.lat !== 0 || answer.lon !== 0) && answer.r_km >= 1 && answer.r_km <= (answer.kind === 'city' ? 60 : 400);
}};
/** Identify the map SYSTEM and numbered Strings block, never the shared place_triage header alone. */
export function geoQuestion(body) {
  const parts = requestParts(body);
  if (!parts.system.startsWith('You place strings on the map.')) return undefined;
  const texts = parts.user.startsWith('Strings:\n') ? numbered(parts.user.slice(9), 40) : null;
  return texts && sameSchema(parts.schema, responseSchema(geoKind)) ? itemQuestion(geoKind.operation, texts, {}, '', true) : invalid(geoKind.operation, 'expected numbered Strings and map schema');
}
