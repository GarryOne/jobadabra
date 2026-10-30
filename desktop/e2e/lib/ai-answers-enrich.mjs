// Replay extracted posting facts by posting identity and the full, retry or role-only question.
// Job: serve stored answers
import fs from 'node:fs';
import {S, hash, invalid, itemQuestion, object, requestParts, sameSchema, valid} from './ai-answers-engine-items.mjs';
const evidence = S.string, fact = values => S.object({value: S.enum(values), evidence});
const roleFamilies = ['sre', 'platform', 'devops', 'cloud_infrastructure', 'software', 'data', 'security', 'support_it', 'sales_b2b', 'sales_retail', 'logistics', 'hospitality', 'healthcare', 'creative_media', 'finance_admin', 'education', 'trades', 'engineering', 'business_ops', 'manufacturing', 'science', 'customer_service', 'legal', 'aviation_transport', 'public_security', 'other'];
const fields = {
  languages: S.array(S.object({language: S.enum(['English', 'German', 'French', 'Italian', 'Spanish', 'Portuguese', 'Dutch', 'Other']), level: S.enum(['required', 'nice_to_have']), evidence})),
  english_is_enough: fact(['yes', 'no', 'unknown']), seniority: fact(['junior', 'mid', 'senior', 'staff_principal', 'lead_manager', 'unknown']),
  work_mode: S.object({value: S.enum(['onsite', 'hybrid', 'remote', 'unknown']), remote_scope: S.string, evidence}), workload: S.string,
  salary: S.object({stated: S.boolean, text: S.string}), employer_type: fact(['direct_employer', 'recruiter', 'unknown']), role_family: S.enum(roleFamilies),
  technologies: S.array(S.string), responsibilities: S.array(S.string), on_call: S.enum(['yes', 'no', 'unknown']), visa_sponsorship: fact(['offered', 'not_offered', 'unknown']),
  contract: S.enum(['permanent', 'fixed_term', 'freelance', 'internship', 'unknown']), deadline: S.string, posted: S.string, confidence: S.enum(['high', 'medium', 'low']),
};
// Why (30 Oct 2026, a8, quality golden 3006): duties is a transient role-reasoning slot; reviewed rows predating it keep their family judgment.
const roleFields = {duties: S.string, role_family: fields.role_family};
const roleSchema = {...S.object(roleFields), required: ['role_family']};
const answerFields = {...fields, duties: S.string};
/** Validate full or narrowed fact rows against the engine's fixed field contracts. */
export const enrichKind = {operation: 'app.enrich', mode: 'single', noun: 'posting', valid: answer => object(answer) && Object.keys(answer).length > 0 && Object.entries(answer).every(([key, value]) => Object.hasOwn(answerFields, key) && valid(answerFields[key], value))};
enrichKind.validEntry = (answer, key) => {
  const variant = key.split('/').at(-1);
  // Why (30 Oct 2026, a8, quality golden 3006): accept the new slot only on role rows, without changing full/retry contracts or stored answers.
  if (variant === 'role') return valid(roleSchema, answer);
  const names = variant === 'full' ? Object.keys(fields) : variant === 'role' ? ['role_family'] : variant.startsWith('retry-') ? variant.slice(6).split(',') : [];
  return names.length > 0 && (!variant.startsWith('retry-') || names.every(name => ['seniority', 'work_mode', 'technologies'].includes(name))) && new Set(names).size === names.length && names.every(name => Object.hasOwn(fields, name)) && valid(S.object(Object.fromEntries(names.map(name => [name, fields[name]]))), answer);
};

/** Recognize extraction SYSTEM variants and one unambiguous Title/Company/Location identity. */
export function enrichQuestion(body, persona) {
  const parts = requestParts(body), roleOnly = parts.system.startsWith("You name one job's own kind of work for a job-search tool, from its title and posting.");
  if (!roleOnly && !parts.system.startsWith('You extract facts from job postings for a job-search tool.')) return undefined;
  const names = object(parts.schema?.properties) ? Object.keys(parts.schema.properties) : [];
  // Why (30 Oct 2026, a8, quality golden 3006): validate the new required wire slot, but let offline replay reuse the same saved family without duties.
  const dutiesSlot = roleOnly && names.length === 2 && sameSchema(parts.schema, S.object(roleFields));
  if (dutiesSlot) return roleQuestion({...parts, schema: S.object({role_family: fields.role_family})}, persona, roleSchema);
  return roleQuestion(parts, persona);
}

/** Validate an extraction variant and build its posting identity; transient slots do not change its semantic key. */
function roleQuestion(parts, persona, replaySchema) {
  const roleOnly = parts.system.startsWith("You name one job's own kind of work for a job-search tool, from its title and posting.");
  const names = object(parts.schema?.properties) ? Object.keys(parts.schema.properties) : [];
  if (!names.length || names.some(name => !Object.hasOwn(fields, name))) return invalid(enrichKind.operation, 'unsupported extraction fields');
  const responseSchema = S.object(Object.fromEntries(names.map(name => [name, fields[name]])));
  const full = names.length === Object.keys(fields).length;
  if (!sameSchema(parts.schema, responseSchema) || roleOnly && (names.length !== 1 || names[0] !== 'role_family') || !roleOnly && !full && names.some(name => !['seniority', 'work_mode', 'technologies'].includes(name))) return invalid(enrichKind.operation, 'unsupported extraction schema variant');
  const identity = /^Title: ([^\r\n]+)\r?\nCompany: ([^\r\n]+)\r?\nLocation: ([^\r\n]*)\r?\n\r?\nPosting:\n[\s\S]+$/.exec(parts.user);
  if (!identity) return invalid(enrichKind.operation, 'expected Title/Company/Location and Posting');
  const golden = new URL(persona ? `../fixtures/golden-${persona}/` : '../fixtures/golden/', import.meta.url);
  const truth = JSON.parse(fs.readFileSync(new URL('truth.json', golden), 'utf8')), sources = JSON.parse(fs.readFileSync(new URL('sources.json', golden), 'utf8'));
  const matches = truth.filter(item => item.title === identity[1].trim() && (item.company || sources[0].company) === identity[2].trim() && item.location === identity[3].trim());
  // Why (30 Oct 2026, qu-enrich): feed postings need keys too; the tuple hash below prevents borrowing a different posting's answer.
  if (matches.length > 1) return invalid(enrichKind.operation, 'posting identity matches more than one golden row');
  // Why (30 Oct 2026, supervisor): narrow retries and the independent role question are different judgments; none may borrow the full extraction's answer.
  const variant = roleOnly ? 'role' : full ? 'full' : `retry-${[...names].sort().join(',')}`;
  const question = itemQuestion(enrichKind.operation, [identity.slice(1).join('\n')], {}, persona);
  question.items[0].label = identity[1];
  // Why (30 Oct 2026, jobs inventory): fixture IDs collide across catalogs; the title/company/location tuple survives a later catalog extension.
  const posting = {title: identity[1].trim(), company: identity[2].trim(), location: identity[3].trim()};
  question.items[0].key = `${persona || 'default'}/app.enrich/${hash(posting)}/${variant}`;
  return {...question, responseSchema: replaySchema || responseSchema};
}
