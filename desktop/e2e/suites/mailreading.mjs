// Retired suite pointer: live mail-reading rates now belong to qualityai:mail.
// Job: run tolerant suites as rates
export const name = 'mailreading';
export const cadence = 'manual';
export const light = true;
export const keepGoing = true;
/** Explain the replacement without starting a model call. */
export async function run() {
  console.log('mailreading is retired; name qualityai:mail to run the mail reading part.');
}
