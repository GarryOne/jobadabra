// The screenshot review's "looks the same" test (owner, 26 Oct 2026: review only screenshots whose pixels changed since the last one judged): a PNG decoder
// (node zlib, no dependency) and each screenshot as strips (every pixel row averaged over 16-px columns). Two shots look the same when, cell by cell, their
// strips match either top-aligned or with one vertical shift: CI's window height changes between runs (991 vs 1025 px measured), which moves everything
// anchored to the bottom (the bottom bar, the sidebar's foot) while the page stays put. A build stamp or a ticking clock changes a few cells; a missing,
// moved or recoloured block changes hundreds. Measured on 9 Settings pairs of two CI runs (26 Oct 2026): 6 changed cells both ways on the 3 identical-looking pages (the build stamp),
// 59-2114 on the others. Guarded by test/png-grid.test.mjs.
import zlib from 'node:zlib';

const CHANNELS = {0: 1, 2: 3, 4: 2, 6: 4};   // PNG colour type -> channels (grey, RGB, grey+alpha, RGBA); Chromium's screenshots have no palette

export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let pos = 8, width = 0, height = 0, channels = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), type = buf.toString('latin1', pos + 4, pos + 8), data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4); channels = CHANNELS[data[9]];
      if (data[8] !== 8 || !channels || data[12] !== 0) throw new Error(`PNG kind not read (depth ${data[8]}, colour ${data[9]}, interlace ${data[12]})`);
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = width * channels, pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), out = pixels.subarray(y * stride, (y + 1) * stride);
    const prev = y ? pixels.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? out[i - channels] : 0, b = prev ? prev[i] : 0, c = prev && i >= channels ? prev[i - channels] : 0;
      let add = 0;
      if (filter === 1) add = a;
      else if (filter === 2) add = b;
      else if (filter === 3) add = (a + b) >> 1;
      else if (filter === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[i] = (line[i] + add) & 0xff;
    }
  }
  return {width, height, channels, pixels, pixel: (x, y) => pixels.subarray((y * width + x) * channels, (y * width + x + 1) * channels)};
}

const CELL = 16;
// -> {width, height, cols, cells}: cells[(y * cols + c) * 3 + k] = average of channel k over pixels c*16..c*16+15 of row y.
export function lookStrips(buf) {
  const {width, height, channels, pixels} = decodePng(buf), cols = Math.ceil(width / CELL), cells = Buffer.alloc(cols * height * 3), grey = channels < 3;
  for (let y = 0; y < height; y++) {
    for (let c = 0; c < cols; c++) {
      let r = 0, g = 0, b = 0, n = 0;
      for (let x = c * CELL; x < Math.min(width, (c + 1) * CELL); x++, n++) { const at = (y * width + x) * channels; r += pixels[at]; g += pixels[grey ? at : at + 1]; b += pixels[grey ? at : at + 2]; }
      const out = (y * cols + c) * 3;
      cells[out] = Math.round(r / n); cells[out + 1] = Math.round(g / n); cells[out + 2] = Math.round(b / n);
    }
  }
  return {width, height, cols, cells};
}

const STEP = 24;   // a cell "changed" when a colour channel moved by more than this (out of 255): antialiasing and a dotted background stay under it
function differs(a, ya, b, yb, c) {
  ya = Math.min(Math.max(ya, 0), a.height - 1);   // past an edge: the edge row (the screenshot's margin below a shorter window is plain background)
  const i = (ya * a.cols + c) * 3, j = (yb * b.cols + c) * 3;
  return Math.abs(a.cells[i] - b.cells[j]) > STEP || Math.abs(a.cells[i + 1] - b.cells[j + 1]) > STEP || Math.abs(a.cells[i + 2] - b.cells[j + 2]) > STEP;
}

// -> how many cells of b differ from a, read as "the window got taller or shorter": one shift t for the whole picture, no larger than the two pictures'
// height difference (same height: no shift), and in each 16-px column a row above which it is top-aligned and below which it is shifted by t (the page
// stays put, what is anchored to the bottom moves). A gone or moved block taller than that difference cannot hide in this reading. Another width: Infinity.
export function changedCells(a, b) {
  if (!a || !b || a.width !== b.width || a.cols !== b.cols) return Infinity;
  const top = new Uint32Array(b.height + 1), shifted = new Uint32Array(b.height + 1), grew = a.height - b.height;
  let best = Infinity;
  for (let t = Math.min(0, grew); t <= Math.max(0, grew) && best > 0; t++) {
    let total = 0;
    for (let c = 0; c < b.cols && total < best; c++) {
      for (let y = 0; y < b.height; y++) top[y + 1] = top[y] + differs(a, y, b, y, c);
      shifted[b.height] = 0;
      for (let y = b.height - 1; y >= 0; y--) shifted[y] = shifted[y + 1] + differs(a, y + t, b, y, c);
      let column = Infinity;
      for (let split = 0; split <= b.height; split++) column = Math.min(column, top[split] + shifted[split]);
      total += column;
    }
    best = Math.min(best, total);
  }
  return best;
}

// Same look: at most `spots` changed cells read both ways (12: a build stamp or a clock is 3-6; one changed word in a card is already more).
export const sameLook = (a, b, {spots = 12} = {}) => changedCells(a, b) <= spots && changedCells(b, a) <= spots;

// For the cache file: the strips deflated as base64 (a 1600 x 1000 shot: ~300 KB of cells, a few KB deflated), and back.
export const stripsToJson = s => ({width: s.width, height: s.height, cols: s.cols, cells: zlib.deflateSync(s.cells).toString('base64')});
export function stripsFromJson(json) {
  try { return json && typeof json.cells === 'string' ? {width: json.width, height: json.height, cols: json.cols, cells: zlib.inflateSync(Buffer.from(json.cells, 'base64'))} : null; } catch { return null; }
}
