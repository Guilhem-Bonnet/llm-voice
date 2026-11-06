import { describe, expect, it } from "vitest";
import { repairStreamedWavSizes } from "../../../src/core/wavRepair.js";

function streamedWav(dataBytes: number, announcedData = 2_000_000_000): Uint8Array {
  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode("RIFF"), 0);
  view.setUint32(4, 36 + announcedData, true);
  bytes.set(new TextEncoder().encode("WAVEfmt "), 8);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 24_000, true);
  view.setUint32(28, 48_000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  bytes.set(new TextEncoder().encode("data"), 36);
  view.setUint32(40, announcedData, true);
  return bytes;
}

function sizes(bytes: Uint8Array): { riff: number; data: number; total: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { riff: view.getUint32(4, true), data: view.getUint32(40, true), total: bytes.length };
}

describe("repairStreamedWavSizes", () => {
  it("rewrites both sizes to the bytes received", () => {
    expect(sizes(repairStreamedWavSizes(streamedWav(1000)))).toEqual({ riff: 1036, data: 1000, total: 1044 });
  });

  it("drops a trailing half sample: a stream cut on an odd byte stays decodable", () => {
    expect(sizes(repairStreamedWavSizes(streamedWav(1001)))).toEqual({ riff: 1036, data: 1000, total: 1044 });
  });

  it("returns the same array for a valid file", () => {
    const valid = streamedWav(1000, 1000);
    expect(repairStreamedWavSizes(valid)).toBe(valid);
  });
});
