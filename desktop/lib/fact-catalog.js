// The facts of Your details that forms ask most, with their fixed ids (owner, 18 Oct 2026): the one list lib/missing-facts.js asks from and the site validates reports against
// (site/src/fact-asks.js). Pure data, no imports, so the site (which has no AI package) can load it. Guarded by test/missing-facts.test.js and test/queue-wording.test.js.
// A fact is its schema only: id, home, kind (the value's kind picks its control) and label (the name its line is saved under and matched by, like lib/contact.js LABELS).
// No question or hint text here: the queue's question writer words them (lib/queue-wording.js; owner, 27 Oct 2026: "Yes, write them too").

// What Your details holds, in the order a fresh install is asked.
export const CATALOG = [
  {id: 'permit', home: 'eligibility', label: 'Work permit / visa', kind: 'text'},
  {id: 'sponsorship', home: 'eligibility', label: 'Need visa sponsorship?', kind: 'yes_no'},
  {id: 'notice', home: 'availability', label: 'Notice period', kind: 'duration'},
  {id: 'start', home: 'availability', label: 'Earliest start date', kind: 'date'},
  {id: 'salary', home: 'availability', label: 'Salary expectation', kind: 'salary'},
  {id: 'languages', home: 'languages', label: 'Languages', kind: 'language'},
];
export const byId = id => CATALOG.find(fact => fact.id === id);
