// Reads ONE file out of a zip by byte ranges, so a 1 GB artifact costs three small requests, not a 143 s download.
// Why (1 Nov 2026, mac-07: "node tools/flaky-verdict.mjs --run <id>" printed nothing in 150 s): e2e-view-apply-3of3 of a red run holds the kept traces (1,045,025,600 bytes)
// and the flaky read downloaded all of it to get the 2 KB steps.json. Azure blob storage answers explicit ranges (not "bytes=-N") with 206.
// Invariants: pure over an injected `range(start, end) -> Buffer` (inclusive, like HTTP); zip64 and encrypted entries are refused (throw), never guessed.
// Tests: test/zip-peek.test.mjs
// Job: report health
import zlib from 'node:zlib';

const EOCD = 0x06054b50, CENTRAL = 0x02014b50, LOCAL = 0x04034b50;
const TAIL = 64 * 1024;   // the end-of-central-directory record sits within the last 64 KB + 22 bytes (the zip comment is at most 65535 bytes)
const NO_ZIP64 = 0xffffffff;

/** The central directory bytes of a zip of `length` bytes (taken from the tail range when it holds them, as a small zip does). */
async function centralDirectory({length, range}) {
  const tailFrom = Math.max(0, length - TAIL - 22);
  const tail = await range(tailFrom, length - 1);
  let at = tail.length - 22;
  while (at >= 0 && tail.readUInt32LE(at) !== EOCD) at--;
  if (at < 0) throw new Error('zip: no end-of-central-directory record');
  const size = tail.readUInt32LE(at + 12), offset = tail.readUInt32LE(at + 16);
  if (size === NO_ZIP64 || offset === NO_ZIP64) throw new Error('zip: zip64 archives are not read');
  return offset >= tailFrom ? tail.subarray(offset - tailFrom, offset - tailFrom + size) : range(offset, offset + size - 1);
}

/** The entries of a central directory, in order: {name, flags, method, packed, local}. */
function* entriesOf(central) {
  for (let i = 0; i + 46 <= central.length && central.readUInt32LE(i) === CENTRAL;) {
    const nameLength = central.readUInt16LE(i + 28), extraLength = central.readUInt16LE(i + 30), commentLength = central.readUInt16LE(i + 32);
    yield {name: central.toString('utf8', i + 46, i + 46 + nameLength), flags: central.readUInt16LE(i + 8), method: central.readUInt16LE(i + 10), packed: central.readUInt32LE(i + 20), local: central.readUInt32LE(i + 42)};
    i += 46 + nameLength + extraLength + commentLength;
  }
}

/** The inflated bytes of one entry: its local header says where the data starts (the local extra field may differ from the central one). */
async function readEntry(range, {flags, method, packed, local}) {
  if (flags & 1) throw new Error('zip: encrypted entries are not read');
  if (packed === NO_ZIP64 || local === NO_ZIP64) throw new Error('zip: zip64 entries are not read');
  const head = await range(local, local + 29);
  if (head.readUInt32LE(0) !== LOCAL) throw new Error('zip: bad local header');
  const start = local + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
  const data = packed ? await range(start, start + packed - 1) : Buffer.alloc(0);
  if (method === 0) return data;
  if (method === 8) return zlib.inflateRawSync(data);
  throw new Error(`zip: compression method ${method} is not read`);
}

/** @returns {Promise<Buffer>} the bytes of `name` (a string, or a RegExp for the first entry it matches) inside a zip of `length` bytes; throws when the entry is missing or the archive is a shape this does not read. */
export async function zipEntry(source, name) {
  const wanted = typeof name === 'string' ? found => found === name : found => name.test(found);
  const found = [...entriesOf(await centralDirectory(source))].find(entry => wanted(entry.name));
  if (!found) throw new Error(`zip: no entry ${name}`);
  return readEntry(source.range, found);
}
