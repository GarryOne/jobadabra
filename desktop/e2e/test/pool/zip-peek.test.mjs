// zip-peek: one entry out of a zip by byte ranges. The archive is built by hand (no zip tool on every CI OS); the spy counts the bytes asked for.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import zlib from 'node:zlib';
import {zipEntry} from '../../lib/zip-peek.mjs';

function u16(n) { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; }
function u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; }
/** entries: [{name, data, deflate}] -> a zip like upload-artifact's (local headers, data, central directory, end record). */
function buildZip(entries, {comment = ''} = {}) {
  const parts = [], central = [];
  let offset = 0;
  for (const {name, data, deflate} of entries) {
    const packed = deflate ? zlib.deflateRawSync(data) : data, method = deflate ? 8 : 0, nameBytes = Buffer.from(name);
    const local = Buffer.concat([u32(0x04034b50), u16(20), u16(0), u16(method), u16(0), u16(0), u32(0), u32(packed.length), u32(data.length), u16(nameBytes.length), u16(4), nameBytes, Buffer.alloc(4)]);
    central.push(Buffer.concat([u32(0x02014b50), u16(20), u16(20), u16(0), u16(method), u16(0), u16(0), u32(0), u32(packed.length), u32(data.length), u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), nameBytes]));
    parts.push(local, packed);
    offset += local.length + packed.length;
  }
  const directory = Buffer.concat(central), note = Buffer.from(comment);
  return Buffer.concat([...parts, directory, u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(directory.length), u32(offset), u16(note.length), note]);
}
const source = zip => { const asked = []; return {asked, length: zip.length, range: async (start, end) => { asked.push([start, end]); return zip.subarray(start, end + 1); }}; };

test('a small entry beside 40 MB of traces is read with a few small ranges, stored or deflated', async () => {
  const traces = Buffer.alloc(40 << 20, 7), steps = Buffer.from(JSON.stringify({v: 1, results: [{name: 'a step', status: 'passed'}]}));
  for (const deflate of [false, true]) {
    const zip = buildZip([{name: 'trace-1.zip', data: traces}, {name: 'steps.json', data: steps, deflate}, {name: 'trace-2.zip', data: traces}]);
    const spy = source(zip);
    assert.deepEqual(JSON.parse((await zipEntry(spy, 'steps.json')).toString()), JSON.parse(steps.toString()));
    const bytes = spy.asked.reduce((sum, [start, end]) => sum + end - start + 1, 0);
    assert.ok(bytes < 200 * 1024, `deflate=${deflate}: ${bytes} bytes asked for, the traces are ${traces.length * 2}`);
    assert.ok(spy.asked.length <= 4, `${spy.asked.length} requests`);
  }
});

test('an archive comment, a missing entry and a shape this does not read all say so, never a guess', async () => {
  const steps = Buffer.from('{"results":[]}');
  const commented = buildZip([{name: 'steps.json', data: steps}], {comment: 'x'.repeat(5000)});
  assert.equal((await zipEntry(source(commented), 'steps.json')).toString(), steps.toString(), 'the end record is found past a comment');
  await assert.rejects(zipEntry(source(buildZip([{name: 'other.json', data: steps}])), 'steps.json'), /no entry steps\.json/);
  await assert.rejects(zipEntry(source(Buffer.alloc(100)), 'steps.json'), /no end-of-central-directory/);
  const zip64 = buildZip([{name: 'steps.json', data: steps}]);
  zip64.writeUInt32LE(0xffffffff, zip64.length - 6);   // the directory offset field of the end record
  await assert.rejects(zipEntry(source(zip64), 'steps.json'), /zip64/);
});
