// The facts of Your details that forms ask most, with their fixed ids (owner, 18 Oct 2026): the one list lib/missing-facts.js asks from and the site validates reports against
// (site/src/fact-asks.js). Pure data, no imports, so the site (which has no AI package) can load it. Guarded by test/missing-facts.test.js and test/queue-wording.test.js.
// A fact is its schema only: id, home, kind (the value's kind picks its control) and label (the name its line is saved under and matched by, like lib/contact.js LABELS).
// No question or hint text here: the queue's question writer words them (lib/queue-wording.js; owner, 27 Oct 2026: "Yes, write them too").

// What Your details holds, in the order a fresh install is asked.
export const CATALOG = [
  // Why (28 Oct 2026, owner, #2322): eligibility is Nationality plus three zones; sponsorship and a single "work permit" line are concluded from them, never asked.
  // Labels kept equal to renderer/work-eligibility.js NATIONALITY and ZONES (this file imports nothing: the site loads it).
  {id: 'nationality', home: 'eligibility', label: 'Nationality', kind: 'text'},
  {id: 'zone_eu', home: 'eligibility', label: 'EU / EEA + Switzerland', kind: 'per_country'},
  {id: 'zone_uk', home: 'eligibility', label: 'United Kingdom', kind: 'per_country'},
  {id: 'zone_us', home: 'eligibility', label: 'United States', kind: 'per_country'},
  {id: 'notice', home: 'availability', label: 'Notice period', kind: 'duration'},
  {id: 'start', home: 'availability', label: 'Earliest start date', kind: 'date'},
  {id: 'salary', home: 'availability', label: 'Salary expectation', kind: 'salary'},
  {id: 'languages', home: 'languages', label: 'Languages', kind: 'language'},
];
export const byId = id => CATALOG.find(fact => fact.id === id);
