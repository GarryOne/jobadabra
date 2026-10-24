// "Full report →" on a search's card or entry: opens Reports → Searches on that run (pages/reports.js openSearchReport; Reports first, so the page is showing).
import {openView} from './nav.js';
import {openSearchReport} from './reports.js';

export function showFullReport(runId, {close = () => {}} = {}) {
  close();
  openView('reports');
  return openSearchReport(runId);
}
