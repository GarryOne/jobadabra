// The status to preselect in each work zone for a nationality outside Europe and the US (owner, 28 Oct 2026: "considering the nationality can be 190 countries on the
// globe, that's too much of a scripted list… use AI if the nationality is not US or Europe"). Europe and the US stay the fixed table (renderer/work-eligibility.js).
// The AI judges (a Canadian: UK, EU, US); the code keeps only zones and statuses from the fixed sets, per country, cached in settings.zoneSuggestions, so a country
// is asked once. No AI or a failed call leaves the zone unsuggested (never a guess), tried again at the next change. Guarded by test/zone-suggest.test.js.
import {anthropicApi} from './ai/anthropic-api.js';
import {MODEL} from './question-reuse.js';
import {STATUSES, ZONES, countryCode} from '../renderer/work-eligibility.js';

const SCHEMA = {type: 'object', additionalProperties: false, required: ['zones'], properties: {zones: {type: 'array', items: {type: 'object', additionalProperties: false,
  required: ['zone', 'status'], properties: {zone: {type: 'string', enum: ZONES.map(zone => zone.id)}, status: {type: 'string', enum: STATUSES}}}}}};
export const INSTRUCTIONS = `A job seeker is a citizen of one country. For each work zone say how they may work there without a job-specific permit already in hand: ${ZONES.map(zone => `"${zone.id}" = ${zone.label}`).join(', ')}.
Statuses: "yes, freely" (a citizen, or free movement), "yes, with a permit" (a visa, work or youth-mobility scheme normally open to citizens of that country), "no, needs sponsorship" (an employer must sponsor a visa).
Answer every zone once.`;

// Freest first: with two nationalities the better status of each zone wins.
const freest = (a, b) => (STATUSES.indexOf(a) <= STATUSES.indexOf(b) ? a : b);

/**
 * names: English country names -> {zoneId: status} for the zones the AI answered (empty when none is known). Reads and fills settings.zoneSuggestions[ISO code].
 */
export async function suggest(storage, names, {ai = {}} = {}) {
  const codes = [...new Set((names || []).map(countryCode).filter(Boolean))];
  const kept = {...(storage.settings().zoneSuggestions || {})};
  const client = ai.client || (ai.apiKey ? anthropicApi(ai.apiKey) : null);
  for (const code of codes.filter(each => !kept[each])) {
    if (!client) continue;
    const name = names.find(each => countryCode(each) === code);
    try {
      const response = await client.messages.create({model: MODEL, max_tokens: 300, system: INSTRUCTIONS, output_config: {format: {type: 'json_schema', schema: SCHEMA}, effort: 'low'},
        messages: [{role: 'user', content: `<citizenship>${name}</citizenship>`}]});
      const said = JSON.parse(response.content?.find(block => block.type === 'text')?.text || '{}').zones || [];
      const zones = Object.fromEntries(said.filter(each => ZONES.some(zone => zone.id === each.zone) && STATUSES.includes(each.status)).map(each => [each.zone, each.status]));
      if (Object.keys(zones).length) { kept[code] = zones; storage.saveSettings({zoneSuggestions: kept}); }
    } catch { /* tried again at the next change */ }
  }
  const out = {};
  for (const code of codes) for (const [zone, status] of Object.entries(kept[code] || {})) out[zone] = out[zone] ? freest(out[zone], status) : status;
  return out;
}
