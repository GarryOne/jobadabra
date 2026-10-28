// An evidence chip of What we learned opens the fill that taught it: Reports → Form fills on that fill's detail (pages/reports.js openFormFill; Reports first, so the page is showing).
import {openView} from './nav.js';
import {openFormFill} from './reports.js';

/** Shows Reports → Form fills with fill `id` open. */
export function showFormFill(id) {
  openView('reports');
  return openFormFill(id);
}
