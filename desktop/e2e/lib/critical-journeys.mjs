// The critical-journey registry (critical-journeys.json, not the live pool journeys of journeys.json / lib/journey.mjs): the critical journeys the beta proves and the steps
// that prove each, plus the safety or data steps kept though no journey owns them. Read by its guard test; 2/5b makes the beta run these suites.
// Job: pick the suites
// Why (1 Nov 2026, owner via mac-07: "Yes, all 13 journeys (Recommended)"): the registry is the one list of what the beta runs. Safety and data marks stay in code
// (lib/safety-steps.mjs); this file never copies them. Tests: test/critical-journeys.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {suitesUsing} from './import-graph.mjs';

const E2E = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** @returns {{journeys: {id: string, name: string, steps: {suite: string, step: string, parts?: string[]}[]}[], kept: {suite: string, step: string, parts?: string[]}[]}} */
export function loadJourneys(e2eDir = E2E) {
  return JSON.parse(fs.readFileSync(path.join(e2eDir, 'critical-journeys.json'), 'utf8'));
}

/** Every registry step with the group it belongs to ("J5", or "kept" for a safety or data step no journey owns). */
export const registrySteps = registry => [
  ...registry.journeys.flatMap(journey => journey.steps.map(entry => ({...entry, group: journey.id}))),
  ...registry.kept.map(entry => ({...entry, group: 'kept'})),
];

/** The suites holding at least one registry step, sorted. */
export const journeySuites = registry => [...new Set(registrySteps(registry).map(entry => entry.suite))].sort();

// A suite's reachable source: its own file and every helper it imports, with `\'` read as `'` so a name quoted either way matches.
function suiteTexts(e2eDir) {
  const files = {};
  for (const dir of ['suites', 'lib']) for (const name of fs.readdirSync(path.join(e2eDir, dir))) if (name.endsWith('.mjs')) files[`${dir}/${name}`] = fs.readFileSync(path.join(e2eDir, dir, name), 'utf8');
  const used = suitesUsing(e2eDir, files), texts = {};
  for (const [file, suites] of Object.entries(used)) for (const suite of suites) texts[suite] = `${texts[suite] || ''}\n${files[file].replace(/\\(['"`])/g, '$1')}`;
  return texts;
}

/**
 * The registry steps whose name is no longer in their suite's source: a renamed or removed step. A step's name must appear whole in the suite or a helper it imports;
 * a step whose name the code builds (`${what}: the run ends…`) lists the literal `parts` that must each appear instead.
 * @returns {{suite: string, step: string, group: string}[]}
 */
export function missingSteps(registry, e2eDir = E2E) {
  const texts = suiteTexts(e2eDir);
  return registrySteps(registry).filter(entry => !(entry.parts || [entry.step]).every(part => (texts[entry.suite] || '').includes(part)))
    .map(({suite, step, group}) => ({suite, step, group}));
}
