// A minimal PNG encoder for tests of the screenshot review (lib/png-grid.mjs, review-ui.mjs): 8-bit RGB or RGBA, Chromium's row filters.
import zlib from 'node:zlib';

// A minimal PNG encoder for the test (8-bit RGB or RGBA); each row takes the filter `filterOf(y)` (0 none, 1 sub, 2 up), as Chromium mixes them.
const crc = buf => { let c, crcv = 0xffffffff; for (const b of buf) { c = (crcv ^ b) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcv = (crcv >>> 8) ^ c; } return (crcv ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
export function png(width, height, pixel, {channels = 3, filterOf = () => 0} = {}) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = channels === 4 ? 6 : 2;
  const stride = width * channels, plain = Buffer.alloc(stride * height), raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const p = pixel(x, y); for (let c = 0; c < channels; c++) plain[y * stride + x * channels + c] = p[c] ?? 255; }
  for (let y = 0; y < height; y++) {
    const filter = filterOf(y); raw[y * (stride + 1)] = filter;
    for (let i = 0; i < stride; i++) {
      const v = plain[y * stride + i], left = i >= channels ? plain[y * stride + i - channels] : 0, up = y ? plain[(y - 1) * stride + i] : 0;
      raw[y * (stride + 1) + 1 + i] = (v - (filter === 1 ? left : filter === 2 ? up : 0)) & 0xff;
    }
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
