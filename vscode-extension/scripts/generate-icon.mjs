#!/usr/bin/env node
/**
 * Generates `media/icon.png` (128x128, marketplace icon) from scratch using
 * only Node builtins (`zlib` for DEFLATE) — no binary is copied into the
 * repository, no image dependency is added.
 *
 * Run: node scripts/generate-icon.mjs
 */
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SIZE = 128;
const BACKGROUND = [0, 90, 158, 255]; // dark VS Code blue
const FOREGROUND = [255, 255, 255, 255]; // white play triangle

let crcTable;
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

/** True inside a centred play triangle, used as the icon's glyph. */
function isInsideTriangle(x, y) {
  const cx = SIZE / 2 - 10;
  const cy = SIZE / 2;
  const halfHeight = 34;
  const width = 44;
  const dx = x - cx;
  const dy = y - cy;
  if (dx < 0 || dx > width) {
    return false;
  }
  const halfAtX = halfHeight * (1 - dx / width);
  return Math.abs(dy) <= halfAtX;
}

function buildRawPixels() {
  const rows = [];
  for (let y = 0; y < SIZE; y++) {
    const row = Buffer.alloc(1 + SIZE * 4);
    row[0] = 0; // no per-scanline filter
    for (let x = 0; x < SIZE; x++) {
      const pixel = isInsideTriangle(x, y) ? FOREGROUND : BACKGROUND;
      const offset = 1 + x * 4;
      row[offset] = pixel[0];
      row[offset + 1] = pixel[1];
      row[offset + 2] = pixel[2];
      row[offset + 3] = pixel[3];
    }
    rows.push(row);
  }
  return Buffer.concat(rows);
}

function buildPng() {
  const raw = buildRawPixels();
  const idatData = deflateSync(raw);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(SIZE, 0);
  ihdrData.writeUInt32BE(SIZE, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // colour type: RGBA
  ihdrData[10] = 0; // compression method
  ihdrData[11] = 0; // filter method
  ihdrData[12] = 0; // interlace method

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdrData),
    pngChunk("IDAT", idatData),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

const outPath = join(dirname(fileURLToPath(import.meta.url)), "..", "media", "icon.png");
writeFileSync(outPath, buildPng());
console.log(`Wrote ${outPath}`);
