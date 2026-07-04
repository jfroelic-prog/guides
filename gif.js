// StepSnap — self-contained animated GIF89a encoder (no dependencies, no build).
//
// Why hand-rolled: the rest of StepSnap is plain vanilla JS by design, so rather
// than pull in a GIF library we implement just enough of the GIF89a spec to turn
// a list of screenshots into one looping animation.
//
// Usage (browser or Node):
//   const bytes = StepSnapGIF.encode(frames, { width, height, delay: 1200, loop: 0 });
//   // frames: array of RGBA pixel buffers (Uint8ClampedArray|Uint8Array),
//   //         each exactly width*height*4 bytes, all the same size.
//   // delay:  milliseconds each frame is shown.  loop: 0 = forever.
//   // returns: Uint8Array of a complete .gif file.
//
// How it works:
//   1. Build ONE shared 256-colour palette across all frames (median-cut).
//   2. Map every pixel to its nearest palette colour (with a small cache so this
//      stays fast on big screenshots).
//   3. Compress each frame's colour indexes with GIF's variable-width LZW.
//   4. Assemble header + palette + a loop marker + one block per frame.

(function (global) {
  "use strict";

  /* ---------- 1. Median-cut colour quantisation ---------- */

  // Summarise a list of [r,g,b] pixels: their average colour, which colour
  // channel varies most, and by how much (used to decide where to split).
  function makeBox(pixels) {
    let rmin = 255, gmin = 255, bmin = 255, rmax = 0, gmax = 0, bmax = 0;
    let rs = 0, gs = 0, bs = 0;
    for (const p of pixels) {
      const r = p[0], g = p[1], b = p[2];
      if (r < rmin) rmin = r; if (r > rmax) rmax = r;
      if (g < gmin) gmin = g; if (g > gmax) gmax = g;
      if (b < bmin) bmin = b; if (b > bmax) bmax = b;
      rs += r; gs += g; bs += b;
    }
    const rr = rmax - rmin, gr = gmax - gmin, br = bmax - bmin;
    const range = Math.max(rr, gr, br);
    const channel = range === rr ? 0 : range === gr ? 1 : 2;
    const n = pixels.length || 1;
    return { pixels, range, channel,
             avg: [Math.round(rs / n), Math.round(gs / n), Math.round(bs / n)] };
  }

  // Repeatedly split the widest-ranging box at its median until we have
  // maxColors boxes; the average colour of each box becomes a palette entry.
  function medianCut(samples, maxColors) {
    if (!samples.length) return [[0, 0, 0]];
    let boxes = [makeBox(samples)];
    while (boxes.length < maxColors) {
      let bi = -1, best = -1;
      for (let i = 0; i < boxes.length; i++) {
        const b = boxes[i];
        if (b.pixels.length > 1 && b.range > best) { best = b.range; bi = i; }
      }
      if (bi < 0) break; // every box is a single colour — can't split further
      const b = boxes[bi];
      const ch = b.channel;
      b.pixels.sort((p, q) => p[ch] - q[ch]);
      const mid = b.pixels.length >> 1;
      boxes.splice(bi, 1, makeBox(b.pixels.slice(0, mid)),
                          makeBox(b.pixels.slice(mid)));
    }
    return boxes.map((b) => b.avg);
  }

  // Pick a representative sample of pixels across all frames, then median-cut
  // them into a palette. Returns { palette:[[r,g,b]...], bits, tableSize }.
  function buildPalette(frames, pxCount, maxColors) {
    const samples = [];
    const total = frames.length * pxCount;
    const stride = Math.max(1, Math.floor(total / 18000)); // ~18k samples is plenty
    let counter = 0;
    for (const f of frames) {
      for (let i = 0; i < pxCount; i++) {
        if (counter++ % stride) continue;
        const o = i * 4;
        samples.push([f[o], f[o + 1], f[o + 2]]);
      }
    }
    let palette = medianCut(samples, maxColors);
    // GIF colour tables must be a power of two in size (min 4), and the LZW
    // "minimum code size" must be at least 2 bits.
    let bits = 2;
    while ((1 << bits) < palette.length) bits++;
    const tableSize = 1 << bits;
    while (palette.length < tableSize) palette.push([0, 0, 0]);
    return { palette, bits, tableSize };
  }

  // Map every pixel of a frame to the nearest palette index. A 32K-entry cache
  // keyed by the top 5 bits of each channel avoids a full palette search per
  // pixel (screenshots have millions of pixels but few distinct colours).
  function indexFrame(frame, pxCount, palette) {
    const out = new Uint8Array(pxCount);
    const cache = new Int16Array(32768).fill(-1);
    for (let i = 0; i < pxCount; i++) {
      const o = i * 4;
      const r = frame[o], g = frame[o + 1], b = frame[o + 2];
      const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      let idx = cache[key];
      if (idx < 0) {
        let bestD = Infinity, bi = 0;
        for (let p = 0; p < palette.length; p++) {
          const pe = palette[p];
          const dr = r - pe[0], dg = g - pe[1], db = b - pe[2];
          const d = dr * dr + dg * dg + db * db;
          if (d < bestD) { bestD = d; bi = p; }
        }
        cache[key] = idx = bi;
      }
      out[i] = idx;
    }
    return out;
  }

  /* ---------- 2. LZW compression (GIF variable-width codes) ---------- */

  function lzwEncode(minCodeSize, indices) {
    const clearCode = 1 << minCodeSize;
    const eoiCode = clearCode + 1;
    let codeSize = minCodeSize + 1;
    let nextCode = eoiCode + 1;
    let dict = new Map();

    const out = [];
    let bitBuffer = 0, bitCount = 0;
    function write(code) {
      bitBuffer |= code << bitCount;
      bitCount += codeSize;
      while (bitCount >= 8) {
        out.push(bitBuffer & 0xff);
        bitBuffer >>>= 8;
        bitCount -= 8;
      }
    }

    write(clearCode);
    let buffer = indices[0];
    for (let i = 1; i < indices.length; i++) {
      const k = indices[i];
      const key = (buffer << 8) | k;
      if (dict.has(key)) {
        buffer = dict.get(key);
      } else {
        write(buffer);
        dict.set(key, nextCode++);
        // Grow the code width once the table outgrows the current bit width
        // (GIF's "early change" behaviour — matches standard decoders).
        if (nextCode > (1 << codeSize) && codeSize < 12) codeSize++;
        // Table is full: tell the decoder to reset and start a fresh dictionary.
        if (nextCode === 4096) {
          write(clearCode);
          dict = new Map();
          codeSize = minCodeSize + 1;
          nextCode = eoiCode + 1;
        }
        buffer = k;
      }
    }
    write(buffer);
    write(eoiCode);
    if (bitCount > 0) out.push(bitBuffer & 0xff);
    return out;
  }

  /* ---------- 3. Byte assembly ---------- */

  function GifBuffer() {
    this.bytes = [];
  }
  GifBuffer.prototype.byte = function (b) { this.bytes.push(b & 0xff); return this; };
  GifBuffer.prototype.u16 = function (v) { this.bytes.push(v & 0xff, (v >> 8) & 0xff); return this; };
  GifBuffer.prototype.str = function (s) { for (let i = 0; i < s.length; i++) this.bytes.push(s.charCodeAt(i)); return this; };
  GifBuffer.prototype.raw = function (arr) { for (let i = 0; i < arr.length; i++) this.bytes.push(arr[i] & 0xff); return this; };
  // LZW output split into sub-blocks of at most 255 bytes, terminated by a 0.
  GifBuffer.prototype.subBlocks = function (data) {
    let p = 0;
    while (p < data.length) {
      const n = Math.min(255, data.length - p);
      this.byte(n);
      for (let i = 0; i < n; i++) this.byte(data[p + i]);
      p += n;
    }
    this.byte(0);
    return this;
  };

  function encode(frames, opts) {
    const width = opts.width, height = opts.height;
    const pxCount = width * height;
    const delayCs = Math.max(2, Math.round((opts.delay || 1000) / 10)); // centiseconds
    const loop = opts.loop == null ? 0 : opts.loop;

    const { palette, bits, tableSize } = buildPalette(frames, pxCount, 256);
    const minCodeSize = bits; // bits-per-pixel; GIF requires >= 2 (ensured above)

    const g = new GifBuffer();
    // --- Header + Logical Screen Descriptor ---
    g.str("GIF89a");
    g.u16(width).u16(height);
    // Packed: global colour table present (0x80) | colour resolution | table size
    g.byte(0x80 | ((bits - 1) << 4) | (bits - 1));
    g.byte(0); // background colour index
    g.byte(0); // pixel aspect ratio
    // --- Global Colour Table ---
    for (let i = 0; i < tableSize; i++) {
      const c = palette[i] || [0, 0, 0];
      g.byte(c[0]).byte(c[1]).byte(c[2]);
    }
    // --- NETSCAPE2.0 loop extension ---
    g.byte(0x21).byte(0xff).byte(11).str("NETSCAPE2.0");
    g.byte(3).byte(1).u16(loop).byte(0);

    // --- One Graphic Control + Image block per frame ---
    for (const frame of frames) {
      g.byte(0x21).byte(0xf9).byte(4);
      g.byte(0);            // disposal/flags: leave previous frame in place
      g.u16(delayCs);       // delay in 1/100 s
      g.byte(0);            // transparent colour index (unused)
      g.byte(0);            // block terminator

      g.byte(0x2c);         // image descriptor
      g.u16(0).u16(0);      // left, top
      g.u16(width).u16(height);
      g.byte(0);            // no local colour table

      const indices = indexFrame(frame, pxCount, palette);
      g.byte(minCodeSize);
      g.subBlocks(lzwEncode(minCodeSize, indices));
    }

    g.byte(0x3b); // trailer
    return new Uint8Array(g.bytes);
  }

  global.StepSnapGIF = { encode };
})(typeof window !== "undefined" ? window : globalThis);
