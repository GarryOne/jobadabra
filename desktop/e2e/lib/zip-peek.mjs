// Reads ONE file out of a zip by byte ranges, so a 1 GB artifact costs three small requests, not a 143 s download.
// Why (1 Nov 2026, mac-07: "node tools/flaky-verdict.mjs --run <id>" printed nothing in 150 s): e2e-view-apply-3of3 of a red run holds the kept traces (1,045,025,600 bytes)
// and the flaky read downloaded all of it to get the 2 KB steps.json. Azure blob storage answers explicit ranges (not "bytes=-N") with 206.
// Invariants: pure over an injected `range(start, end) -> Buffer` (inclusive, like HTTP); zip64 and encrypted entries are refused (throw), never guessed.
// Tests: test/zip-peek.test.mjs
// Job: report health
import zlib from 'node:zlib';

const EOCD = 0x06054b50, CENTRAL = 0x02014b50, LOCAL = 0x04034b50;
const TAIL = 64 * 1024;   // the end-of-central-directory record sits within the last 64 KB + 22 bytes (the zip comment is at most 65535 bytes)

/** @returns {Promise<Buffer>} the bytes of `name` (a string, or a RegExp for the first entry it matches) inside a zip of `length` bytes; throws when the entry is missing or the archive is a shape this does not read. */
export async function zipEntry({length, range}, name) {
  const wanted = typeof name === 'string' ? found => found === name : found => name.test(found);
  const tailFrom = Math.max(0, length - TAIL - 22);
  const tail = await range(tailFrom, length - 1);
  let at = -1;
  for (let i = tail.length - 22; i >= 0; i--) if (tail.readUInt32LE(i) === EOCD) { at = i; break; }
  if (at < 0) throw new Error('zip: no end-of-central-directory record');
  const size = tail.readUInt32LE(at + 12), offset = tail.readUInt32LE(at + 16);
  if (size === 0xffffffff || offset === 0xffffffff) throw new Error('zip: zip64 archives are not read');
  const central = offset >= tailFrom ? tail.subarray(offset - tailFrom, offset - tailFrom + size) : await range(offset, offset + size - 1);
  for (let i = 0; i + 46 <= central.length && central.readUInt32LE(i) === CENTRAL;) {
    const flags = central.readUInt16LE(i + 8), method = central.readUInt16LE(i + 10), packed = central.readUInt32LE(i + 20);
    const nameLength = central.readUInt16LE(i + 28), extraLength = central.readUInt16LE(i + 30), commentLength = central.readUInt16LE(i + 32), local = central.readUInt32LE(i + 42);
    if (wanted(central.toString('utf8', i + 46, i + 46 + nameLength))) {
      if (flags & 1) throw new Error('zip: encrypted entries are not read');
      if (packed === 0xffffffff || local === 0xffffffff) throw new Error('zip: zip64 entries are not read');
      const head = await range(local, local + 29);
      if (head.readUInt32LE(0) !== LOCAL) throw new Error('zip: bad local header');
      const start = local + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
      const data = packed ? await range(start, start + packed - 1) : Buffer.alloc(0);
      if (method === 0) return data;
      if (method === 8) return zlib.inflateRawSync(data);
      throw new Error(`zip: compression method ${method} is not read`);
    }
    i += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`zip: no entry ${name}`);
}
